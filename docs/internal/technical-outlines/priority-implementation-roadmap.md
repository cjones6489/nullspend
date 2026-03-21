# NullSpend Priority Implementation Roadmap

**Created:** 2026-03-20
**Last updated:** 2026-03-21 (multi-entity budget strategy from competitive research)
**Purpose:** Forward-looking architecture, infrastructure, and feature roadmap for NullSpend. Derived from the post-audit deep research and competitive analysis. Prioritized by impact on platform positioning as the best financial infrastructure for AI agents.

**Predecessor:** [`nullspend-prelaunch-design-audit.md`](nullspend-prelaunch-design-audit.md) — completed 2026-03-19 (8/8 items shipped). Contains detailed implementation notes, design decisions, and three-pass audit findings for all completed items.

**Research sources:**
- [`docs/research/architecture-review-2026-03-20.md`](../research/architecture-review-2026-03-20.md) — comprehensive architecture review comparing NullSpend against Portkey, LiteLLM, Helicone, Stripe Issuing, Marqeta, Svix, FOCUS spec, OpenTelemetry GenAI, MCP ecosystem, and recent YC companies
- [`docs/research/cost-events-source-column.md`](../research/cost-events-source-column.md) — source column deep research (completed)
- [`docs/research/api-versioning.md`](../research/api-versioning.md) — API versioning deep research (completed)
- [`docs/technical-outlines/agent-tracing-architecture.md`](agent-tracing-architecture.md) — agent tracing five-phase spec
- Multi-entity budget research (2026-03-21) — competitive analysis of LiteLLM, Portkey, OpenRouter, Bifrost, Brex, Ramp, FOCUS v1.3, AgentBudget, SatGate

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
| Webhook event taxonomy (14 types + `api_version`) | 2026-03-20 | Audit Section 4 |
| `source` column on cost_events (`proxy`/`api`/`mcp`) | 2026-03-19 | Audit Section 6 |
| API versioning (`NullSpend-Version` header + three-tier resolution) | 2026-03-19 | Audit Section 5 |
| Webhook secret rotation (dual-signing + 24h expiry) | 2026-03-19 | Audit Section 7 |

---

## Priority 1 — High Impact / Ship Next

Items that address critical gaps identified in the architecture review. Each has clear enterprise demand, competitive differentiation, or architectural improvement.

### 1.1 `tags` JSONB on cost_events — ✅ Done
**Shipped:** 2026-03-19 | **Source:** [Architecture Review](../research/architecture-review-2026-03-20.md) — Competitive Landscape section

The #1 FinOps request universally. LiteLLM, FOCUS spec, and CloudZero all emphasize arbitrary key-value attribution as the primary mechanism for cost allocation (by project, environment, customer, feature, team, department).

**What was built:**
- `tags jsonb DEFAULT '{}'` column on `cost_events`
- Tags accepted via `X-NullSpend-Tags` request header (JSON object, max 10 keys, max 64 char keys, max 256 char values)
- Stored on all ingestion paths (proxy, API, MCP)
- `?tags=` JSONB containment filtering on `GET /api/cost-events`
- `_ns_` prefix reserved for system tags (user-supplied keys starting with `_ns_` are silently dropped)
- SDK: `client.reportCost({ ..., tags: { project: "search", env: "prod" } })`

### 1.2 Loop/Runaway Detection — ✅ Done
**Shipped:** v1.0 (2026-03-19) — sliding window cost-rate detection with circuit breaker.
**Shipped:** v1.1 (2026-03-19) — dashboard UI (velocity form fields, live cooldown status), `velocity.recovered` webhook, DO `getVelocityState()` RPC, internal velocity-state endpoint, dashboard polling API.

Includes: sliding window counter in DO, circuit breaker with configurable cooldown, `velocity.exceeded` + `velocity.recovered` webhooks, dashboard create/edit velocity config, live cooldown badge via 10s polling, `Zap` icon indicator.

### 1.3 W3C `traceparent` Propagation + `trace_id` Column — **Done** (2026-03-19)
**Effort:** ~1h | **Source:** [Architecture Review](../research/architecture-review-2026-03-20.md) — Priority 2; [Agent Tracing Architecture](agent-tracing-architecture.md) — Phase 1

Low effort, high enterprise value. Agent frameworks (AG2, LangChain) are starting to emit `traceparent` headers natively. This enables cost-per-task queries across multiple LLM calls.

**What was built:**
- `trace_id text` nullable column on `cost_events` (indexed where not null)
- `traceId` extracted from `traceparent` header or `X-NullSpend-Trace-Id` custom header, with auto-generation fallback
- `traceparent` header forwarded to upstream provider
- `?traceId=` filter on `GET /api/cost-events`
- Trace breakdown in `GET /api/cost-events/summary` (top 25 traces by cost)

### 1.4 Session-Level Budget Aggregation — ✅ Done
**Shipped:** 2026-03-20 | **Source:** [Architecture Review](../research/architecture-review-2026-03-20.md) — Priority 3; [Deep Research](../research/session-level-budget-aggregation.md)

Per-session spend caps enforced in the DO. When enabled on a budget entity, the DO tracks cumulative spend per `sessionId` (from `X-NullSpend-Session` header) and denies requests that would push a session over its limit.

**What was built:**
- `session_spend` table in DO SQLite (v4 migration): `(entity_key, session_id)` PK, `spend`, `request_count`, `last_seen`
- `session_id` column on `reservations` table (for alarm reversal)
- `sessionLimitMicrodollars` column on Postgres `budgets` table
- Session check in `checkAndReserve` (before velocity, before budget check)
- Session spend correction in `reconcile` (handles overestimate + zero-cost)
- Session spend reversal in `alarm` (expired reservation cleanup)
- 24h TTL session cleanup in alarm handler
- `session.limit_exceeded` webhook event type
- 429 `session_limit_exceeded` responses on OpenAI, Anthropic, MCP routes (no Retry-After)
- Dashboard: session limit config in budget dialog, Clock icon indicator in table
- Session ID length validation (256 char cap)
- 17 DO runtime tests, 10 route/orchestrator tests, 6 validation tests, 4 E2E smoke tests

### 1.5 Configurable Budget Thresholds — ✅ Done
**Effort:** ~1.5h | **Source:** [Prelaunch Audit Section 6](nullspend-prelaunch-design-audit.md) — last remaining medium-priority item

Thresholds currently hardcoded at `[50, 80, 90, 95]` in the proxy. Users cannot configure or discover them.

**What was built:**
- `threshold_percentages jsonb` column on budgets (array of integers, defaults to `[50, 80, 90, 95]`)
- Configurable via create/update budget API and dashboard UI
- `detectThresholdCrossings()` reads per-entity thresholds from budget entity, with default fallback
- `parseThresholds()` validates JSON safety, malformed input, reference isolation

### 1.6 Queue-Based Cost Event Logging — ✅ Done
**Shipped:** 2026-03-20 | **Source:** Stress testing — 0/25 cost events logged under concurrent load

Routes now enqueue cost events to Cloudflare Queues (`nullspend-cost-events`) instead of writing directly to Postgres via `waitUntil`. Queue consumer batch-INSERTs with per-message fallback for poison message isolation. DLQ consumer provides last-resort writes. Falls back to direct write when queue binding absent (local dev).

Key design decisions: `queue.sendBatch()` for MCP batch path, `max_batch_size=100` / `max_batch_timeout=5s`, `onConflictDoNothing` for idempotent re-delivery, 5s timeout on `queue.send()`, sentinel-based metric separation (pg_error vs semaphore_full), DLQ handler guards against HYPERDRIVE binding unavailability, `cost_event_queue_fallback` metric on fallback.

**Stress test verified:** 25/25 at medium, 50/50 at heavy. Spend drift: 0.0% at medium.

**New files:** `cost-event-queue.ts`, `cost-event-queue-handler.ts`, `cost-event-dlq-handler.ts`, 3 test files. Updated: 10 test files, 3 route files, `index.ts`, `wrangler.jsonc`.

### 1.7 Budget Sync Verification Round-Trip — ✅ Done
**Shipped:** 2026-03-20 | **Source:** Stress testing — $0 budget race condition

Stress tests found 3-6 requests leaking past a $0 budget under 25 concurrent requests. The DO hadn't finished populating the budget entity before requests arrived. Fix: `doBudgetUpsertEntities` now reads back `getBudgetState()` after upserting and retries any missing entities. Emits `budget_sync_retry` metric when retry fires. Deployed and verified: 25/25 denied at $0 budget.

### 1.8 Aborted Stream Cost Tracking — ✅ Done
**Shipped:** 2026-03-20 | **Source:** Stress testing — 0/5 aborted streams logged cost events

When a client aborts a streaming response mid-flight, the SSE parser resolves with `cancelled: true` and null usage. Previously no cost event was written, creating an analytics/billing gap.

**What was built:**
- In the `!result.usage && result.cancelled` branch of both `openai.ts` and `anthropic.ts`, an estimated cost event is written via `logCostEventQueued` with `inputTokens: 0`, `outputTokens: 0`, `costMicrodollars: estimate`
- Tagged with `_ns_estimated: "true"` and `_ns_cancelled: "true"` in the JSONB `tags` column (queryable via `@>` containment)
- Cost event write is try/catch-wrapped so failures cannot block budget reconciliation
- `parseTags` reserves the `_ns_` prefix — user-supplied tags starting with `_ns_` are silently dropped
- Dashboard aggregation queries accept `excludeEstimated` option; summary API accepts `?excludeEstimated=true`
- `emitMetric("cost_event_estimated")` fires on successful write for observability
- Stress test tightened: ≥80% of aborted streams must have cost events in DB

**Verified:** Stress tests pass 28/28. Live DB confirmed correct shape, tags, and zero tokens.

---

## Priority 2 — Medium Impact / Ship This Month

Items that improve DX, expand platform capabilities, or strengthen competitive positioning.

### 2.0a Budget Sync First-Populate Root Cause
**Effort:** ~3-4h | **Source:** Stress testing (2026-03-20) — probe verification fails ~20% of the time

Deep research (2026-03-21) revealed **two separate issues**, not one:

#### Issue 1: Hyperdrive Query Caching — Silent Sync Failure (higher severity)

Hyperdrive caches SELECT queries for **60 seconds** by default (+15s stale-while-revalidate). The sync path reads via `env.HYPERDRIVE.connectionString`, but the dashboard writes to Postgres directly (not through Hyperdrive). If a cached empty result exists from a prior lookup, `lookupBudgetsForDO` returns `[]`, and `doBudgetUpsertEntities` exits at `if (entities.length === 0) return;` — **no retry fires, no metric emitted, silent failure.** The budget is never populated in the DO.

This is **worse than Issue 2** because the verification+retry defense (1.7) does not protect against it — empty entities means nothing to verify.

**Deep research (2026-03-22) — HYPERDRIVE usage audit:**

All 6 `env.HYPERDRIVE.connectionString` call sites were audited. Only 2 perform SELECTs (cacheable by Hyperdrive); the other 4 are writes (never cached):

| Location | Operation | Cached? | Needs fresh? |
|---|---|---|---|
| `index.ts:224` | Auth `lookupKeyInDb()` SELECT | Yes | Has own in-memory positive/negative cache |
| `internal.ts:90` | Budget sync `lookupBudgetsForDO()` SELECT | **Yes — THE BUG** | **Yes** |
| `queue-handler.ts:14` | Reconcile `updateBudgetSpend()` UPDATE | No | N/A |
| `dlq-handler.ts:24` | Reconcile DLQ UPDATE | No | N/A |
| `cost-event-queue-handler.ts:19` | Cost event INSERT | No | N/A |
| `cost-event-dlq-handler.ts:20` | Cost event DLQ INSERT | No | N/A |

**Options evaluated:**

| Option | Pros | Cons |
|---|---|---|
| **A: Disable caching on existing Hyperdrive** | Zero code changes, one CLI command, no pool doubling | Loses edge cache for auth cold starts (~50-100ms, mitigated by in-memory cache) |
| B: Second uncached Hyperdrive binding | Surgical, other paths keep caching | Doubles DB connection pool, code changes in internal.ts + worker-configuration.d.ts + wrangler.jsonc + 30+ test mocks |
| C: Per-query cache bypass | No infra changes | Not reliably supported by `pg` driver, CF docs recommend multiple bindings instead |

**Decision: Option A** — disable caching on the existing Hyperdrive config.

```bash
wrangler hyperdrive update ae987aca79704f1fa94bf2c4bb761f14 --caching-disabled true
```

Rationale: Only 2 SELECT paths exist, both are better off uncached (auth has its own cache, sync needs fresh data). Zero code changes. No connection pool doubling. Reversible with `--caching-disabled false` if needed post-launch. If edge caching becomes valuable later (many cold starts), revisit with dual-binding approach.

**Effort:** ~15min (CLI command + verify + stress test confirmation)

#### Issue 2: DO Write Visibility — ~20% Retry Rate — ✅ Fixed (2026-03-21)

Root cause confirmed via deep research: `getBudgetState()` read from the in-memory `this.budgets` Map, not SQLite. Under concurrent RPC interleaving at `await` points, another `checkAndReserve` could call `loadBudgets()` which does `this.budgets.clear()` then rebuilds — causing a momentary stale read window. CF docs confirm SQLite reads are microsecond-fast (page cache), making the Map redundant.

**What was fixed:**
1. `getBudgetState()` now reads directly from SQLite (same query as `loadBudgets()`), matching the `getVelocityState()` pattern already in production. The in-memory Map is retained only for `populateIfEmpty` return value and constructor logging.
2. Verification comment updated + retry log upgraded from `console.warn` to `console.error` with "UNEXPECTED" prefix, since post-fix this path should never fire.
3. `removeBudget()` no longer deletes in-flight reservations. Previously, it aggressively deleted all reservations referencing the removed entity, which broke `reconcile()` for co-covered entities (multi-entity reservations). `reconcile()` already handles missing budgets gracefully (reports `budgetsMissing`, skips spend). Alarm handles expired reservation cleanup.

**Verified:** 1130/1130 proxy unit tests, 57/57 DO integration tests (previously 55/57 — the 2 `removeBudget` + reconcile tests now pass), typecheck clean, stress tests 28/28 at medium intensity.

### 2.0b Analytics Engine Metrics + Proxy Latency Publication — ✅ Done
**Shipped:** 2026-03-21 | **Source:** Stress testing (2026-03-20) — `/health/metrics` returns all zeros; Architecture Review — Bifrost benchmark

**Merged with former 2.4 (Proxy Latency Metrics).** Deep research (2026-03-21) found the proxy latency pipeline was already fully built but the AE SQL API query endpoint had multiple bugs preventing live data.

**Bugs found and fixed:**
1. **UInt64 string coercion** — AE returns `request_count` as a string (e.g., `"402"`). The `safe()` function checked `typeof === "number"`, silently returning 0. Fixed to coerce strings.
2. **`FORMAT JSON` missing** — Added explicitly to the SQL query to guarantee JSON response format.
3. **Response key ambiguity** — CF docs conflict on `data` vs `result`. Made parsing handle both defensively (live testing confirmed `data` is correct).
4. **Negative caching** — On AE failure, caches empty metrics for 30s to prevent thundering herd. Auth errors (401/403) bypass negative cache so expired tokens stay loud.
5. **`Vary: Accept`** — Added to both JSON and Prometheus responses for correct HTTP caching semantics.
6. **Observability** — Added `emitMetric` calls for cache hit/miss, AE query success/failure (with duration), cache write errors. Timeout vs network error differentiation in logs.

**What was built/fixed:**
- `CF_ACCOUNT_ID` + `CF_API_TOKEN` worker secrets set
- `metrics.ts` — `safe()` string coercion, `FORMAT JSON`, defensive `data`/`result` parsing, negative caching, `Vary: Accept`, structured metric emission, timeout differentiation
- `health-metrics.test.ts` — 30 tests (up from 16): mock fidelity (string UInt64), null/empty-string values, negative caching, auth-error bypass, timeout, malformed JSON, both response keys, metric emission, Vary header
- `smoke-metrics.test.ts` — 5 E2E tests: endpoint shape, Prometheus format, AE population after traffic (with polling), `Server-Timing` header, `x-nullspend-overhead-ms` header
- `.dev.vars.example` — added `CF_ACCOUNT_ID` + `CF_API_TOKEN` placeholders

**Live-verified:** `curl https://nullspend.cjones6489.workers.dev/health/metrics` returns real p50/p95/p99 latency data.

**Important context (from deep research):**
- CF Workers `performance.now()` only advances on I/O (Spectre mitigation) — CPU-bound overhead (~0.5-1ms) is invisible. All CF Workers proxies face this.
- `overhead_ms` = total - upstream (wall clock). Includes I/O from auth, budget check, Redis — not just CPU time.
- Bifrost's 11us excludes JSON marshalling + HTTP calls — not comparable to NullSpend's overhead which includes auth, budget check, DO RPC.
- Streaming: AE data point uses full stream duration; `Server-Timing` header uses TTFB. Both correct for their context.

**Optional future enhancements:**
- Add `?provider=` filter to `/health/metrics`, add `colo` blob for region breakdown
- Document overhead numbers in README once real production data volume is available

### 2.1 Claude Agent SDK Adapter — ✅ Done
**Shipped:** 2026-03-20 | **Source:** [Architecture Review](../research/architecture-review-2026-03-20.md) — Priority 4; [Deep Research](../research/claude-agent-sdk-adapter.md)

Config-transformer adapter (`withNullSpend()`) that routes Claude Agent SDK LLM calls through NullSpend's proxy via `ANTHROPIC_BASE_URL` + `ANTHROPIC_CUSTOM_HEADERS` env vars. ~100 lines, zero runtime deps, one function, one interface.

**What was built:**
- `packages/claude-agent/` — `@nullspend/claude-agent` workspace package (ESM + CJS + dts)
- `withNullSpend()` merges NullSpend options into SDK `Options`: apiKey, budgetSessionId, tags, traceId, actionId, proxyUrl
- Client-side validation matching proxy expectations: `actionId` format (`ns_act_<UUID>`), `traceId` format (32-char lowercase hex), tag key pattern (`[a-zA-Z0-9_-]+`), newline injection prevention
- Always merges `process.env` as base so child process retains `PATH`, `ANTHROPIC_API_KEY`, etc.
- 34 unit tests, CI build + test steps, peerDep on SDK `>=0.2.0 <1.0.0`

### 2.2 Thin Webhook Event Mode — ✅ Done
**Shipped:** 2026-03-21 | **Source:** [Architecture Review](../research/architecture-review-2026-03-20.md) — Competitive section (Stripe v2 pattern); [Deep Research](../research/thin-webhook-events-research.md)

Stripe's API v2 moved to thin events (payload contains only event type + resource reference, consumer fetches current state via API). Thin events are version-stable and cheaper to deliver. No AI proxy competitor (LiteLLM, Helicone, Portkey) offers thin events.

**What was built:**
- `payload_mode text DEFAULT 'full' CHECK (payload_mode IN ('full', 'thin'))` column on `webhook_endpoints` (migration 0030)
- Per-endpoint config: `payloadMode: "full" | "thin"` — only `cost_event.created` goes thin; budget/velocity/session/action/threshold events always deliver full payloads regardless of mode
- `ThinWebhookEvent` interface: `{ id, type, api_version, created_at, related_object: { id, type, url } }`
- `buildThinCostEventPayload()` builder in both proxy and dashboard (SYNC'd)
- Thin/full branching at all 5 proxy dispatch sites (OpenAI streaming + non-streaming, Anthropic streaming + non-streaming, MCP)
- Dashboard `dispatchCostEventToEndpoints()` helper with per-endpoint thin/full decision, event type filtering, HMAC signing, and lazy secret expiry cleanup
- `requestId` filter added to `GET /api/cost-events` list endpoint (enables thin event fetch-back URL)
- `GET /api/cost-events/{id}` fetch-back endpoint (session-auth, ownership-scoped via API key join)
- Webhook CRUD: `payloadMode` in create/update/get API + Zod validation
- HMAC signing unchanged — thin events signed identically to full events
- Proxy cache (`WebhookEndpointWithSecret`) includes `payloadMode` from DB; `CachedWebhookEndpoint` (KV/Redis metadata cache) unchanged
- Deploy-order safe: migration adds column with DEFAULT 'full', `?? "full"` fallback in all dispatch code

**Tests added:** 37 new tests across 12 files — thin payload builders, mixed endpoint dispatch, non-cost-event to thin endpoint, payloadMode validation schemas, fetch-back endpoint, non-streaming thin dispatch, URL query param validation, requestId list filter, apiKeyId=null edge case

**Competitive edge:** No AI proxy competitor offers per-endpoint payload mode configuration

### 2.3 Unit Economics Dashboard Metrics
**Effort:** ~1 day | **Source:** [Architecture Review](../research/architecture-review-2026-03-20.md) — Competitive section (CloudZero pattern)

Surface "cost per session," "cost per tool invocation," "cost per API key" as first-class computed metrics. NullSpend already has the data — just needs aggregation and display.

**What to build:**
- Extend `GET /api/cost-events/summary` with unit economics:
  - `costPerSession` (total cost / unique session count)
  - `costPerKey` (total cost / active key count)
  - `costPerTool` (tool cost / tool invocation count)
  - `topSessions` (most expensive sessions with cost + request count)

### 2.4 Tag-Based Budgets
**Effort:** ~4-6h | **Source:** Multi-entity budget research (2026-03-21)

Let users set a budget on a tag value (e.g., `project=openclaw` gets $50/month). Solves multi-agent cost tracking without requiring one API key per agent — one key, different tags per agent/project/environment.

**Competitive context:** LiteLLM has tag budgets but with critical bugs: spend inflation on multi-tag requests (#21894), TOCTOU race with no reservation pattern (#18730), budget bypass via pass-through routes (#12977, #10750), and broken period resets (#14266). Portkey's metadata `group_by` policies are flexible but enterprise-gated ($5K+) and budget limits are immutable after creation. Helicone conflates budgets with rate limits (rolling windows only, no calendar resets). No competitor does tag-based budget enforcement well — this is a core differentiator opportunity.

**Data model:** Add `entity_type = 'tag'` with `entity_id = 'project=openclaw'` to the existing `budgets` table. Tag budgets are just another entity in the DO's SQLite — same check-and-reserve, same reservation tracking, same reconciliation. No new enforcement layer (Bifrost lesson: initially separating provider budgets created architectural problems).

**What to build:**
- Tag budget rows in existing `budgets` table: `entity_type = 'tag'`, `entity_id = '{key}={value}'`
- `lookupBudgetsForDO` extended to also query tag budgets for the user
- DO `checkAndReserve`: tag budgets checked in same `transactionSync()` alongside entity budgets — atomic, no TOCTOU race (unlike LiteLLM's async batch approach)
- Tag budget CRUD API: `POST/GET/PATCH/DELETE /api/tag-budgets`
- Default tags on API keys: `defaultTags` JSONB column on `api_keys` table — auto-applied to all requests using that key (Bedrock inference profile pattern). Per-request `X-NullSpend-Tags` merge with and override key defaults.
- `?groupBy=tag:project` parameter on existing `GET /api/cost-events/summary` for tag-spend analytics (AWS Cost Explorer / Kubecost pattern)
- Dashboard UI: tag budget management page, `__untagged__` visible category in cost breakdowns
- `tag_budget.exceeded` webhook event type
- 429 `tag_budget_exceeded` denial response
- Cap: 50 tag budgets per user (bounds DO SQLite, Postgres queries, dashboard)

**Design decisions (resolved via competitive research 2026-03-21):**

*Core enforcement:*
- Tag budgets are per-user, not global (user A's `project=foo` budget is independent of user B's)
- A request can match multiple tag budgets; all must pass (strictest wins, same as entity budgets)
- Tag budgets are checked alongside entity budgets in same `transactionSync()` — both layers must approve
- Each matching tag budget gets the full request cost (correct semantics — a $5 request matching both project and env budgets deducts $5 from each). Dashboard must NOT sum tag budgets for a "total" to avoid double-counting (LiteLLM #21894 lesson)
- Period reset reuses the same inline mechanism as entity budgets (no separate reset job — avoids LiteLLM #14266 race)

*Untagged requests (industry consensus: no catch-all):*
- Untagged requests skip tag budgets entirely — entity budgets (user/key) are the catch-all
- `__untagged__` shown as a visible category in dashboards (Kubecost `__unallocated__` pattern)
- Track "% of spend allocated" as a KPI (FinOps Foundation maturity model)
- Optional future: let users create a budget for untagged spend (`tagKey: "*"`) — opt-in, not automatic

*Default tags on API keys (merge semantics — 7/9 platforms use most-specific-wins):*
- Request tags override key defaults for the same key; non-conflicting keys are merged (union)
- Example: key defaults `{project: "openclaw", team: "backend"}` + request tags `{project: "other", env: "prod"}` → effective `{project: "other", team: "backend", env: "prod"}`
- Store effective merged tags on the cost event (not raw request tags)
- Return `X-NullSpend-Effective-Tags` response header so callers see resolved tags
- Sources: OpenTelemetry spec (MUST override), AWS tag policies, Azure Cost Management, Stripe metadata, Portkey, CSS cascade — all use most-specific-wins
- Future escape hatch: `locked: true` on key-level tags if admins need to prevent override

*HTTP status code (keep 429 now, design for 402 later):*
- Current: 429 + `error.code: "tag_budget_exceeded"` (consistent with existing budget enforcement)
- Anthropic uses 402 for billing errors (separate from 429 rate limits). OpenRouter uses 402 for insufficient credits. Stripe uses 402 for payment failures. The x402 protocol and HAP IETF draft are standardizing 402 for agent budget contexts.
- Medium-term: add API-version-gated opt-in to 402 for all budget exhaustion responses
- Long-term: default to 402 once x402/HAP standards mature and SDKs add 402-aware handling

*Analytics (hybrid approach — AWS/Kubecost pattern):*
- Tag spend analytics: `?groupBy=tag:project` parameter on existing `GET /api/cost-events/summary` (unified endpoint, tag is just another GROUP BY dimension)
- Tag budget CRUD: separate `/api/tag-budgets` endpoints (lifecycle management is a distinct concern)
- Postgres indexing: GIN with `jsonb_path_ops` on `cost_events.tags` for dashboard queries. Expression B-tree indexes on common tag keys for planner accuracy (Postgres hardcodes `@>` selectivity at 0.1% regardless of actual data — expression indexes have proper statistics)

**Explicitly deferred:**
- Boolean filter expressions (And/Or/Not) on tag budgets — AWS FilterExpression pattern, valuable but not needed at launch
- Cedar-inspired policy DSL for budget rules — design later when rule complexity justifies it
- Macaroon-style budget delegation on API keys — SatGate/DeepMind pattern, design for agentic workflows later
- HTTP 402 as default status — wait for x402/HAP maturity
- ClickHouse for tag-spend analytics — wait for Postgres to show strain

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

### 3.8 First-Class Agent Entities
**Effort:** ~1-2 days | **Source:** Multi-entity budget research (2026-03-21)

Wire up the `agent` entity type that already exists in the budgets schema. Gives users an OpenRouter-style experience: create named agents in the dashboard, assign budgets, and see per-agent cost breakdowns.

**Competitive context:** OpenRouter uses Org > Member > Key with guardrails. Bifrost has a 5-level hierarchy (Customer > Team > User > VK > Provider). NullSpend's flat entity types (`user | agent | api_key | team`) are simpler but need UI exposure. The `agent` entity bridges the gap between per-account and per-key budgets without requiring a key per agent.

**What to build:**
- `agents` table: `(id, user_id, name, description, created_at)` — lightweight named entity
- Associate requests with an agent via `X-NullSpend-Agent` header or tag
- Agent CRUD API: `POST/GET/PATCH/DELETE /api/agents`
- Dashboard: agent management page, per-agent cost breakdown, budget assignment
- Budget entity creation: `entityType: "agent", entityId: agent.id`
- SDK: `client.chat({ ..., agentId: "ns_agent_..." })`

**Design decisions:**
- Agents are per-user (like API keys). No cross-user agent sharing until teams ship.
- An agent can have its own budget independently of the API key used to call it
- Tag-based budgets (2.4) solve 90% of the use case. This adds named entities for better DX/dashboard UX.
- Team/org hierarchy is explicitly deferred — that's enterprise multi-tenancy (see "Explicitly Not Building")

### 3.9 Provider-Level Budgets
**Effort:** ~3-4h | **Source:** [Architecture Review](../research/architecture-review-2026-03-20.md) — Competitive section (LiteLLM pattern)

"$500/month on Anthropic, $300/month on OpenAI." Allow budgets scoped to a specific provider for multi-provider cost control.

### 3.10 Hierarchical Budget Delegation
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
| 5-level budget hierarchy | LiteLLM's org>team>user>key>enduser creates confusing edge cases (e.g., user budget bypassed for team keys). Flat entity types + tag budgets + optional named agents is better DX. Revisit team/org hierarchy only when multi-tenant customers arrive. |
| WASM policy rule engine | Enterprise overkill at current stage. Three policies (strict_block, soft_block, warn) cover 95% of use cases. |
| Embeddable webhook debug portal | Significant effort for a feature most users won't need until multi-tenant webhook management. |

---

## Roadmap Summary

Last updated: 2026-03-21 (tag-based budget design decisions resolved)

| Priority | Item | Status | Effort | Source |
|---|---|---|---|---|
| **P1** | `tags` JSONB on cost_events | **Done** (2026-03-19) | ~2h | Architecture Review |
| **P1** | Loop/runaway detection (velocity limits) | **Done** (2026-03-19) | ~3-4h | Architecture Review |
| **P1** | W3C `traceparent` + `trace_id` column | **Done** (2026-03-19) | ~4h | [Research](../research/traceparent-trace-id-research.md) |
| **P1** | Session-level budget aggregation | **Done** (2026-03-20) | ~4h | [Research](../research/session-level-budget-aggregation.md) |
| **P1** | Configurable budget thresholds | **Done** (2026-03-19) | ~1.5h | Audit Section 6 |
| **P1** | Queue-based cost event logging | **Done** (2026-03-20) | ~3-4h | Stress testing |
| **P1** | Budget sync verification round-trip | **Done** (2026-03-20) | ~1h | Stress testing |
| **P1** | Aborted stream cost tracking gap | **Done** (2026-03-20) | ~2h | Stress testing |
| **P2** | Budget sync: Hyperdrive caching fix | **Done** (2026-03-22) | ~15min | Deep research (2026-03-22) |
| **P2** | Budget sync: DO write visibility fix + removeBudget reconcile fix | **Done** (2026-03-21) | ~1h | Deep research (2026-03-21) |
| **P2** | AE metrics + proxy latency publication (merged 2.0b + 2.4) | **Done** (2026-03-21) | ~1-2h | Stress testing + Architecture Review |
| **P2** | Claude Agent SDK adapter | **Done** (2026-03-20) | ~1 day | [Deep Research](../research/claude-agent-sdk-adapter.md) |
| **P2** | Thin webhook event mode | Not started | ~3-4h | Architecture Review |
| **P2** | Unit economics dashboard metrics | Not started | ~1 day | Architecture Review |
| **P2** | Tag-based budgets (+ default tags on keys, `groupBy` analytics) | Not started | ~1-2 days | Multi-entity research (2026-03-21) |
| **P2** | GitHub Secret Scanning registration | Not started | External | Audit Section 2 |
| **P3** | First-class agent entities | Not started | ~1-2 days | Multi-entity research (2026-03-21) |
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

**P1 total:** ~10h | **P2 total:** ~2.5 days (includes 2.0a split: ~30min + ~2-3h) | **P3 total:** ~2-3 weeks
