# Research Review: Frontier Proxy Architecture Deep Dive

**Reviewed:** `docs/internal/research/frontier-proxy-architecture-deep-dive.md`
**Reviewer:** Staff engineer codebase audit
**Date:** 2026-03-22

---

## Research Review Summary

- **Alignment score:** 7/10 — The research is strategically sound but has significant blind spots about what we've already shipped and what our existing packages already do.
- **Ready to implement as-is:** No — several recommendations would duplicate existing code, and the "current state" baseline is wrong in key places (Phase 1 optimizations are already partially shipped, not future work).
- **Biggest misalignments:**
  1. Research treats Phase 1 proxy optimizations (Redis removal, Smart Placement, parallelization, Server-Timing) as future work — **most of this is already shipped** in uncommitted changes on main.
  2. Research recommends building a "NullSpend MCP Server" for budget-as-a-tool — we already have `@nullspend/mcp-server` (HITL approval) and `@nullspend/mcp-proxy` (with budget checking + cost tracking). The research didn't look at these packages.
  3. Research recommends building `@nullspend/ai-sdk` from scratch — doesn't account for the existing `@nullspend/sdk` which already has `checkBudget()`, `reportCost()`, `reportCostBatch()`, `queueCost()`, and client-side batching.
  4. Research says "NullSpend (current) 145-260ms" — this was true before the current sprint but the uncommitted changes already have native rate limiting, Smart Placement, parallelized auth, and Server-Timing instrumentation.
  5. `pg` → `postgres.js` migration from the latency optimization doc is referenced but the research doesn't address it — that Refactor 2 is still pending and relevant.

---

## Validated Recommendations

### 1. Cloudflare Workers + DO is the right platform
**Confirmed.** The research correctly identifies that no other edge platform has a Durable Objects equivalent. Our `UserBudgetDO` uses DO SQLite for atomic check-and-reserve with single-writer consistency — this is unique. Smart Placement (now enabled in `wrangler.jsonc`) co-locates Worker + DO.

**Evidence:** `wrangler.jsonc` has `"placement": { "mode": "smart" }`. `UserBudgetDO` is exported from `index.ts`. Budget enforcement goes through `doBudgetCheck()` → DO RPC → SQLite.

### 2. The "3 enforcement modes" product strategy (proxy + SDK + MCP tools)
**Confirmed and well-aligned.** This maps cleanly to our existing package structure:
- **Proxy** = `apps/proxy/` (hard enforcement, zero-trust) — already shipping
- **SDK** = `packages/sdk/` (cooperative, batched reporting) — already has `checkBudget()` + `reportCost()`
- **MCP tools** = `packages/mcp-server/` + `packages/mcp-proxy/` — HITL approval + tool-level cost tracking

The research correctly identifies that offering all three reporting to one dashboard is the differentiator.

### 3. Per-key enforcement modes (`strict` / `track` / `optimistic`)
**Good recommendation, needs minor schema work.** Our `budgets` table has `policy` enum (`strict_block` / `soft_block` / `warn`) which maps to the spirit of this, but it's per-budget, not per-key. Adding a per-key `enforcement` mode would be a schema addition to `api_keys` table.

### 4. Multi-agent budget hierarchy
**Confirmed as a gap.** The `budgets` table supports `entityType` (user/agent/api_key/team/tag) and `entityId`, which is the foundation for hierarchical budgets. But there's no parent-child relationship between entities, no rollup logic, and no delegation mechanism. The research correctly identifies this as a competitive differentiator nobody else has.

### 5. Vercel Edge Functions disqualified for AI proxying
**Confirmed.** The connection-severing on long TTFT is a real dealbreaker. Reasoning models (o3, Claude with extended thinking) can take 5-30s before first token. Our CF Workers handle this correctly.

### 6. Theoretical 3-10ms floor for sync enforcement on CF Workers + DO
**Reasonable estimate.** With Smart Placement now enabled, the Worker and DO should be co-located. The `do_budget_check` metric in `budget-do-client.ts` captures actual duration — we should verify against real deployment data after the current changes ship.

### 7. CRDTs are unnecessary for NullSpend today
**Confirmed.** Single-writer DO with Smart Placement is the right choice. The Bounded Counter CRDT note for future multi-region active-active is a good breadcrumb but not actionable now.

### 8. JWT/PASETO signed API keys as future moat
**Confirmed.** Our current auth flow (`api-key-auth.ts`) does SHA-256 hash lookup → Postgres query (Hyperdrive) → timing-safe comparison. The in-memory cache (120s TTL with jitter, 256 entries) mitigates this, but JWT would eliminate the DB hop entirely. Current key format (`ns_live_sk_` prefix) would need a new prefix (`ns_jwt_`) — backward compatible by prefix detection.

### 9. Budget-as-a-tool (Cycles MCP Server pattern)
**Good strategic direction, but research overstates the gap.** Our `@nullspend/mcp-proxy` already has:
- `costTracker.resolveToolCost(name)` — cost estimation
- `costTracker.checkBudget(name, costEstimate)` — pre-call budget check
- `costTracker.reportEvent(...)` — post-call cost reporting

What's missing vs Cycles: **reservation semantics** (reserve → commit/release) and **agent-queryable budget state** (the agent asking "how much budget do I have left?"). These are incremental additions to existing packages, not net-new products.

---

## Misalignments Found

### Critical: Research baseline is stale — Phase 1 optimizations already shipped

**Severity: Critical**

The research repeatedly states:
- "NullSpend (current) 145-260ms overhead"
- "Complete Proxy Optimization (Phase 1 from existing doc) — Redis removal + Smart Placement + parallelization → 5-20ms overhead — This is table stakes. Do it first."

**What the codebase actually shows:**

The uncommitted changes on `main` already include:
- `wrangler.jsonc`: Smart Placement enabled, native rate limiting bindings (`IP_RATE_LIMITER`, `KEY_RATE_LIMITER`)
- `index.ts`: `applyRateLimit()` uses native bindings, auth + rate limit parallelized via `Promise.all()`
- `context.ts`: `redis` field removed, `stepTiming` added
- `headers.ts`: Full `StepTiming` interface with `preFlightMs`, `bodyParseMs`, `budgetCheckMs`, Server-Timing header with descriptions
- `api-key-auth.ts`: 120s TTL with ±10s jitter already implemented
- `routes/openai.ts`, `anthropic.ts`, `mcp.ts`: Redis references removed
- `webhook-cache.ts`: KV-only, Redis path removed

**What's NOT done yet:**
- `@upstash/redis` is removed from proxy source but `pg` → `postgres.js` migration hasn't started
- `db-semaphore.ts` still exists (6 source files + 9 test files reference it)
- Smoke test files still reference `@upstash/redis` (2 files — likely stale)
- `worker-configuration.d.ts` still has `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` in the Env type (needs `wrangler types` regeneration)

**How to fix the research:** Update the benchmark table. NullSpend's "current" should reflect the shipped optimizations. Add a "remaining work" section that calls out Refactor 2 (pg → postgres.js) and Refactor 3-4 (cleanup + test consolidation) as the actual next steps.

### High: Research recommends building MCP Server as net-new — it already exists

**Severity: High**

The research recommends:
> "NullSpend MCP Server — Expose budget operations as MCP tools: nullspend_check_budget, nullspend_reserve, nullspend_commit, nullspend_release, nullspend_session_summary, nullspend_suggest_model"

**What already exists:**

`packages/mcp-server/` — An MCP server exposing `propose_action` and `check_action` tools (HITL approval flow).

`packages/mcp-proxy/` — An MCP proxy with:
- `BudgetClient` with circuit breaker (calls `/v1/mcp/budget/check`)
- `EventBatcher` (queues cost events, batches to `/v1/mcp/events`)
- `ToolCostRegistry` (discovers tools, fetches user-configured costs)
- Cost tier estimation from MCP annotations (`readOnlyHint`, `destructiveHint`, `openWorldHint`)

**The gap is real but smaller than the research suggests.** We need to add:
1. Reservation semantics (reserve → commit/release) to the MCP proxy's budget client
2. Budget query tools to the MCP server (`check_budget`, `session_summary`)
3. Model suggestion tool (`suggest_model` using `@nullspend/cost-engine`)

These are **incremental additions to existing packages**, not a new `@nullspend/mcp-server` product. The foundation — MCP transport, tool registration, budget checking, cost batching — already exists.

### High: Research recommends `@nullspend/ai-sdk` without noting existing SDK capabilities

**Severity: High**

The research recommends building `@nullspend/ai-sdk` (Vercel AI SDK middleware) as the "highest impact SDK integration."

**What already exists in `packages/sdk/`:**
- `checkBudget()` — fetch user's budget status (limit, spend, remaining per entity)
- `reportCost(event)` — single cost event reporting
- `reportCostBatch(events)` — batch reporting
- `queueCost(event)` — client-side queue with automatic batching
- `CostReporter` — automatic batch flushing, timer-based, overflow handling
- Full `CostEventInput` schema with provider, model, tokens, cost, session, trace, tags

**What's genuinely missing:**
- A `wrapLanguageModel` middleware for Vercel AI SDK
- `fetch` parameter wrappers for OpenAI/Anthropic native SDKs
- Local cost estimation (using `@nullspend/cost-engine` client-side)
- Cached budget enforcement at the SDK level

The research recommendation is directionally correct — building Vercel AI SDK middleware is high value. But it should be framed as "extend `@nullspend/sdk` with provider-specific wrappers that use the existing `checkBudget()` + `queueCost()` infrastructure," not "build a new product."

### Medium: Research doesn't account for cost-engine's existing capabilities

**Severity: Medium**

When the research discusses "local cost estimation" for SDK-side enforcement, it doesn't mention that `@nullspend/cost-engine` already exists as a standalone package with:
- `getModelPricing(provider, model)` — 30 models across OpenAI, Anthropic, Google
- `costComponent(tokens, ratePerMTok)` — microdollar-precision calculation
- `isKnownModel(provider, model)` — model allowlist check

This package is already a workspace dependency (`@nullspend/cost-engine: "workspace:*"` in proxy's package.json). Any SDK-side cost estimation should import and use this, not recreate it.

### Medium: "Cross-provider smart routing" recommendation ignores proxy architecture

**Severity: Medium**

The research recommends "Route to cheapest provider meeting quality threshold" as a 12-month item. This fundamentally changes the proxy's architecture — currently, the proxy routes to a single upstream provider based on the URL path (`/v1/chat/completions` → OpenAI, `/v1/messages` → Anthropic). Adding provider selection requires:
1. A model mapping/routing table
2. Request format translation (OpenAI ↔ Anthropic schemas are different)
3. Response format normalization
4. Pricing comparison logic

This is a much larger effort than the research suggests and would essentially make NullSpend into an AI gateway (competing with Portkey/LiteLLM) rather than a FinOps layer. The roadmap doc already notes: "the proxy is commoditizing... the value is in the spend controls, not the proxy rails." Smart routing might conflict with this positioning.

### Low: Stale Env type in worker-configuration.d.ts

**Severity: Low**

`worker-configuration.d.ts` still includes `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` in the `Env` interface. These should be removed by running `npx wrangler types` after the current changes ship. The research doc's Refactor 1 mentions this but it's easy to miss.

---

## Missing Context

### 1. The priority implementation roadmap already exists
`docs/internal/technical-outlines/priority-implementation-roadmap.md` is the authoritative roadmap. It was created 2026-03-20, updated 2026-03-22, and includes strategic context from an earlier architecture review. The frontier research should reference and align with this document, not propose a parallel roadmap.

Key items from the existing roadmap that the research didn't consider:
- Tags on cost_events (already shipped)
- Velocity/loop detection (already shipped with v1.0 and v1.1)
- Session limits (already shipped)
- Webhook secret rotation (already shipped)
- Agent tracing architecture (five-phase spec exists)
- MCP tool cost discovery (Part 1 shipped 2026-03-22)

### 2. The proxy already has queue-based cost event logging
The research discusses async cost logging as a pattern to adopt but doesn't note that NullSpend already has `COST_EVENT_QUEUE` (Cloudflare Queue) with DLQ, batch processing (max_batch_size: 100, 5s timeout), and fallback to direct writes. This was built to address the semaphore saturation issue under high concurrency.

### 3. Webhook dispatch architecture
The research mentions webhooks but doesn't account for our full webhook system: 14 event types, dual-key HMAC signing with 24h rotation, `payloadMode` (full/thin), QStash-based delivery, threshold crossing detection, and velocity recovery webhooks. Any "guardian agent" features should build on this, not recreate it.

### 4. The `claude-agent` package uses proxy redirect, not SDK instrumentation
`packages/claude-agent/` works by setting `ANTHROPIC_BASE_URL` to the proxy and injecting headers. This is the proxy enforcement model. The research correctly identifies that a `fetch`-wrapper approach would be complementary (SDK enforcement model), but should note that the proxy redirect already exists and covers the zero-trust use case for Claude agents.

### 5. ESM `.js` extension requirement in proxy
All proxy source files use `.js` extensions in relative imports (ESM requirement for Cloudflare Workers). Any new files added to the proxy must follow this convention. The research doesn't mention this.

---

## Existing Code the Research Missed

| What exists | Where | What the research recommends instead |
|---|---|---|
| `sdk.checkBudget()` | `packages/sdk/src/client.ts:155` | "Build budget query for SDK" |
| `sdk.queueCost()` + `CostReporter` batching | `packages/sdk/src/cost-reporter.ts` | "Build client-side batching" |
| `mcp-proxy` BudgetClient + circuit breaker | `packages/mcp-proxy/src/cost-tracker.ts` | "Build MCP budget enforcement" |
| `mcp-proxy` EventBatcher | `packages/mcp-proxy/src/cost-tracker.ts` | "Build MCP cost event reporting" |
| `mcp-proxy` ToolCostRegistry + tier estimation | `packages/mcp-proxy/src/cost-tracker.ts` | "Build tool cost estimation" |
| `mcp-server` propose_action + check_action | `packages/mcp-server/src/tools.ts` | "Build MCP server" |
| `cost-engine` getModelPricing (30 models) | `packages/cost-engine/src/pricing.ts` | "Bundle cost estimation in SDK" |
| `claude-agent` withNullSpend header injection | `packages/claude-agent/src/with-nullspend.ts` | (acknowledged, correctly) |
| COST_EVENT_QUEUE + DLQ | `wrangler.jsonc`, queue handlers | "Use async cost logging" |
| Server-Timing with StepTiming | `apps/proxy/src/lib/headers.ts` | "Add per-step Server-Timing" |
| Native rate limiting bindings | `wrangler.jsonc` ratelimits config | "Replace Upstash with native" |
| Smart Placement | `wrangler.jsonc` placement config | "Enable Smart Placement" |

---

## Convention Violations

### 1. Research uses `nullspend_` prefix for MCP tool names
The research proposes tools named `nullspend_check_budget`, `nullspend_reserve`, etc. Our existing MCP server uses `propose_action` and `check_action` — no namespace prefix. If we want consistency, either add the prefix to existing tools or don't use it for new ones. Given MCP tool naming conventions (tools are already scoped to the server), the prefix is unnecessary overhead.

### 2. Research proposes `enforcement: "strict" | "track" | "optimistic"` on API keys
Our existing budget policy enum is `strict_block | soft_block | warn` on the `budgets` table. Adding a separate enforcement mode to `api_keys` creates two overlapping concepts. Should be one mechanism: either extend the budget policy or add to keys, not both.

### 3. Research references `@nullspend/openai` and `@nullspend/anthropic` as separate packages
Our monorepo convention is feature-focused packages (`sdk`, `cost-engine`, `claude-agent`, `mcp-server`, `mcp-proxy`), not provider-focused packages. Provider-specific `fetch` wrappers should live in `@nullspend/sdk` as exports (e.g., `import { withNullSpendFetch } from "@nullspend/sdk/openai"`) rather than separate packages.

---

## Upgrade Opportunities

### 1. Budget-as-a-Tool MCP pattern (Cycles model)
**Who does it well:** Cycles MCP Server — reserve/commit/release lifecycle
**What we currently do:** MCP proxy does pre-call budget check but no reservation semantics at the MCP tool level. MCP server only has HITL approval tools.
**Why upgrading matters:** Agents that are self-aware of their budget constraints make better decisions (model selection, task prioritization, graceful degradation). This is a differentiated product feature, not just a technical optimization.
**Effort:** Medium — add 3-4 tools to existing `@nullspend/mcp-server`, extend `BudgetClient` in `@nullspend/mcp-proxy` with reserve/commit/release.
**When:** Next sprint. Builds on existing MCP infrastructure.

### 2. Vercel AI SDK Middleware (`wrapLanguageModel`)
**Who does it well:** Vercel AI SDK's `StopCondition` for budget-based loop termination
**What we currently do:** No Vercel AI SDK integration. SDK has `checkBudget()` but requires manual integration.
**Why upgrading matters:** Vercel AI SDK is the dominant framework for building AI applications in Next.js. A first-class middleware would give zero-overhead cost tracking to the largest developer audience.
**Effort:** Medium — new export from `@nullspend/sdk` that wraps `wrapLanguageModel`, uses `cost-engine` for local pricing, `queueCost()` for async reporting.
**When:** 6-month horizon. High impact but not blocking anything.

### 3. OTel GenAI Span Exporter
**Who does it well:** OpenLLMetry (Traceloop) — instruments 10+ providers via OTel
**What we currently do:** No OTel integration at all. Cost events flow through proxy headers or SDK `reportCost()`.
**Why upgrading matters:** Teams with existing OTel infrastructure (Datadog, Honeycomb, Grafana) could get NullSpend cost tracking without changing any code — just add an exporter. Leverages standardized `gen_ai.*` span attributes.
**Effort:** Low-Medium — new `@nullspend/otel-exporter` package, maps OTel span attributes to `CostEventInput`, uses existing `reportCostBatch()`.
**When:** 12-month horizon. Nice-to-have, not a differentiator.

### 4. `fetch`-Parameter Wrappers for Native SDKs
**Who does it well:** Langfuse (drop-in import replacement), Helicone (baseURL redirect)
**What we currently do:** `@nullspend/claude-agent` does proxy redirect (sets `ANTHROPIC_BASE_URL`). No `fetch` wrapper approach.
**Why upgrading matters:** The `fetch` wrapper pattern gives users SDK-mode (zero proxy latency) while still reporting costs. Both OpenAI and Anthropic Node SDKs accept a custom `fetch` parameter.
**Effort:** Low — thin wrappers that intercept response, extract usage, call `queueCost()`.
**When:** 6-month horizon. Ship alongside Vercel AI SDK middleware.

### 5. `pg` → `postgres.js` Migration (Refactor 2 from latency optimization doc)
**Who does it well:** Dashboard already uses `postgres.js` via Drizzle
**What we currently do:** Proxy uses `pg` (node-postgres) `Client` with manual connection lifecycle + `db-semaphore.ts` concurrency limiter across 6 source files.
**Why upgrading matters:** Eliminates ~300 lines of boilerplate, removes `db-semaphore.ts` entirely (postgres.js `max` setting handles it), unifies the entire codebase on one Postgres library.
**Effort:** ~2 days. Well-scoped in `proxy-latency-optimization.md` Refactors 2A-2C.
**When:** Now. This is the next concrete implementation step after the current Phase 1 changes are committed.

---

## Revised Recommendation

The research is strategically excellent — the market analysis, competitive landscape, and product direction are all strong. The main correction needed is grounding against what already exists.

### Immediate (this week)
1. **Commit and deploy the current Phase 1 changes.** Redis removal, Smart Placement, parallelization, Server-Timing are all in uncommitted changes. Ship them, run `bench.ts`, capture real latency numbers.
2. **Regenerate `worker-configuration.d.ts`** via `wrangler types` to clean up stale Upstash env vars.
3. **Update the benchmark table** in the research doc with real post-optimization numbers.

### Next sprint (Refactor 2)
4. **`pg` → `postgres.js` migration** per `proxy-latency-optimization.md` Refactors 2A-2C. Delete `db-semaphore.ts`. This is concrete, well-scoped, and reduces ~300 lines.

### 6-month horizon (strategic features)
5. **Extend `@nullspend/mcp-server`** with budget-as-a-tool: `check_budget`, `reserve`, `commit`, `release`, `session_summary`, `suggest_model`. Build on existing MCP infrastructure.
6. **Extend `@nullspend/mcp-proxy`** BudgetClient with reservation semantics (reserve → commit/release).
7. **Add Vercel AI SDK middleware** to `@nullspend/sdk` — `wrapLanguageModel` using `cost-engine` + `queueCost()`.
8. **Add `fetch` wrappers** for OpenAI/Anthropic SDKs to `@nullspend/sdk`.
9. **Per-key enforcement mode** — extend `api_keys` schema or budget policy to support `strict`/`track`/`optimistic`.

### 12-month horizon (competitive positioning)
10. **Multi-agent budget hierarchy** — parent/child entity relationships, rollup logic, delegation.
11. **OTel GenAI exporter** — `@nullspend/otel-exporter` package.
12. **JWT/PASETO signed API keys** — eliminate auth DB lookup entirely.
13. **Guardian agent features** — anomaly detection, waste identification, cost-per-outcome tracking.

### What NOT to build
- **Cross-provider smart routing** — conflicts with "Ramp for AI spend" positioning. We're the spend controls, not the routing rails. Let Portkey/LiteLLM commoditize routing.
- **Self-hosted Rust gateway** — only if enterprise demand materializes. CF Workers + DO is the right architecture for SaaS.
- **Separate `@nullspend/openai` and `@nullspend/anthropic` packages** — keep provider wrappers as exports from `@nullspend/sdk`.

---

## Updated File List

### Already changed (uncommitted on main — commit these)
| File | Status | Change |
|---|---|---|
| `apps/proxy/src/index.ts` | Modified | Native rate limiting, parallelized auth, step timing |
| `apps/proxy/src/lib/api-key-auth.ts` | Modified | 120s TTL with jitter |
| `apps/proxy/src/lib/context.ts` | Modified | Redis field removed, stepTiming added |
| `apps/proxy/src/lib/headers.ts` | Modified | StepTiming interface, Server-Timing with descriptions |
| `apps/proxy/src/routes/anthropic.ts` | Modified | Redis references removed |
| `apps/proxy/src/routes/mcp.ts` | Modified | Redis references removed |
| `apps/proxy/src/routes/openai.ts` | Modified | Redis references removed |

### Next: Refactor 2 (pg → postgres.js)
| File | Change |
|---|---|
| `apps/proxy/src/lib/db.ts` | **NEW** — module-level postgres.js instance |
| `apps/proxy/src/lib/db-semaphore.ts` | **DELETE** |
| `apps/proxy/src/__tests__/db-semaphore.test.ts` | **DELETE** |
| `apps/proxy/src/lib/api-key-auth.ts` | Replace pg Client with getSql() |
| `apps/proxy/src/lib/budget-do-lookup.ts` | Replace pg Client with getSql() |
| `apps/proxy/src/lib/budget-spend.ts` | Replace pg Client with getSql() |
| `apps/proxy/src/lib/cost-logger.ts` | Replace pg Client with getSql() |
| `apps/proxy/src/lib/webhook-cache.ts` | Replace pg Client with getSql() |
| `apps/proxy/src/lib/webhook-expiry.ts` | Replace pg Client with getSql() |
| `apps/proxy/package.json` | Remove `pg`, add `postgres` |
| 9 test files | Update mocks from pg to postgres.js |

### Future: Budget-as-a-Tool MCP
| File | Change |
|---|---|
| `packages/mcp-server/src/tools.ts` | Add budget query/reserve/commit/release tools |
| `packages/mcp-server/src/config.ts` | Add budget-related config options |
| `packages/mcp-proxy/src/cost-tracker.ts` | Add reservation lifecycle to BudgetClient |

### Future: SDK Provider Wrappers
| File | Change |
|---|---|
| `packages/sdk/src/middleware/` | **NEW** — Vercel AI SDK `wrapLanguageModel` middleware |
| `packages/sdk/src/fetch/` | **NEW** — `withNullSpendFetch` for OpenAI/Anthropic SDKs |

---

## Updated Effort Estimate

| Item | Research Estimate | Revised Estimate | Reason |
|---|---|---|---|
| Phase 1 proxy optimization | "Build now" | **Already done** (commit + deploy) | Uncommitted changes on main |
| Refactor 2 (pg → postgres.js) | Not in this research | ~2 days | Per latency optimization doc |
| MCP budget-as-a-tool | "Build now" (implied net-new) | ~3-4 days | Incremental on existing packages |
| Vercel AI SDK middleware | 6-month horizon | ~1 week | New code but reuses cost-engine + sdk |
| Fetch wrappers | 6-month horizon | ~2-3 days | Thin wrappers on existing sdk |
| Per-key enforcement modes | 6-month horizon | ~3-4 days | Schema change + proxy logic + dashboard UI |
| Multi-agent budget hierarchy | 12-month horizon | ~2-3 weeks | Schema redesign, rollup logic, DO changes |
| OTel exporter | 12-month horizon | ~1 week | New package, maps spans to existing types |
| JWT signed keys | 12-month horizon | ~2 weeks | New key format, migration, revocation |

**Total near-term work:** Commit Phase 1 (done) + Refactor 2 (~2 days) + MCP budget tools (~3-4 days) = **~1 week of concrete implementation** before moving to 6-month horizon items.
