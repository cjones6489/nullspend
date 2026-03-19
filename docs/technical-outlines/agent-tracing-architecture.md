# Agent Tracing & Cost Correlation Architecture

**Date:** 2026-03-18 15:00 UTC (last updated 2026-03-18 17:00 UTC)
**Status:** Proposed
**Research:** See `docs/claude-research/agent-tracing-cost-correlation-research.md` for full competitive analysis, standards review, and framework survey.

---

## Problem Statement

NullSpend tracks per-request costs precisely but cannot correlate them across an agent loop. When an agent calls an LLM, gets back tool requests, executes tools, and calls the LLM again, each step is logged as an isolated `cost_events` row. There is no way to answer "how much did this agent run cost?" without manual timestamp correlation.

### What the proxy sees vs. what actually happens

```
LLM call #1 → response includes tool_calls     ← proxy logs cost event
    ↓
Agent executes tools locally                    ← proxy is BLIND
    ↓
LLM call #2 → includes tool results            ← proxy logs cost event (no link to #1)
    ↓
Agent executes more tools                       ← proxy is BLIND
    ↓
LLM call #3 → final answer                     ← proxy logs cost event (no link to #1 or #2)
```

### Specific gaps

| Gap | Impact |
|---|---|
| No trace ID propagation | Can't group LLM calls into agent runs |
| No tool call round-trip | Know LLM requested `fetch_url` but not if it ran or what it cost |
| No cost rollup per trace | Can't answer "this agent run cost $2.47" |
| No cost in response headers | Agents can't self-monitor spend without polling |
| Tool definition cost invisible | Can't tell users "15% of your input cost is tool schemas" |
| MCP-to-LLM disconnect | MCP proxy and LLM proxy share `actionId`/`sessionId` loosely |

### Industry validation

No proxy-only platform (Portkey, LiteLLM, Helicone) solves this without client cooperation. The minimum cooperation required is **one header per request** — a trace ID. Every major agent framework already supports passing custom metadata into LLM calls (Vercel AI SDK, LangChain, AutoGen, LiteLLM).

---

## Design Principles

1. **Zero-config baseline.** Everything works without any trace header — per-request cost tracking, budget enforcement, cost events. The proxy auto-generates trace IDs and returns cost in response headers. Value at zero effort.
2. **Progressive disclosure.** Each header the developer adds unlocks a visible feature: `X-NullSpend-Trace-Id` enables explicit trace grouping, `X-NullSpend-Agent-Id` enables multi-agent attribution, `traceparent` enables OTel integration. But Level 0 (just change `base_url`) already works. *(Ref: Helicone's progressive adoption model — see `developer-adoption-tracing-research.md`)*
3. **Server-side correlation first.** The proxy should extract maximum correlation from what it can already see — tool_call_id stitching across requests (Phase 2) gives ~80% of trace correlation value with zero client cooperation. Client headers are enrichment, not a requirement. *(Ref: No competitor does server-side tool_call_id stitching — NullSpend-unique)*
4. **Align with OTel GenAI conventions.** Don't invent custom standards. Use `gen_ai.*` attribute names and W3C `traceparent` format. But pin to a specific semconv version — the spec is "Development" status with active breaking changes. *(Ref: OTel semconv broke 3x in 2026 alone — see `competitor-infrastructure-bugs-research.md`)*
5. **Don't build an observability platform.** Langfuse, Arize Phoenix, and Datadog own full tracing UIs. NullSpend owns cost tracking + budget enforcement. Emit OTel-compatible data that feeds into those platforms.
6. **Proxy-first, SDK-optional.** The SDK provides convenience (`createHeaders()`, `wrapOpenAI()`) but is never required. The proxy URL + `defaultHeaders` pattern works with any OpenAI/Anthropic SDK natively. *(Ref: Both SDKs support `default_headers` + `base_url` — see `developer-adoption-tracing-research.md`)*

### Adoption Funnel

Based on developer adoption research, the system is designed for progressive adoption:

```
Level 0: Change base_url               → per-request cost, auto trace IDs, cost in headers
         (Zero effort. ~100% of users.)

Level 1: Server-side tool stitching     → auto-grouped agent loops
         (Automatic. ~80% coverage. NullSpend-unique.)

Level 2: Add X-NullSpend-Trace-Id      → explicit trace grouping across calls
         (One-time defaultHeaders setup. ~20% of power users.)

Level 3: Use @nullspend/sdk wrapper     → auto-propagation, cost accumulation
         (~5-10% of users. Highest value.)

Level 4: Full OTel traceparent         → emit to Langfuse/Datadog/etc
         (~2% enterprise users.)
```

---

## Architecture Overview

### Phased Approach

| Phase | What | Effort | Value |
|---|---|---|---|
| **Phase 1** | Accept trace headers + return cost headers | ~4h | Agent loop grouping + self-monitoring |
| **Phase 2** | Tool call stub extraction from LLM responses | ~6h | Proxy-side tool round-trip correlation |
| **Phase 3** | Cost rollup per trace API | ~4h | "This run cost $X" answer |
| **Phase 4** | MCP `_meta` cost conventions | ~3h | Cost layer for MCP ecosystem |
| **Phase 5** | Tool definition cost attribution | ~2h | "15% of input cost is tool schemas" |
| **Phase 6** | Agent loop detection + session circuit breakers | ~6h | Prevent runaway agent costs |
| **Phase 7** | Adaptive cost estimation | ~4h | Better reservation accuracy |
| **Phase 8** | Mid-stream SSE cost injection | ~4h | Real-time cost visibility during streaming |

Total estimated effort: ~33 hours across 8 phases. Each phase is independently shippable. Phases 1-5 are the core tracing architecture. Phases 6-8 are high-value additions informed by competitive research.

---

## Phase 1: Trace Headers + Cost Response Headers

### Inbound: Accept trace context

Accept two trace header formats (first match wins):

| Header | Format | Standard |
|---|---|---|
| `traceparent` | `00-{trace_id}-{parent_id}-{flags}` | W3C Trace Context |
| `X-NullSpend-Trace-Id` | Any string, or `"auto"` | NullSpend custom |

**Resolution order:**
1. If `traceparent` is present and valid → extract `trace_id` (32 hex chars)
2. Else if `X-NullSpend-Trace-Id` is present and is NOT `"auto"` → use as-is
3. Else → auto-generate a UUID v4 trace ID (covers both `"auto"` and missing header)

**The `"auto"` magic value:** When the developer sets `defaultHeaders: { "X-NullSpend-Trace-Id": "auto" }` on their OpenAI/Anthropic client, the proxy generates a unique trace ID per request. This is the recommended setup for most users — set-and-forget, one line in the constructor, unique trace per request. *(Ref: Both OpenAI and Anthropic SDKs support `default_headers`/`defaultHeaders` natively — no NullSpend SDK required. See `developer-adoption-tracing-research.md`.)*

**Why `"auto"` instead of just omitting the header:** Without the header, the proxy still auto-generates — but the developer has no signal that tracing is active. With `"auto"`, the developer explicitly opts into tracing, and the proxy knows the caller is NullSpend-aware (enabling future features like tool_call_id stitching notifications).

### Inbound: Accept agent identity headers (optional)

For multi-agent systems where multiple agents share a single API key, accept optional attribution headers:

| Header | Format | Purpose |
|---|---|---|
| `X-NullSpend-Agent-Id` | Any string (e.g., `researcher`, `code-reviewer`) | Identifies which agent made this call |
| `X-NullSpend-Parent-Agent-Id` | Any string | Identifies the agent that delegated to this one |

These enable per-agent cost attribution without requiring separate API keys per agent. Stored on `cost_events` and available in the Phase 3 cost rollup. Both are optional — the system works without them, just with less granular attribution.

**Why this matters:** OpenAI Agents SDK has `HandoffSpanData` (from_agent, to_agent). Google A2A has `collaboratorName`. Microsoft Entra uses OBO delegation chains. Multi-agent is where the market is heading, and agent identity is the foundation. Supporting it from day one avoids a schema migration later.

**Validation:** `agent_id` and `parent_agent_id` are free-form strings, max 128 characters, validated with a simple length + printable ASCII check. No registry or pre-registration required — agents self-identify.

**Parsing `traceparent`:**
```
traceparent: 00-0af7651916cd43dd8448eb211c80319c-00f067aa0ba902b7-01
              │  │                                │                │
              │  └── trace_id (32 hex chars)       └── parent_id    └── flags
              └── version (always "00")
```

Extract `trace_id` as the NullSpend trace ID. Store `parent_id` for future span hierarchy support.

**Where to parse:** In the request context builder (`apps/proxy/src/lib/context.ts` or equivalent), extract the trace ID early so it's available to all downstream code.

### Outbound: Return cost + trace in response headers

Add to **every** proxy response (both streaming and non-streaming):

| Header | Value | Example | Always present? |
|---|---|---|---|
| `X-NullSpend-Request-Id` | Server-generated unique request ID | `ns_req_a1b2c3d4` | Yes |
| `X-NullSpend-Trace-Id` | The trace ID (provided or auto-generated) | `0af7651916cd43dd8448eb211c80319c` | Yes |
| `X-NullSpend-Cost` | Cost in microdollars | `1250` (= $0.00125) | Non-streaming: yes. Streaming: final chunk only |
| `X-NullSpend-Budget-Remaining` | Lowest remaining budget in microdollars, or `unlimited` | `48750000` | Yes |

**Why `X-NullSpend-Request-Id` (Stripe pattern):** Every Stripe response includes a server-generated `Request-Id`. The server generates the correlation ID, not the client — this guarantees uniqueness and is more reliable than client-generated trace IDs. Developers include this in support tickets and dashboard queries. *(Ref: Stripe SDK design — see `developer-adoption-tracing-research.md`)*

**Why `X-NullSpend-Trace-Id` always returned:** Even if the caller didn't send a trace header, the proxy auto-generates one and returns it. This enables "lazy trace propagation" — the SDK wrapper (Tier 3) can capture the auto-generated trace ID from the first response and send it on subsequent calls. Note: the native OpenAI/Anthropic SDKs do NOT expose response headers to callers easily, so lazy propagation requires our SDK wrapper or manual `httpx`/`fetch` usage. *(Ref: Lazy propagation research confirmed this limitation — see `developer-adoption-tracing-research.md`)*

**Why `X-NullSpend-Cost`:** LiteLLM does this (`x-litellm-response-cost`) and it's their most-cited feature in developer discussions. Portkey and Helicone don't return cost in headers. This is the "visible payoff" that makes developers want to engage with NullSpend — they see their cost per request without opening any dashboard. *(Ref: Portkey/LiteLLM comparison — see `agent-tracing-cost-correlation-research.md`)*

**Trust boundary — do NOT forward trace headers upstream:** The proxy must strip `traceparent` and `tracestate` before forwarding to OpenAI/Anthropic. These providers don't participate in the client's trace, and forwarding leaks internal trace IDs across the trust boundary. Create a new span at the proxy; use span links (not parent-child) to connect. *(Ref: OTel spec #1633 cross-trust-boundary context leakage — see `competitor-infrastructure-bugs-research.md`)*

### Schema change: Add `trace_id`, `agent_id`, `parent_agent_id` to `cost_events`

```sql
ALTER TABLE cost_events ADD COLUMN trace_id text;
ALTER TABLE cost_events ADD COLUMN agent_id text;
ALTER TABLE cost_events ADD COLUMN parent_agent_id text;
CREATE INDEX cost_events_trace_id_idx ON cost_events (trace_id);
CREATE INDEX cost_events_agent_id_idx ON cost_events (agent_id);
```

`trace_id` supplements `session_id` (which remains for backward compatibility). `trace_id` is the W3C-compatible correlation key; `session_id` is the caller's application-level session concept. `agent_id` and `parent_agent_id` are nullable — only populated when the caller sends the headers.

### Security considerations

**Trace ID scoping:** Trace IDs are a shared namespace — any caller can send any trace ID. Security is enforced at the query layer, not the ingestion layer:
- The Phase 3 cost rollup API (`/api/traces/:traceId/cost`) filters by authenticated `userId`. User A cannot see user B's trace, even if they guess the trace ID.
- The `tool_call_stubs` table (Phase 2) is similarly scoped by `userId` via the `requesting_request_id` join to `cost_events`.
- Trace IDs should NOT be treated as secrets or used as access tokens.

**Collision risk:** If two different users independently generate the same UUID v4 trace ID, their events coexist in the `cost_events` table but are isolated by `userId` in all queries. No data leakage.

**Malformed `traceparent`:** If the `traceparent` header fails W3C format validation (not 4 dash-separated fields, trace_id not 32 hex chars), fall back to `X-NullSpend-Trace-Id`. If that's also absent, auto-generate. Never reject a request due to a bad trace header — tracing is best-effort, not a gate.

### Performance considerations

**Latency impact of Phase 1 changes:**
- `traceparent` parsing: <0.1ms (regex match + string split)
- Response header injection: <0.1ms (string concatenation)
- `trace_id` column write: zero additional latency — already part of the `logCostEvent()` INSERT

**Non-blocking writes:** Tool call stub creation (Phase 2) and cost event logging are performed via `waitUntil()` to avoid blocking the response. The proxy returns the response to the caller immediately; stub writes and cost logging happen asynchronously after the response is sent. If a stub write fails, the tool call is simply not tracked — no impact on the LLM response.

**Memory overhead:** Agent identity headers add two nullable text columns to `cost_events`. No additional in-memory state per request beyond the `RequestContext` fields.

### Data flow

```
Request arrives
  ├── Resolve trace_id:
  │     1. traceparent valid? → extract trace_id
  │     2. X-NullSpend-Trace-Id present and not "auto"? → use as-is
  │     3. Otherwise → generate UUID v4
  ├── Extract agent_id, parent_agent_id from headers (if present)
  ├── Generate X-NullSpend-Request-Id (server-side, always)
  ├── Store all in RequestContext
  │
  ├── Strip traceparent/tracestate from upstream request (trust boundary)
  ├── Forward to upstream LLM
  ├── Parse response, calculate cost
  │
  ├── waitUntil: logCostEvent({ ..., traceId, agentId, parentAgentId })
  ├── waitUntil: createToolCallStubs (Phase 2, if tool_calls in response)
  ├── Add response headers (request ID, trace ID, cost, remaining)
  └── Return response immediately
```

### Files to modify

| File | Change |
|---|---|
| `apps/proxy/src/lib/context.ts` | Extract trace ID + agent identity from headers into `RequestContext` |
| `apps/proxy/src/routes/openai.ts` | Pass `traceId`, `agentId`, `parentAgentId` to cost logger, add response headers |
| `apps/proxy/src/routes/anthropic.ts` | Same |
| `apps/proxy/src/routes/mcp.ts` | Same |
| `apps/proxy/src/lib/cost-logger.ts` | Accept and store `traceId`, `agentId`, `parentAgentId` |
| `packages/db/src/schema.ts` | Add `traceId`, `agentId`, `parentAgentId` columns to `cost_events` |
| Drizzle migration | `ALTER TABLE` + indexes |

### Test plan

| Test | Type | What it verifies |
|---|---|---|
| `traceparent` header parsing (valid, malformed, missing) | Unit | Correct extraction of trace ID from W3C format |
| `X-NullSpend-Trace-Id` header passthrough | Unit | Custom header accepted, stored, returned |
| `X-NullSpend-Trace-Id: "auto"` generates unique per-request | Unit | Magic value interpreted correctly |
| `"auto"` generates different IDs for different requests | Unit | Not a static value |
| Auto-generation when no header provided | Unit | UUID v4 generated, returned in response |
| Malformed `traceparent` falls back to custom header | Unit | Graceful degradation, no request rejection |
| Malformed `traceparent` falls back to auto-generation | Unit | Graceful degradation when both headers invalid |
| `traceparent` takes precedence over `X-NullSpend-Trace-Id` | Unit | Resolution order respected |
| `X-NullSpend-Request-Id` present on every response (server-generated) | Unit | Stripe pattern: always present, unique |
| Response headers present on non-streaming response | Unit | All four headers set correctly |
| Response headers present on streaming response (final chunk) | Unit | Cost header on last SSE event |
| `traceparent`/`tracestate` stripped from upstream request | Unit | Trust boundary: not forwarded to OpenAI/Anthropic |
| `trace_id` stored in `cost_events` row | Unit | Cost logger passes trace ID through |
| Multiple requests with same trace ID group correctly | Integration | Query by trace ID returns all events |
| `X-NullSpend-Agent-Id` stored on cost event | Unit | Agent identity propagated |
| `X-NullSpend-Parent-Agent-Id` stored on cost event | Unit | Delegation chain propagated |
| Agent ID max length enforcement (128 chars) | Unit | Rejects oversized values |
| Agent ID with non-printable chars rejected | Unit | Input validation |
| Missing agent ID headers produce null columns | Unit | Optional headers don't break flow |
| Same trace ID, different users — cost rollup isolated | Unit | Security: user A can't see user B's trace |
| Cost logging via `waitUntil()` doesn't block response | Unit | Response returned before log write completes |

---

## Phase 2: Tool Call Stub Extraction (Primary Correlation Mechanism)

### Concept

**This is NullSpend's key differentiator.** No competitor does server-side tool_call_id stitching. The proxy already captures `toolCallsRequested` from LLM responses. Phase 2 creates lightweight "pending tool" records and closes them out when the next LLM call on the same trace (or same API key, if no trace header) arrives with tool results.

This gives ~80% of trace correlation value with zero client cooperation beyond the API key. The developer doesn't need to send any trace header — the proxy infers the agent loop structure from the tool_call_id round-trip. *(Ref: No proxy platform (Portkey, LiteLLM, Helicone) does this — see `agent-tracing-cost-correlation-research.md`)*

### How it works (proxy-side only, no client cooperation beyond trace ID)

**Step 1: LLM response with tool_calls**

The proxy parses the LLM response and sees:
```json
{
  "choices": [{
    "message": {
      "tool_calls": [
        { "id": "call_abc", "function": { "name": "fetch_url" } },
        { "id": "call_def", "function": { "name": "save_file" } }
      ]
    }
  }]
}
```

For each tool call, create a `tool_call_stubs` row:
```
trace_id, tool_call_id ("call_abc"), tool_name ("fetch_url"),
requested_at, requesting_request_id, status ("pending")
```

**Step 2: Next LLM call with tool results**

The next request on the same trace ID contains messages with `role: "tool"`:
```json
{
  "messages": [
    { "role": "tool", "tool_call_id": "call_abc", "content": "..." },
    { "role": "tool", "tool_call_id": "call_def", "content": "..." }
  ]
}
```

The proxy matches `tool_call_id` values against pending stubs and marks them as `completed`:
```
status → "completed", completed_at, completing_request_id
```

### New table: `tool_call_stubs`

```sql
CREATE TABLE tool_call_stubs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  trace_id text NOT NULL,
  tool_call_id text NOT NULL,        -- Provider's tool call ID (e.g., "call_abc")
  tool_name text NOT NULL,
  status text NOT NULL DEFAULT 'pending',  -- pending | completed | orphaned
  requesting_request_id text NOT NULL,     -- The cost_event that triggered this
  completing_request_id text,              -- The cost_event that provided results
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tool_call_stubs_trace_id_idx ON tool_call_stubs (trace_id);
CREATE INDEX tool_call_stubs_status_idx ON tool_call_stubs (status) WHERE status = 'pending';
```

### Orphan detection

If a trace has pending stubs with no completing request within 5 minutes, mark as `orphaned`. This happens when:
- The agent crashed between LLM calls
- The tool execution failed and the agent gave up
- The agent used a different API key for the follow-up call (different trace)

Orphan detection can be a periodic cleanup job or a check on trace finalization.

### Anthropic variant

Anthropic uses `tool_use` content blocks (not `tool_calls`):
```json
{
  "content": [
    { "type": "tool_use", "id": "toolu_abc", "name": "fetch_url", "input": {...} }
  ]
}
```

And tool results are `tool_result` content blocks:
```json
{
  "content": [
    { "type": "tool_result", "tool_use_id": "toolu_abc", "content": "..." }
  ]
}
```

The proxy already handles both formats for `toolCallsRequested` extraction. Phase 2 extends this to create and close stubs using the provider-specific ID fields.

### Files to modify

| File | Change |
|---|---|
| `packages/db/src/schema.ts` | Add `toolCallStubs` table |
| Drizzle migration | Create table + indexes |
| `apps/proxy/src/routes/openai.ts` | Create stubs from response `tool_calls`, match stubs from request `tool` messages |
| `apps/proxy/src/routes/anthropic.ts` | Same for `tool_use` / `tool_result` blocks |
| `apps/proxy/src/lib/cost-logger.ts` | Accept stub creation/completion as part of cost logging |

### Test plan

| Test | Type | What it verifies |
|---|---|---|
| Stubs created from OpenAI `tool_calls` response | Unit | Correct extraction + row creation |
| Stubs created from Anthropic `tool_use` blocks | Unit | Provider-specific parsing |
| Stubs completed when next request has matching `tool_call_id` | Unit | Round-trip correlation |
| Stubs marked orphaned after timeout | Unit | Cleanup logic |
| Multiple tool calls in one response create multiple stubs | Unit | Batch handling |
| No stubs created when response has no tool calls | Unit | No spurious rows |
| Stubs only matched within same `trace_id` | Unit | Cross-trace isolation |

---

## Phase 3: Cost Rollup Per Trace

### New API endpoint

```
GET /api/traces/:traceId/cost
```

**Response:**
```json
{
  "traceId": "0af7651916cd43dd8448eb211c80319c",
  "totalCostMicrodollars": 247500,
  "eventCount": 17,
  "providers": {
    "openai": { "costMicrodollars": 185000, "eventCount": 5 },
    "anthropic": { "costMicrodollars": 50000, "eventCount": 2 },
    "mcp": { "costMicrodollars": 12500, "eventCount": 10 }
  },
  "models": {
    "gpt-4o": { "costMicrodollars": 185000, "eventCount": 5 },
    "claude-sonnet-4-6": { "costMicrodollars": 50000, "eventCount": 2 },
    "mcp-server/fetch_url": { "costMicrodollars": 12500, "eventCount": 10 }
  },
  "toolCalls": {
    "total": 12,
    "completed": 10,
    "pending": 0,
    "orphaned": 2
  },
  "timeRange": {
    "firstEvent": "2026-03-18T14:30:00Z",
    "lastEvent": "2026-03-18T14:30:47Z",
    "durationMs": 47000
  }
}
```

**Auth:** Same as other dashboard API routes — session-based auth, scoped to the user's cost events.

### SDK addition

```typescript
// packages/sdk/src/client.ts
async getTraceCost(traceId: string): Promise<TraceCostResponse> {
  return this.request<TraceCostResponse>("GET", `/api/traces/${traceId}/cost`);
}
```

### Implementation

Simple `GROUP BY` query on `cost_events` with `WHERE trace_id = ?`, plus a join to `tool_call_stubs` for the tool call summary. No new tables needed — this is a read-only aggregation of existing data.

### Test plan

| Test | Type | What it verifies |
|---|---|---|
| Rollup returns correct totals across providers | Unit | Aggregation math |
| Rollup returns empty result for unknown trace | Unit | 404 or empty response |
| Rollup scoped to authenticated user | Unit | Can't see other users' traces |
| Tool call summary counts are accurate | Unit | pending/completed/orphaned counts |
| Time range calculated from first/last event | Unit | Boundary timestamps |

---

## Phase 4: MCP `_meta` Cost Conventions

### Opportunity

No specification standardizes cost metadata for MCP. The `_meta` field on every MCP message supports custom keys with reverse-DNS prefixes. NullSpend can establish the convention.

### Proposed conventions

On MCP tool call responses (from NullSpend's MCP proxy to the client):

```json
{
  "result": {
    "content": [{ "type": "text", "text": "..." }],
    "_meta": {
      "com.nullspend/cost_microdollars": 10000,
      "com.nullspend/budget_remaining_microdollars": 48750000,
      "com.nullspend/trace_id": "0af7651916cd43dd8448eb211c80319c",
      "com.nullspend/tool_tier": "write"
    }
  }
}
```

On MCP tool call requests (propagating trace context per SEP-414):

```json
{
  "params": {
    "name": "fetch_url",
    "arguments": { "url": "..." },
    "_meta": {
      "traceparent": "00-0af7651916cd43dd8448eb211c80319c-00f067aa0ba902b7-01",
      "com.nullspend/budget_remaining_microdollars": 48750000
    }
  }
}
```

### Implementation

Modify `packages/mcp-proxy/src/proxy.ts` to:
1. Inject `traceparent` into outbound MCP tool call `_meta` (per SEP-414)
2. Add `com.nullspend/*` fields to tool call responses
3. Propagate trace ID from the calling LLM's trace context (if MCP proxy is configured with one)

### Files to modify

| File | Change |
|---|---|
| `packages/mcp-proxy/src/proxy.ts` | Inject `_meta` fields on request/response |
| `packages/mcp-proxy/src/cost-tracker.ts` | Return cost data for `_meta` injection |
| `packages/mcp-proxy/src/index.ts` | Accept trace ID config for propagation |

### Test plan

| Test | Type | What it verifies |
|---|---|---|
| `com.nullspend/cost_microdollars` present in tool call response `_meta` | Unit | Cost metadata injected |
| `traceparent` injected in outbound tool call `_meta` | Unit | SEP-414 compliance |
| `com.nullspend/budget_remaining` reflects actual remaining budget | Unit | Correct value from budget check |
| Missing trace ID config omits `traceparent` from `_meta` | Unit | Graceful when unconfigured |
| `_meta` fields don't overwrite existing upstream `_meta` | Unit | Merge, not replace |

---

## Phase 5: Tool Definition Cost Attribution

### Problem

When agents pass tool schemas in their LLM calls, those schemas consume input tokens. The proxy already calculates `toolDefinitionTokens = Math.ceil(JSON.stringify(body.tools).length / 4)` but stores it as an informational field — it's not broken out in `costBreakdown`.

### Solution

Add `toolDefinition` to the `costBreakdown` JSONB field:

```json
{
  "input": 125000,
  "output": 45000,
  "cached": 0,
  "reasoning": 0,
  "toolDefinition": 18750
}
```

The `toolDefinition` value is an estimated portion of the `input` cost, not additive. It answers: "of your $0.125 input cost, $0.019 was tool schemas."

**Calculation:** `toolDefinitionCost = (toolDefinitionTokens / inputTokens) * inputCostMicrodollars`

### Double-counting prevention

The `toolDefinition` cost is a **subset of** `input` cost, not additive. The rollup API (Phase 3) must not sum `toolDefinition` on top of `input` — it's a breakdown within `input`. The response schema makes this explicit by nesting it inside `costBreakdown` alongside `input`, not as a separate top-level field.

### Files to modify

| File | Change |
|---|---|
| `apps/proxy/src/routes/openai.ts` | Calculate and include `toolDefinition` in cost breakdown |
| `apps/proxy/src/routes/anthropic.ts` | Same |
| `apps/proxy/src/lib/cost-logger.ts` | Pass through to storage |

### Test plan

| Test | Type | What it verifies |
|---|---|---|
| `toolDefinition` present in `costBreakdown` when tools in request | Unit | Breakdown populated |
| `toolDefinition` absent when no tools in request | Unit | No spurious field |
| `toolDefinition` is a proportion of `input`, not additive | Unit | Math: `toolDef / input = toolDefTokens / inputTokens` |
| `toolDefinition` is zero when `inputTokens` is zero | Unit | Division by zero guard |
| Cost rollup (Phase 3) does not double-count `toolDefinition` | Unit | Rollup sums `costMicrodollars`, not breakdown components |

---

## Data Model Summary

### New columns

| Table | Column | Type | Index |
|---|---|---|---|
| `cost_events` | `trace_id` | `text` | Yes (`cost_events_trace_id_idx`) |
| `cost_events` | `agent_id` | `text` | Yes (`cost_events_agent_id_idx`) |
| `cost_events` | `parent_agent_id` | `text` | No (query via `agent_id` join) |

### New tables

| Table | Purpose | Phase |
|---|---|---|
| `tool_call_stubs` | Pending/completed tool call tracking | Phase 2 |

### Response headers (new)

| Header | Value | Phase |
|---|---|---|
| `X-NullSpend-Trace-Id` | Trace ID (provided or auto-generated) | Phase 1 |
| `X-NullSpend-Cost` | Cost in microdollars | Phase 1 |
| `X-NullSpend-Budget-Remaining` | Lowest remaining budget or `unlimited` | Phase 1 |

### API endpoints (new)

| Endpoint | Method | Purpose | Phase |
|---|---|---|---|
| `/api/traces/:traceId/cost` | GET | Cost rollup per trace | Phase 3 |

---

## Phase 6: Agent Loop Detection & Session Circuit Breakers

### Problem

An organization lost **$47K over 11 days** from an undetected agent loop. NullSpend's Durable Object architecture is ideally positioned to detect and prevent this — the DO already tracks per-user spend and processes requests sequentially.

### Detection Heuristics (Proxy-Side, No Client Cooperation)

| Heuristic | Signal | Threshold |
|---|---|---|
| Request frequency | Same API key, >10 req/min sustained >30 min | Configurable |
| Tool call count | >50 tool calls in one session | Per-session counter |
| Token accumulation | Cumulative input tokens >1M per session | Per-session counter |
| Cost velocity | Spend rate exceeds 3x historical baseline (EWMA) | Learned |

### Session Circuit Breaker

Add per-session cost tracking in the Durable Object alongside per-entity budget tracking:

```typescript
// In UserBudgetDO — session spend table
CREATE TABLE IF NOT EXISTS session_spend (
  session_id TEXT PRIMARY KEY,
  spend INTEGER NOT NULL DEFAULT 0,
  request_count INTEGER NOT NULL DEFAULT 0,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);
```

When a request arrives with a `sessionId`:
1. Increment session spend and request count
2. If session spend exceeds configurable per-session limit, deny
3. If request count exceeds configurable per-session request limit, deny
4. Alarm-based cleanup of stale sessions (>1 hour inactive)

### EWMA Anomaly Detection

Track spend velocity per user with Exponentially Weighted Moving Average:

```
ewma = alpha * costPerMinute + (1 - alpha) * ewma
variance = alpha * (residual^2) + (1 - alpha) * variance
zScore = residual / sqrt(variance)
isAnomaly = |zScore| > 3  (3-sigma threshold)
```

This detects gradual cost creep that fixed thresholds miss. Can run inside the DO with minimal overhead — just two floating-point values per user.

### Configuration

Thresholds are stored in the DO's SQLite alongside budget rows:

```sql
CREATE TABLE IF NOT EXISTS session_limits (
  key TEXT PRIMARY KEY,    -- "max_session_spend" | "max_session_requests" | "ewma_alpha" | "ewma_sigma"
  value INTEGER NOT NULL
);
```

Default values applied when no row exists. Configurable via a future dashboard settings page or API endpoint. For MVP, hardcode sensible defaults: max_session_spend = $10 (10,000,000 microdollars), max_session_requests = 200, ewma_alpha = 0.3, ewma_sigma = 3.

### Denial response

When a session circuit breaker triggers, return the standard budget denial format:

```json
{
  "error": {
    "code": "session_limit_exceeded",
    "message": "Session has exceeded its cost limit. Start a new session or increase the limit.",
    "details": {
      "sessionId": "sess_abc",
      "sessionSpend": 10500000,
      "sessionLimit": 10000000,
      "requestCount": 47
    }
  }
}
```

HTTP status: 429 (same as budget denial — the client retry logic is the same).

### Files to modify

| File | Change |
|---|---|
| `apps/proxy/src/durable-objects/user-budget.ts` | Add `session_spend` table, session tracking in `checkAndReserve`, EWMA state |
| `apps/proxy/src/lib/budget-orchestrator.ts` | Pass `sessionId` to DO RPC |
| `apps/proxy/src/lib/budget-do-client.ts` | Update `doBudgetCheck` signature |
| `apps/proxy/src/routes/openai.ts` | Ensure `sessionId` flows through to budget check |
| `apps/proxy/src/routes/anthropic.ts` | Same |

### Test plan

| Test | Type | What it verifies |
|---|---|---|
| Session spend incremented on each request | Unit | DO tracks cumulative session cost |
| Session denied when spend exceeds limit | Unit | 429 returned with `session_limit_exceeded` |
| Session denied when request count exceeds limit | Unit | Request counting works |
| No session tracking when `sessionId` is absent | Unit | Graceful degradation |
| Stale sessions cleaned up by alarm (>1h inactive) | Unit | No unbounded memory growth |
| EWMA anomaly detected at 3-sigma spike | Unit | Statistical detection works |
| EWMA doesn't false-positive during normal variance | Unit | Baseline stability |
| Session denial includes correct details in response body | Unit | Debugging info present |

### Estimated effort: ~6 hours

---

## Phase 7: Adaptive Cost Estimation

### Problem

NullSpend's current estimation uses a static 1.1x safety margin on `estimateMaxCost`. This overestimates for simple requests and underestimates for reasoning models.

### Solution

Replace the static multiplier with a learned ratio per `(model, request_shape)` tuple:

```typescript
interface AdaptiveEstimator {
  // Key: "gpt-4o:tools:stream" or "claude-sonnet:no-tools:sync"
  // Value: rolling statistics of actual/estimated ratio
  ratioHistory: Map<string, { mean: number; stddev: number; n: number }>;

  estimate(model: string, body: RequestBody): number {
    const base = estimateMaxCost(model, body);
    const shape = `${model}:${body.tools ? 'tools' : 'no-tools'}:${body.stream ? 'stream' : 'sync'}`;
    const history = this.ratioHistory.get(shape);

    if (history && history.n > 50) {
      // p95 of ratio distribution for 95% coverage
      const p95Ratio = history.mean + 1.645 * history.stddev;
      return Math.round(base * p95Ratio);
    }
    return base; // Fall back to static 1.1x until enough data
  }
}
```

**Training data:** `cost_events` already contains both estimated (from reservation) and actual costs. A periodic job computes ratios per shape and updates the estimator.

**Storage:** Worker KV namespace (`ESTIMATION_RATIOS`). Updated by a Cron Trigger (e.g., hourly) that queries `cost_events` for the last 24h, computes per-shape ratios, and writes to KV. The estimator reads from KV on each request (sub-millisecond KV reads).

**Cold start:** When KV has no data for a shape (new model, new request pattern), fall back to the existing static 1.1x margin. The system is self-improving — accuracy increases as more data flows through.

### Files to modify

| File | Change |
|---|---|
| `apps/proxy/src/lib/cost-estimator.ts` | Add adaptive estimation logic, KV read |
| `apps/proxy/src/lib/anthropic-cost-estimator.ts` | Same for Anthropic |
| `apps/proxy/wrangler.toml` | Add `ESTIMATION_RATIOS` KV namespace binding |
| New: `apps/proxy/src/cron/update-estimation-ratios.ts` | Cron job to compute and write ratios |

### Test plan

| Test | Type | What it verifies |
|---|---|---|
| Adaptive estimate used when KV has data for shape | Unit | Learned ratio applied |
| Static 1.1x fallback when KV has no data | Unit | Cold start behavior |
| Static fallback when `n < 50` samples | Unit | Minimum sample threshold |
| p95 ratio calculation is correct | Unit | `mean + 1.645 * stddev` math |
| Different shapes get independent ratios | Unit | No cross-contamination |
| KV read failure falls back to static | Unit | Resilience |

### Estimated effort: ~4 hours

---

## Phase 8: Mid-Stream SSE Cost Injection

### Opportunity

Neither OpenAI nor Anthropic reports token-by-token cost during streaming. NullSpend can inject custom SSE events mid-stream that are backwards-compatible (clients ignore unknown event types):

```
event: token
data: {"choices":[{"delta":{"content":"Hello"}}]}

event: nullspend:usage
data: {"tokens_so_far":150,"estimated_cost_microdollars":3000,"budget_remaining_microdollars":48750000}

event: token
data: {"choices":[{"delta":{"content":" world"}}]}
```

### How it works

1. Proxy pipes SSE through a `TransformStream` (already does this for usage extraction)
2. Count output characters as they stream, estimate tokens via `chars / 4`
3. Every N tokens (configurable, e.g., every 100), inject a `nullspend:usage` SSE event
4. Final chunk includes exact cost from provider's usage object

### Compatibility

- OpenAI Python/Node SDK: ignores unknown SSE event types
- Anthropic SDK: ignores unknown event types (uses named events like `message_start`, `content_block_delta` — unrecognized event types are dropped by the parser)
- `curl` / raw SSE consumers: see the events, can parse or ignore
- NullSpend SDK: can parse `nullspend:usage` events for real-time cost display

### Anthropic SSE format handling

Anthropic uses named SSE events (`event: message_start`, `event: content_block_delta`) rather than the `data:`-only format OpenAI uses. The injected `event: nullspend:usage` is compatible with both — Anthropic clients ignore unknown event types, and OpenAI clients ignore events that aren't `data:` lines.

### Files to modify

| File | Change |
|---|---|
| `apps/proxy/src/routes/openai.ts` | Add character counter to streaming TransformStream, inject SSE events |
| `apps/proxy/src/routes/anthropic.ts` | Same, adapted for Anthropic SSE format |
| `apps/proxy/src/lib/sse-parser.ts` | Extract character count alongside token accumulation |
| `apps/proxy/src/lib/anthropic-sse-parser.ts` | Same |
| New: `apps/proxy/src/lib/cost-injection.ts` | SSE event formatter, injection interval logic |

### Test plan

| Test | Type | What it verifies |
|---|---|---|
| `nullspend:usage` events injected every N tokens (OpenAI format) | Unit | Injection cadence |
| `nullspend:usage` events injected every N tokens (Anthropic format) | Unit | Provider-specific SSE handling |
| Event includes `tokens_so_far`, `estimated_cost_microdollars` | Unit | Payload shape |
| Final event has exact cost (not estimate) | Unit | Reconciliation at stream end |
| Non-streaming responses are unaffected | Unit | No injection on JSON responses |
| OpenAI SDK ignores injected events (passthrough test) | Integration | Client compatibility |
| Character-to-token estimation is within 30% of actual | Unit | Heuristic accuracy |
| Injection disabled when `X-NullSpend-No-Inject: true` header sent | Unit | Opt-out mechanism |

### Estimated effort: ~4 hours

---

## SDK Integration (`@nullspend/sdk`)

The SDK provides convenience layers for trace propagation. Each tier is independently useful; none is required.

### Tier 1: `createHeaders()` Helper

A typed function that constructs NullSpend headers. ~20 lines of code, no runtime magic.

**Python:**
```python
from nullspend import create_headers

client = openai.OpenAI(
    base_url="https://proxy.nullspend.com/v1",
    default_headers=create_headers(
        api_key="nsk_abc123",
        trace_id="auto",           # proxy generates per-request
        session="agent-run-42",     # optional grouping
        agent_id="research-bot",    # optional multi-agent identity
    ),
)
```

**TypeScript:**
```typescript
import { createHeaders } from "@nullspend/sdk";

const client = new OpenAI({
    baseURL: "https://proxy.nullspend.com/v1",
    defaultHeaders: createHeaders({
        apiKey: "nsk_abc123",
        traceId: "auto",
        session: "agent-run-42",
        agentId: "research-bot",
    }),
});
```

**Implementation:** Maps SDK options to `X-NullSpend-*` headers. Returns a `Record<string, string>`. No HTTP client wrapping, no monkey-patching.

### Tier 2: `wrapOpenAI()` / `wrapAnthropic()` (Deferred)

A wrapper that auto-manages per-request trace IDs by intercepting the HTTP client. Uses `DefaultHttpxClient` with event hooks (Python) or custom `fetch` (TypeScript). Captures `X-NullSpend-Trace-Id` from response headers and propagates to subsequent calls.

**Deferred until there is user demand.** The proxy URL + `defaultHeaders` pattern (Tier 1) covers most use cases. The wrapper adds value only when developers need cross-request trace propagation without explicitly managing trace IDs.

### Tier 3: `nullspend-run` CLI (Deferred)

```bash
nullspend-run --api-key nsk_abc123 -- python agent.py
```

Sets `OPENAI_BASE_URL`, `ANTHROPIC_BASE_URL`, and monkey-patches HTTP clients to inject headers. Zero code changes. Follows the Datadog `ddtrace-run` pattern. **Deferred** — high maintenance burden with every SDK version bump.

---

## What This Does NOT Include

- **Full observability UI** — Langfuse, Arize Phoenix, Datadog own this space. NullSpend emits data they can consume.
- **SDK instrumentation requirement** — Everything works with zero SDK. The proxy URL + `defaultHeaders` pattern uses native OpenAI/Anthropic SDK features. *(Ref: Both SDKs support `default_headers` + `base_url` natively)*
- **Custom tracing protocol** — Aligned with W3C Trace Context and OTel GenAI conventions.
- **Non-MCP tool execution tracking** — Physically impossible without client cooperation. The SDK's `reportCost()` covers this.
- **Span hierarchy storage** — Phase 1-3 use flat trace ID grouping. Full parent-child spans are a future extension if needed.
- **OTel exporter** — Future work. NullSpend could emit OTel spans to external collectors via `waitUntil()`, but the priority is cost tracking, not full tracing.
- **Monkey-patching / CLI runner** — Deferred (Tiers 2-3). The proxy-first pattern avoids the maintenance burden of keeping up with SDK internals. *(Ref: AgentOps and Traceloop both have recurring breaks from SDK version bumps — see `developer-adoption-tracing-research.md`)*

---

## Competitive Position After Implementation

| Capability | NullSpend (after) | Portkey | LiteLLM | Helicone | Langfuse | AgentOps |
|---|---|---|---|---|---|---|
| Proxy-level cost tracking | Yes | Dashboard only | Yes (header) | No | N/A | N/A |
| Budget enforcement | Yes (DO-based) | No | Yes (virtual keys) | No | No | No |
| MCP tool cost tracking | Yes + `_meta` conventions | No | No | No | No | No |
| Trace correlation | Yes (`traceparent` + `auto` + stitching) | Yes (custom header) | Yes (metadata) | Partial (paths) | Yes (SDK) | Yes (SDK) |
| Server-side tool stitching | **Yes (unique)** | No | No | No | No | No |
| Tool call round-trip | Yes (stub matching) | Implicit | Implicit | Custom API | Yes (decorator) | Yes (auto-patch) |
| Zero-SDK integration | Yes (`defaultHeaders`) | Yes (headers) | Yes (body metadata) | Yes (base URL) | No (SDK required) | No (SDK required) |
| Cost in response headers | Yes | No | Yes | No | N/A | N/A |
| Cost rollup per trace | Yes (API) | Dashboard only | Dashboard only | No | Yes (SDK) | Per-session |
| HITL approval gate | Yes (actions) | No | No | No | No | No |
| Agent loop detection | Yes (DO-based) | No | No | No | No | Yes |
| Mid-stream cost | Yes (SSE injection) | No | No | No | No | No |
| Adaptive estimation | Yes (learned) | No | No | No | No | No |
| OTel compatibility | Yes (`traceparent`) | Yes | Full | OpenLLMetry | Full | No |
| Dollar costs in traces | **Yes (first)** | No | No | No | No | No |

**Unique position:** NullSpend would be the only platform combining: proxy-level cost enforcement + server-side tool_call_id stitching (no competitor does this) + MCP tool cost tracking + OTel-compatible trace correlation + per-trace cost rollup + agent loop detection + mid-stream cost visibility + HITL approval gates. No other platform puts dollar costs directly in traces — everyone else gives token counts only. And the zero-SDK integration path (`defaultHeaders` + `"auto"`) means developers get tracing with one line of config.
