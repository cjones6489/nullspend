# Agent Tracing & Cost Correlation Architecture

**Date:** 2026-03-18
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

1. **Zero-config baseline.** Everything works without the trace header — per-request cost tracking, budget enforcement, cost events. Tracing is an opt-in upgrade.
2. **One header, full correlation.** A single `traceparent` header (W3C standard) or `X-NullSpend-Trace-Id` header unlocks agent loop grouping.
3. **Align with OTel GenAI conventions.** Don't invent custom standards. Use `gen_ai.*` attribute names and W3C `traceparent` format.
4. **Don't build an observability platform.** Langfuse, Arize Phoenix, and Datadog own full tracing UIs. NullSpend owns cost tracking + budget enforcement. Emit OTel-compatible data that feeds into those platforms.
5. **Proxy-first, SDK-optional.** The proxy should extract maximum correlation from what it can see (LLM responses contain `tool_calls`). SDK cooperation enriches but isn't required.

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

Accept two header formats (first match wins):

| Header | Format | Standard |
|---|---|---|
| `traceparent` | `00-{trace_id}-{parent_id}-{flags}` | W3C Trace Context |
| `X-NullSpend-Trace-Id` | Any string (UUID recommended) | NullSpend custom |

If neither is provided, auto-generate a trace ID (UUID v4).

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

Add to every proxy response:

| Header | Value | Example |
|---|---|---|
| `X-NullSpend-Trace-Id` | The trace ID (provided or auto-generated) | `0af7651916cd43dd8448eb211c80319c` |
| `X-NullSpend-Cost` | Cost in microdollars | `1250` (= $0.00125) |
| `X-NullSpend-Budget-Remaining` | Lowest remaining budget in microdollars, or `unlimited` | `48750000` |
| `X-NullSpend-Request-Id` | Unique request ID (existing `requestId`) | `req_abc123` |

**Why return `X-NullSpend-Trace-Id` even if caller didn't send one:** Callers can capture the auto-generated trace ID from the first response and pass it on subsequent calls. This enables "lazy trace propagation" — the agent framework doesn't need to pre-generate trace IDs.

**Why `X-NullSpend-Cost`:** LiteLLM does this (`x-litellm-response-cost`). Portkey doesn't. This lets agents self-monitor spend without polling a separate API. For streaming responses, the cost header is only available on the final chunk (cost requires complete token counts).

### Schema change: Add `trace_id` to `cost_events`

```sql
ALTER TABLE cost_events ADD COLUMN trace_id text;
CREATE INDEX cost_events_trace_id_idx ON cost_events (trace_id);
```

This supplements `session_id` (which remains for backward compatibility). `trace_id` is the W3C-compatible correlation key; `session_id` is the caller's application-level session concept.

### Data flow

```
Request arrives
  ├── Extract trace_id from traceparent or X-NullSpend-Trace-Id
  ├── If neither present, generate UUID v4
  ├── Store in RequestContext
  │
  ├── Forward to upstream LLM
  ├── Parse response, calculate cost
  │
  ├── logCostEvent({ ..., traceId })
  ├── Add response headers (trace ID, cost, remaining)
  └── Return response
```

### Files to modify

| File | Change |
|---|---|
| `apps/proxy/src/lib/context.ts` | Extract trace ID from headers into `RequestContext` |
| `apps/proxy/src/routes/openai.ts` | Pass `traceId` to cost logger, add response headers |
| `apps/proxy/src/routes/anthropic.ts` | Same |
| `apps/proxy/src/routes/mcp.ts` | Same |
| `apps/proxy/src/lib/cost-logger.ts` | Accept and store `traceId` |
| `packages/db/src/schema.ts` | Add `traceId` column to `cost_events` |
| Drizzle migration | `ALTER TABLE` + index |

### Test plan

| Test | Type | What it verifies |
|---|---|---|
| `traceparent` header parsing (valid, malformed, missing) | Unit | Correct extraction of trace ID from W3C format |
| `X-NullSpend-Trace-Id` header passthrough | Unit | Custom header accepted, stored, returned |
| Auto-generation when no header provided | Unit | UUID v4 generated, returned in response |
| Response headers present on non-streaming response | Unit | All four headers set correctly |
| Response headers present on streaming response (final chunk) | Unit | Cost header on last SSE event |
| `trace_id` stored in `cost_events` row | Unit | Cost logger passes trace ID through |
| Multiple requests with same trace ID group correctly | Integration | Query by trace ID returns all events |
| `traceparent` takes precedence over `X-NullSpend-Trace-Id` | Unit | Priority order |

---

## Phase 2: Tool Call Stub Extraction

### Concept

The proxy already captures `toolCallsRequested` from LLM responses. Phase 2 creates lightweight "pending tool" records and closes them out when the next LLM call on the same trace arrives with tool results.

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

### Files to modify

| File | Change |
|---|---|
| `apps/proxy/src/routes/openai.ts` | Calculate and include `toolDefinition` in cost breakdown |
| `apps/proxy/src/routes/anthropic.ts` | Same |
| `apps/proxy/src/lib/cost-logger.ts` | Pass through to storage |

---

## Data Model Summary

### New columns

| Table | Column | Type | Index |
|---|---|---|---|
| `cost_events` | `trace_id` | `text` | Yes (`cost_events_trace_id_idx`) |

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

**Training data:** `cost_events` already contains both estimated (from reservation) and actual costs. A periodic job computes ratios per shape and updates the estimator. Can be stored in the DO's SQLite or in a Worker KV namespace.

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
- Anthropic SDK: ignores unknown event types
- `curl` / raw SSE consumers: see the events, can parse or ignore
- NullSpend SDK: can parse `nullspend:usage` events for real-time cost display

### Estimated effort: ~4 hours

---

## What This Does NOT Include

- **Full observability UI** — Langfuse, Arize Phoenix, Datadog own this space. NullSpend emits data they can consume.
- **SDK instrumentation requirement** — Everything works with zero SDK. The `traceparent` header is the only cooperation needed.
- **Custom tracing protocol** — Aligned with W3C Trace Context and OTel GenAI conventions.
- **Non-MCP tool execution tracking** — Physically impossible without client cooperation. The SDK's `reportCost()` covers this.
- **Span hierarchy storage** — Phase 1-3 use flat trace ID grouping. Full parent-child spans are a future extension if needed.
- **OTel exporter** — Future work. NullSpend could emit OTel spans to external collectors, but the priority is cost tracking, not full tracing.

---

## Competitive Position After Implementation

| Capability | NullSpend (after) | Portkey | LiteLLM | Helicone | Langfuse | AgentOps |
|---|---|---|---|---|---|---|
| Proxy-level cost tracking | Yes | Dashboard only | Yes (header) | No | N/A | N/A |
| Budget enforcement | Yes (DO-based) | No | Yes (virtual keys) | No | No | No |
| MCP tool cost tracking | Yes + `_meta` conventions | No | No | No | No | No |
| Trace correlation | Yes (`traceparent`) | Yes (custom header) | Yes (metadata) | Partial (paths) | Yes (SDK) | Yes (SDK) |
| Tool call round-trip | Yes (stub matching) | Implicit | Implicit | Custom API | Yes (decorator) | Yes (auto-patch) |
| Cost in response headers | Yes | No | Yes | No | N/A | N/A |
| Cost rollup per trace | Yes (API) | Dashboard only | Dashboard only | No | Yes (SDK) | Per-session |
| HITL approval gate | Yes (actions) | No | No | No | No | No |
| Agent loop detection | Yes (DO-based) | No | No | No | No | Yes |
| Mid-stream cost | Yes (SSE injection) | No | No | No | No | No |
| Adaptive estimation | Yes (learned) | No | No | No | No | No |
| OTel compatibility | Yes (`traceparent`) | Yes | Full | OpenLLMetry | Full | No |
| Dollar costs in traces | **Yes (first)** | No | No | No | No | No |

**Unique position:** NullSpend would be the only platform combining: proxy-level cost enforcement + MCP tool cost tracking + OTel-compatible trace correlation + per-trace cost rollup + agent loop detection + mid-stream cost visibility + HITL approval gates. No other platform puts dollar costs directly in traces — everyone else gives token counts only.
