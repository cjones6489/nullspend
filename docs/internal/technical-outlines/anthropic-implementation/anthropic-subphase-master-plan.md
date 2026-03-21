# Anthropic Provider Implementation — Master Sub-Phase Plan

> **Parent scope:** Phase 4 of the NullSpend FinOps roadmap.
>
> **Goal:** Add full Anthropic Claude API support to the proxy with accurate
> cost tracking, streaming passthrough, and budget enforcement — using the
> same patterns established by the OpenAI implementation.
>
> **Guiding principle:** Each sub-phase produces a deployable, testable
> increment. No sub-phase depends on code that hasn't been built and tested
> in a prior sub-phase. Each sub-phase has its own acceptance criteria and
> test suite that must pass before moving to the next.
>
> **Reference documents:**
> - `docs/technical-outlines/anthropic-implementation/Anthropic Claude API proxy-complete implementation reference.md`
> - `docs/technical-outlines/anthropic-implementation/phase-4a-anthropic-pricing-cost-calculator.md`

---

## Sub-Phase Overview

| Phase | Name | What It Produces | Dependencies |
|-------|------|-----------------|--------------|
| **4A** | Pricing Data + Cost Calculator | Pricing JSON, `calculateAnthropicCost()`, unit tests | None |
| **4B** | Anthropic SSE Parser | `createAnthropicSSEParser()`, unit tests | None (parallel with 4A) |
| **4C** | Route Handler + Header Mapping | `/v1/messages` route, auth, upstream forwarding, non-streaming cost tracking | 4A, 4B |
| **4D** | Budget Enforcement + Cost Estimator | Anthropic cost estimator, budget wiring, streaming cost tracking | 4A, 4B, 4C |
| **4E** | Smoke Tests + Deployment | E2E tests against live Anthropic API, deploy to production | 4A–4D |

**Parallelism:** Phases 4A and 4B have zero shared code and can be built
simultaneously. Phase 4C is the integration point. Phase 4D layers on
budget enforcement. Phase 4E validates everything end-to-end.

---

## Phase 4A: Pricing Data + Cost Calculator

**Status:** Detailed plan exists at `phase-4a-anthropic-pricing-cost-calculator.md`

### Summary

Pure functions and data only. No proxy, no Redis, no Postgres. Everything
lives in `packages/cost-engine/` and `apps/proxy/src/lib/`. Testable in
isolation with Vitest.

### Deliverables

1. **Pricing data** — Add all current Anthropic models (including dated
   aliases) to `packages/cost-engine/src/pricing-data.json`
2. **Type definitions** — `AnthropicRawUsage` and
   `AnthropicCacheCreationDetail` in `apps/proxy/src/lib/anthropic-types.ts`
3. **Cost calculator** — `calculateAnthropicCost()` in
   `apps/proxy/src/lib/anthropic-cost-calculator.ts`
4. **Unit tests** — ~25 tests covering 7 known competitor bugs (AC-1
   through AC-7), long context pricing, edge cases, multi-model pricing
   verification, and pricing catalog structural validation

### Key Design Decisions (already made)

- Cache write default: assume 5-min TTL when no breakdown is available
  (conservative; undercharges slightly for 1-hour writes rather than
  overcharging for 5-min writes)
- Long context threshold: >200K total input tokens triggers 2x input /
  1.5x output multiplier
- `inputTokens` in DB stores *total* input (uncached + cache_creation +
  cache_read) for consistency with the OpenAI column semantics
- `reasoningTokens` stored as 0 — Anthropic includes thinking tokens in
  `output_tokens` with no separate breakdown
- `cachedInputTokens` in DB stores `cache_read_input_tokens` (the
  discounted-rate tokens), matching OpenAI's `cached_tokens` semantics

### Files Created/Modified

| File | Action |
|------|--------|
| `packages/cost-engine/src/pricing-data.json` | Modify — add ~15 Anthropic entries |
| `apps/proxy/src/lib/anthropic-types.ts` | Create |
| `apps/proxy/src/lib/anthropic-cost-calculator.ts` | Create |
| `apps/proxy/src/__tests__/anthropic-cost-calculator.test.ts` | Create |
| `packages/cost-engine/src/anthropic-catalog.test.ts` | Create |

### Acceptance Criteria

- All 7 AC bug regression tests pass
- Long context multipliers apply correctly at the >200K boundary
- TTL-specific cache write rates used when breakdown is available
- Unknown models return 0 cost (not an error)
- All existing OpenAI tests still pass (no regressions)

### Estimated Effort

1 day build, 1 day testing.

---

## Phase 4B: Anthropic SSE Parser

### Summary

A new streaming parser purpose-built for Anthropic's named-event SSE
format. This is structurally different from OpenAI's single-type `data:`
lines — Anthropic uses `event: message_start`, `event: content_block_delta`,
etc. The existing `sse-parser.ts` (OpenAI) is not modified.

### Why a Separate Parser

OpenAI SSE:
```
data: {"id":"chatcmpl-...","choices":[...],"usage":null}
data: {"id":"chatcmpl-...","choices":[],"usage":{...}}
data: [DONE]
```

Anthropic SSE:
```
event: message_start
data: {"type":"message_start","message":{"usage":{"input_tokens":25,...}}}

event: content_block_delta
data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}

event: message_delta
data: {"type":"message_delta","usage":{"output_tokens":15}}

event: message_stop
data: {"type":"message_stop"}
```

Anthropic's format has named events, two separate usage extraction points,
cumulative (not incremental) token counts in `message_delta`, and no
`[DONE]` sentinel. Sharing a parser would be fragile and bug-prone.

### Deliverables

1. **SSE parser** — `createAnthropicSSEParser()` in
   `apps/proxy/src/lib/anthropic-sse-parser.ts`
2. **Unit tests** — in
   `apps/proxy/src/__tests__/anthropic-sse-parser.test.ts`

### File: `apps/proxy/src/lib/anthropic-sse-parser.ts`

#### Interface

```typescript
export interface AnthropicSSEResult {
  usage: AnthropicRawUsage | null;
  cacheCreationDetail: AnthropicCacheCreationDetail | null;
  model: string | null;
  stopReason: string | null;
}

export function createAnthropicSSEParser(
  upstreamBody: ReadableStream<Uint8Array>,
): {
  readable: ReadableStream<Uint8Array>;
  resultPromise: Promise<AnthropicSSEResult>;
};
```

#### Architecture — TransformStream Tee

Same pattern as the OpenAI parser: a `TransformStream` that passes bytes
through unmodified to the client while extracting metadata from the SSE
events. The proxy never modifies the upstream response.

#### Event Processing Rules

**Line buffering:** Same as OpenAI parser — accumulate text in a line
buffer, process on `\n`, keep incomplete lines for the next chunk. Uses
`TextDecoder` with `{ stream: true }` for multi-byte UTF-8 safety.

**Two-line state machine:** Unlike OpenAI (where we only look at `data:`
lines), Anthropic requires tracking both `event:` and `data:` lines
together:

```
State: currentEventType = null

On line starting with "event: ":
  currentEventType = line.slice(7).trim()

On line starting with "data: ":
  payload = JSON.parse(line.slice(5).trim())
  processEvent(currentEventType, payload)
  currentEventType = null   // reset after processing

On empty line:
  currentEventType = null   // reset on event boundary
```

**Token extraction (two points only):**

1. **`message_start`** — Extract from `payload.message.usage`:
   - `input_tokens` (uncached input)
   - `cache_creation_input_tokens`
   - `cache_read_input_tokens`
   - Also capture `payload.message.model`

2. **`message_delta`** — Extract from `payload.usage`:
   - `output_tokens` (cumulative, not incremental)
   - If `input_tokens` is present, it overrides `message_start` values
     (happens with server tools like web search)
   - `cache_creation_input_tokens` and `cache_read_input_tokens` here are
     cumulative — do NOT add to `message_start` values. Use them as
     authoritative finals, or ignore if they match `message_start`.
   - Extract `payload.delta.stop_reason`

**Events to handle:**

| Event Type | Action |
|------------|--------|
| `message_start` | Extract input tokens, model |
| `content_block_start` | Pass through (no extraction needed) |
| `content_block_delta` | Pass through (text/thinking/tool content) |
| `content_block_stop` | Pass through |
| `message_delta` | Extract output tokens, stop reason |
| `message_stop` | Stream complete — resolve result promise |
| `ping` | Pass through (keepalive) |
| `error` | Pass through, log warning |
| Unknown | Pass through silently (future-proof) |

**On stream cancel:** Resolve with whatever tokens have been captured so
far. Input tokens from `message_start` will be available; output tokens
may be missing if `message_delta` hasn't arrived. The cost calculator
handles `output_tokens: 0` gracefully.

**On flush (stream ends without `message_stop`):** Process any remaining
buffered lines, then resolve.

### Key Pitfall: Cumulative vs. Delta

This is the LangChain.js #10249 bug. The `message_delta` event's cache
token fields are cumulative — they represent the same values as
`message_start`, not additional tokens. The parser must NOT sum them:

```typescript
// WRONG — produces 2x the actual cache tokens
finalUsage.cache_read_input_tokens =
  messageStartUsage.cache_read + messageDeltaUsage.cache_read;

// CORRECT — use message_delta values as authoritative finals
if (messageDeltaUsage.cache_read_input_tokens !== undefined) {
  finalUsage.cache_read_input_tokens = messageDeltaUsage.cache_read_input_tokens;
}
```

Strategy: store `message_start` usage as initial state. When
`message_delta` arrives, overlay its `usage` fields onto the stored state.
For `output_tokens`, always take `message_delta`'s value (it's cumulative).
For input/cache fields, take `message_delta`'s values if present (they may
be updated by server tools), otherwise keep `message_start`'s values.

### Test Plan

#### Synthetic SSE Stream Construction

Build test helpers that construct valid Anthropic SSE byte streams from
structured event arrays:

```typescript
function buildAnthropicSSEStream(events: Array<{
  event: string;
  data: Record<string, unknown>;
}>): ReadableStream<Uint8Array>;
```

#### Test Cases

**Basic non-streaming usage extraction:**
```
message_start with input_tokens=25, cache_creation=0, cache_read=0
message_delta with output_tokens=15
→ usage: { input_tokens: 25, output_tokens: 15, cache_creation: 0, cache_read: 0 }
```

**Cached request:**
```
message_start with input_tokens=5, cache_creation=1253, cache_read=128955
message_delta with output_tokens=503
→ usage matches all fields
```

**Cumulative cache tokens — NOT double-counted:**
```
message_start with cache_read=128955
message_delta with cache_read=128955 (same value, cumulative)
→ cache_read_input_tokens = 128955, NOT 257910
```

**Server tool updates input tokens in message_delta:**
```
message_start with input_tokens=25
message_delta with input_tokens=50, output_tokens=15
→ Final input_tokens = 50 (overridden by message_delta)
```

**Extended thinking stream sequence:**
```
message_start → thinking content_block_start → thinking_delta events →
signature_delta → content_block_stop → text content_block_start →
text_delta events → content_block_stop → message_delta → message_stop
→ Correct output_tokens captured, model captured from message_start
```

**Ping events interspersed:**
```
message_start → ping → content_block_start → ping → ... → message_stop
→ Pings don't affect usage extraction
```

**Error event mid-stream:**
```
message_start → content_block_delta → error event
→ Partial usage captured (input from message_start, no output)
```

**Stream cancellation before message_delta:**
```
message_start (input_tokens=25) → content_block_delta → [stream cancelled]
→ usage.input_tokens = 25, usage.output_tokens = 0 (or null)
```

**Chunked data split across boundaries:**
```
SSE events split at arbitrary byte boundaries (mid-UTF8, mid-JSON)
→ Parser correctly reassembles and extracts usage
```

**Empty stream (upstream sends nothing useful):**
```
ping → message_stop (no message_start)
→ usage = null, model = null
```

**Model extraction from message_start:**
```
message_start with model "claude-sonnet-4-5-20250929"
→ result.model === "claude-sonnet-4-5-20250929"
```

**Bytes pass through unmodified:**
```
Compare input bytes to output bytes of the readable stream
→ Exact byte equality
```

### Files Created

| File | Action |
|------|--------|
| `apps/proxy/src/lib/anthropic-sse-parser.ts` | Create |
| `apps/proxy/src/__tests__/anthropic-sse-parser.test.ts` | Create |

### Acceptance Criteria

- Parser extracts correct usage from synthetic Anthropic SSE streams
- Cumulative cache tokens are not double-counted
- Server-tool input token overrides work correctly
- Stream cancellation returns partial usage gracefully
- Bytes pass through unmodified (no re-encoding, no event stripping)
- All existing OpenAI SSE parser tests still pass
- Unknown event types are passed through without error

### Estimated Effort

0.5 day build, 0.5 day testing.

---

## Phase 4C: Route Handler + Header Mapping

### Summary

The integration phase. Wires the cost calculator (4A) and SSE parser (4B)
into a new Anthropic route handler, adds header transformation for
Anthropic's auth model, and registers the `/v1/messages` route in the
proxy entry point. By the end of this phase, the proxy can forward
Anthropic requests with accurate cost tracking for both streaming and
non-streaming responses.

Budget enforcement is deferred to Phase 4D. This phase focuses on:
getting traffic flowing, costs calculated correctly, and cost events
logged to the database.

### Deliverables

1. **Constants** — Add Anthropic base URL to `constants.ts`
2. **Header handlers** — Anthropic-specific upstream and client header
   builders in `apps/proxy/src/lib/anthropic-headers.ts`
3. **Route handler** — `handleAnthropicMessages()` in
   `apps/proxy/src/routes/anthropic.ts`
4. **Entry point update** — Register `/v1/messages` route in `index.ts`
5. **Unit tests** — Header handling tests, route handler unit tests

### File: `apps/proxy/src/lib/constants.ts`

Add:
```typescript
export const ANTHROPIC_BASE_URL = "https://api.anthropic.com";
```

### File: `apps/proxy/src/lib/anthropic-headers.ts`

#### Upstream Headers (proxy → Anthropic)

Anthropic uses a different auth model than OpenAI:
- OpenAI: `Authorization: Bearer sk-...`
- Anthropic: `x-api-key: sk-ant-api03-...`

The proxy receives the user's real Anthropic API key via the standard
`Authorization: Bearer <key>` header (or optionally via `x-api-key`). It
strips proxy-specific headers and forwards the key as `x-api-key` to
Anthropic.

```typescript
export function buildAnthropicUpstreamHeaders(request: Request): Headers {
  const headers = new Headers();

  // Auth: extract Bearer token or x-api-key and forward as x-api-key
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    headers.set("x-api-key", authHeader.slice(7));
  } else {
    const xApiKey = request.headers.get("x-api-key");
    if (xApiKey) headers.set("x-api-key", xApiKey);
  }

  // Required headers
  headers.set("anthropic-version", "2023-06-01");
  headers.set("content-type", "application/json");

  // Forward beta features if present
  const beta = request.headers.get("anthropic-beta");
  if (beta) headers.set("anthropic-beta", beta);

  return headers;
}
```

**Design decision: hardcode `anthropic-version: 2023-06-01`.** This is
still the only stable version as of March 2026. Clients may omit it
(relying on SDK defaults), so we inject it. If Anthropic ever bumps the
version, we update this constant — it's a single line change.

#### Client Headers (proxy → caller)

```typescript
export function buildAnthropicClientHeaders(upstreamResponse: Response): Headers {
  const headers = new Headers();

  // Content type
  const ct = upstreamResponse.headers.get("content-type");
  if (ct) headers.set("content-type", ct);

  // Anthropic request ID (different format from OpenAI: "req_018...")
  const requestId = upstreamResponse.headers.get("request-id");
  if (requestId) headers.set("x-request-id", requestId);

  // Forward Anthropic rate-limit headers
  for (const [name, value] of upstreamResponse.headers) {
    if (name.startsWith("anthropic-ratelimit-")) {
      headers.set(name, value);
    }
  }

  // Retry-after for 429s
  const retryAfter = upstreamResponse.headers.get("retry-after");
  if (retryAfter) headers.set("retry-after", retryAfter);

  return headers;
}
```

**Note on `request-id` normalization:** Anthropic returns `request-id`
(no `x-` prefix). We normalize to `x-request-id` in the client response
for consistency with our OpenAI behavior. The raw Anthropic `request-id`
value (e.g., `req_018EeWyXxfu5pfWkrYcMdjWG`) is used as the
`requestId` for cost event tracking.

### File: `apps/proxy/src/routes/anthropic.ts`

Mirrors the structure of `routes/openai.ts` but without budget
enforcement (added in 4D). The handler:

1. Validates `X-NullSpend-Auth` platform key (reuses `auth.ts`)
2. Extracts `model` from request body
3. Validates model against `isKnownModel("anthropic", model)`
4. Builds upstream headers via `buildAnthropicUpstreamHeaders()`
5. Forwards request to `https://api.anthropic.com/v1/messages`
6. On non-streaming: parse response JSON, extract `usage` and
   `cache_creation`, call `calculateAnthropicCost()`, log via
   `waitUntil(logCostEvent(...))`
7. On streaming: pipe through `createAnthropicSSEParser()`, log cost in
   `waitUntil` after `resultPromise` resolves

#### Anthropic-Specific Request Handling

Unlike OpenAI, Anthropic does NOT have `stream_options.include_usage` —
usage is always present in streaming events. So there is no equivalent of
`ensureStreamOptions()`. The `stream` field is simply read from the body.

The `model` field extraction works the same way (`body.model`).

#### Non-Streaming Flow

```
Client → proxy → POST api.anthropic.com/v1/messages
                          ↓
                   200 JSON response
                          ↓
              Parse response.usage + response.cache_creation
                          ↓
              calculateAnthropicCost() → CostEventInsert
                          ↓
              waitUntil(logCostEvent(...))
                          ↓
              Return response to client (unmodified body)
```

#### Streaming Flow

```
Client → proxy → POST api.anthropic.com/v1/messages (stream: true)
                          ↓
                   200 SSE stream
                          ↓
              createAnthropicSSEParser(upstreamBody)
                ├─ readable → client (bytes pass through)
                └─ resultPromise → waitUntil:
                     extract usage from result
                     calculateAnthropicCost()
                     logCostEvent()
              Return readable stream to client immediately
```

#### Request ID Extraction

Anthropic returns `request-id` header (e.g., `req_018EeWyXxfu5pfWkrYcMdjWG`).
Use this as the cost event `requestId`. Fallback to `crypto.randomUUID()`
if missing (shouldn't happen, but defensive).

```typescript
const requestId =
  upstreamResponse.headers.get("request-id") ?? crypto.randomUUID();
```

### File: `apps/proxy/src/index.ts`

Add the new route alongside the existing OpenAI route:

```typescript
// Existing
if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
  // ... rate limiting, body parsing ...
  return await handleChatCompletions(request, env, body);
}

// New
if (request.method === "POST" && url.pathname === "/v1/messages") {
  // ... rate limiting (reuse same logic), body parsing ...
  return await handleAnthropicMessages(request, env, body);
}
```

**Rate limiting:** Reuse the exact same IP-based sliding window. The rate
limiter doesn't care about the provider — it limits requests per IP.

**Body size check:** Same 1MB limit applies. Anthropic's own limit is
32MB, but our proxy doesn't need to accept bodies that large for V1.

### Provider Detection Note

For V1, provider detection is **path-based**:
- `/v1/chat/completions` → OpenAI
- `/v1/messages` → Anthropic

This is clean and unambiguous because the two APIs use different paths.
There is no need for header-sniffing or config-based provider selection.

### Test Plan

#### Header Tests: `apps/proxy/src/__tests__/anthropic-headers.test.ts`

**Upstream header construction:**
- Bearer token extracted and forwarded as `x-api-key`
- `x-api-key` header forwarded directly if no Bearer token
- `anthropic-version: 2023-06-01` always set
- `content-type: application/json` always set
- `anthropic-beta` forwarded when present
- Proxy-specific headers (`x-nullspend-auth`, `host`) NOT forwarded
- Missing auth results in no `x-api-key` header (Anthropic will return 401)

**Client header construction:**
- `content-type` forwarded from upstream
- `request-id` normalized to `x-request-id`
- `anthropic-ratelimit-*` headers forwarded
- `retry-after` forwarded when present
- Non-allowlisted headers NOT forwarded

#### Route Handler Tests: `apps/proxy/src/__tests__/anthropic-route.test.ts`

These will use mocked fetch and cost calculator (same pattern as OpenAI
route tests if they exist, otherwise establish the pattern):

- Missing `X-NullSpend-Auth` → 401
- Invalid `X-NullSpend-Auth` → 401
- Unknown model → 400 with `invalid_model` error
- Valid non-streaming request → 200, cost event logged
- Valid streaming request → 200 SSE, cost event logged after stream
- Upstream 4xx → forwarded to client, no cost event
- Upstream 5xx → forwarded to client, no cost event
- Missing response body on streaming → 502

### Files Created/Modified

| File | Action |
|------|--------|
| `apps/proxy/src/lib/constants.ts` | Modify — add `ANTHROPIC_BASE_URL` |
| `apps/proxy/src/lib/anthropic-headers.ts` | Create |
| `apps/proxy/src/routes/anthropic.ts` | Create |
| `apps/proxy/src/index.ts` | Modify — add `/v1/messages` route |
| `apps/proxy/src/__tests__/anthropic-headers.test.ts` | Create |
| `apps/proxy/src/__tests__/anthropic-route.test.ts` | Create |

### Acceptance Criteria

- `/v1/messages` route returns 401 without valid platform auth
- Unknown Anthropic models rejected with 400
- Non-streaming Anthropic requests proxied and cost events logged
- Streaming Anthropic requests proxied with SSE passthrough and cost events logged
- Upstream errors forwarded without cost tracking
- `request-id` header correctly extracted and used for cost events
- `anthropic-version` header always injected on upstream requests
- All existing OpenAI routes unaffected

### Estimated Effort

1 day build, 0.5 day testing.

---

## Phase 4D: Budget Enforcement + Cost Estimator

### Summary

Adds budget enforcement to the Anthropic route using the same Redis-based
reservation system already proven for OpenAI. This requires an Anthropic
cost estimator (pre-request cost prediction) and wiring the existing
`checkAndReserve` / `reconcile` budget Lua scripts into the Anthropic
route handler.

### Why This Is Separate from Phase 4C

Budget enforcement adds significant complexity:
- Pre-request cost estimation (different output caps per model)
- Reservation lifecycle (reserve → forward → reconcile)
- Error path cleanup (reconcile with 0 on upstream failure)
- `waitUntil` ordering (cost log + reconciliation)

By deferring it to 4D, Phase 4C can be tested end-to-end without the
budget system, isolating any issues to either "cost tracking" (4C) or
"budget enforcement" (4D).

### Deliverables

1. **Cost estimator** — `estimateAnthropicMaxCost()` in
   `apps/proxy/src/lib/anthropic-cost-estimator.ts`
2. **Route handler update** — Add budget lifecycle to `routes/anthropic.ts`
3. **Unit tests** — Cost estimator tests, budget integration tests

### File: `apps/proxy/src/lib/anthropic-cost-estimator.ts`

Mirrors `cost-estimator.ts` (OpenAI) with Anthropic-specific output caps.

```typescript
const ANTHROPIC_OUTPUT_CAPS: Record<string, number> = {
  "claude-opus-4-6": 128_000,
  "claude-sonnet-4-6": 64_000,
  "claude-sonnet-4-5": 64_000,
  "claude-opus-4-5": 128_000,
  "claude-haiku-4-5": 64_000,
  "claude-opus-4-1": 64_000,
  "claude-opus-4": 64_000,
  "claude-sonnet-4": 64_000,
  "claude-haiku-3.5": 8_000,
  "claude-haiku-3": 4_000,
};

const ANTHROPIC_DEFAULT_OUTPUT_CAP = 64_000;
```

**Input estimation:** Same heuristic as OpenAI — `body.length / 4` chars
per token.

**Output estimation:** Use `body.max_tokens` if specified (required field
in Anthropic API). Unlike OpenAI where `max_tokens` is optional, Anthropic
*requires* it. So the estimator should almost always have an explicit cap.
Fallback to model-specific defaults only if the body parse fails.

**Cache awareness:** The estimator does NOT attempt to predict cache
behavior. It uses the base input rate for the estimate. This may
overestimate slightly (cache reads are cheaper), but overestimation is
safe for budget reservation — it just means the reservation is larger
than the actual cost, and the reconciliation corrects it.

### Route Handler Budget Wiring

The budget lifecycle in `routes/anthropic.ts` is identical to
`routes/openai.ts`:

```
1. lookupBudgets(redis, connectionString, apiKeyId, userId)
2. estimateAnthropicMaxCost(model, body)
3. checkAndReserve(redis, entityKeys, estimate)
4. If denied → return 429 with budget details
5. Forward request to Anthropic
6. On success:
   - Calculate actual cost
   - waitUntil(logCostEvent + reconcileReservation with actual cost)
7. On failure:
   - waitUntil(reconcileReservation with 0)
```

The `reconcileReservation` helper function from `routes/openai.ts` should
be extracted to a shared location (e.g., `lib/budget-reconcile.ts` or
kept duplicated if the code is small enough). Evaluate during build.

### Test Plan

#### Cost Estimator Tests

- Model with explicit `max_tokens` → uses that value
- Model without `max_tokens` → uses model-specific cap
- Unknown model → returns fallback cost ($1)
- Safety margin applied (1.1x)
- Large context (long system prompt) produces proportionally larger estimate
- Estimate uses base input rate (not cache-discounted rates)

#### Budget Integration Tests

Since the budget system (Redis Lua scripts, `checkAndReserve`, `reconcile`)
is already tested for OpenAI, the Anthropic tests focus on correct wiring:

- Budget lookup called with correct attribution
- Estimate passed to `checkAndReserve` uses Anthropic estimator
- Budget denial returns 429 with correct error shape
- Successful request reconciles with actual cost
- Upstream error reconciles with 0
- Stream cancellation reconciles with actual (partial) cost
- Missing budget entities skips budget enforcement (same as OpenAI)

### Files Created/Modified

| File | Action |
|------|--------|
| `apps/proxy/src/lib/anthropic-cost-estimator.ts` | Create |
| `apps/proxy/src/routes/anthropic.ts` | Modify — add budget lifecycle |
| `apps/proxy/src/__tests__/anthropic-cost-estimator.test.ts` | Create |

### Acceptance Criteria

- Anthropic requests checked against budgets before forwarding
- Budget-denied requests return 429 with details
- Successful requests reconcile with actual cost
- Failed/errored requests reconcile with 0
- Cost estimator produces reasonable estimates for all Anthropic models
- All existing OpenAI budget tests still pass

### Estimated Effort

0.5 day build, 0.5 day testing.

---

## Phase 4E: Smoke Tests + Deployment

### Summary

End-to-end validation against the live Anthropic API, deployed to the
production Cloudflare Worker. This phase requires a real Anthropic API key
and validates the entire pipeline: routing, auth, header mapping, upstream
forwarding, streaming, cost calculation, cost logging to Postgres, and
budget enforcement.

### Prerequisites

- Anthropic API key set as a Cloudflare Worker secret
  (`ANTHROPIC_API_KEY` — or reuse the user's key forwarded from the client)
- `wrangler deploy` with Phase 4A–4D code

**Note on API key architecture:** For V1, the proxy forwards the user's
own Anthropic API key. The user sets their key in their client SDK's
config. The proxy doesn't store or manage Anthropic keys — it just
passes them through. This is the same model as the OpenAI proxy.

### Deliverables

1. **Smoke test helpers update** — Extend `smoke-test-helpers.ts` with
   Anthropic-specific helpers
2. **Baseline smoke tests** — `smoke-anthropic.test.ts`
3. **Cost E2E tests** — `smoke-anthropic-cost-e2e.test.ts`
4. **Budget E2E tests** — `smoke-anthropic-budget-e2e.test.ts`
5. **Streaming tests** — `smoke-anthropic-streaming.test.ts`
6. **Deployment verification** — deploy and run full suite

### Smoke Test Helpers Update

Add to `smoke-test-helpers.ts`:

```typescript
export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

export function anthropicAuthHeaders(
  extra?: Record<string, string>,
): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key": ANTHROPIC_API_KEY!,
    "X-NullSpend-Auth": PLATFORM_AUTH_KEY,
  };
  if (extra) Object.assign(h, extra);
  return h;
}

export function smallAnthropicRequest(
  overrides: Record<string, unknown> = {},
) {
  return JSON.stringify({
    model: "claude-haiku-3",
    max_tokens: 10,
    messages: [{ role: "user", content: "Say ok" }],
    ...overrides,
  });
}
```

Uses `claude-haiku-3` as default model — cheapest available, minimizes
test costs.

Update `waitForCostEvent` to accept a `provider` parameter instead of
hardcoding `'openai'`.

### Test File: `smoke-anthropic.test.ts`

**Baseline tests:**
- Health check still works (existing)
- Non-streaming Anthropic request returns valid response
- Streaming Anthropic request returns valid SSE stream
- Response contains expected Anthropic fields (`id`, `type: "message"`,
  `content`, `usage`, `stop_reason`)
- Unknown Anthropic model rejected with 400
- Missing auth returns 401
- `x-request-id` header present in proxy response

### Test File: `smoke-anthropic-cost-e2e.test.ts`

**Cost verification (mirrors `smoke-cost-e2e.test.ts` for OpenAI):**
- Non-streaming request: cost event appears in DB within timeout
- Streaming request: cost event appears in DB within timeout
- Cost event has `provider: "anthropic"`
- `input_tokens` > 0, `output_tokens` > 0
- `cost_microdollars` > 0
- `model` field matches the dated version returned by Anthropic
- `request_id` matches the `x-request-id` header from the proxy response

**Cache token E2E (if feasible):**
- Send a request with a large system prompt marked for caching
  (`cache_control: { type: "ephemeral" }`)
- Send a second request with the same system prompt
- Verify the second request's cost event shows `cached_input_tokens > 0`
- Verify the second request's cost is lower than the first

### Test File: `smoke-anthropic-streaming.test.ts`

**Streaming-specific tests:**
- SSE events contain `event:` field lines (not stripped)
- `message_start` event present
- `content_block_delta` events contain text
- `message_delta` event present with usage
- `message_stop` event terminates stream
- Stream can be consumed incrementally (not buffered)

### Test File: `smoke-anthropic-budget-e2e.test.ts`

**Budget enforcement (mirrors `smoke-budget-e2e.test.ts`):**
- Set up a budget with a very low limit (10 microdollars)
- First request succeeds and logs cost
- Subsequent requests denied with 429 once budget exhausted
- Budget denial response includes remaining/limit details

### Deployment Steps

1. Ensure all unit tests pass: `pnpm --filter proxy test`
2. Ensure all cost-engine tests pass: `pnpm --filter @nullspend/cost-engine test`
3. Deploy: `cd apps/proxy && npx wrangler deploy`
4. Set Anthropic-related secrets if needed (TBD based on auth architecture)
5. Run smoke tests against deployed proxy:
   ```
   PROXY_URL=https://nullspend.<account>.workers.dev \
   ANTHROPIC_API_KEY=sk-ant-... \
   PLATFORM_AUTH_KEY=... \
   DATABASE_URL=... \
   npx vitest run --config vitest.smoke.config.ts
   ```
6. Verify all tests pass
7. Monitor `wrangler tail` for any errors in production

### Files Created/Modified

| File | Action |
|------|--------|
| `apps/proxy/smoke-test-helpers.ts` | Modify — add Anthropic helpers, parameterize provider |
| `apps/proxy/smoke-anthropic.test.ts` | Create |
| `apps/proxy/smoke-anthropic-cost-e2e.test.ts` | Create |
| `apps/proxy/smoke-anthropic-budget-e2e.test.ts` | Create |
| `apps/proxy/smoke-anthropic-streaming.test.ts` | Create |

### Acceptance Criteria

- All Anthropic smoke tests pass against the deployed proxy
- Cost events for Anthropic requests appear in Supabase Postgres
- Budget enforcement works for Anthropic requests
- Streaming responses arrive incrementally (not buffered)
- SSE event format preserved (named events not stripped)
- All existing OpenAI smoke tests still pass (no regressions)
- No errors in `wrangler tail` during test run

### Estimated Effort

1 day build, 1 day testing and deployment.

---

## Cross-Phase Concerns

### Shared Code Extraction Opportunities

During build, evaluate whether these should be shared:

| Code | Currently In | Candidates |
|------|-------------|-----------|
| `reconcileReservation()` | `routes/openai.ts` | Extract to `lib/budget-reconcile.ts` if Anthropic's version is identical |
| `CostEventInsert` type alias | `cost-calculator.ts` | Extract to `anthropic-types.ts` or a shared `proxy-types.ts` |
| Rate limiting block in `index.ts` | `index.ts` inline | Consider extracting if the `/v1/messages` route duplicates it |
| Body parsing + size check | `index.ts` inline | Consider extracting to `lib/body-parser.ts` |

**Principle:** Extract only when the code is actually duplicated and the
extraction is obvious. Don't pre-abstract.

### Database Schema

**No schema changes required.** The existing `cost_events` table handles
Anthropic data via:
- `provider: "anthropic"` (already a text column, no enum constraint)
- `input_tokens`: stores total input (uncached + cache write + cache read)
- `cached_input_tokens`: stores cache read tokens
- `reasoning_tokens`: stores 0 for Anthropic
- `cost_microdollars`: stores fully calculated cost including all components

The only information lost is `cache_creation_input_tokens` as a separate
column. This is acceptable for V1. If needed later, a migration adds the
column — no existing data is invalidated.

### Wrangler Configuration

No changes to `wrangler.jsonc` are needed unless we add an Anthropic API
key as a worker secret (which we don't for V1 — the user's key is
forwarded from the client request).

### Dashboard Impact

The existing dashboard queries filter by `provider` and will
automatically show Anthropic data once cost events start flowing. No
dashboard changes are required for V1 — the cost summary API, spend
charts, and budget views all work with the existing schema.

If we want to show Anthropic-specific breakdowns (e.g., cache write vs.
cache read costs), that requires new dashboard UI — but that's post-V1.

---

## Estimated Total Effort

| Phase | Build | Test | Total |
|-------|-------|------|-------|
| 4A: Pricing + Cost Calculator | 1 day | 1 day | 2 days |
| 4B: SSE Parser | 0.5 day | 0.5 day | 1 day |
| 4C: Route Handler | 1 day | 0.5 day | 1.5 days |
| 4D: Budget Enforcement | 0.5 day | 0.5 day | 1 day |
| 4E: Smoke Tests + Deploy | 1 day | 1 day | 2 days |
| **Total** | **4 days** | **3.5 days** | **7.5 days** |

With 4A and 4B running in parallel: **~6.5 working days** end-to-end.

---

## Build Order

```
Week 1:
  Day 1-2:  Phase 4A (pricing data + cost calculator + tests)
            Phase 4B (SSE parser + tests) — in parallel
  Day 3-4:  Phase 4C (route handler + headers + integration)
  Day 5:    Phase 4D (budget enforcement + cost estimator)

Week 2:
  Day 1-2:  Phase 4E (smoke tests + deployment + validation)
```

Each phase boundary is a natural stopping point. If issues are discovered
in smoke testing (4E), they can be traced back to the specific sub-phase
that owns the broken component.
