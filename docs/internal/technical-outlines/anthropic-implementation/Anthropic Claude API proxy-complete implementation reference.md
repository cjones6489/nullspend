# Anthropic Claude API proxy: complete implementation reference

**The Anthropic Messages API uses a stable `2023-06-01` version header, SSE streaming with cumulative usage tokens in `message_delta`, and a multi-tiered pricing model where cache token accounting is the single largest source of cost-calculation bugs across every major proxy implementation.** This reference covers every detail needed to add Anthropic provider support to a Cloudflare Workers + Upstash Redis + Supabase Postgres proxy: exact schemas, streaming event structures, SDK behavior, pricing formulas, and hard-won lessons from LiteLLM, Helicone, Portkey, Vercel AI SDK, and LangChain.js.

---

## Messages API request and response specification

### Endpoint and required headers

The single endpoint is `POST https://api.anthropic.com/v1/messages`. Three headers are mandatory:

| Header | Value | Notes |
|--------|-------|-------|
| `x-api-key` | API key (`sk-ant-api03-...`) | Primary auth. Alternatively, `Authorization: Bearer <oauth-token>` for OAuth flows — but never send a raw API key via Bearer |
| `anthropic-version` | **`2023-06-01`** | Still the only stable version as of March 2026. Returns HTTP 400 if missing |
| `content-type` | `application/json` | Required for POST |

Optional headers include `anthropic-beta` (comma-separated beta feature flags like `extended-cache-ttl-2025-04-11,context-1m-2025-08-07`) and `anthropic-dangerous-direct-browser-access` (enables CORS for browser requests). The response always returns `request-id` (globally unique, e.g., `req_018EeWyXxfu5pfWkrYcMdjWG`) and rate-limit headers.

### Request body schema

**Required fields**: `model` (string, e.g., `"claude-sonnet-4-5-20250929"`), `max_tokens` (integer ≥ 1), and `messages` (array, max 100,000 messages). Each message has `role` (`"user"` or `"assistant"`) and `content` (string or array of content blocks supporting text, images, tool results, and documents).

**Optional fields** and their constraints:

| Field | Type | Default | Key constraints |
|-------|------|---------|----------------|
| `system` | string or TextBlockParam[] | none | Top-level only, not a message role. Array form enables prompt caching |
| `temperature` | float 0.0–1.0 | 1.0 | Mutually exclusive with `top_p` on Opus 4.1+ models |
| `top_p` | float 0.0–1.0 | — | Cannot combine with `temperature` on newer models |
| `top_k` | integer | — | Limits token sampling to top K options |
| `stop_sequences` | string[] | — | Custom stop sequences |
| `stream` | boolean | false | Enables SSE streaming |
| `metadata` | `{user_id?: string}` | — | Opaque identifier, max 256 chars |
| `tools` | ToolDefinition[] | — | Each has `name`, `description`, `input_schema` |
| `tool_choice` | object | — | `{type: "auto"|"any"|"tool", name?: string}` |
| `thinking` | object | — | Extended thinking (see below) |
| `service_tier` | string | — | `"auto"` or `"standard_only"` for priority tier |
| `output_config` | object | — | `{format: {type: "json_schema", schema: {...}}}` for structured outputs (GA) |

**Extended thinking** uses `thinking: {type: "enabled", budget_tokens: N}` (minimum 1,024, must be < `max_tokens`) for older models, or `thinking: {type: "adaptive", effort: "high"}` (effort: `"low"`, `"medium"`, `"high"`, `"max"`) for Claude 4.6 models. When `max_tokens` exceeds **21,333**, streaming is required. Temperature must be 1.0, and **Opus 4.6 does not support assistant message prefilling** when thinking is enabled.

### Response body schema

```json
{
  "id": "msg_01XFDUDYJgAACzvnptvVoYEL",
  "type": "message",
  "role": "assistant",
  "content": [
    {"type": "text", "text": "Hello!", "citations": []},
    {"type": "thinking", "thinking": "...", "signature": "EqQB..."},
    {"type": "tool_use", "id": "toolu_01T1x...", "name": "get_weather", "input": {"location": "SF"}}
  ],
  "model": "claude-sonnet-4-5-20250929",
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "usage": {
    "input_tokens": 12,
    "output_tokens": 6,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": {
      "ephemeral_5m_input_tokens": 0,
      "ephemeral_1h_input_tokens": 0
    }
  }
}
```

Content block types in responses: `text`, `thinking`, `redacted_thinking`, `tool_use`, `server_tool_use`, and `web_search_tool_result`. The `stop_reason` values are `"end_turn"`, `"max_tokens"`, `"stop_sequence"`, `"tool_use"`, or `"model_context_window_exceeded"` (new).

### Usage object — the critical accounting fields

The total input token formula is: **`total_input = input_tokens + cache_creation_input_tokens + cache_read_input_tokens`**. The `input_tokens` field represents only the uncached portion. The `cache_creation` sub-object (with `ephemeral_5m_input_tokens` and `ephemeral_1h_input_tokens`) is **GA** — both 5-minute and 1-hour cache TTLs are generally available with no beta header needed. Extended thinking tokens are counted within `output_tokens` with no separate breakdown.

### Error responses and rate limiting

Errors return `{"type": "error", "error": {"type": "<error_type>", "message": "..."}, "request_id": "req_..."}`. Status codes: **400** (invalid_request_error), **401** (authentication_error), **403** (permission_error), **404** (not_found_error), **413** (request_too_large, 32MB limit), **429** (rate_limit_error), **500** (api_error), **529** (overloaded_error).

Rate-limit headers returned on every response:

| Header prefix | Variants |
|--------------|----------|
| `anthropic-ratelimit-requests-` | `limit`, `remaining`, `reset` |
| `anthropic-ratelimit-tokens-` | `limit`, `remaining`, `reset` |
| `anthropic-ratelimit-input-tokens-` | `limit`, `remaining`, `reset` |
| `anthropic-ratelimit-output-tokens-` | `limit`, `remaining`, `reset` |

Rate limits are **per organization/API key**, not per IP. A proxy does not change rate-limit behavior. The `retry-after` header accompanies 429 responses.

---

## Streaming SSE format and token extraction

### Event flow and exact JSON structures

Setting `"stream": true` returns `Content-Type: text/event-stream`. Each SSE event has `event: <type>` and `data: <json>` lines separated by `\n\n`. The canonical flow:

**1. `message_start`** — contains the full Message object with empty content. **Input tokens appear here:**
```json
event: message_start
data: {"type":"message_start","message":{"id":"msg_1nZd...","type":"message",
  "role":"assistant","content":[],"model":"claude-sonnet-4-5-20250929",
  "stop_reason":null,"stop_sequence":null,
  "usage":{"input_tokens":25,"output_tokens":1,
    "cache_creation_input_tokens":0,"cache_read_input_tokens":0}}}
```

**2. `content_block_start`** — begins each content block (thinking, text, or tool_use):
```json
event: content_block_start
data: {"type":"content_block_start","index":0,
  "content_block":{"type":"thinking","thinking":""}}
```

**3. `content_block_delta`** — incremental content. Delta types: `thinking_delta`, `signature_delta`, `text_delta`, `input_json_delta`, `citations_delta`:
```json
event: content_block_delta
data: {"type":"content_block_delta","index":0,
  "delta":{"type":"text_delta","text":"Hello"}}
```

For tool use, `input_json_delta` provides string fragments that must be concatenated and parsed only on `content_block_stop`:
```json
data: {"type":"content_block_delta","index":1,
  "delta":{"type":"input_json_delta","partial_json":"{\"location\": \"San Fra"}}
```

**4. `content_block_stop`** — ends the block: `{"type":"content_block_stop","index":0}`

**5. `message_delta`** — **final output tokens appear here (cumulative, not incremental):**
```json
event: message_delta
data: {"type":"message_delta",
  "delta":{"stop_reason":"end_turn","stop_sequence":null},
  "usage":{"output_tokens":15}}
```

When server tools (web search) are used, `message_delta` may also contain updated `input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, and `server_tool_use.web_search_requests`.

**6. `message_stop`** — stream complete: `{"type":"message_stop"}`

**7. `ping`** — keepalive, interspersed anywhere: `{"type":"ping"}`

**8. `error`** — can occur at any point: `{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}`

### Token extraction strategy for the proxy

This is the most implementation-critical section. For cost tracking in a streaming proxy:

- **Extract `input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`** from `message_start.message.usage` at stream start
- **Extract final `output_tokens`** from `message_delta.usage.output_tokens` — this value is **cumulative**, representing total output tokens, not a delta
- If `message_delta.usage` also contains `input_tokens` (happens with server tools), use these as the authoritative final input token counts, overriding the `message_start` values
- **Cache token fields** (`cache_creation_input_tokens`, `cache_read_input_tokens`) in `message_delta` are also **cumulative** — identical to `message_start` values unless server tools added more input. Do NOT add them to the `message_start` values (this exact bug caused double-counting in LangChain.js issue #10249)
- Anthropic has **no equivalent** of OpenAI's `stream_options.include_usage` — usage is always present in streaming events
- If the stream is aborted before `message_delta`, you will have `input_tokens` from `message_start` but no reliable `output_tokens` count. Anthropic still bills for generated tokens up to the abort point

### Extended thinking streaming sequence

With thinking enabled, the stream order is: `message_start` → thinking `content_block_start` (index 0) → multiple `thinking_delta` events → one `signature_delta` → `content_block_stop` → text `content_block_start` (index 1) → `text_delta` events → `content_block_stop` → `message_delta` → `message_stop`. Thinking tokens are included in the final `output_tokens` count.

---

## Pricing and cost calculation formulas

### Per-model token pricing (USD per million tokens)

| Model | Model ID | Input | Output | Context | Max Output |
|-------|----------|-------|--------|---------|------------|
| **Opus 4.6** | `claude-opus-4-6` | $5.00 | $25.00 | 200K (1M beta) | 128K |
| **Sonnet 4.6** | `claude-sonnet-4-6` | $3.00 | $15.00 | 200K (1M beta) | 64K |
| **Opus 4.5** | `claude-opus-4-5-20251124` | $5.00 | $25.00 | 200K (1M beta) | 128K |
| **Sonnet 4.5** | `claude-sonnet-4-5-20250929` | $3.00 | $15.00 | 200K (1M beta) | 64K |
| **Haiku 4.5** | `claude-haiku-4-5-20251001` | $1.00 | $5.00 | 200K | 64K |
| Opus 4.1 | `claude-opus-4-1-20250805` | $15.00 | $75.00 | 200K | 64K |
| Opus 4 | `claude-opus-4-20250514` | $15.00 | $75.00 | 200K | 64K |
| Sonnet 4 | `claude-sonnet-4-20250514` | $3.00 | $15.00 | 200K (1M beta) | 64K |
| Haiku 3.5 | `claude-3-5-haiku-20241022` | $0.80 | $4.00 | 200K | 8K |
| Haiku 3 | `claude-3-haiku-20240307` | $0.25 | $1.25 | 200K | 4K |

**Claude 3.5 Sonnet** was retired October 28, 2025. **Sonnet 3.7** and **Haiku 3.5** were retired February 19, 2026. **Haiku 3** retirement is scheduled for April 19, 2026.

### Cache pricing multipliers

| Operation | Multiplier on base input rate | Example (Sonnet 4.5 at $3/MTok) |
|-----------|-------------------------------|----------------------------------|
| **5-min cache write** | **1.25×** | $3.75/MTok |
| **1-hour cache write** | **2.0×** | $6.00/MTok |
| **Cache read (hit)** | **0.1×** | $0.30/MTok |

Both TTLs are GA. Cache pricing is the same regardless of model generation.

### Long context pricing (>200K input tokens)

When total input exceeds **200K tokens** (including cache reads and writes), **all** tokens in the request — input and output — are charged at premium rates:

- Input: **2× base rate** (e.g., Sonnet 4.5: $6.00/MTok)
- Output: **1.5× base rate** (e.g., Sonnet 4.5: $22.50/MTok)
- Cache multipliers stack on top of the long-context rate

### Other pricing modifiers

- **Batch API**: 50% discount on all token costs, processes within 24 hours
- **Extended thinking tokens**: billed at the standard **output token rate** — no separate tier
- **Fast mode** (Opus 4.6 only, research preview): **6× all rates** ($30/$150 per MTok), up to 2.5× faster generation
- **Data residency** (US-only inference): **1.1× all rates** (Opus 4.6+ only)
- All modifiers are **multiplicative** and stack (e.g., Batch + Long Context + 5-min Cache Write for Sonnet 4.5 input: $3.00 × 2 × 1.25 × 0.5 = $3.75/MTok)

### Cost calculation formula

```
cost = (input_tokens × input_rate)
     + (cache_creation_input_tokens × input_rate × cache_write_multiplier)
     + (cache_read_input_tokens × input_rate × cache_read_multiplier)
     + (output_tokens × output_rate)
```

Where `input_rate` and `output_rate` are the base rates (or long-context rates if total input > 200K). **Critical**: `input_tokens` from Anthropic's response is already the uncached portion — do NOT subtract cache tokens from it. The total input is the *sum* of all three fields, not `input_tokens` alone.

---

## SDK base URL behavior for proxy compatibility

### Python SDK (`anthropic` package)

```python
from anthropic import Anthropic
client = Anthropic(
    base_url="https://proxy.example.com",  # snake_case
    api_key="your-proxy-key"
)
# SDK will call: POST https://proxy.example.com/v1/messages
```

The SDK **automatically appends `/v1/messages`** to `base_url`. The proxy must handle the `/v1/messages` path. The environment variable `ANTHROPIC_BASE_URL` also works. Default headers sent automatically: `x-api-key`, `anthropic-version: 2023-06-01`, `content-type: application/json`, `user-agent: anthropic-python/<version>`. Custom headers via `default_headers={}` (constructor) or `extra_headers={}` (per-request).

Two auth modes: `api_key` → `x-api-key` header, or `auth_token` → `Authorization: Bearer` header. Only one can be set. The SDK errors if both are provided.

### TypeScript SDK (`@anthropic-ai/sdk`)

```typescript
import Anthropic from '@anthropic-ai/sdk';
const client = new Anthropic({
    apiKey: 'your-proxy-key',
    baseURL: 'https://proxy.example.com',  // camelCase
});
// SDK will call: POST https://proxy.example.com/v1/messages
```

Same path-appending behavior. Supports Node.js 18+, **Cloudflare Workers**, Vercel Edge, Deno, Bun natively. For browser use, `dangerouslyAllowBrowser: true` is required. Same dual auth modes as Python.

**Key proxy implication**: Your proxy URL should be the base (e.g., `https://proxy.example.com`), and you must route `/v1/messages` to the Anthropic handler. Both SDKs handle streaming identically with custom base URLs — no special handling needed.

---

## Critical pitfalls for Cloudflare Workers proxy implementation

### SSE stream buffering is the #1 proxying issue

Many infrastructure layers buffer responses before forwarding, breaking the real-time SSE contract. For a Cloudflare Workers proxy, ensure:

- Return a `Response` with a `ReadableStream` body immediately — do not buffer the entire response
- Set response headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`
- Preserve the `event:` field lines in SSE events — some proxies strip these, causing SDKs to silently skip all events (`ValueError: No generation chunks were returned` in LangChain)

**Cloudflare AI Gateway UTF-8 corruption**: A confirmed active bug corrupts multibyte characters (Japanese, emoji) in Anthropic streaming responses through CF AI Gateway, producing U+FFFD replacement characters. This affects AI Gateway specifically, not raw Workers. Your custom Workers proxy should not have this issue if you pass through the stream bytes without re-encoding.

### Cloudflare Workers limits to watch

- **Request body**: 100MB (paid plan), sufficient for all Messages API requests (32MB limit)
- **CPU time**: 30 seconds (paid), 10ms (free) — this is CPU time, not wall-clock
- **Subrequest timeout**: No hard wall-clock limit on paid Workers for streaming responses, but Cloudflare may terminate very long-lived connections
- **The TypeScript SDK** had a known edge-runtime streaming bug (issue #292) where SSE data split across chunks at arbitrary boundaries caused `SyntaxError: Unexpected end of JSON input`. Modern SDK versions handle this, but your proxy's SSE parser must also handle arbitrarily chunked data

### Header handling rules

**Must forward**: `x-api-key` (or substitute with your stored key), `anthropic-version`, `content-type`, `anthropic-beta` (if present). **Must NOT forward**: client's `Authorization` header if you're re-keying requests. Anthropic tolerates extra headers — proxy-specific headers (e.g., `x-proxy-request-id`) will not cause rejection. The `anthropic-version` header is **strictly required**: omitting it returns HTTP 400 `invalid_request_error`.

### Authentication architecture

Your proxy should accept its own auth token (e.g., a virtual API key stored in Supabase), strip it, and inject the real Anthropic API key as `x-api-key`. Never forward `Authorization: Bearer` with a raw API key — Anthropic returns `authentication_error: Invalid bearer token`. Bearer tokens are exclusively for OAuth flows.

### CORS

Anthropic's API blocks CORS by default. Since your proxy runs server-side on Cloudflare Workers, this is irrelevant — you'll add your own CORS headers on the proxy's response to clients. If you ever need direct browser-to-Anthropic access, the `anthropic-dangerous-direct-browser-access: true` header enables it, but this is not recommended.

---

## Lessons from existing proxy implementations

### LiteLLM: cache cost bugs are the dominant failure mode

LiteLLM has suffered **at least six distinct cache-related cost calculation bugs** over 18 months, making it the definitive cautionary tale. The core pattern:

- **Bug #6575**: Cache creation tokens charged additively on top of full prompt cost, instead of replacing the base-rate portion
- **Bug #9812**: Double-counting cache tokens because `prompt_tokens` already includes `cache_creation_input_tokens` in Anthropic's schema
- **Bug #11364**: Cache-read tokens not deducted from prompt cost, causing **10× overcharges** on high-cache-hit workloads
- **Bug #11789**: Streaming-specific divergence — cache tokens correctly handled in non-streaming but reported as 0 in streaming, causing **7× overcharge**
- **Bug #15055**: Missing pricing for the combination of 1-hour cache TTL + long-context (>200K tokens)

The root cause across all bugs: **streaming and non-streaming code paths diverged**. PR #9838 explicitly merged them into a shared calculation block. Your implementation should have **exactly one cost calculation function** used by both streaming and non-streaming paths.

LiteLLM's cost map fields per model: `input_cost_per_token`, `output_cost_per_token`, `cache_creation_input_token_cost`, `cache_read_input_token_cost`, `input_cost_per_token_above_200k_tokens`, and corresponding above-200K cache fields.

### Helicone: evolved from per-provider workers to unified gateway

Helicone's architecture is instructive for Cloudflare Workers: they started with **separate Workers per provider** (`anthropic.helicone.ai`), intercepting traffic and logging asynchronously to ClickHouse. Their cost calculation lives in a separate `@helicone/cost` npm package using declarative `ModelRow` objects with operator-based model matching (`equals`, `startsWith`, `includes`). This package-level separation is clean but their open-source version has limited cache-token support.

### Portkey: declarative transformation at 122KB

Portkey's AI Gateway runs on Cloudflare Workers with an ultra-lightweight footprint. Their key pattern: **declarative `ProviderConfig` objects** that define parameter mappings, defaults, and transform functions rather than imperative translation code. For Anthropic, this handles system message extraction, `stop` → `stop_sequences` renaming, and content block format conversion. Their streaming splits on `\n\n` and applies transforms per-chunk. Notable bugs: #496 (prompt and completion tokens arriving in separate streaming chunks), #244 (system message only accepted strings, not arrays), #652 (base64 images not forwarded correctly). **Cost calculation is not in the open-source gateway** — it's a cloud-only enterprise feature.

### Vercel AI SDK: the token normalization problem

The Vercel AI SDK's `LanguageModelV2` spec provides the cleanest multi-provider abstraction. Their critical discovery (issue #9921, fixed in SDK v6): **Anthropic and OpenAI define `input_tokens` differently**. Anthropic reports `input_tokens` as only the uncached portion; OpenAI reports it as the total with `cached_tokens` as a subset. Naively mapping both the same way produced wildly incorrect totals (18 vs. 2,302 actual tokens). Their normalized schema:

```typescript
interface ModelUsage {
  inputTokens: number;           // Always total
  outputTokens: number;
  inputTokensDetails?: {
    regularTokens?: number;
    cacheWriteTokens?: number;
    cacheReadTokens?: number;
  };
  outputTokensDetails?: {
    regularTokens?: number;
    reasoningTokens?: number;
  };
}
```

### LangChain.js: cumulative vs. delta confusion

LangChain issue #10249 (open, March 2026) documents the exact streaming bug your proxy must avoid: Anthropic's `message_delta` contains **cumulative** `cache_creation_input_tokens` and `cache_read_input_tokens` (same values as `message_start`). LangChain's merge function treated them as deltas and summed them, producing **exactly 2× the actual values**. The fix: ignore cache token fields from `message_delta` if they match `message_start`, or simply use `message_delta` values as authoritative finals.

---

## Multi-provider proxy design patterns

### Independent parsers with unified output

Every successful multi-provider proxy uses **independent, provider-specific streaming parsers** feeding into a **unified internal representation**. Anthropic's named-event SSE format (`event: message_start`, `event: content_block_delta`) is fundamentally different from OpenAI's single-type `data:` lines with `data: [DONE]` sentinel. Sharing a parser is a recipe for fragile code.

The recommended architecture for your Cloudflare Workers proxy:

- **Provider-specific handler modules**: Each implements `parseStream()`, `extractUsage()`, and `calculateCost()`
- **Shared interfaces**: `ProxyUsage` (normalized token counts with breakdowns), `ProxyCost` (computed dollar amounts), `StreamEvent` (normalized event for logging)
- **Single cost calculation function**: Takes `ProxyUsage` + model ID → `ProxyCost`, used identically for streaming and non-streaming
- **Header transformer per provider**: Maps proxy auth to provider auth, adds required headers (Anthropic: `anthropic-version`; OpenAI: `Authorization: Bearer`)

### Cost tracking to Supabase + Redis

For budget enforcement, use Upstash Redis for **real-time running totals** (fast atomic increments during request processing) and Supabase Postgres for **durable cost records** (written asynchronously after request completion). The streaming proxy should:

1. Start streaming the response through to the client immediately (no buffering)
2. Parse SSE events in a `TransformStream` tee, extracting usage from `message_start` and `message_delta`
3. On `message_delta` or `message_stop`, compute cost and atomically increment the Redis budget counter
4. If the budget is exceeded, optionally abort the upstream connection (client gets a partial response)
5. Asynchronously write the full request log to Supabase via `waitUntil()`

---

## API changelog and breaking changes (October 2025 – March 2026)

### New models

| Date | Model | Notable changes |
|------|-------|----------------|
| Oct 15, 2025 | **Haiku 4.5** | Fastest model, $1/$5 |
| Nov 24, 2025 | **Opus 4.5** | Most intelligent, $5/$25 (down from Opus 4's $15/$75) |
| Feb 5, 2026 | **Opus 4.6** | Adaptive thinking, no prefilling, fast mode (6× pricing) |
| Feb 17, 2026 | **Sonnet 4.6** | Improved agentic search, fewer tokens |

### Retirements

Claude 3.5 Sonnet retired **October 28, 2025**. Claude Opus 3 retired **January 5, 2026**. Claude Sonnet 3.7 and Haiku 3.5 retired **February 19, 2026**. Claude Haiku 3 retirement scheduled **April 19, 2026**.

### Breaking changes affecting proxy implementations

- **`temperature` + `top_p` mutual exclusion**: Starting with Opus 4.1 and newer, sending both returns an error. Your proxy should validate or strip one
- **`output_format` → `output_config.format`**: Structured outputs parameter renamed when it went GA in January 2026
- **Adaptive thinking**: New models use `thinking: {type: "adaptive"}` instead of `{type: "enabled", budget_tokens: N}`
- **`context_management` field location**: Now returned at the `message_delta` root level, not inside the `delta` object
- **No assistant prefilling on Opus 4.6**: Requests with prefilled assistant messages are rejected
- **New stop reason**: `"model_context_window_exceeded"` — allows requesting max tokens without pre-calculating input size
- **Many features graduated from beta to GA**: structured outputs, fine-grained tool streaming, web search, code execution, prompt caching (including 1-hour TTL) — all no longer require beta headers

### The API version has NOT changed

Despite all these additions, the base API version remains **`2023-06-01`**. Anthropic uses beta headers for feature gating and adds new fields/event types without bumping the version. Your proxy should be resilient to unknown fields in responses and unknown SSE event types in streams.

---

## Conclusion: implementation-critical takeaways

**Cache token math is the hardest part.** Anthropic's `input_tokens` is the uncached portion only. Total input = `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`. Apply different rates to each component. Never double-count. Use one cost function for streaming and non-streaming.

**Streaming token extraction has exactly two extraction points**: `message_start` (input tokens, cache tokens) and `message_delta` (cumulative output tokens, potentially updated input tokens). Cache tokens in `message_delta` are cumulative — not deltas to add to `message_start` values.

**The proxy's SSE passthrough must preserve `event:` lines.** Stripping named events causes SDK-level silent failures. Parse events in a tee'd `TransformStream` rather than buffering.

**SDK compatibility requires handling `/v1/messages` path.** Both official SDKs append this path to the base URL. Your Workers proxy should route on this path, and your Anthropic handler should accept the standard Anthropic request format without translation.

**Plan for model churn.** Four models were retired in 5 months. Store pricing in Supabase (not hardcoded) and support model alias resolution (e.g., `claude-sonnet-4-5` → `claude-sonnet-4-5-20250929`). The `model` field in responses always returns the dated version, which is what you should use for cost lookup.