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

### 1.2 Loop/Runaway Detection
**Effort:** ~3-4h | **Source:** [Architecture Review](../research/architecture-review-2026-03-20.md) — Priority 1, Frontier section 5.2

The #1 unaddressed enterprise pain point. Fortune 500 collectively leaked $400M in uncontrolled AI costs (2025). A single recursive agent loop can cost $100K+. Multi-agent systems show quadratic token growth.

**What to build:**
- Add `velocity_limit_microdollars_per_minute` column to budgets (nullable, opt-in)
- In DO's `checkAndReserve`, check rolling spend in last 60s from reservations table
- If velocity exceeds limit, return denial with `reason: "velocity_limit"`
- New webhook event type: `budget.velocity.exceeded`
- Dashboard: velocity limit field on budget create/edit form

**Why now:** DO already has alarms and per-entity state. TrueFoundry's Agent Gateway and AgentBudget both offer loop detection — NullSpend should match this before launch.

### 1.3 W3C `traceparent` Propagation + `trace_id` Column
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

### 1.5 Configurable Budget Thresholds
**Effort:** ~1.5h | **Source:** [Prelaunch Audit Section 6](nullspend-prelaunch-design-audit.md) — last remaining medium-priority item

Thresholds currently hardcoded at `[50, 80, 90, 95]` in the proxy. Users cannot configure or discover them.

**What to build:**
- Add `warn_threshold_pct` + `critical_threshold_pct` columns to budgets (nullable, defaults to 80/95)
- Expose in create/update budget API (`createBudgetInputSchema`)
- Read in proxy's `detectThresholdCrossings()` from budget entity instead of hardcoded array

---

## Priority 2 — Medium Impact / Ship This Month

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
| **P1** | `tags` JSONB on cost_events | Not started | ~2h | Architecture Review |
| **P1** | Loop/runaway detection (velocity limits) | Not started | ~3-4h | Architecture Review |
| **P1** | W3C `traceparent` + `trace_id` column | Not started | ~1h | Audit Section 12 + Architecture Review |
| **P1** | Session-level budget aggregation | Not started | ~2-3h | Architecture Review |
| **P1** | Configurable budget thresholds | Not started | ~1.5h | Audit Section 6 |
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
