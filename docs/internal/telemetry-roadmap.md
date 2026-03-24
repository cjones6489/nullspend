# Telemetry & Observability Roadmap

**Created:** 2026-03-23
**Updated:** 2026-03-24 (Phase 1+2 shipped, architectural audit, data flow gaps, platform readiness assessment)
**Status:** All 4 Phases Complete (partitioning deferred until 1M+ rows)
**Author:** Claude (from gap analysis with @cjone)

---

## Executive Summary

NullSpend's proxy has solid telemetry foundations — Server-Timing headers, Analytics Engine latency percentiles, cost event persistence with full token breakdowns, and 29 distinct console metrics. But a deep audit reveals gaps at three levels:

1. **Telemetry gaps** (9 items) — missing metrics, missing fields in cost events, incomplete latency breakdown
2. **Data flow gaps** (7 items) — response metadata, cross-request correlation, and provider-specific data that flows through the proxy but is discarded
3. **Architectural constraints** (5 items) — structural limitations that will cap what we can observe or analyze at scale

This roadmap covers all three levels, organized into 4 implementation phases.

---

## Current State (as of 2026-03-23)

### Telemetry Systems

| System | What it captures | Retention | Query method |
|---|---|---|---|
| **Server-Timing header** | Per-request latency breakdown (6 steps: preflight, body parse, budget check, overhead, upstream, total) | Per-response only | Browser DevTools, curl |
| **Analytics Engine (AE)** | Latency data points: 4 blobs (provider, model, stream/json, statusCode), 3 doubles (overheadMs, upstreamMs, totalMs), indexed by provider | 90 days | AE SQL API, `/health/metrics` endpoint |
| **Console metrics** | 29 distinct metric names via `emitMetric()` (43 emission points). JSON to `console.log` for tail worker ingestion | Depends on tail worker sink | Tail worker → external system |
| **Cost events table** | 27 columns per request: tokens, cost, costBreakdown (JSONB), tags (JSONB), session/trace IDs, duration, provider, model | Postgres (indefinite) | SQL, dashboard queries |
| **Health endpoint** | `/health/metrics` — p50/p95/p99 for overhead/upstream/total, request count, 90s KV cache | Real-time (5min window) | HTTP GET |

### Metric Coverage Map

| Proxy Lifecycle Step | Server-Timing | AE Data Point | Cost Event | Console Metric |
|---|---|---|---|---|
| Rate limit check | - | - | - | - |
| Auth (API key lookup) | `preflight` | - | - | - |
| Body parse + validation | `body` | - | - | - |
| Cost estimation | - | - | - | - |
| Budget DO check | `budget` | - | - | `do_budget_check`, `budget_check_skipped` |
| Upstream fetch (total) | `upstream` | `upstreamMs` | `upstreamDurationMs` | `proxy_latency` |
| Upstream TTFB | - | - | - | - |
| SSE stream parsing | - | - | - | - |
| Cost calculation | - | - | `costMicrodollars` | - |
| Cost event persistence | - | - | (the event itself) | `cost_event_drop`, `cost_event_queue_fallback` |
| Budget reconciliation | - | - | - | `do_reconciliation` |
| Webhook dispatch | - | - | - | `webhook_enqueued`, `webhook_delivered`, etc. |
| Total request | `total` | `totalMs` | `durationMs` | - |

---

## Gap Analysis

### GAP-1: Budget enforcement invisible in cost events (Critical)

**Problem:** Every cost event records what happened (tokens, cost, model) but not whether budget was enforced. No field distinguishes "skipped (no budgets)" from "approved" from "denied." The `hasBudgets` skip path emits a console metric (`budget_check_skipped`) but leaves no trace in persisted data.

**Impact:** Cannot answer: "What percentage of requests had budget enforcement?", "Which requests were approved vs skipped?", "Was this cost event from a budget-enforced request?"

**Fix:** Add `budget_status` column to `cost_events` table (enum: `skipped`, `approved`, `denied`). Populate from `BudgetCheckOutcome.status` in route handlers.

**Files:** `packages/db/src/schema.ts`, `apps/proxy/src/routes/openai.ts`, `apps/proxy/src/routes/anthropic.ts`, `apps/proxy/src/routes/mcp.ts`, migration SQL

---

### GAP-2: Zero error classification metrics (Critical)

**Problem:** `index.ts` has 9 error paths (401 auth failure, 429 rate limit, 400 bad JSON, 413 payload too large, 404 unknown route, 500 unhandled error) — none emit a metric or AE data point. Budget denials (429) in route handlers also emit no metric.

**Impact:** Cannot answer: "What's our auth failure rate?", "How many requests are rate-limited?", "Are we under DDoS?", "What's the budget denial rate?"

**Fix:** Add `emitMetric("request_error", { status, reason })` to each error path in `index.ts`. Add `emitMetric("budget_denied", { reason, entityType })` in route handlers on denial. Optionally write error AE data points for percentile analysis.

**Files:** `apps/proxy/src/index.ts`, `apps/proxy/src/routes/openai.ts`, `apps/proxy/src/routes/anthropic.ts`, `apps/proxy/src/routes/shared.ts`

---

### GAP-3: No TTFB or streaming latency breakdown (High)

**Problem:** Server-Timing tracks `upstream` as a single number. For streaming responses, there's no time-to-first-byte (TTFB), no stream completion time, no abort rate. AE data points capture `upstreamMs` as total — cannot distinguish 800ms TTFB + 2200ms streaming from 2800ms TTFB + 200ms streaming.

**Impact:** Cannot diagnose streaming performance issues. Cannot measure provider TTFB regression. Cannot track abort frequency.

**Fix:** Add `ttfbMs` to `StepTiming`. Record `performance.now()` when first SSE chunk arrives in the stream handler. Add `ttfbMs` as a 4th double in AE data points. Add `stream_abort_rate` metric.

**Files:** `apps/proxy/src/lib/headers.ts`, `apps/proxy/src/lib/write-metric.ts`, `apps/proxy/src/routes/openai.ts`, `apps/proxy/src/routes/anthropic.ts`

---

### GAP-4: Cost estimation accuracy not tracked (High)

**Problem:** `estimateMaxCost()` runs pre-request for budget reservation. The estimated value is never persisted alongside actual cost. Cannot measure estimation error, identify underestimated models, or quantify wasted budget headroom from conservative estimates.

**Impact:** Cannot answer: "How accurate are our estimates?", "Which models are we under/over-estimating?", "How much budget headroom is wasted?"

**Fix:** Add `estimated_cost_microdollars` column to `cost_events`. Populate from the pre-request estimate. Dashboard can compute `(estimated - actual) / actual` for accuracy analysis.

**Files:** `packages/db/src/schema.ts`, `apps/proxy/src/routes/openai.ts`, `apps/proxy/src/routes/anthropic.ts`, migration SQL

---

### GAP-5: AE data points lack attribution (Medium)

**Problem:** AE captures provider, model, status code, and latency — but not userId or keyId. Can see "GPT-4o p99 is 4200ms" but not "user X's requests are 2x slower than average." Cost events have attribution but no latency; AE has latency but no attribution.

**Impact:** Cannot slice latency by user or API key. Cannot identify users experiencing degraded performance. Cannot correlate latency with cost.

**Fix:** Add `userId` as blob5 in AE data points (hashed or truncated for cardinality). This enables per-user latency percentile queries via AE SQL API.

**Files:** `apps/proxy/src/lib/write-metric.ts`, `apps/proxy/src/routes/openai.ts`, `apps/proxy/src/routes/anthropic.ts`

**Caveat:** AE has cardinality limits on blobs. If userId count exceeds limits, use a hash bucket (e.g., first 4 chars of userId) instead.

---

### GAP-6: `/health/metrics` only returns aggregates (Medium)

**Problem:** The metrics endpoint returns p50/p95/p99 for all requests combined. AE has per-provider data (provider is the index), but the endpoint doesn't expose per-provider or per-model breakdowns.

**Impact:** Cannot answer via API: "What's Anthropic's p99 vs OpenAI's?", "Is gpt-4o slower than gpt-4o-mini?" Must query AE SQL API directly.

**Fix:** Add `?provider=openai` and `?model=gpt-4o` query params to `/health/metrics`. Filter the AE SQL query by blob values. Cache separately per filter combination.

**Files:** `apps/proxy/src/routes/metrics.ts`

---

### GAP-7: Cost event queue health opaque (Medium)

**Problem:** Queue-based cost event logging tracks fallback (`cost_event_queue_fallback`) and drop (`cost_event_drop`) metrics, but not queue depth, ingestion latency, batch size distribution, or deduplication rate.

**Impact:** Cannot answer: "Is the cost event queue backing up?", "What's the end-to-end ingestion latency?", "How many events are deduplicated?"

**Fix:** Add metrics in the queue consumer: `cost_event_batch_size`, `cost_event_ingestion_latency_ms`, `cost_event_dedup_count`. Emit from `cost-event-queue-handler.ts` after each batch.

**Files:** `apps/proxy/src/cost-event-queue-handler.ts`

---

### GAP-8: Budget sync visibility limited (Low)

**Problem:** Budget invalidation events are tracked, but not sync latency (time from dashboard mutation to proxy cache clear), sync failure rate, or stale-cache frequency (how often `hasBudgets` is wrong).

**Impact:** Cannot measure the auth cache invalidation propagation delay. Cannot detect split-brain between DO and Postgres.

**Fix:** Add `budget_sync_latency_ms` metric in the internal invalidation handler. Add `budget_cache_stale` metric when a DO check reveals a different `hasBudgets` state than auth claimed.

**Files:** `apps/proxy/src/routes/internal.ts`, `apps/proxy/src/lib/budget-orchestrator.ts`

---

### GAP-9: Provider-specific metrics missing (Low)

**Problem:** No tracking of Anthropic cache hit rates (`cache_creation_input_tokens` vs `cache_read_input_tokens`), OpenAI reasoning token usage, long context detection (Anthropic 2x cost >200k tokens), or tool use frequency.

**Impact:** Cannot help users optimize their prompt caching strategy. Cannot identify costly reasoning-heavy workloads.

**Fix:** Add optional fields to cost events or tags: `cache_creation_tokens`, `cache_read_tokens`, `is_long_context`. Emit `provider_cache_hit` metric in Anthropic route handler.

**Files:** `apps/proxy/src/routes/anthropic.ts`, `apps/proxy/src/routes/openai.ts`, `packages/db/src/schema.ts` (or use existing tags JSONB)

---

## Data Flow Gaps — Data That Passes Through But Is Discarded

These are fields the proxy already parses or computes but never persists. Unlike the telemetry gaps above, these represent **lost signal** — data that exists in memory during request processing but vanishes afterward.

### FLOW-1: Response completion reason not persisted (High)

**What's available:**
- OpenAI: `finish_reason` — `stop`, `max_tokens`, `length`, `content_filter`, `tool_calls`
- Anthropic: `stop_reason` — `end_turn`, `max_tokens`, `stop_sequence` (extracted by SSE parser but discarded after usage extraction)

**Why it matters:** "What percentage of requests hit max_tokens?" is a core FinOps question. Users overspending because their completions are being truncated is a common problem. `content_filter` stops indicate policy violations. `tool_calls` indicates agent loop behavior.

**Fix:** Add `stop_reason` text column to `cost_events`. Populate from SSE parser result.

---

### FLOW-2: Anthropic cache read vs write tokens merged (High)

**What's available:** The Anthropic SSE parser extracts both `cache_creation_input_tokens` and `cache_read_input_tokens` separately, plus ephemeral TTL breakdowns (5m vs 1h).

**What's stored:** Only `cachedInputTokens` (a single integer) — the two are merged, losing the distinction between cache reads (cheap) and cache writes (expensive, 25% surcharge).

**Why it matters:** Cache optimization is one of the highest-impact cost reduction levers for Anthropic users. Without read/write split, we can't tell users "your cache hit rate is 85%" or "you're paying $X/day in cache write surcharges."

**Fix:** Add `cache_write_tokens` integer column to `cost_events` (or use tags JSONB: `_ns_cache_write_tokens`, `_ns_cache_read_tokens`). The SSE parser already has both values; just persist them.

---

### FLOW-3: Request metadata not captured (Medium)

**What passes through but is discarded:**
- `max_tokens` / `max_completion_tokens` — used for cost estimation, then dropped
- `temperature`, `top_p`, `frequency_penalty` — completely invisible
- Request body size (`ctx.bodyByteLength`) — computed for estimation, never stored
- Tool count and tool names — `toolDefinitionTokens` is stored but actual tool names are not
- `system` prompt existence/length — invisible

**Why it matters:** For agent monitoring, knowing that a request used temperature=0 with 5 tools and a 4000-token system prompt is critical context. For cost optimization, knowing that `max_tokens` was set to 4096 but only 50 tokens were generated reveals waste.

**Fix (lightweight):** Add `request_metadata` JSONB column to `cost_events` with: `{ max_tokens, temperature, tool_count, system_prompt_length, request_body_bytes }`. Or use the existing `tags` JSONB with `_ns_` prefixed keys.

---

### FLOW-4: Provider rate limit headers not captured (Medium)

**What passes through:** Both OpenAI and Anthropic return rate limit headers (`x-ratelimit-remaining-requests`, `x-ratelimit-remaining-tokens`, etc.). These are forwarded to the client but values are never stored.

**Why it matters:** Rate limit proximity is early-warning data. If a user's `remaining-requests` is approaching 0, we could proactively notify them before they get 429'd by the provider. This is a premium monitoring feature.

**Fix:** Capture rate limit headers in cost event tags: `_ns_ratelimit_remaining_requests`, `_ns_ratelimit_remaining_tokens`. Lightweight — just read headers from upstream response before forwarding.

---

### FLOW-5: Session-level aggregation not possible without full table scan (Medium)

**What exists:** `sessionId` is stored in cost_events and indexed (`cost_events_session_id_idx`). Session spend is tracked in DO SQLite for budget enforcement.

**What's missing:** No session metadata (start time, request count, total cost, total tokens). No session-level pre-aggregation. The DO's session spend state is internal and not queryable from the dashboard. When a DO shuts down, session state is lost.

**Why it matters:** "Show me all sessions for this user and their total spend" requires a `GROUP BY session_id` over potentially millions of rows. For agent monitoring, session is the fundamental unit of work.

**Fix (deferred):** This is a product-level decision. Options: (a) materialized view on `cost_events` grouped by sessionId, (b) `sessions` table populated by a trigger or queue consumer, (c) expose DO session state via API before DO hibernation.

---

### FLOW-6: No parent-child request linking (Low — but architecturally important)

**What exists:** `traceId` links requests within a trace. `actionId` links to HITL actions.

**What's missing:** No `parent_request_id`. When an agent makes a request, gets a tool_calls response, executes tools, and makes a follow-up request, the relationship is implicit (same traceId) but not explicit. MCP tool cost events and LLM cost events are disconnected except by traceId.

**Why it matters:** Agent loop visualization — "show me the chain of requests in this agent run" — requires explicit parent-child links. This is a core feature of agent observability platforms (LangSmith, Braintrust, Helicone).

**Fix (deferred):** Add `parent_request_id` text column to cost_events. The SDK/claude-agent adapter would need to propagate the parent's requestId in a header (e.g., `x-nullspend-parent-request-id`).

---

### FLOW-7: `costBreakdown.toolDefinition` key never populated (Low)

**What exists:** The `costBreakdown` JSONB schema allows a `toolDefinition` key. `toolDefinitionTokens` column is populated correctly.

**What's missing:** The cost calculators (`cost-calculator.ts`, `anthropic-cost-calculator.ts`) compute the cost breakdown object but never include a `toolDefinition` cost component. The key is defined in the TypeScript type but always omitted.

**Fix:** Add `toolDefinition: toolDefCost` to the breakdown object in both cost calculators when `toolDefinitionTokens > 0`.

---

## Architectural Constraints — Structural Limits on Observability

These are not bugs or missing features — they're inherent limitations of the current architecture that constrain what's possible.

### ARCH-1: `waitUntil()` telemetry can be silently lost

**Constraint:** Cost event logging, budget reconciliation, and webhook dispatch all run in `waitUntil()`. If Cloudflare terminates the Worker (execution budget exceeded, memory spike, isolate recycling), these tasks are silently cancelled — no error, no retry, no metric.

**Impact:** Under high load, cost events can be lost for streamed responses. The queue-first architecture mitigates this (queue send is fast), but the direct-write fallback also runs in `waitUntil()` and is equally vulnerable.

**Mitigation options:**
- Accept the risk — queue-first makes loss rare; DLQ catches consumer failures
- Add a checksum/reconciliation job that compares cost events in DB against provider billing
- Log a `waitUntil_registered` metric synchronously, then detect "registered but never completed" via absence

---

### ARCH-2: `cost_events` table has no partitioning or retention strategy

**Constraint:** Single unpartitioned Postgres table. At scale (1M+ events/day), queries involving `createdAt` ranges, `GROUP BY` aggregations, or tag-based filtering will degrade. The `tags` JSONB column has no GIN index — tag-based queries require full table scan.

**Impact:** Dashboard analytics queries will slow down as the table grows. Tag-based spend breakdowns ("spend per project tag") will be unusable at scale.

**Mitigation options:**
- Add GIN index on `tags` column (immediate, low risk)
- Implement time-based partitioning via `pg_partman` (medium effort, requires Supabase support)
- Implement data retention policy (archive events older than 90 days to cold storage)
- Add materialized views for common aggregations (spend-per-user-per-day, spend-per-model-per-day)

---

### ARCH-3: No unified provider interface limits multi-provider extensibility

**Constraint:** OpenAI and Anthropic routes are separate codepaths with provider-specific SSE parsers, cost calculators, header builders, and estimators. There's no shared interface or abstract base. Adding Google Gemini or Mistral requires ~200 lines of near-duplicate code per provider.

**Impact:** Each new provider multiplies the test surface. Provider-specific telemetry gaps (like FLOW-2, Anthropic cache split) must be fixed independently per provider. Cross-provider analytics require provider-aware queries.

**Mitigation:** Not urgent — two providers is manageable. But if we add a 3rd, extract a `ProviderAdapter` interface with: `parseSSE()`, `calculateCost()`, `estimateCost()`, `buildHeaders()`.

---

### ARCH-4: Pre-request token counting is estimation-only

**Constraint:** The proxy estimates input tokens as `bodyByteLength / 4` (a rough heuristic). Actual token counts are only available after the provider responds. This means budget reservation estimates can be significantly wrong for requests with long system prompts, many tools, or non-English text.

**Impact:** Budget reservations may over-reserve (wasting headroom) or under-reserve (allowing spend beyond budget before reconciliation corrects). For a FinOps tool, estimation accuracy is a credibility issue.

**Mitigation options:**
- Accept the heuristic — it's good enough for reservation (reconciliation corrects it)
- Bundle a lightweight tokenizer (e.g., `js-tiktoken`) for accurate pre-request counts. Adds ~10-50ms CPU overhead and ~500KB to bundle size — viable on Workers but not free
- Track estimation accuracy (GAP-4) to quantify the problem before investing in a fix

---

### ARCH-5: Real-time aggregation requires external infrastructure

**Constraint:** The proxy has no in-memory counters beyond the auth cache. Every "current state" query (spend-per-user, requests-per-minute) requires hitting Postgres or AE. The `/health/metrics` endpoint has a 90-second KV cache, so real-time dashboards see stale data.

**Impact:** Cannot build real-time spend alerts, live request rate graphs, or "current session spend" without adding infrastructure (Redis, Durable Objects for counters, or streaming analytics).

**Mitigation:** The DO already tracks per-user spend for budget enforcement. Exposing DO state via an API endpoint (read-only, no budget enforcement) would give real-time spend visibility without new infrastructure. This is a product decision, not a telemetry gap.

---

## Phased Implementation

### Phase 1: Core Visibility (Critical gaps, enables debugging) — SHIPPED 2026-03-24

**Goal:** Answer "what happened?" and "why was this denied?" for any request.

| Item | Gap | Effort | Dependencies |
|---|---|---|---|
| Add `budget_status` to cost events | GAP-1 | Small | DB migration |
| Add `stop_reason` to cost events | FLOW-1 | Small | Same migration |
| Add error classification metrics in `index.ts` | GAP-2 | Small | None |
| Add budget denial metrics in route handlers | GAP-2 | Small | None |
| Add GIN index on `cost_events.tags` | ARCH-2 | Small | DB migration |

**Scope:** 1 migration (2 columns + 1 index) + ~8 files modified. ~80 lines of new code.

**Validation:**
- `pnpm proxy:test` and `pnpm test` pass
- Deploy, make requests with/without budgets, query cost_events for `budget_status` values
- Verify `stop_reason` populated for both OpenAI and Anthropic responses
- Trigger each error path (bad auth, rate limit, invalid JSON, etc.), verify metrics in tail worker logs
- Run `EXPLAIN ANALYZE` on a tag-based query to confirm GIN index is used

---

### Phase 2: Latency & Cost Intelligence (High gaps, enables performance and cost optimization) — SHIPPED 2026-03-24

**Goal:** Answer "why was this slow?" and "how accurate are our estimates?"

| Item | Gap | Effort | Dependencies |
|---|---|---|---|
| Add TTFB tracking to streaming responses | GAP-3 | Medium | None |
| Add `ttfbMs` to AE data points (4th double) | GAP-3 | Small | Requires AE schema awareness |
| Add `estimated_cost_microdollars` to cost events | GAP-4 | Small | DB migration |
| Add stream abort rate metric | GAP-3 | Small | None |
| Split Anthropic cache read/write tokens | FLOW-2 | Small | Same migration or tags JSONB |
| Capture provider rate limit headers in tags | FLOW-4 | Small | None |

**Scope:** 1 migration + ~8 files modified. ~120 lines of new code.

**Caveat:** Adding a 4th double to AE data points changes the data shape. Existing AE SQL queries in `/health/metrics` must be updated to handle the new field. Old data points won't have the 4th double — queries should use `COALESCE` or `IF` for backward compatibility.

**Validation:**
- Deploy, make streaming requests, verify Server-Timing includes `ttfb;dur=X`
- Query AE for TTFB percentiles
- Cancel streams mid-response, verify `stream_cancelled` metric and abort rate tracking
- Compare `estimated_cost_microdollars` vs `cost_microdollars` in cost_events for accuracy analysis
- Make Anthropic requests with prompt caching, verify separate cache read/write counts in cost events
- Check upstream rate limit headers captured in cost event tags

---

### Phase 3: Operational Dashboards (Medium gaps, enables user-facing analytics)

**Goal:** Answer "how is the system performing?" from the dashboard and API.

| Item | Gap | Effort | Dependencies |
|---|---|---|---|
| Add userId to AE data points | GAP-5 | Small | AE cardinality testing |
| Add per-provider/per-model filters to `/health/metrics` | GAP-6 | Medium | None |
| Add cost event queue health metrics | GAP-7 | Small | None |

**Scope:** ~5 files modified. ~120 lines of new code.

**Caveat:** AE blob cardinality — test with realistic userId counts before deploying. If cardinality exceeds AE limits, fall back to hash-bucketed userId (e.g., first 4 chars).

**Validation:**
- Query AE with `WHERE blob5 = 'user-123'` to verify per-user latency works
- Hit `/health/metrics?provider=openai` and `/health/metrics?model=gpt-4o-mini`, verify filtered results
- Process a batch of cost events, verify `cost_event_batch_size` and `cost_event_ingestion_latency_ms` metrics appear

---

### Phase 4: Advanced Observability (Low gaps + architectural prep, enables optimization and scale) — SHIPPED 2026-03-24

**Goal:** Answer "how can users optimize their usage?" and prepare for scale.

| Item | Gap | Effort | Dependencies |
|---|---|---|---|
| Add budget sync latency tracking | GAP-8 | Small | None |
| Add stale-cache detection metric | GAP-8 | Small | Requires hasBudgets flag (shipped) |
| Add provider-specific metrics (cache hits, reasoning tokens, long context) | GAP-9 | Medium | None |
| Populate `costBreakdown.toolDefinition` key | FLOW-7 | Small | None |
| Add lightweight request metadata to cost events | FLOW-3 | Small | Tags JSONB or new column |
| Evaluate time-based partitioning for cost_events | ARCH-2 | Research | Supabase support check |

**Scope:** ~7 files modified. ~150 lines of new code + research spike.

**Validation:**
- Mutate a budget via dashboard, measure time until proxy sees the change via `budget_sync_latency_ms`
- Make Anthropic requests with prompt caching, verify `cache_creation_tokens` / `cache_read_tokens` in cost event tags
- Make OpenAI o3 requests, verify `reasoning_tokens` is populated in cost events (already tracked in column, but verify accuracy)
- Verify `costBreakdown.toolDefinition` is non-null for requests with tool definitions
- Verify request metadata (max_tokens, temperature, tool_count) appears in cost event tags

---

## Priority Matrix

```
                         HIGH IMPACT
                              |
           Phase 1            |           Phase 2
   (budget_status, stop_reason|     (TTFB, estimation accuracy,
    error metrics, GIN index) |      cache split, rate limits)
                              |
  LOW EFFORT -----------------+------------------ HIGH EFFORT
                              |
           Phase 3            |           Phase 4
   (AE attribution, filtered  |     (sync latency, request metadata,
    metrics, queue health)    |      provider-specific, partitioning)
                              |
                         LOW IMPACT
```

**Total across all phases:** 4 new cost_events columns, 1 GIN index, ~15 new metrics, ~6 new tags JSONB keys, 2 migrations, ~25 files touched.

---

## Migration Summary

| Phase | Migrations Required | Changes |
|---|---|---|
| Phase 1 | 1 | `cost_events.budget_status` (text, nullable), `cost_events.stop_reason` (text, nullable), GIN index on `cost_events.tags` |
| Phase 2 | 1 | `cost_events.estimated_cost_microdollars` (bigint, nullable). Cache split via tags JSONB (no schema change). |
| Phase 3 | 0 | — |
| Phase 4 | 0 | — (use existing `tags` JSONB for request metadata) |

All migrations are additive (nullable columns + index) — no downtime, no backfill required. New columns are `NULL` for historical rows, populated going forward. GIN index creation is `CONCURRENTLY`-safe on Supabase.

---

## Deferred Items (Not in phases, tracked for future)

| Item | Source | Why deferred | Trigger to revisit |
|---|---|---|---|
| Parent-child request linking (`parent_request_id`) | FLOW-6 | Requires SDK changes + header propagation; no users yet | When we build agent loop visualization |
| Session metadata table | FLOW-5 | Product-level decision on session semantics | When dashboard adds session analytics view |
| Unified provider adapter interface | ARCH-3 | Two providers is manageable; premature abstraction | When we add a 3rd provider |
| Pre-request tokenizer (js-tiktoken) | ARCH-4 | 10-50ms CPU overhead, 500KB bundle; estimation accuracy not yet measured | After GAP-4 reveals how bad estimates actually are |
| Real-time spend aggregation | ARCH-5 | Requires new infrastructure or DO API exposure | When users request real-time alerting |
| `waitUntil()` loss detection | ARCH-1 | Queue-first makes loss rare; DLQ catches consumer failures | If stress tests reveal cost event drops under extreme load |
| Data retention / archival | ARCH-2 | No data yet; premature optimization | When cost_events exceeds 10M rows |

---

## Non-Goals

- **Distributed tracing (OpenTelemetry):** Valuable but a separate initiative. The W3C `traceparent` header is already parsed and propagated — full OTel integration can layer on top of this roadmap.
- **Real-time alerting:** This roadmap focuses on data collection. Alerting (PagerDuty, Slack) is a separate concern that consumes these metrics.
- **Dashboard UI for metrics:** The `/health/metrics` endpoint improvements in Phase 3 serve the dashboard. Custom analytics views are product work, not telemetry infra.
- **Log aggregation infrastructure:** The tail worker sink (where `emitMetric` JSON goes) is out of scope. This roadmap ensures the right data is emitted; where it lands is a separate decision.
