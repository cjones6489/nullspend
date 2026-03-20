# Deep Technical Research Document

## Topic

**Proxy Latency Metrics Aggregation for NullSpend**

NullSpend's proxy already computes per-request overhead via `appendTimingHeaders()` — every response includes `x-nullspend-overhead-ms` and a W3C `Server-Timing` header. But there's no way to answer "what's the p50/p95/p99 overhead?" without manually collecting individual response headers. We need an aggregation strategy that works in Cloudflare Workers' stateless environment and a `/health/metrics` endpoint to expose the results.

This matters for three reasons: (1) "how much latency does your proxy add?" is the #1 developer objection, (2) a credible, verifiable answer is a trust gate for adoption, and (3) competitive benchmarking (Bifrost at 11us, Helicone at 8ms, LiteLLM at 2ms, Portkey at 10ms) demands we measure and publish our own numbers.

## Executive Summary

**Recommended approach:** Cloudflare Analytics Engine (AE) for writes + Workers KV for cached reads. Write one data point per request via the fire-and-forget `writeDataPoint()` API (zero hot-path overhead), query percentiles via AE's `quantileExactWeighted()` SQL function, cache the result in KV with a 60-second TTL. The `/health/metrics` endpoint reads from KV for sub-millisecond responses.

**Key findings:**
1. Analytics Engine is purpose-built for this — zero-latency writes, native percentile SQL functions, included in Workers paid plan, 92-day retention
2. Durable Objects as metric aggregators are an anti-pattern — a global singleton DO can't handle 10K RPS and becomes a single point of failure
3. Redis (Upstash) adds 5-10ms latency and cost per write — unnecessary when AE does the same thing for free
4. Postgres piggyback risks connection pool contention (5-slot semaphore) and OLAP/OLTP conflict
5. DDSketch (`@datadog/sketches-js`) is the production standard for streaming percentiles if in-process aggregation is ever needed, but AE eliminates that need
6. NullSpend's per-request `Server-Timing` header already exceeds what Helicone, Portkey, and Cloudflare AI Gateway offer — the gap is only in aggregation

**Biggest risks:** (1) Non-streaming overhead measurement includes response body parsing time, overstating overhead. (2) A single p99 number conflates fast paths (cached auth) with slow paths (cold auth + budget DO check) — segment by code path. (3) Public `/health/metrics` endpoint leaks traffic volume — consider auth-gating or accepting the tradeoff.

## Research Method

Seven specialized agents conducted parallel research:

1. **Documentation Research** — Cloudflare Analytics Engine API, DO constraints, Upstash Redis patterns, KV consistency model, W3C Server-Timing spec, OTel in Workers, Prometheus exposition format
2. **Competitive / Platform Patterns** — Bifrost, Helicone, LiteLLM, Portkey, Cloudflare AI Gateway, Kong, Envoy, Stripe, Datadog DDSketch
3. **Open Source / Repo Research** — tdigest, DDSketch JS, HdrHistogram JS, prom-client, Workers-compatible alternatives, sliding window implementations
4. **Architecture** — Six options compared (Analytics Engine, DO aggregator, Redis sliding window, in-memory + flush, Postgres piggyback, AE + KV hybrid)
5. **DX / Product Experience** — Developer needs, endpoint design, naming, dashboard integration, transparency-as-feature
6. **Frontier / Emerging Patterns** — YC companies, DDSketch vs T-digest vs SplineSketch, edge-native observability convergence, benchmarking methodology, public metrics as differentiator
7. **Risk / Failure Modes** — 22 risks across data accuracy, infrastructure, scaling, operations, measurement definition, security, and rollout

---

## Official Documentation Findings

### Cloudflare Workers Analytics Engine

The most critical finding: `writeDataPoint()` is **fire-and-forget with zero latency overhead**. The Workers runtime handles the write asynchronously — no `await`, no `waitUntil()` needed. Up to 250 data points per Worker invocation (we'd write 1).

**Data model:** Each data point supports 20 blobs (strings for dimensions), 20 doubles (numbers for metrics), and 1 index (string for sampling key). This gives rich dimensionality — provider, model, streaming flag, status code as blobs; overhead, upstream, total as doubles.

**Percentile queries:** The SQL API supports `quantileExactWeighted(probability)(column, _sample_interval)` — exactly what's needed for p50/p95/p99 computation with adaptive sampling correction.

**Sampling:** Adaptive Bit Rate (ABR) sampling at read time for large datasets. The `_sample_interval` column exposes the sampling factor so queries can weight results correctly.

**Retention:** 92 days (3 months). Sufficient for latency metrics where only recent data matters.

**Pricing:** Included in Workers paid plan ($5/mo, already active for DOs). 10M data points/month and 1M read queries/month included. At current scale, completely free.

**Query endpoint:** `POST /accounts/{account_id}/analytics_engine/sql` — requires a Cloudflare API token (not available as a Worker binding). The Worker must make an authenticated HTTP call to the CF API, adding ~50-200ms per query. This is why KV caching matters.

### Cloudflare Workers KV

Eventually consistent with up to 60 seconds staleness. KV reads are extremely fast (500us-10ms for hot keys). Write limit: 1 write per second per unique key (fine for a single cached snapshot refreshed every 60s). Pricing negligible at this usage level.

### W3C Server-Timing Header

Baseline widely available since March 2023 (Chrome, Firefox, Safari, Edge). NullSpend already emits this correctly. Key addition: `Server-Timing` can carry multiple named metrics: `auth;dur=1.2, budget;dur=3.4, proxy;dur=5.1` — this enables per-component breakdown without any new infrastructure.

### OpenTelemetry in Workers

**Metrics are NOT supported.** Cloudflare explicitly states: "exporting Worker metrics and custom metrics is not yet supported." Only traces (open beta) and logs are available. This rules out OTel as a metrics path today.

### Prometheus in Workers

`prom-client` (3,400 stars) is **not Workers-compatible** — deeply tied to Node.js APIs (`process`, `perf_hooks`, `cluster`). No production-ready Workers-compatible Prometheus client exists. If Prometheus format is needed, it must be built as a thin serialization layer on top of pre-computed values.

---

## Modern Platform and Ecosystem Patterns

### Competitive Latency Metrics Comparison

| Platform | Overhead | Per-Request Header | Prometheus | Component Breakdown | Benchmark Method |
|---|---|---|---|---|---|
| **Bifrost** | 11-59us | No | Yes (native) | No | Mock upstream, subtract |
| **Helicone** | 8-80ms | No | No | No | Paired direct vs proxy |
| **LiteLLM** | 2ms p50 | `x-litellm-overhead-duration-ms` | Yes (`/metrics`) | Total/LLM/Overhead | `network_mock` mode |
| **Portkey** | ~10ms | No | Yes (15 metrics) | Auth/RateLimit/Pre/Post/Cache | Not published |
| **CF AI GW** | 10-50ms | No | No | No | Not published |
| **Kong** | N/A | No | Yes (3 metrics) | Total/Kong/Upstream | N/A |
| **Envoy** | N/A | No | Yes (histograms) | 6 duration operators | N/A |
| **NullSpend** | TBD | `x-nullspend-overhead-ms` + `Server-Timing` | **No** | Total/Overhead/Upstream | **None** |

### Key Patterns

**LiteLLM** emits four response headers: `x-litellm-overhead-duration-ms`, `x-litellm-response-duration-ms`, `x-litellm-callback-duration-ms`, `x-litellm-call-id`. Their Prometheus endpoint exposes histograms including TTFT for streaming. Their `network_mock` benchmarking mode (intercepts httpx transport with canned responses) is a clean methodology.

**Portkey** has the most sophisticated sub-component breakdown: 15 Prometheus metrics covering auth, rate limiting, pre/post processing, cache, and a streaming-aware metric `processing_time_excluding_last_byte_ms` that isolates gateway overhead from streaming tail. This is the gold standard.

**Envoy** defines 6 duration operators decomposing request processing, upstream latency, and response processing separately — the most granular model.

**Cloudflare AI Gateway** is surprisingly weak — no per-request timing headers, no latency histograms, no component breakdown. NullSpend already exceeds it with the `Server-Timing` header.

### Strategic Insight

NullSpend's per-request `Server-Timing` header is already ahead of most competitors. The gap is aggregation and publishing. Adding a `/health/metrics` endpoint would put NullSpend at parity with LiteLLM and Portkey.

---

## Relevant Repos, Libraries, and Technical References

### Streaming Percentile Libraries (JS/TS)

| Library | Stars | Downloads/wk | Workers OK? | Deps | Mergeability | Error Guarantee |
|---|---|---|---|---|---|---|
| `@datadog/sketches-js` | 11 | ~2.6M | Yes (core) | 0 prod | Full | Relative (configurable) |
| `tdigest` | 72 | ~2.6M | Yes | 1 (bintrees) | One-way | None (practical) |
| `hdr-histogram-js` | 127 | — | Partial | 3 deps | Yes | Significant digits |

**DDSketch (`@datadog/sketches-js`)** is the clear winner for any in-process aggregation needs. Zero production dependencies, formally guaranteed relative error, fully mergeable across distributed instances, ~10KB bundle size, ~2KB memory footprint. The `accept(value)` / `getValueAtQuantile(q)` API is minimal.

However, Analytics Engine eliminates the need for in-process sketches entirely — it handles the distributed aggregation problem at the infrastructure level.

### Cloudflare Workers Metric Patterns

- **Analytics Engine + SQL API** — Native solution for custom metrics in Workers. `writeDataPoint()` is non-blocking, SQL API supports `quantileExactWeighted()`. This is the answer.
- **Tail Workers** — Receive execution events after the producer Worker completes. Could write to AE, but add indirection without benefit since AE writes are already zero-overhead from the producer.
- **`cf-workers-prometheus-push-gateway`** (25 stars) — Uses DOs for counter/gauge accumulation. Histogram support WIP. Max ~100 RPS throughput. Validates that DOs are limited as metric aggregators.

---

## Architecture Options

### Option A: Analytics Engine (Raw)

Write a data point per request, query AE SQL API directly on `/health/metrics`.

- **Hot-path overhead:** 0ms (fire-and-forget)
- **Data accuracy:** High (adaptive sampling with weight correction)
- **Infra cost:** $0 (included in Workers paid plan)
- **Complexity:** Low (~50 LOC)
- **Weakness:** SQL API query adds 50-200ms per `/health/metrics` request (external HTTP call to CF API)
- **When appropriate:** If slightly slow metrics responses are acceptable

### Option B: Durable Object Metrics Aggregator

Dedicated `MetricsDO` receives timing data, maintains in-memory sketch.

- **Hot-path overhead:** 2-5ms (DO RPC per request)
- **Data accuracy:** High while alive, lost on eviction
- **Infra cost:** $0.15/million requests (doubles DO costs at scale)
- **Complexity:** Medium-high
- **Critical flaw:** Single unsharded DO. Cannot handle 10K RPS. Inverts the scaling model that makes UserBudgetDO work (sharded by user). Cross-region latency (50-200ms) for every timing report.
- **When appropriate:** Never for global metrics. The architecture is fundamentally wrong.

### Option C: Upstash Redis Sliding Window

ZADD timing samples, ZRANGEBYSCORE for windowed queries.

- **Hot-path overhead:** 5-10ms per ZADD (even in `waitUntil()`, consumes CPU)
- **Data accuracy:** High, persistent
- **Infra cost:** ~$6/month at 1M requests
- **Complexity:** Medium (Lua scripts for percentile computation)
- **Weakness:** Memory grows linearly. 1K RPS over 5 minutes = 300K entries = 15-30MB. Approaches Upstash memory limits at scale.
- **When appropriate:** As a future optimization if AE is insufficient

### Option D: In-Memory Per-Isolate + Periodic Flush

Each isolate buffers samples, flushes to KV/Redis.

- **Hot-path overhead:** ~0ms
- **Data accuracy:** Poor to unusable. Workers isolates are ephemeral. No eviction hook. At low traffic, most samples lost. At high traffic, merge conflicts.
- **Complexity:** High (distributed merge logic)
- **When appropriate:** Never in Workers. Fundamentally incompatible with the execution model.

### Option E: Postgres Piggyback

Query `cost_events` table which already has `duration_ms` and `upstream_duration_ms`.

- **Hot-path overhead:** 0ms (data already written)
- **Data accuracy:** High for successful requests only (budget-denied/rate-limited requests don't generate cost events)
- **Infra cost:** $0
- **Weakness:** `percentile_cont()` over 36M rows (10K RPS for 1 hour) is a 5-30 second query. The 5-connection semaphore means this query competes with cost event writes. Health checks should never depend on database health.
- **When appropriate:** Only as a fallback for very low traffic, behind heavy caching

### Option F: Analytics Engine + KV Cache (Recommended)

Write to AE per request (zero overhead). Cache computed percentiles in KV with 60s TTL. `/health/metrics` reads from KV.

- **Hot-path overhead:** 0ms
- **Data accuracy:** High (up to 60s stale — acceptable for health metrics)
- **Infra cost:** $0
- **Complexity:** Low-medium (~150 LOC)
- **Read latency:** Sub-millisecond (KV read)
- **Failure isolation:** Total — AE/KV failures never affect proxy requests
- **Scaling:** Excellent — AE handles distributed aggregation, KV handles global read distribution
- **Dimensionality:** Full — can slice by provider, model, streaming, status code
- **When appropriate:** Always. This is the right choice for NullSpend's architecture.

---

## Recommended Approach for Our Platform

### Design: Option F — Analytics Engine + KV Cache

**Why this wins:**

1. **Zero hot-path overhead.** `writeDataPoint()` is synchronous, non-blocking, handled by the Workers runtime. No `await`, no `waitUntil()`, no subrequest. Every other option adds measurable per-request cost.

2. **Complete failure isolation.** The metrics pipeline is entirely decoupled from the request pipeline. If AE, KV, or the CF SQL API go down, proxy requests are completely unaffected.

3. **Data already exists.** The `emitMetric("proxy_latency", ...)` calls in both route handlers already compute overhead, upstream, and total. Adding a `writeDataPoint()` call is ~4 lines per handler.

4. **Rich dimensionality for free.** AE's blob/double/index model carries provider, model, streaming flag, status code as dimensions and overhead, upstream, total as metrics — all in one data point.

5. **Native percentile computation.** AE's `quantileExactWeighted()` handles adaptive sampling correction automatically. No custom percentile algorithms needed.

6. **KV caching matches existing patterns.** The webhook endpoint caching in `cache-kv.ts` is the exact same cache-aside pattern. Well-understood code.

7. **Cost: literally zero.** AE is included in the Workers paid plan. KV writes are negligible (1 per 60s).

### Implementation

**Write side** (in each route handler, next to existing `emitMetric` call):
```typescript
try {
  env.METRICS?.writeDataPoint({
    blobs: [provider, model, streaming ? "stream" : "json", String(status)],
    doubles: [overheadMs, upstreamDurationMs, totalMs],
    indexes: [provider],
  });
} catch { /* never throw from metrics */ }
```

**Read side** (`GET /health/metrics` — unauthenticated, like `/health`):
```typescript
// 1. Check KV cache
const cached = await env.CACHE_KV.get("metrics:5m", "json");
if (cached) return Response.json(cached);

// 2. Cache miss: query AE SQL API
const sql = `
  SELECT
    quantileExactWeighted(0.5)(double1, _sample_interval) AS p50,
    quantileExactWeighted(0.95)(double1, _sample_interval) AS p95,
    quantileExactWeighted(0.99)(double1, _sample_interval) AS p99,
    SUM(_sample_interval) AS request_count
  FROM proxy_metrics
  WHERE timestamp > NOW() - INTERVAL '5' MINUTE
`;

// 3. Write result to KV with 60s TTL
await env.CACHE_KV.put("metrics:5m", JSON.stringify(result), { expirationTtl: 60 });
```

**Response shape:**
```json
{
  "overhead_ms": { "p50": 5, "p95": 12, "p99": 23 },
  "request_count": 1847,
  "window_seconds": 300,
  "measured_at": "2026-03-20T14:32:00Z"
}
```

**What to add to the codebase:**
- `analytics_engine_datasets` binding in `wrangler.jsonc`
- `METRICS: AnalyticsEngineDataset` in the Env interface
- `CF_ACCOUNT_ID` and `CF_API_TOKEN` secrets for the SQL API query
- `src/routes/metrics.ts` — the `/health/metrics` handler (~80 LOC)
- ~4 lines in each route handler to call `writeDataPoint`
- Route registration in `index.ts` (outside auth pipeline)

**Estimated effort:** 1-2 files, ~150 lines, zero schema migrations, zero new infrastructure.

---

## Frontier and Emerging Patterns

### DDSketch is the Consensus Winner for Streaming Percentiles

**Who:** Datadog (production since 2019, DDSketch paper at VLDB)
**What:** Logarithmic bucket mapping with configurable relative accuracy, fully mergeable
**Why it matters:** If NullSpend ever needs in-process percentile computation (e.g., for a DO-based approach), DDSketch is the correct algorithm. Formal relative-error guarantees, 2KB memory footprint, zero-dependency JS implementation.
**Maturity:** Production-proven (Datadog processes billions of data points)
**Action:** Design for later. AE eliminates the need for in-process sketches, but DDSketch is the fallback if AE proves insufficient.

### SplineSketch — Potential DDSketch Successor

**Who:** Academic paper, ACM SIGMOD December 2025 (arXiv:2504.01206)
**What:** Monotone cubic spline interpolation for streaming quantile estimation. 2-20x more accurate than T-digest on real-world data with formal guarantees.
**Maturity:** Academic — no JS implementation exists yet.
**Action:** Watch. If a JS/WASM implementation appears, evaluate as DDSketch replacement.

### Transparency-as-Feature

**Who:** OpenAI (public latency percentile dashboard), Artificial Analysis (third-party cross-provider benchmarks), OpenStatus (open-source status pages with p50/p75/p90/p95/p99)
**What:** Making internal performance metrics public as a trust signal.
**Why it matters:** For a FinOps proxy, transparency about overhead is existential. If NullSpend adds 50ms and customers pay per-token, that 50ms is itself a cost. Making the metric public ("< 15ms p50 overhead, verified live at `/health/metrics`") is the strongest possible marketing.
**Maturity:** Production-proven (OpenAI, Linear, many SaaS companies)
**Action:** Adopt now. Make `/health/metrics` unauthenticated so anyone can verify the claim.

### Bifrost Benchmark Methodology

**Who:** Maxim/Bifrost (open source Go LLM proxy)
**What:** Mock upstream at fixed latency (60ms), subtract from total, measure p50/p95/p99 at sustained load.
**Why it matters:** Sound, reproducible methodology that NullSpend should adopt for publishing benchmark numbers.
**Maturity:** Production-proven.
**Action:** Adopt now. Create a `pnpm proxy:bench` script using this methodology.

### Cloudflare Native OTel Tracing

**Who:** Cloudflare (open beta, billing from March 2026)
**What:** Automatic distributed traces from Workers with zero code changes. Captures fetch calls, KV/DO/R2 bindings.
**Maturity:** Open beta.
**Action:** Design for later. When it GAs, NullSpend gets free distributed traces. The existing `trace-context.ts` implementation positions us to take advantage.

### Helicone's Rust Gateway

**Who:** Helicone (YC W23, acquired)
**What:** Rebuilt AI gateway in Rust using Tower middleware. <5ms P95 overhead, ~3K RPS on modest hardware.
**Why it matters:** Proves <5ms P95 is achievable on Cloudflare Workers. Sets the performance bar for edge-based AI proxies.
**Maturity:** Production-proven.
**Action:** Watch. If NullSpend's overhead exceeds 15ms p95 consistently, investigate Rust-based alternatives.

---

## Opportunities to Build Something Better

### 1. Per-Request + Aggregate (No One Does Both Well)

NullSpend already has per-request timing headers that beat most competitors. Adding aggregate percentiles via `/health/metrics` would make NullSpend the only AI proxy with both per-request transparency AND aggregate statistics. LiteLLM has both but requires Prometheus setup. NullSpend would offer it out of the box.

### 2. Public Overhead Dashboard

No AI proxy publishes a live, public overhead dashboard. A public `/health/metrics` endpoint with a landing page card showing "< 15ms p50 overhead — verify live" is a novel trust signal. This is especially powerful for a FinOps product where overhead is literally a cost.

### 3. Streaming-Aware Overhead

Portkey's `processing_time_excluding_last_byte_ms` is the only metric that correctly isolates gateway overhead from streaming tail duration. NullSpend could adopt this distinction, making the overhead number more meaningful for streaming-heavy workloads (which are the majority of agent traffic).

### 4. Sub-Component Server-Timing

Envoy has 6 duration operators. NullSpend could add `auth;dur=N, budget;dur=N` to the existing `Server-Timing` header. No infrastructure needed — just timing measurements around the auth and budget check calls. Developers debugging latency would see exactly which component is slow.

---

## Risks, Gaps, and Edge Cases

### Critical

| Risk | Severity | Mitigation |
|---|---|---|
| DO as centralized metric aggregator can't handle 10K RPS | Critical | Don't use. Use AE instead. |

### High

| Risk | Severity | Mitigation |
|---|---|---|
| Overhead number conflates fast/slow paths (cached vs cold auth, budget vs no budget) | High | Segment by provider, streaming, has_budget in AE blobs |
| Non-streaming overhead includes response body parsing time | High | Fix: measure `upstreamDurationMs` through `.text()` completion, or segment streaming/non-streaming and document the difference |
| Single p99 is misleading without segmentation | High | Expose segmented metrics or at minimum streaming vs non-streaming |
| Metrics bug could crash proxy (synchronous throw) | High | Wrap all AE writes in try/catch. Guard with `if (env.METRICS)`. Never-throw invariant. |
| Redis/DO add latency to measure latency (observer effect) | High | Use AE (0.05ms CPU) not Redis (5ms) or DO (10-200ms) |

### Medium

| Risk | Severity | Mitigation |
|---|---|---|
| Cold start inflates tail latency (first request to isolate has empty auth cache) | Medium | Tag with cold_start flag if needed, but accept as real overhead users experience |
| Public `/health/metrics` leaks traffic volume and operational data | Medium | Accept tradeoff (transparency > secrecy for a FinOps product) or auth-gate |
| 60s KV cache staleness during incidents | Medium | Include `measured_at` in response. Consider freshness check (503 if stale > 2 min). |
| AE binding misconfiguration crashes proxy | Medium | Guard: `if (env.METRICS) { try { ... } catch {} }` |
| CF SQL API timeout on complex queries | Medium | Keep queries simple. No joins or subqueries. |

### Low

| Risk | Severity | Mitigation |
|---|---|---|
| AE silent write failures | Low | Compare AE request counts vs CF dashboard analytics |
| `performance.now()` coarsening (Spectre mitigation) | Low | Acceptable — sub-millisecond precision not needed |
| Gaming via request spam | Low | Only count authenticated successful requests in headline numbers |

---

## Recommended Technical Direction

### Design Pattern
Analytics Engine for distributed write, KV for cached read, JSON for response format.

### Architecture
```
Request → [compute overhead] → writeDataPoint() to AE (fire-and-forget)
                                       ↓
                              Analytics Engine (managed)
                                       ↓
GET /health/metrics → KV cache hit? → return cached JSON
                    → KV miss? → query AE SQL API → cache in KV (60s TTL) → return
```

### What to Do Now
1. Add `analytics_engine_datasets` binding to `wrangler.jsonc`
2. Add `writeDataPoint()` calls in openai.ts, anthropic.ts, mcp.ts route handlers (4 lines each)
3. Create `src/routes/metrics.ts` with KV-cached AE SQL query handler
4. Register `/health/metrics` in `index.ts` outside auth pipeline
5. Add `CF_ACCOUNT_ID` and `CF_API_TOKEN` secrets for AE query

### What to Defer
- Prometheus exposition format (`/metrics` endpoint) — no users have Prometheus set up yet
- Sub-component timing breakdown (auth_ms, budget_ms) — add when debugging latency issues
- Dashboard "Proxy Health" card — add after launch when analytics page is actively used
- Benchmark script (`pnpm proxy:bench`) — nice to have but not blocking
- DDSketch in-process aggregation — AE handles this

### What to Avoid
- Durable Object as metric aggregator (scaling bottleneck, anti-pattern)
- Redis for metrics writes (adds latency and cost, unnecessary)
- In-memory per-isolate buffering (fundamentally incompatible with Workers)
- Postgres percentile queries on `/health/metrics` (connection pool contention)
- OTel metrics export (not supported in Workers)

---

## Open Questions

1. **Should `/health/metrics` require authentication?** Making it public enables Prometheus scraping, independent verification, and transparency-as-marketing. But it exposes request volume. Recommendation: start public, add auth if it becomes a concern.

2. **Should we fix the non-streaming overhead measurement?** Currently `upstreamDurationMs` is captured after `fetch()` resolves but before `.text()` completes, so response body transfer time counts as "overhead." Fixing this is a small code change but changes the meaning of the number. Recommendation: fix it — response body transfer is not proxy overhead.

3. **Should we add sub-component timing to `Server-Timing`?** Adding `auth;dur=N, budget;dur=N` is zero-infra effort but requires instrumenting individual pipeline stages. Recommendation: defer until someone asks. The aggregate overhead number is sufficient for launch.

4. **What time windows should `/health/metrics` expose?** Options: 5 minutes (responsive), 1 hour (stable), 24 hours (long-term). Recommendation: start with 5 minutes. Add configurable `?window=5m|1h|24h` parameter later.

5. **How should the AE dataset be refreshed in KV?** Options: (a) lazy refresh on cache miss (simple, 50-200ms penalty on first request after TTL), (b) Cron Trigger every 60s (always fresh, adds a scheduled Worker). Recommendation: start with lazy refresh. Add Cron Trigger if the 50-200ms cold-read penalty is noticeable.

---

## Sources and References

### Official Documentation
- [Cloudflare Analytics Engine — Getting Started](https://developers.cloudflare.com/analytics/analytics-engine/get-started/)
- [Cloudflare Analytics Engine — SQL Reference (Aggregate Functions)](https://developers.cloudflare.com/analytics/analytics-engine/sql-reference/aggregate-functions/)
- [Cloudflare Analytics Engine — Sampling](https://developers.cloudflare.com/analytics/analytics-engine/sampling/)
- [Cloudflare Analytics Engine — Limits](https://developers.cloudflare.com/analytics/analytics-engine/limits/)
- [Cloudflare Analytics Engine — Pricing](https://developers.cloudflare.com/analytics/analytics-engine/pricing/)
- [Cloudflare Durable Objects — In-Memory State](https://developers.cloudflare.com/durable-objects/reference/in-memory-state/)
- [Cloudflare Durable Objects — Limits](https://developers.cloudflare.com/durable-objects/platform/limits/)
- [Cloudflare Durable Objects — Alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)
- [Cloudflare Workers — Node.js Compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/)
- [Cloudflare Workers — OTel Export](https://developers.cloudflare.com/workers/observability/exporting-opentelemetry-data/)
- [Cloudflare Workers — Automatic Tracing (Open Beta)](https://blog.cloudflare.com/workers-tracing-now-in-open-beta/)
- [Cloudflare Tail Workers](https://developers.cloudflare.com/workers/observability/logs/tail-workers/)
- [Cloudflare AI Gateway — Analytics](https://developers.cloudflare.com/ai-gateway/observability/analytics/)
- [Cloudflare AI Gateway — Costs](https://developers.cloudflare.com/ai-gateway/observability/costs/)
- [W3C Server-Timing Specification](https://www.w3.org/TR/server-timing/)
- [Prometheus — Metric Types (Histogram vs Summary)](https://prometheus.io/docs/concepts/metric_types/)

### Specifications and Standards
- [OpenTelemetry GenAI Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/)
- [Prometheus Exposition Format](https://prometheus.io/docs/instrumenting/exposition_formats/)
- [OpenMetrics Specification](https://openmetrics.io/)

### Platform and Product References
- [Bifrost — Benchmarks](https://www.getmaxim.ai/bifrost/resources/benchmarks)
- [Bifrost — Architecture](https://www.getmaxim.ai/blog/bifrost-a-drop-in-llm-proxy-40x-faster-than-litellm/)
- [Helicone — Latency Impact Reference](https://docs.helicone.ai/references/latency-affect)
- [Helicone — Rust Gateway Architecture](https://www.blog.brightcoding.dev/2026/03/14/helicone-ai-gateway-the-revolutionary-rust-powered-llm-router)
- [LiteLLM — Proxy Overhead Headers](https://docs.litellm.ai/docs/proxy/response_headers)
- [LiteLLM — Prometheus Metrics](https://docs.litellm.ai/docs/proxy/prometheus)
- [Portkey — AI Gateway Features](https://portkey.ai/features/ai-gateway)
- [Portkey — Cost Management](https://portkey.ai/docs/product/observability/cost-management)
- [Portkey — LLM Observability Guide 2026](https://portkey.ai/blog/the-complete-guide-to-llm-observability/)
- [Kong — Prometheus Plugin](https://docs.konghq.com/hub/kong-inc/prometheus/)
- [Envoy — Access Log Duration Operators](https://www.envoyproxy.io/docs/envoy/latest/configuration/observability/access_log/usage)
- [Stripe — API Request IDs](https://docs.stripe.com/api/request_ids)
- [Datadog — DDSketch Blog](https://www.datadoghq.com/blog/engineering/computing-accurate-percentiles-with-ddsketch/)
- [OpenAI — Service Health](https://status.openai.com/)
- [Artificial Analysis — Provider Comparison](https://artificialanalysis.ai/)

### Repositories and Code References
- [@datadog/sketches-js](https://github.com/DataDog/sketches-js) — 11 stars, zero prod deps, DDSketch for JS/TS, ~2.6M npm downloads/week
- [tdigest](https://github.com/welch/tdigest) — 72 stars, stable since 2015, ~2.6M npm downloads/week
- [HdrHistogramJS](https://github.com/HdrHistogram/HdrHistogramJS) — 127 stars, v3.0.1 (mid-2025)
- [prom-client](https://github.com/siimon/prom-client) — 3,400 stars, NOT Workers-compatible
- [@microlabs/otel-cf-workers](https://github.com/evanderkoogh/otel-cf-workers) — 370 stars, RC status, traces only
- [cloudflare-prometheus-exporter](https://github.com/cloudflare/cloudflare-prometheus-exporter) — 144 stars, official, reads CF API
- [cf-workers-prometheus-push-gateway](https://github.com/eidam/cf-workers-prometheus-push-gateway) — 25 stars, DO-based, ~100 RPS max
- [Bifrost](https://github.com/maximhq/bifrost) — Go LLM proxy, 11us overhead benchmark
- [Helicone AI Gateway](https://github.com/Helicone/ai-gateway) — Rust gateway, <5ms P95
- [OpenStatus](https://github.com/openstatusHQ/openstatus) — Open-source status page with p50/p75/p90/p95/p99

### Academic Papers
- [DDSketch: A Fast and Fully-Mergeable Quantile Sketch (VLDB 2019)](https://www.vldb.org/pvldb/vol12/p2195-masson.pdf)
- [SplineSketch: Streaming Quantile Estimation via Spline Interpolation (ACM SIGMOD 2025, arXiv:2504.01206)](https://arxiv.org/abs/2504.01206)
- [Elastic Compactors for Relative-Error Quantile Estimation (SODA 2025, arXiv:2411.01384)](https://arxiv.org/abs/2411.01384)

### Blog Posts and Articles
- [Using Analytics Engine to Improve Analytics Engine (Cloudflare Blog)](https://blog.cloudflare.com/using-analytics-engine-to-improve-analytics-engine/)
- [What is Cloudflare Workers Analytics Engine? (Jamie Lord, Feb 2025)](https://lord.technology/2025/02/04/what-is-cloudflare-workers-analytics-engine.html)
- [Langfuse Acquired by ClickHouse](https://clickhouse.com/blog/clickhouse-acquires-langfuse-open-source-llm-observability)
- [Stanford Foundation Model Transparency Index (Dec 2025)](https://crfm.stanford.edu/fmti/December-2025/paper.pdf)

### Internal Codebase References
- `apps/proxy/src/lib/headers.ts:64-77` — `appendTimingHeaders()` computing overhead, upstream, total
- `apps/proxy/src/lib/metrics.ts` — `emitMetric()` structured log emitter
- `apps/proxy/src/lib/context.ts` — `RequestContext.requestStartMs`
- `apps/proxy/src/index.ts:148` — `performance.now()` at request entry
- `apps/proxy/src/routes/openai.ts:186-197` — upstream duration measurement
- `apps/proxy/src/routes/openai.ts:413-414,524-525` — `appendTimingHeaders` + `emitMetric` calls
- `apps/proxy/src/routes/anthropic.ts` — parallel timing measurement pattern
- `apps/proxy/src/lib/cost-logger.ts` — `waitUntil()` async DB write pattern
- `apps/proxy/src/lib/db-semaphore.ts` — 5-connection limit (`MAX_CONCURRENT = 5`)
- `apps/proxy/src/__tests__/headers-edge-cases.test.ts` — timing header tests
