# NullSpend Priority Implementation Roadmap

**Created:** 2026-03-20
**Last updated:** 2026-03-20
**Purpose:** Forward-looking architecture, infrastructure, and feature roadmap for NullSpend. Derived from the post-audit deep research and competitive analysis. Prioritized by impact on platform positioning as the best financial infrastructure for AI agents.

**Predecessor:** [`nullspend-prelaunch-design-audit.md`](nullspend-prelaunch-design-audit.md) — completed 2026-03-19 (8/8 items shipped). Contains detailed implementation notes, design decisions, and three-pass audit findings for all completed items.

**Research sources:**
- [`docs/research/architecture-review-2026-03-20.md`](../research/architecture-review-2026-03-20.md) — comprehensive architecture review comparing NullSpend against Portkey, LiteLLM, Helicone, Stripe Issuing, Marqeta, Svix, FOCUS spec, OpenTelemetry GenAI, MCP ecosystem, and recent YC companies
- [`docs/research/cost-events-source-column.md`](../research/cost-events-source-column.md) — source column deep research (completed)
- [`docs/research/api-versioning.md`](../research/api-versioning.md) — API versioning deep research (completed)
- [`docs/technical-outlines/agent-tracing-architecture.md`](agent-tracing-architecture.md) — agent tracing five-phase spec

**Strategic context:** NullSpend has zero external users. The API surface, schema, and architecture can still change freely. Every decision should be evaluated against the platform vision: **best financial infrastructure for AI agents — the Stripe of AI FinOps.**

**Competitive positioning (from research):** No competitor replicates NullSpend's combination of Durable Object-backed real-time enforcement + MCP proxy + HITL approval + hierarchical budgets + Stripe-aligned API surface. The proxy is commoditizing (Braintrust deprecated theirs, Bifrost offers 11us open-source). **NullSpend is "Ramp for AI spend"** — the value is in the spend controls, not the proxy rails.

---

## Completed (Prelaunch Audit — 2026-03-18 to 2026-03-19)

All items below are shipped, tested, and documented in [`nullspend-prelaunch-design-audit.md`](nullspend-prelaunch-design-audit.md).

| Item | Shipped | Reference |
|---|---|---|
| DO-first budget enforcement | 2026-03-18 | Audit Section 11 |
| Prefixed object IDs (`ns_{type}_{uuid}`) | 2026-03-18 | Audit Section 1 |
| API key format (`ns_live_sk_` + 32 hex) | 2026-03-18 | Audit Section 2 |
| Error response contract (`{ error: { code, message, details } }`) | 2026-03-18 | Audit Section 3 |
| Webhook event taxonomy (11 types + `api_version`) | 2026-03-19 | Audit Section 4 |
| `source` column on cost_events (`proxy`/`api`/`mcp`) | 2026-03-19 | Audit Section 6 |
| API versioning (`NullSpend-Version` header + three-tier resolution) | 2026-03-19 | Audit Section 5 |
| Webhook secret rotation (dual-signing + 24h expiry) | 2026-03-19 | Audit Section 7 |

---

## Priority 1 — High Impact / Ship Next

Items that address critical gaps identified in the architecture review. Each has clear enterprise demand, competitive differentiation, or architectural improvement.

### 1.1 `tags` JSONB on cost_events
**Effort:** ~2h | **Source:** [Architecture Review](../research/architecture-review-2026-03-20.md) — Competitive Landscape section

The #1 FinOps request universally. LiteLLM, FOCUS spec, and CloudZero all emphasize arbitrary key-value attribution as the primary mechanism for cost allocation (by project, environment, customer, feature, team, department).

**What to build:**
- Add `tags jsonb DEFAULT '{}'` column to `cost_events`
- Accept tags via `X-NullSpend-Tags` request header (JSON object, max 10 keys, max 64 char keys, max 256 char values)
- Store on all ingestion paths (proxy, API, MCP)
- Enable `?tag.key=value` filtering on `GET /api/cost-events`
- Enable `GROUP BY tag` dimension in summary endpoint
- SDK: `client.reportCost({ ..., tags: { project: "search", env: "prod" } })`

**Why now:** Highest-impact schema addition for enterprise adoption. Zero users means zero migration cost. Enables cost attribution without structural schema changes for every new dimension.

### 1.2 Loop/Runaway Detection — ✅ Done
**Shipped:** v1.0 (2026-03-19) — sliding window cost-rate detection with circuit breaker.
**Shipped:** v1.1 (2026-03-19) — dashboard UI (velocity form fields, live cooldown status), `velocity.recovered` webhook, DO `getVelocityState()` RPC, internal velocity-state endpoint, dashboard polling API.

Includes: sliding window counter in DO, circuit breaker with configurable cooldown, `velocity.exceeded` + `velocity.recovered` webhooks, dashboard create/edit velocity config, live cooldown badge via 10s polling, `Zap` icon indicator.

### 1.3 W3C `traceparent` Propagation + `trace_id` Column — **Done** (2026-03-19)
**Effort:** ~1h | **Source:** [Architecture Review](../research/architecture-review-2026-03-20.md) — Priority 2; [Agent Tracing Architecture](agent-tracing-architecture.md) — Phase 1

Low effort, high enterprise value. Agent frameworks (AG2, LangChain) are starting to emit `traceparent` headers natively. This enables cost-per-task queries across multiple LLM calls.

**What to build:**
- Add `trace_id text` nullable column to `cost_events`
- Extract `traceId` from `traceparent` header in proxy (32-char hex from positions 3-35)
- Forward `traceparent` header to upstream provider
- Add `?traceId=` filter on `GET /api/cost-events`
- Add cost rollup: `GET /api/cost-events/summary?traceId=...`

**Why now:** Already in the prelaunch audit as low-priority. Research upgraded it — every platform that supports enterprise observability requires trace correlation.

### 1.4 Session-Level Budget Aggregation
**Effort:** ~2-3h | **Source:** [Architecture Review](../research/architecture-review-2026-03-20.md) — Priority 3, Frontier section 5.2b

Current budget enforcement is per-request. An agent making 1000 cheap requests ($0.01 each) bypasses a $5 budget because no single request exceeds it.

**What to build:**
- Track per-session cumulative spend in DO SQLite (new `session_spend` table: session_id, total_spend, first_seen, last_seen)
- When `sessionId` is present in the request context, check cumulative session spend against the budget
- Session entries auto-expire after configurable TTL (default: 1 hour of inactivity)

**Why now:** NullSpend already tracks `sessionId` on cost events and MCP events. The DO has the primitives. Without session aggregation, budget enforcement has a fundamental gap.

### 1.5 Configurable Budget Thresholds — ✅ Done
**Effort:** ~1.5h | **Source:** [Prelaunch Audit Section 6](nullspend-prelaunch-design-audit.md) — last remaining medium-priority item

Thresholds currently hardcoded at `[50, 80, 90, 95]` in the proxy. Users cannot configure or discover them.

**What to build:**
- Add `warn_threshold_pct` + `critical_threshold_pct` columns to budgets (nullable, defaults to 80/95)
- Expose in create/update budget API (`createBudgetInputSchema`)
- Read in proxy's `detectThresholdCrossings()` from budget entity instead of hardcoded array

### 1.6 Queue-Based Cost Event Logging — ✅ Done
**Shipped:** 2026-03-20 | **Source:** Stress testing — 0/25 cost events logged under concurrent load

Routes now enqueue cost events to Cloudflare Queues (`nullspend-cost-events`) instead of writing directly to Postgres via `waitUntil`. Queue consumer batch-INSERTs with per-message fallback for poison message isolation. DLQ consumer provides last-resort writes. Falls back to direct write when queue binding absent (local dev).

Key design decisions: `queue.sendBatch()` for MCP batch path, `max_batch_size=100` / `max_batch_timeout=5s`, `onConflictDoNothing` for idempotent re-delivery, 5s timeout on `queue.send()`, sentinel-based metric separation (pg_error vs semaphore_full), DLQ handler guards against HYPERDRIVE binding unavailability, `cost_event_queue_fallback` metric on fallback.

**Stress test verified:** 25/25 at medium, 50/50 at heavy. Spend drift: 0.0% at medium.

**New files:** `cost-event-queue.ts`, `cost-event-queue-handler.ts`, `cost-event-dlq-handler.ts`, 3 test files. Updated: 10 test files, 3 route files, `index.ts`, `wrangler.jsonc`.

### 1.7 Budget Sync Verification Round-Trip — ✅ Done
**Shipped:** 2026-03-20 | **Source:** Stress testing — $0 budget race condition

Stress tests found 3-6 requests leaking past a $0 budget under 25 concurrent requests. The DO hadn't finished populating the budget entity before requests arrived. Fix: `doBudgetUpsertEntities` now reads back `getBudgetState()` after upserting and retries any missing entities. Emits `budget_sync_retry` metric when retry fires. Deployed and verified: 25/25 denied at $0 budget.

### 1.8 Aborted Stream Cost Tracking
**Effort:** ~2h | **Source:** Stress testing (2026-03-20) — 0/5 aborted streams logged cost events

When a client aborts a streaming response mid-flight, the proxy's `waitUntil(logCostEvent())` often doesn't fire because the response lifecycle is interrupted. This means aborted streams have zero cost attribution — spend is tracked in the DO (via reservation + reconciliation) but the detailed cost event record is lost.

**What to build:**
- Log cost event at reservation time (pre-upstream) with `status: 'reserved'`, estimated cost
- On successful completion, update to `status: 'completed'` with actual cost
- On abort/timeout, reconciliation already adjusts the DO; ensure cost event is written with partial usage
- Alternative: move cost event logging to the reconciliation queue (would be solved by 1.6)

**Why now:** Combined with 1.6 (queue-based logging), aborted streams would naturally be covered since reconciliation already fires for aborted requests. May not need a separate fix if 1.6 is implemented first.

---

## Priority 2 — Medium Impact / Ship This Month

Items that improve DX, expand platform capabilities, or strengthen competitive positioning.

### 2.0a Budget Sync First-Populate Root Cause
**Effort:** ~2-3h | **Source:** Stress testing (2026-03-20) — probe verification fails ~20% of the time

The verification+retry fix (1.7) masks the issue, but `populateIfEmpty` silently fails to persist on the first call in ~20% of stress test runs. The `getBudgetState()` read-back finds the entity missing, triggering the retry. Possible causes: Hyperdrive returning stale reads for `lookupBudgetsForDO`, db-semaphore blocking the Postgres query in the sync path, or a DO timing edge case with `transactionSync`.

**What to investigate:**
- Add logging to `lookupBudgetsForDO` to confirm entities are returned from Postgres
- Add logging to `populateIfEmpty` to confirm the INSERT executes
- Check if `budget_sync_retry` metric fires in production (would confirm the retry is needed)
- Check Worker logs for semaphore-related errors during sync requests

### 2.0b Analytics Engine Metrics Ingestion
**Effort:** ~1-2h | **Source:** Stress testing (2026-03-20) — `/health/metrics` returns all zeros

The proxy writes latency data points to Analytics Engine on every request, but `/health/metrics` queries return zeros during and after stress sessions. The 5-minute query window and AE ingestion delay may mean data points aren't available for real-time monitoring. The KV cache (90s TTL) compounds the lag.

Items that improve DX, expand platform capabilities, or strengthen competitive positioning.

### 2.1 Claude Agent SDK Adapter
**Effort:** ~1 day | **Source:** [Architecture Review](../research/architecture-review-2026-03-20.md) — Priority 4, Frontier section 1.1

Claude Agent SDK exposes `total_cost_usd` in `SDKResultMessage`. No agent framework has built-in budget enforcement — NullSpend fills this gap.

**What to build:**
- Lightweight npm package `@nullspend/claude-agent`
- Wraps NullSpend SDK, consumes `total_cost_usd` from result messages
- Reports cost to `POST /api/cost-events` after each agent run
- Optional: pre-run budget check via `GET /api/budgets/status`

### 2.2 Thin Webhook Event Mode
**Effort:** ~3-4h | **Source:** [Architecture Review](../research/architecture-review-2026-03-20.md) — Competitive section (Stripe v2 pattern)

Stripe's API v2 moved to thin events (payload contains only event ID + type, consumer fetches current state via API). Thin events are version-stable and cheaper to deliver.

**What to build:**
- Add `payload_mode text DEFAULT 'full' CHECK (payload_mode IN ('full', 'thin'))` to `webhook_endpoints`
- Thin payload: `{ id, type, api_version, created_at, data: { id: "ns_evt_..." } }`
- Consumer calls `GET /api/cost-events/{id}` to get full data
- Expose in webhook endpoint create/update API

### 2.3 Unit Economics Dashboard Metrics
**Effort:** ~1 day | **Source:** [Architecture Review](../research/architecture-review-2026-03-20.md) — Competitive section (CloudZero pattern)

Surface "cost per session," "cost per tool invocation," "cost per API key" as first-class computed metrics. NullSpend already has the data — just needs aggregation and display.

**What to build:**
- Extend `GET /api/cost-events/summary` with unit economics:
  - `costPerSession` (total cost / unique session count)
  - `costPerKey` (total cost / active key count)
  - `costPerTool` (tool cost / tool invocation count)
  - `topSessions` (most expensive sessions with cost + request count)

### 2.4 Proxy Latency Metrics
**Effort:** ~1h | **Source:** [Architecture Review](../research/architecture-review-2026-03-20.md) — Competitive section (Bifrost benchmark)

Competitive benchmark: Bifrost at 11us (Go), Helicone at 50-80ms (Cloudflare Workers). NullSpend should measure and publish its overhead.

**What to build:**
- Emit `proxy_overhead_ms` metric on every request (total request time minus upstream duration)
- Add `GET /health/metrics` endpoint returning p50/p95/p99 proxy overhead
- Document in README/docs

### 2.5 GitHub Secret Scanning Registration
**Effort:** External action | **Source:** [Prelaunch Audit Section 2](nullspend-prelaunch-design-audit.md)

Email `secret-scanning@github.com` with the regex `ns_(live|test)_sk_[a-f0-9]{32}`. Free service that protects users from accidentally committing keys to public repos.

---

## Priority 3 — Lower Impact / Design Now, Ship Later

Items that require more design work, depend on external signals, or are valuable but not urgent.

### 3.1 AI SDK Middleware Adapter
**Effort:** ~2-3 days | **Source:** [Architecture Review](../research/architecture-review-2026-03-20.md) — Competitive section (Vercel AI SDK v6 pattern)

`const model = withNullSpend(openai('gpt-4o'), { apiKey })` removes the proxy requirement entirely. Massive DX improvement — wrap any model with budget enforcement inline.

**Wait for:** Vercel AI SDK v6 middleware API to stabilize.

### 3.2 ClickHouse Analytics Path
**Effort:** ~1 week (design + dual-write) | **Source:** [Architecture Review](../research/architecture-review-2026-03-20.md) — Competitive section (Helicone pattern)

As `cost_events` grows past 10M rows, Postgres OLAP queries will degrade. Helicone processes 2B+ events on ClickHouse + Kafka.

**Do now:** Design the write path to be dual-writable (Postgres + event stream).
**Do later:** Add ClickHouse consumer when query latency on aggregate reports exceeds 500ms.

### 3.3 OTel GenAI Span Emission
**Effort:** ~2-3h | **Source:** [Architecture Review](../research/architecture-review-2026-03-20.md) — Priority 6

Emit `gen_ai.client.token.usage` metrics from the proxy. Makes NullSpend data compatible with Datadog, Grafana, SigNoz. Propose `gen_ai.client.cost.usd` to the OTel GenAI SIG.

**Wait for:** GenAI semantic conventions to approach stable status.

### 3.4 Append-Only Budget Audit Event Log
**Effort:** ~4-6h | **Source:** [Architecture Review](../research/architecture-review-2026-03-20.md) — Priority 7

Immutable `budget_events` table (reserve/reconcile/deny/reset/update events) emitted by the DO. Required for enterprise compliance (EU AI Act, SOC 2) and enables reconstructible audit trails.

### 3.5 MCP Cost Attribution SEP
**Effort:** ~2h (draft) | **Source:** [Architecture Review](../research/architecture-review-2026-03-20.md) — Priority 5, Frontier section 1.2

MCP has no cost semantics. Propose `costHint` annotations to the AAIF Tool Annotations Interest Group. Position NullSpend as the reference implementation.

### 3.6 FOCUS FinOps Export
**Effort:** ~3-4h | **Source:** [Architecture Review](../research/architecture-review-2026-03-20.md) — Priority 9

Map cost events to FOCUS v1.3 columns for enterprise FinOps tool integration (CloudZero, Vantage, Kubecost, Apptio).

### 3.7 Stripe MPP Integration
**Effort:** ~1 day | **Source:** [Architecture Review](../research/architecture-review-2026-03-20.md) — Priority 8, Frontier section 5.1

NullSpend as the budget/approval gate before MPP-enabled agent payments. Agent checks NullSpend budget → approve → authorize MPP payment → Stripe settles.

**Wait for:** MPP adoption signal and production readiness.

### 3.8 Provider-Level Budgets
**Effort:** ~3-4h | **Source:** [Architecture Review](../research/architecture-review-2026-03-20.md) — Competitive section (LiteLLM pattern)

"$500/month on Anthropic, $300/month on OpenAI." Allow budgets scoped to a specific provider for multi-provider cost control.

### 3.9 Hierarchical Budget Delegation
**Effort:** ~1 day | **Source:** [Architecture Review](../research/architecture-review-2026-03-20.md) — Frontier section 5.2b

Agent-to-sub-agent budget allocation for multi-agent systems. Manager agents allocate sub-budgets to worker agents. Maps to NullSpend's DO entity model.

---

## Explicitly Not Building

Items evaluated and rejected based on the architecture review. See [Architecture Review](../research/architecture-review-2026-03-20.md) — "What's Overengineered" section.

| Item | Why not |
|---|---|
| Semantic caching | Low hit rates for agent workloads (agents rarely send identical prompts). Adds latency and complexity for minimal savings. |
| Content guardrails in the proxy | Scope creep. Content filtering/PII belongs in a separate layer (Galileo, Guardrails AI). |
| Dynamic model routing | Orthogonal to FinOps. Users who want routing should use Martian/OpenRouter upstream. |
| 5-level budget hierarchy | LiteLLM's org>team>user>key>enduser creates confusing edge cases. Flat entity types with simple enforcement is better DX. |
| WASM policy rule engine | Enterprise overkill at current stage. Three policies (strict_block, soft_block, warn) cover 95% of use cases. |
| Embeddable webhook debug portal | Significant effort for a feature most users won't need until multi-tenant webhook management. |

---

## Roadmap Summary

Last updated: 2026-03-20

| Priority | Item | Status | Effort | Source |
|---|---|---|---|---|
| **P1** | `tags` JSONB on cost_events | **Done** (2026-03-19) | ~2h | Architecture Review |
| **P1** | Loop/runaway detection (velocity limits) | **Done** (2026-03-19) | ~3-4h | Architecture Review |
| **P1** | W3C `traceparent` + `trace_id` column | **Done** (2026-03-19) | ~4h | [Research](../research/traceparent-trace-id-research.md) |
| **P1** | Session-level budget aggregation | Researched | ~2-3h | [Research](../research/session-level-budget-aggregation.md) |
| **P1** | Configurable budget thresholds | **Done** (2026-03-19) | ~1.5h | Audit Section 6 |
| **P1** | Queue-based cost event logging | **Done** (2026-03-20) | ~3-4h | Stress testing |
| **P1** | Budget sync verification round-trip | **Done** (2026-03-20) | ~1h | Stress testing |
| **P1** | Aborted stream cost tracking gap | Not started | ~2h | Stress testing |
| **P2** | Budget sync first-populate root cause | Not started | ~2-3h | Stress testing |
| **P2** | Analytics Engine metrics ingestion gap | Not started | ~1-2h | Stress testing |
| **P2** | Claude Agent SDK adapter | Not started | ~1 day | Architecture Review |
| **P2** | Thin webhook event mode | Not started | ~3-4h | Architecture Review |
| **P2** | Unit economics dashboard metrics | Not started | ~1 day | Architecture Review |
| **P2** | Proxy latency metrics | Not started | ~1h | Architecture Review |
| **P2** | GitHub Secret Scanning registration | Not started | External | Audit Section 2 |
| **P3** | AI SDK middleware adapter | Not started | ~2-3 days | Architecture Review |
| **P3** | ClickHouse analytics path (design) | Not started | ~1 week | Architecture Review |
| **P3** | OTel GenAI span emission | Not started | ~2-3h | Architecture Review |
| **P3** | Append-only audit event log | Not started | ~4-6h | Architecture Review |
| **P3** | MCP cost attribution SEP | Not started | ~2h | Architecture Review |
| **P3** | FOCUS FinOps export | Not started | ~3-4h | Architecture Review |
| **P3** | Stripe MPP integration | Not started | ~1 day | Architecture Review |
| **P3** | Provider-level budgets | Not started | ~3-4h | Architecture Review |
| **P3** | Hierarchical budget delegation | Not started | ~1 day | Architecture Review |
| **—** | `doc_url` on error responses | Not started | ~15m | Audit Section 3 |
| **—** | Budget check result tracking | Not started | TBD | Audit Section 6 |
| **—** | `enforcement_latency_ms` on cost_events | Not started | TBD | Audit Section 6 |
| **—** | `has_policies` on api_keys | Not started | TBD | Audit Section 6 |
| **—** | API version-gating logic | Not started | TBD | Audit Section 5 |
| **—** | Postgres → ClickHouse migration | Not started | TBD | Audit Section 13 |
| **—** | Multi-region DO replication | Not started | TBD | Audit Section 13 |

**P1 total:** ~10h | **P2 total:** ~2.5 days | **P3 total:** ~2-3 weeks
