# Competitor & Infrastructure Bug Research

> **Date:** 2026-03-18 16:45 UTC
> **Method:** 5 parallel research agents targeting LiteLLM, Langfuse, Helicone, Portkey, OTel GenAI conventions, and Cloudflare Workers/DOs.
> **Purpose:** Learn from competitors' production failures to bake fixes into NullSpend's tracing architecture before we build it.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Bugs NullSpend Already Avoids](#2-bugs-nullspend-already-avoids)
3. [Critical Warnings for Tracing Build](#3-critical-warnings-for-tracing-build)
4. [Immediate Action Items](#4-immediate-action-items)
5. [Defensive Architecture Checklist](#5-defensive-architecture-checklist)
6. [Platform-Specific Findings](#6-platform-specific-findings)
7. [References](#7-references)

---

## 1. Executive Summary

Across 5 platforms, we found **80+ specific bugs** with root causes. The failures cluster around 8 recurring architectural mistakes:

| Pattern | Platforms Affected | NullSpend Status |
|---|---|---|
| Cached token double-counting | LiteLLM (4x), Langfuse (3x), Helicone | **Safe** — cost engine handles cache tokens as first-class |
| Non-atomic budget enforcement (TOCTOU) | LiteLLM (3x) | **Safe** — DO `transactionSync()` is atomic |
| Fire-and-forget cost logging (silent data loss) | LiteLLM, Langfuse | **At risk** — `waitUntil()` can timeout |
| Streaming usage extraction timing | LiteLLM (4x), Helicone, Portkey | **Safe** — extract from final chunk |
| Python GIL / Node.js event loop saturation | LiteLLM, Langfuse | **Safe** — CF Workers have no GIL |
| Mutable shared state across requests | LiteLLM (2x), Portkey | **Safe** — Workers are stateless |
| Manual pricing catalog maintenance | LiteLLM, Helicone (9x), Langfuse | **Same risk** — `pricing-data.json` |
| OTel semantic convention instability | Langfuse (3x), OpenLLMetry (5x) | **Not yet exposed** — no OTel integration yet |

---

## 2. Bugs NullSpend Already Avoids

### By architecture (no action needed)

| Bug Class | Competitor Issue | Why NullSpend is immune |
|---|---|---|
| Non-atomic budget check (TOCTOU race) | LiteLLM #18730 — concurrent TPM bypass | DO `transactionSync()` is atomic within single-threaded DO |
| Budget bypass via alternate request paths | LiteLLM #12977 (Azure path), #10750 (pass-through) | All routes go through same `checkBudget()` in orchestrator |
| Budget not enforced in hierarchy | LiteLLM #12905 (team skips user), #11083 (end-user) | DO checks ALL matching entities (user + api_key) |
| Python GIL throughput ceiling | LiteLLM #21046 — 4x overhead at 300 RPS | CF Workers: no GIL, isolate-per-request |
| Memory leaks from client cache | LiteLLM #10126, #12685, #15128 | Workers are stateless, no cross-request caches |
| Mutable shared dict corruption | LiteLLM PR #10167, Portkey #1550 | Workers: no shared mutable state |
| Budget reset OOM (loads 250K keys) | LiteLLM #13210 | DO handles resets inline per-request via `currentPeriodStart` |
| Node.js event loop saturation | Langfuse #7591 — pod restarts at 10K QPS | Workers: no event loop to saturate |
| SDK context loss in async generators | Langfuse #7749, #8216, #7226 | Proxy doesn't instrument user code |
| Framework callback double-counting | Langfuse #10914, #3956, Logfire #1509 | Proxy tracks at exactly one layer |
| Streaming immutable header crash | Portkey #1550 — Node.js `TypeError: immutable` | CF Workers: headers are mutable |

### By design decisions (validate periodically)

| Bug Class | Competitor Issue | Our design |
|---|---|---|
| Streaming token accumulation | LiteLLM #12970 — 10-100x inflation | Extract from final chunk only, never accumulate |
| Cost at ingestion vs retroactive | Langfuse #12184 | Calculate at proxy time (correct) |
| Inconsistent budget reset | LiteLLM #14266 — race in batch reset | Inline period reset in DO `checkAndReserve` |
| Redis keys without TTL | Langfuse #11016 — OOM from stale keys | DO SQLite (no Redis for budgets), webhooks have TTL |

---

## 3. Critical Warnings for Tracing Build

### 3.1 Token Field Taxonomy (THE #1 bug across all competitors)

**The pattern:** "Field X is a subset of field Y but code treats them as additive."

| Platform | Issue | What happened |
|---|---|---|
| LiteLLM | #11364 | Cached tokens charged at full price (10.9x overcharge) |
| LiteLLM | #5443 | Cache creation tokens double-charged (2x cost) |
| LiteLLM | #19680 | Cached tokens STILL overcharged (2026, 4th occurrence) |
| Langfuse | #10592 | UI sums `input` + `cache_read_input` (both include cached) |
| Langfuse | #12306 | OTel `input_tokens` is total-inclusive; Anthropic API is uncached-only |
| Langfuse | #11244 | Reasoning tokens treated as additive to output (subset) |

**NullSpend action:** Our Phase 5 `toolDefinition` breakdown and Phase 3 cost rollup must have explicit documentation:

```
costBreakdown.input        = TOTAL input cost (includes everything)
costBreakdown.cached       = SUBSET of input (not additive)
costBreakdown.toolDefinition = SUBSET of input (not additive)
costBreakdown.output       = TOTAL output cost
costBreakdown.reasoning    = SUBSET of output (not additive)
```

### 3.2 OTel Semantic Conventions Are Unstable

| Issue | What broke | Impact |
|---|---|---|
| semconv v1.37 | Prompt/completion moved from attributes to events | All attribute-based parsers broke (Langfuse #12657) |
| semconv #825 | `llm.*` renamed to `gen_ai.*` | Every early adopter's code broke |
| semconv #1950 | `gemini` -> `google.gemini` | String-matching on provider names broke |
| semconv #3341 | Token type can't distinguish cached/reasoning subsets | Aggregation math is broken |
| OpenLLMetry #3748 | `SpanAttributes.LLM_SYSTEM` disappeared | Import errors on upgrade |

**NullSpend action:** Create a thin `otel-attributes.ts` constants module. Pin to a specific semconv version. When the spec changes, update ONE file.

### 3.3 traceparent Header Handling

| Issue | What goes wrong |
|---|---|
| OTel spec #4496 | Node.js: client + proxy both inject traceparent = comma-separated garbage |
| OTel spec #1633 | Forwarding traceparent to upstream leaks trace IDs across trust boundaries |
| MCP #3532 | MCP context propagation not yet standardized |

**NullSpend action for Phase 1:**
1. **Strip** incoming `traceparent` before forwarding to OpenAI/Anthropic (trust boundary)
2. **Replace**, never append — if we inject our own, remove the client's first
3. Store the client's trace context for correlation, but create a new span at the proxy

### 3.4 Streaming Cost Bugs

| Platform | Issue | Root Cause |
|---|---|---|
| LiteLLM | #12970 | Streaming inflates prompt_tokens 10-100x (accumulates instead of replacing) |
| LiteLLM | #6633 | Cost callback fires before stream completes |
| LiteLLM | #11915 | Missing `stream_options: {"include_usage": true}` injection |
| LiteLLM | #11789 | Streaming + caching: cache tokens counted as regular input |
| Helicone | #733 | 2x prompt tokens in streaming mode |
| Portkey | #1206 | Unhandled rejection in stream transform crashes gateway |
| Portkey | #1363 | Intermittent stream writer double-close (production-only) |

**NullSpend action for Phase 8 (SSE injection):**
- Never accumulate tokens from intermediate chunks
- Ensure stream writer state guards prevent double-close
- Test with `cancel()` (client disconnect) mid-stream
- The `ensureStreamOptions()` function already injects `include_usage: true` — keep it

### 3.5 OTel Span Size Limits

| Issue | What happens |
|---|---|
| OTel Collector #14298 | One oversized span causes Collector to drop ENTIRE batch (HTTP 413) |
| semconv #1621 | Per-message events create massive spans for multi-turn conversations |

**NullSpend action:** Never record prompt/completion content as span attributes. If content capture is ever opt-in, hard-truncate at 32KB. Set `OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT`.

---

## 4. Immediate Action Items

These should be fixed regardless of tracing work:

### 4.1 Add `Content-Encoding: identity` to streaming responses

**Risk:** CRITICAL. Cloudflare's proxy can buffer `text/event-stream` if compression is applied, delivering tokens as a single burst instead of streaming. Multiple reports (Mintlify blog, CF community #506921, Mastra #13584).

**Fix:** Add `Content-Encoding: identity` to all streaming response headers in `openai.ts` and `anthropic.ts`.

### 4.2 Defensive reservation cleanup in `checkAndReserve`

**Risk:** HIGH. DO alarms have at-most 6 retries. If alarm handler fails 6x, expired reservations never clean up, inflating `reserved` and causing false `budget_exceeded` denials.

**Fix:** Before checking budgets in `checkAndReserve`, scan for and clean expired reservations. The alarm becomes an optimization, not a correctness requirement. Also add try/catch in alarm handler that reschedules a new alarm on error.

### 4.3 Route cost logging through Queues

**Risk:** HIGH. `waitUntil()` has a 30-second deadline. If Postgres is slow via Hyperdrive, cost event logging can be silently cancelled. Reconciliation already goes through Queues; cost logging should too.

**Fix:** Send cost events to Cloudflare Queues first (fast, <5ms). Queue consumer writes to Postgres with retries and DLQ.

### 4.4 Verify compatibility date >= 2024-12-16

**Risk:** MEDIUM. TransformStream backpressure bug before this date. NullSpend's SSE parsers use TransformStream.

**Fix:** Check `wrangler.toml` compatibility date.

---

## 5. Defensive Architecture Checklist

For each phase of the tracing build, verify these patterns:

### Phase 1: Trace Headers

- [ ] Strip `traceparent` before forwarding to upstream (trust boundary — OTel #1633)
- [ ] Replace, never append trace headers (duplication bug — OTel #4496)
- [ ] Graceful degradation on malformed `traceparent` (never reject request)
- [ ] Agent ID headers validated (128 char max, printable ASCII)
- [ ] `trace_id` column is nullable (backward compat)

### Phase 2: Tool Call Stubs

- [ ] No NULL in composite unique constraints (LiteLLM #12892 PostgreSQL trap)
- [ ] Stub writes via `waitUntil()` or Queues (non-blocking)
- [ ] Stubs scoped by `userId` in all queries (security)
- [ ] Orphan detection handles clock skew

### Phase 3: Cost Rollup

- [ ] Rollup sums `costMicrodollars`, NOT breakdown components (double-counting)
- [ ] MCP tool events with `provider: "mcp"` don't double-count LLM input costs
- [ ] Query bounded by time range or pagination (Langfuse #10107 — unbounded GROUP BY)
- [ ] Rollup scoped by authenticated `userId` (can't see other users' traces)

### Phase 5: Tool Definition Cost

- [ ] `toolDefinition` is explicitly a SUBSET of `input`, not additive
- [ ] Division by zero guard when `inputTokens = 0`
- [ ] Documentation clearly states the taxonomy (subset vs additive)

### Phase 6: Session Circuit Breakers

- [ ] Session spend table uses non-nullable columns in unique constraints
- [ ] Alarm handler has try/catch with alarm rescheduling (DO alarm issue)
- [ ] Configurable thresholds with sensible defaults
- [ ] Denial response matches existing budget denial format (429)

### Phase 8: SSE Cost Injection

- [ ] `Content-Encoding: identity` set on all streaming responses
- [ ] Stream writer state guard prevents double-close (Portkey #1363)
- [ ] Character-counting heuristic, never token accumulation from chunks
- [ ] `cancel()` callback tested for client disconnect mid-injection
- [ ] Injected events use `event: nullspend:usage` (clients ignore unknown types)
- [ ] Verify TransformStream compatibility date >= 2024-12-16

---

## 6. Platform-Specific Findings

### 6.1 LiteLLM — 30+ bugs

**Cost tracking:** #11364 (cached 10.9x overcharge), #5443/#9812 (cache creation 2x), #9833 (Haiku 10x pricing error), #11495 (Gemini tiered pricing missing), #17410 (image tokens as text), #15547 (Perplexity search cost missing), #19680/#19681 (cached tokens STILL overcharged 2026).

**Budget enforcement:** #12977 (Azure path bypass), #10750 (pass-through bypass), #12905 (team skips user budget), #11083 (end-user budget not enforced), #14266 (reset race condition), #18730 (concurrent TPM bypass).

**Streaming:** #12970 (10-100x token inflation), #11789 (streaming + caching mismatch), #11915 (no usage in stream), #6633 (spend logs before stream completion).

**Double-counting:** #15740 (Responses API 2x spend), #12892 (NULL unique constraint), #21894 (tag usage inflated), PR #10167 (shared dict mutation), #13280 (missing spend logs), #20179 (WebSearch breaks spend).

**Scaling:** #13210 (reset OOM), #6345 (perf degradation over time), #8498 (DB connection exhaustion), #15794 (Redis async ignores max_connections), #21046 (1.7-4x throughput overhead), #10126/#12685/#15128 (memory leaks).

### 6.2 Langfuse — 25+ bugs

**Cost:** #10592 (cached input 2x in UI), #12306 (OTel cached 2x), #11244 (reasoning tokens 2x), #12531 (wrong key mappings), #12635 (missing cache data from OTel), #9386 (string-matching field names).

**Traces:** #8395 (LangGraph traces split on out-of-order events), #11941 (timing-based graph reconstruction fails), #12576 (write/read path schema mismatch).

**Double-counting:** #10914 (async contextvars), #3956 (LlamaIndex/Ollama 2x).

**Scaling:** #10107 (SQL timeout at 100M rows), #7591 (Node.js saturation at 10K QPS), #10334 (ClickHouse query timeouts), #8156 (1-hour shutdown).

**OTel:** #12657 (v1.37 attributes→events break), #12643 (AI SDK v6 empty traces), #12371 (Java duplicated metadata).

**SDK:** #7749 (async decorator), #8216 (FastAPI streaming), #7226 (async_generator detection), #6331 (slow context configure), #8573 (flush hangs).

**Infrastructure:** #11016 (Redis OOM), #7024 (BullMQ dead jobs), #12589/#10146 (ClickHouse migration issues), #11702 (dirty database state), #11394 (stream pipe crash).

### 6.3 Helicone — 14 bugs

**Critical:** #5597 (cross-org API key IDOR), #5561 (gateway ignores user API key, uses free-tier pool).

**Cost:** #5440/#5374/#5375/#5423/#4080/#4072/#5297/#2560/#5418 (pricing catalog lag — 9 separate model issues), #4893 (Grok via OpenRouter tier misattribution), #3687 (Vertex AI zero tokens).

**Streaming:** #733 (2x prompt tokens), #1508 (Anthropic SSE parse failure).

**Other:** #2973 (compressed response not decoded), #1549 (KV cache corruption), #5475 (pagination at scale), #5639 (Anthropic structured output dropped), #5544 (500 on unknown models), #5610 (MCP complex params fail).

### 6.4 Portkey — 16 bugs

**Critical:** #1237 (simple cache became semantic — platform outage), #1507 (unbounded memory cache OOM + request loop attack).

**Streaming:** #1550/#1389 (immutable header crash), #1206 (unhandled rejection crashes gateway), #1363 (intermittent double-close), #722 (Vertex error event crashes parser), #1047 (Bedrock error in 200 stream).

**Token normalization:** #1564 (inconsistent prompt_tokens across Anthropic providers).

**Headers:** #1402/#1305 (dual content-length + chunked), #1345 (anthropic_beta stripped).

**Other:** #1203/#1473/#1546 (JSON Schema to Gemini conversion), #1205 (guardrail bypasses retry), #431 (custom_host overrides fallback), #1264 (vendored OpenAI shadows real package), #1256 (semantic cache not implemented), #1119 (afterRequestHook skipped for streaming).

### 6.5 OTel GenAI — 21 issues

**Streaming:** #1170 (uncloseable span problem), contrib #4120 (30-58x token inflation), contrib #4345 (ToolCallBuffer crash on None).

**Double-counting:** #1918 (aggregated vs raw usage), #3341 (token type can't distinguish subsets).

**Breaking changes:** #825 (`llm.*` → `gen_ai.*`), #1950 (provider value renames), #1851 (system_message → system_instructions).

**Missing features:** #2312 (no cost attributes — stalled), #3447 (no user attribution), #3342 (no gateway/proxy attributes), #3500 (no content capture config standard), #3419/#3418 (no agent loop span standard).

**Security:** spec #4496 (traceparent duplication), spec #1633 (cross-trust-boundary leakage).

**Infrastructure:** Collector #14298 (oversized span drops entire batch), #1621 (per-message event spam).

**MCP:** #3532 (context propagation unstandardized), #3533 (notification spans undefined), #3360/#3359 (error type redundancy), #3338 (session duration buckets too small), #3123 (no tool parameter recording standard).

### 6.6 Cloudflare Workers/DOs — 25 issues

**DO-specific:** Single-threaded bottleneck (~200-500 RPS complex ops), eviction cold start spikes, `blockConcurrencyWhile` 30s timeout, alarm reliability (6 retries max), global uniqueness violation during partitions, code version skew during deploys, memory limit 128MB, in-memory state loss on uncaught exceptions.

**Worker-specific:** `waitUntil()` 30s deadline + cancellation, SSE buffering from compression, TransformStream backpressure bug (pre-2024-12-16), client disconnect detection unreliable, CPU time limits on streaming, subrequest limits, `AbortSignal.timeout` local dev issues.

**Storage:** Hyperdrive connection timeouts, KV 60s eventual consistency, DO location pinning (never moves after creation), DO-to-DO stub lifecycle issues, write coalescing breaks on await, SQLite LIKE pattern 50-byte limit.

**Incidents:** Elevated DO/R2 latency March 2026 (regional).

---

## 7. References

### LiteLLM
[#11364](https://github.com/BerriAI/litellm/issues/11364) | [#5443](https://github.com/BerriAI/litellm/issues/5443) | [#9812](https://github.com/BerriAI/litellm/issues/9812) | [#9834](https://github.com/BerriAI/litellm/pull/9834) | [#11495](https://github.com/BerriAI/litellm/issues/11495) | [#17410](https://github.com/BerriAI/litellm/issues/17410) | [#15547](https://github.com/BerriAI/litellm/issues/15547) | [#19680](https://github.com/BerriAI/litellm/issues/19680) | [#12977](https://github.com/BerriAI/litellm/issues/12977) | [#10750](https://github.com/BerriAI/litellm/issues/10750) | [#12905](https://github.com/BerriAI/litellm/issues/12905) | [#11083](https://github.com/BerriAI/litellm/issues/11083) | [#14266](https://github.com/BerriAI/litellm/issues/14266) | [#18730](https://github.com/BerriAI/litellm/issues/18730) | [#12970](https://github.com/BerriAI/litellm/issues/12970) | [#11789](https://github.com/BerriAI/litellm/issues/11789) | [#11915](https://github.com/BerriAI/litellm/issues/11915) | [#6633](https://github.com/BerriAI/litellm/issues/6633) | [#15740](https://github.com/BerriAI/litellm/issues/15740) | [#12892](https://github.com/BerriAI/litellm/issues/12892) | [#21894](https://github.com/BerriAI/litellm/issues/21894) | [#10167](https://github.com/BerriAI/litellm/pull/10167) | [#13280](https://github.com/BerriAI/litellm/issues/13280) | [#20179](https://github.com/BerriAI/litellm/issues/20179) | [#13210](https://github.com/BerriAI/litellm/issues/13210) | [#6345](https://github.com/BerriAI/litellm/issues/6345) | [#8498](https://github.com/BerriAI/litellm/issues/8498) | [#15794](https://github.com/BerriAI/litellm/issues/15794) | [#21046](https://github.com/BerriAI/litellm/issues/21046) | [#10126](https://github.com/BerriAI/litellm/issues/10126) | [#13646](https://github.com/BerriAI/litellm/issues/13646) | [#14472](https://github.com/BerriAI/litellm/issues/14472) | [#11929](https://github.com/BerriAI/litellm/issues/11929) | [#18728](https://github.com/BerriAI/litellm/issues/18728)

### Langfuse
[#10592](https://github.com/langfuse/langfuse/issues/10592) | [#12306](https://github.com/langfuse/langfuse/issues/12306) | [#11244](https://github.com/langfuse/langfuse/issues/11244) | [#12531](https://github.com/langfuse/langfuse/issues/12531) | [#12635](https://github.com/langfuse/langfuse/issues/12635) | [#12184](https://github.com/langfuse/langfuse/issues/12184) | [#9386](https://github.com/langfuse/langfuse/issues/9386) | [#8395](https://github.com/langfuse/langfuse/issues/8395) | [#11941](https://github.com/langfuse/langfuse/issues/11941) | [#12576](https://github.com/langfuse/langfuse/issues/12576) | [#10914](https://github.com/langfuse/langfuse/issues/10914) | [#3956](https://github.com/langfuse/langfuse/issues/3956) | [#10107](https://github.com/langfuse/langfuse/issues/10107) | [#7591](https://github.com/langfuse/langfuse/issues/7591) | [#10334](https://github.com/langfuse/langfuse/issues/10334) | [#8156](https://github.com/langfuse/langfuse/issues/8156) | [#12657](https://github.com/langfuse/langfuse/issues/12657) | [#12643](https://github.com/langfuse/langfuse/issues/12643) | [#12371](https://github.com/langfuse/langfuse/issues/12371) | [#7749](https://github.com/langfuse/langfuse/issues/7749) | [#8216](https://github.com/langfuse/langfuse/issues/8216) | [#7226](https://github.com/langfuse/langfuse/issues/7226) | [#6331](https://github.com/langfuse/langfuse/issues/6331) | [#8573](https://github.com/langfuse/langfuse/issues/8573) | [#11016](https://github.com/langfuse/langfuse/issues/11016) | [#7024](https://github.com/langfuse/langfuse/issues/7024)

### Helicone
[#5597](https://github.com/Helicone/helicone/issues/5597) | [#5561](https://github.com/Helicone/helicone/issues/5561) | [#5440](https://github.com/Helicone/helicone/issues/5440) | [#5374](https://github.com/Helicone/helicone/issues/5374) | [#4893](https://github.com/Helicone/helicone/issues/4893) | [#733](https://github.com/Helicone/helicone/issues/733) | [#1508](https://github.com/Helicone/helicone/issues/1508) | [#2973](https://github.com/Helicone/helicone/issues/2973) | [#1549](https://github.com/Helicone/helicone/issues/1549) | [#3687](https://github.com/Helicone/helicone/issues/3687) | [#5639](https://github.com/Helicone/helicone/issues/5639) | [#5544](https://github.com/Helicone/helicone/issues/5544) | [#5475](https://github.com/Helicone/helicone/issues/5475) | [#5610](https://github.com/Helicone/helicone/issues/5610)

### Portkey
[#1550](https://github.com/Portkey-AI/gateway/issues/1550) | [#1237](https://github.com/Portkey-AI/gateway/issues/1237) | [#1206](https://github.com/Portkey-AI/gateway/issues/1206) | [#1564](https://github.com/Portkey-AI/gateway/issues/1564) | [#1402](https://github.com/Portkey-AI/gateway/issues/1402) | [#1305](https://github.com/Portkey-AI/gateway/issues/1305) | [#1345](https://github.com/Portkey-AI/gateway/issues/1345) | [#722](https://github.com/Portkey-AI/gateway/issues/722) | [#1203](https://github.com/Portkey-AI/gateway/issues/1203) | [#1205](https://github.com/Portkey-AI/gateway/issues/1205) | [#431](https://github.com/Portkey-AI/gateway/issues/431) | [#1264](https://github.com/Portkey-AI/gateway/issues/1264) | [#1363](https://github.com/Portkey-AI/gateway/issues/1363) | [#1507](https://github.com/Portkey-AI/gateway/issues/1507) | [#1047](https://github.com/Portkey-AI/gateway/issues/1047)

### OTel GenAI
[semconv #1170](https://github.com/open-telemetry/semantic-conventions/issues/1170) | [contrib #4120](https://github.com/open-telemetry/opentelemetry-python-contrib/issues/4120) | [contrib #4345](https://github.com/open-telemetry/opentelemetry-python-contrib/issues/4345) | [semconv #1918](https://github.com/open-telemetry/semantic-conventions/issues/1918) | [semconv #825](https://github.com/open-telemetry/semantic-conventions/pull/825) | [semconv #1950](https://github.com/open-telemetry/semantic-conventions/issues/1950) | [semconv #2312](https://github.com/open-telemetry/semantic-conventions/issues/2312) | [semconv #3341](https://github.com/open-telemetry/semantic-conventions/issues/3341) | [semconv #3342](https://github.com/open-telemetry/semantic-conventions/issues/3342) | [spec #4496](https://github.com/open-telemetry/opentelemetry-specification/issues/4496) | [spec #1633](https://github.com/open-telemetry/opentelemetry-specification/issues/1633) | [Collector #14298](https://github.com/open-telemetry/opentelemetry-collector/issues/14298) | [semconv #1621](https://github.com/open-telemetry/semantic-conventions/issues/1621) | [semconv #3532](https://github.com/open-telemetry/semantic-conventions/issues/3532) | [Logfire #1509](https://github.com/pydantic/logfire/issues/1509) | [OpenLLMetry #3748](https://github.com/traceloop/openllmetry/issues/3748)

### Cloudflare
[DO Rules](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/) | [DO Limits](https://developers.cloudflare.com/durable-objects/platform/limits/) | [DO Known Issues](https://developers.cloudflare.com/durable-objects/platform/known-issues/) | [DO Lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/) | [Alarms API](https://developers.cloudflare.com/durable-objects/api/alarms/) | [Worker Context](https://developers.cloudflare.com/workers/runtime-apis/context/) | [TransformStream](https://developers.cloudflare.com/workers/runtime-apis/streams/transformstream/) | [Worker Limits](https://developers.cloudflare.com/workers/platform/limits/) | [Hyperdrive](https://developers.cloudflare.com/hyperdrive/concepts/connection-pooling/) | [KV How It Works](https://developers.cloudflare.com/kv/concepts/how-kv-works/) | [DO Data Location](https://developers.cloudflare.com/durable-objects/reference/data-location/) | [workers-sdk #9438](https://github.com/cloudflare/workers-sdk/issues/9438) | [workers-sdk #5948](https://github.com/cloudflare/workers-sdk/issues/5948) | [workerd #1020](https://github.com/cloudflare/workerd/issues/1020) | [Mintlify SSE Blog](https://www.mintlify.com/blog/debugging-a-mysterious-http-streaming-issue-when-cloudflare-compression-breaks-everything) | [CF Community SSE](https://community.cloudflare.com/t/sse-endpoint-breaks-after-recent-update-cloudflare-buffers-text-event-stream-desp/810790) | [CF Community DO Latency](https://community.cloudflare.com/t/elevated-durable-objects-and-r2-api-latency/901455)
