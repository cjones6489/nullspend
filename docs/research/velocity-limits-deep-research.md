# Deep Technical Research: Loop/Runaway Detection (Velocity Limits)

**Date:** 2026-03-20
**Priority:** P1 | **Estimated effort:** ~3-4h
**Source:** [Architecture Review](architecture-review-2026-03-20.md) — Priority 1, Frontier section 5.2
**Research method:** 3-agent parallel research (Documentation + Competitive, Architecture + DX, Frontier + Risk)

---

## Topic

**Loop/runaway detection via velocity limits** — detecting when an AI agent is spending too fast and enforcing rate-of-spend limits to prevent cost runaway before the budget is exhausted.

**Why it matters:** The #1 unaddressed enterprise pain point. Fortune 500 collectively leaked $400M in uncontrolled AI costs in 2025. A single recursive agent loop can cost $100K+. Multi-agent systems show quadratic token growth. NullSpend's current budget enforcement stops agents when budgets are *exhausted* but cannot detect *abnormal spending velocity* — an agent burning $50/minute when the expected rate is $5/minute sails through until the $500 budget is gone.

---

## Executive Summary

**Recommended approach:** Append-only velocity log table in the DO's SQLite, checked as Phase 0 of the existing `checkAndReserve` method, with circuit-breaker enforcement and webhook alerting.

**Key architectural decisions:**
1. **Velocity log, not reservations** — the existing reservations table is unsuitable (entries deleted on reconcile, misses fast-completing loops)
2. **SQLite storage, not in-memory** — DO eviction after ~30s of inactivity would reset in-memory velocity state, creating an exploitable gap
3. **Circuit breaker enforcement** — on velocity violation, deny all requests for a configurable cooldown period, then automatically recover
4. **Per-entity checking** (user + api_key) — consistent with budget enforcement, prevents key-rotation evasion
5. **Cost-based velocity, not request-count** — an agent making many cheap calls is fine; an agent burning $50/minute is not

**Competitive whitespace:** No competitor offers real-time velocity-based loop detection at the proxy layer. AgentBudget has client-side circuit breaking. Agent frameworks (Claude SDK, OpenAI Agents SDK, AutoGen) count turns, not dollars-per-second. Card payment platforms (Stripe Issuing, Marqeta) have mature velocity control patterns that map directly to this problem.

**Biggest risks:** False positives from legitimate multi-agent orchestration bursts (mitigated by burst allowance in the velocity window) and DO eviction losing velocity state (mitigated by SQLite persistence).

---

## Research Method

Three specialized agents worked in parallel:

1. **Documentation + Competitive Agent** — Researched Cloudflare DO storage constraints, SQLite performance in DOs, sliding window patterns, and competitive implementations from AgentBudget, TrueFoundry, Stripe Issuing, Marqeta, and circuit breaker patterns
2. **Architecture + DX Agent** — Evaluated 5 architectural options for velocity detection inside the DO, analyzed configuration models, enforcement mechanisms, recovery patterns, and developer experience implications
3. **Frontier + Risk Agent** — Searched for YC companies, academic research (AGENTSAFE, AIR), novel anomaly detection approaches, agent framework safety mechanisms, card industry velocity patterns, and analyzed 10 specific failure modes with mitigations

---

## Official Documentation Findings

### Cloudflare Durable Objects — Storage and Execution Model

- **SQLite storage persists across evictions.** In-memory JavaScript class fields do NOT survive eviction. Velocity state must be in SQLite.
- **DO eviction occurs after "a short period" of inactivity** — empirically ~10-30 seconds. An attacker could exploit in-memory-only velocity state by pausing requests.
- **Storage limit:** 10 GB per DO (SQLite). Velocity log storage is trivial (~576KB steady-state for a 1-hour window at 10 req/s).
- **`transactionSync()`** provides atomicity within a request. Velocity check + budget check + reservation can all happen in one atomic block.
- **Sequential request processing** — DOs process requests one at a time. No race conditions between concurrent velocity checks. Request #100 correctly sees 99 prior requests.
- **`Date.now()` returns time of last I/O, not real-time.** Within `transactionSync()`, the clock is frozen. However, each incoming request is an I/O event that unfreezes the clock, so timestamps between requests are accurate. This is adequate for velocity detection.
- **Alarm API** — already used for reservation expiry cleanup. Can be extended for velocity log cleanup with minimal additional complexity.

### PostgreSQL — Configuration Storage

- Velocity config columns (`velocity_limit_microdollars`, `velocity_window_seconds`) flow to the DO via the existing `populateIfEmpty` RPC, the same path as budget config. No new Postgres queries on the hot path.

---

## Modern Platform and Ecosystem Patterns

### Competitive Landscape: No One Does This at the Proxy Layer

| Platform | Loop/Velocity Detection | Layer | Gap |
|---|---|---|---|
| **AgentBudget** | Circuit breaker for repeated API calls | Client SDK (Python) | In-process only, no multi-session awareness |
| **TrueFoundry** | Velocity monitoring + stop-loss | Agent Gateway | Enterprise, not publicly documented |
| **Helicone** | None | Observability only | Observe, don't enforce |
| **Respan** | None | Observability only | Quality evals, not cost enforcement |
| **Portkey** | Rate limiting (enterprise) | API Gateway | Budget limits, not velocity detection |
| **LiteLLM** | Rate limiting, cooldowns | Python proxy | Request-count limits, not cost-rate |
| **Vercel AI Gateway** | Credit balance tracking | API Gateway | No velocity controls |
| **Langfuse** | None | Observability only | Post-hoc analysis |

**Key insight:** This is genuine whitespace. No competitor offers cost-velocity detection at the proxy layer with real-time enforcement.

### Agent Framework Safety Mechanisms — All Count Turns, Not Dollars

| Framework | Safety Control | What It Misses |
|---|---|---|
| **Claude Agent SDK** | `allowedTools`, hooks (`PreToolUse`, `PostToolUse`) | No `max_budget_usd`, no turn limits, no cost tracking |
| **OpenAI Agents SDK** | `max_turns`, `RunHooks` | No token budget or cost tracking |
| **AutoGen/AG2** | `TokenUsageTermination`, `MaxMessageTermination`, `TimeoutTermination` | Self-reported token counts, per-session only |
| **LangChain/LangGraph** | `recursion_limit` (default 25) | Structural loops, not cost-intensive loops |

**Synthesis:** Frameworks prevent infinite loops but not cost runaway within allowed turns. An agent making 10 turns of expensive reasoning model calls (legitimate turn count, $50 cost) is invisible to framework controls.

### Card Payments Industry — Mature Velocity Patterns

**Stripe Issuing:**
- Spending limits as `{amount, interval, categories}` arrays
- Intervals: `per_authorization`, `daily`, `weekly`, `monthly`
- Fixed windows (midnight UTC reset), not sliding
- "Most restrictive spending control applies" when overlapping
- "Best-effort" with potential 30-second aggregation delay

**Marqeta:**
- Separate velocity control resource with dimensions: `amount_limit` + `usage_limit` + `velocity_window`
- Tracks BOTH dollar amount AND transaction count per window
- Controls attach to card products, card groups, or individual cards
- Active/inactive toggle without deletion

**Lessons for NullSpend:**
1. **Track cost rate, not just request count** — a loop of cheap calls vs. expensive calls look different
2. **Fixed windows are simpler than sliding** — Stripe resets at interval boundaries, easier to reason about
3. **"Most restrictive wins"** when multiple controls overlap — consistent with NullSpend's existing budget enforcement
4. **Defaults matter** — Stripe's default limits for new cards are a safety net even before user configuration

---

## Relevant Repos, Libraries, and Technical References

### Agent Loop Detection
- **AgentBudget** (agentbudget.dev) — Python SDK with circuit breaker pattern for loop detection. Supports 60+ models. Most comparable feature to what we'd build, but client-side only.
- **AGENTSAFE** (arXiv 2512.03180, Dec 2025) — Academic framework for agent safety with "semantic telemetry, dynamic authorization, anomaly detection, and interruptibility mechanisms." The anomaly detection maps to velocity limits.
- **AIR** (arXiv 2602.11749, Feb 2026) — First incident response framework for LLM agents. Post-hoc detection that could inform what velocity patterns to watch for.

### Rate Limiting Patterns
- Stripe Issuing spending controls API — mature velocity control model with multi-interval limits
- Marqeta velocity controls — separate resource type with amount + count tracking
- Cloudflare rate limiting product — fixed-window counters at edge, millions of requests/second

### Circuit Breaker Patterns
- Netflix Hystrix (archived) / Resilience4j — classic circuit breaker: closed → open → half-open states
- The circuit breaker pattern maps naturally to velocity enforcement: normal → tripped → cooldown → normal

---

## Architecture Options

### Option A: Rolling Window from Reservations Table
`SELECT SUM(amount) FROM reservations WHERE created_at > (now - window_ms)`

| Dimension | Assessment |
|---|---|
| **Accuracy** | 3/10 — Fatal flaw: reservations are deleted on reconcile. Fast-completing loops leave no trace. |
| **Latency** | Negligible — single SQLite query |
| **Storage** | Zero additional |
| **Cold start** | Fine — SQLite persists |
| **Complexity** | Very low |

**Verdict: Rejected.** Reservations measure concurrency, not velocity. A tight loop where each call completes in 2 seconds would show near-zero reservations at any instant.

### Option B: Append-Only Velocity Log Table (RECOMMENDED)
New `velocity_log (entity_type, entity_id, amount, ts)` table. Append on every `checkAndReserve`, query rolling sum, clean up via alarm.

| Dimension | Assessment |
|---|---|
| **Accuracy** | 9/10 — Independent of reservation lifecycle. Every request leaves a durable trace. |
| **Latency** | ~0.01ms — One INSERT + one SELECT SUM inside existing transactionSync |
| **Storage** | Bounded — ~576KB steady-state for 1-hour window at 10 req/s. Alarm cleanup keeps it bounded. |
| **Cold start** | Excellent — SQLite persists across eviction. Full velocity history available immediately. |
| **Complexity** | Low-medium — ~40-60 lines of production code |

**Verdict: Strongly recommended.** Best accuracy, minimal latency cost, bounded storage, durable across evictions, simple implementation.

### Option C: In-Memory Sliding Window (Circular Buffer)
Array of `{amount, ts}` tuples in DO instance memory. No SQLite writes.

| Dimension | Assessment |
|---|---|
| **Accuracy** | 5/10 — Perfect while warm, complete amnesia on eviction (~30s inactivity). |
| **Latency** | Negligible (~0.001ms) |
| **Storage** | Zero persistent |
| **Cold start** | Complete data loss — exploitable by spacing requests beyond eviction threshold |
| **Complexity** | Low |

**Verdict: Rejected.** Eviction amnesia makes this exploitable. An attacker pauses 30 seconds to permanently reset velocity tracking.

### Option D: Fixed-Window Counters in DO SQLite
`velocity_windows (window_key TEXT PK, total INTEGER, count INTEGER)` with minute-epoch keys.

| Dimension | Assessment |
|---|---|
| **Accuracy** | 6/10 — Fixed-window boundary problem: burst straddling two windows sees only half the velocity. |
| **Latency** | ~0.01ms — Single UPSERT + SELECT |
| **Storage** | Minimal and bounded |
| **Cold start** | Good — SQLite persists |
| **Complexity** | Low |

**Verdict: Viable but inferior to Option B.** The boundary problem is the deal-breaker for a safety feature. A runaway burst at a window edge would be detected late or not at all.

### Option E: Hybrid In-Memory + SQLite Checkpoint
Track in memory, periodically flush to SQLite. Restore on cold start.

| Dimension | Assessment |
|---|---|
| **Accuracy** | 7-9/10 — Depends on checkpoint interval tuning |
| **Latency** | Mixed — hot path is memory-only but checkpoint creates periodic I/O |
| **Storage** | Moderate |
| **Cold start** | Good (with checkpoint lag) |
| **Complexity** | Medium-high — checkpoint scheduling, partial restore, race conditions |

**Verdict: Over-engineered.** Option B's latency cost (~0.01ms) is already negligible. The hybrid saves ~0.005ms at the cost of significant complexity.

---

## Recommended Approach for NullSpend

### Architecture: Append-Only Velocity Log (Option B) with Circuit Breaker Enforcement

**Why this is best for NullSpend specifically:**
1. The DO already processes budget checks in `transactionSync()`. Adding a velocity log append + sum query inside the same transaction adds ~0.01ms latency — invisible on the hot path.
2. SQLite persistence solves the DO eviction problem for free.
3. The append-only log naturally supports multi-window queries (just change the `WHERE ts > ?` threshold) for future per-minute + per-hour velocity.
4. Circuit breaker enforcement (deny for cooldown, then auto-recover) matches the agent autonomy model — agents shouldn't require human intervention to resume.

### Implementation in `checkAndReserve`

The velocity check integrates as **Phase 0** (before budget check):

```
transactionSync(() => {
  // Phase 0: Velocity check (NEW)
  for each budget entity with velocity_limit:
    INSERT INTO velocity_log (entity_type, entity_id, amount, ts) VALUES (?, ?, estimate, now)
    SELECT SUM(amount) FROM velocity_log WHERE entity_type=? AND entity_id=? AND ts > (now - window)
    if sum > velocity_limit:
      set velocity_tripped_at on budget row
      return denied(velocity_exceeded)

  // Phase 0.5: Circuit breaker check (NEW)
  for each budget entity with velocity_tripped_at:
    if velocity_tripped_at + cooldown > now:
      return denied(velocity_exceeded, retry_after)
    else:
      clear velocity_tripped_at  // cooldown expired

  // Phase 1: Query budgets (EXISTING)
  // Phase 1.5: Period resets (EXISTING)
  // Phase 2: Budget check (EXISTING)
  // Phase 3: Reserve (EXISTING)
})
```

Denied-by-velocity requests never create reservations (no cleanup needed).

### Configuration Model

**Per-budget, opt-in.** Two new columns on `budgets` table:

```sql
ALTER TABLE budgets ADD COLUMN velocity_limit_microdollars BIGINT;
ALTER TABLE budgets ADD COLUMN velocity_window_seconds INTEGER DEFAULT 60;
```

Both nullable. `NULL` = no velocity enforcement. Flows to DO via existing `populateIfEmpty` RPC (add two parameters).

**Zod validation:**
```typescript
velocityLimitMicrodollars: z.number().int().positive().optional(),
velocityWindowSeconds: z.number().int().min(10).max(3600).default(60).optional(),
```

### DO SQLite Schema Changes

```sql
-- In initSchema(), tagged as v2:
CREATE TABLE IF NOT EXISTS velocity_log (
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_velocity_log_lookup
  ON velocity_log (entity_type, entity_id, ts);

-- Add columns to budgets table:
ALTER TABLE budgets ADD COLUMN velocity_limit INTEGER;
ALTER TABLE budgets ADD COLUMN velocity_window INTEGER DEFAULT 60000;
ALTER TABLE budgets ADD COLUMN velocity_tripped_at INTEGER;
```

### Enforcement: Circuit Breaker

1. **Velocity exceeded** → set `velocity_tripped_at = now` on the budget row
2. **During cooldown** (`velocity_tripped_at + cooldown > now`) → deny all requests with `velocity_exceeded` (cheap timestamp comparison, no velocity_log query)
3. **After cooldown** → clear `velocity_tripped_at`, resume normal velocity checking
4. **If velocity re-exceeded** → re-trip circuit breaker

### Error Response

```json
HTTP 429
Retry-After: 45

{
  "error": {
    "code": "velocity_exceeded",
    "message": "Request blocked: spending rate exceeds velocity limit. Retry after cooldown.",
    "details": {
      "velocity_limit_microdollars": 5000000,
      "velocity_window_seconds": 60,
      "velocity_current_microdollars": 5200000,
      "cooldown_remaining_seconds": 45,
      "entity_type": "user",
      "entity_id": "u1"
    }
  }
}
```

### Webhook Events

- `velocity.exceeded` — first detection, with 5-minute dedup cooldown
- `velocity.recovered` — lazily emitted on first successful request after cooldown

### Budget Status API Extension

```json
{
  "entities": [{
    "velocityLimit": {
      "limitMicrodollars": 5000000,
      "windowSeconds": 60,
      "currentMicrodollars": 2300000,
      "tripped": false,
      "cooldownExpiresAt": null
    }
  }]
}
```

---

## Frontier and Emerging Patterns

### AgentBudget — Client-Side Circuit Breaker (Production-Proven)
- **Who:** AgentBudget (YC-backed), agentbudget.dev
- **What:** Python SDK with three-layer protection: hard limit, soft limit callback, circuit breaker for repeated API calls
- **Why it matters:** Most comparable feature to NullSpend's velocity limits, but operates at a fundamentally different layer (client vs. proxy). NullSpend's proxy position enables detection across all agents without SDK adoption.
- **Maturity:** Production-proven (open-source, 60+ models)
- **Action:** Watch — learn from their circuit breaker design patterns

### AGENTSAFE — Academic Anomaly Detection Framework (Experimental)
- **Who:** Researchers, arXiv 2512.03180, Dec 2025
- **What:** "Semantic telemetry, dynamic authorization, anomaly detection, and interruptibility mechanisms" for agentic systems
- **Why it matters:** The anomaly detection and interruptibility concepts map directly to velocity limits
- **Maturity:** Experimental (academic paper)
- **Action:** Watch — the semantic telemetry concepts could inform a v2 multi-signal approach

### Stripe Issuing Velocity Controls (Production-Proven)
- **Who:** Stripe, shipped in production for years
- **What:** Multi-interval spending limits with "most restrictive wins" cascade
- **Why it matters:** Direct architectural precedent. NullSpend's budget entities map to card spending controls.
- **Maturity:** Production-proven at massive scale
- **Action:** Adopt patterns now — fixed windows, multi-interval, most-restrictive-wins

### Card Industry Dual-Dimension Tracking (Production-Proven)
- **Who:** Marqeta, Stripe, Lithic
- **What:** Track both dollar amount AND transaction count per window
- **Why it matters:** Catches both cheap-loop (many requests, low cost) and expensive-loop (few requests, high cost) patterns
- **Maturity:** Production-proven
- **Action:** Design for now (v1 tracks cost only, v2 adds count dimension)

### Agent Framework Gap — No Cost-Rate Controls (Universal Gap)
- **Who:** All major frameworks (Claude SDK, OpenAI, AutoGen, LangChain)
- **What:** Frameworks count turns/tokens, not dollars-per-second
- **Why it matters:** Validates NullSpend's positioning — proxy-layer cost-velocity detection fills a gap that no framework addresses
- **Maturity:** N/A (absence, not a pattern)
- **Action:** Leverage in positioning — "your framework prevents infinite loops, NullSpend prevents infinite costs"

---

## Opportunities to Build Something Better

1. **Proxy-layer velocity detection is unclaimed territory.** No competitor does this. AgentBudget is client-side. Helicone/Respan/Langfuse are observe-only. NullSpend would be first to market with real-time cost-velocity enforcement at the proxy layer.

2. **Cost-based velocity, not request-count.** Most rate limiters count requests. NullSpend can count dollars-per-second because the cost engine provides exact pricing for every request. This is fundamentally more useful — 100 cheap requests are fine, 3 expensive ones might not be.

3. **Circuit breaker with automatic recovery** is better DX than manual reset. Agents operate autonomously; requiring a human to reset a velocity block defeats the purpose. The cooldown period (configurable, default 60s) lets the velocity window age out naturally.

4. **Unified enforcement surface.** Users configure velocity limits in the same budget CRUD API they already use. No separate "velocity rules" resource. One entity, one set of controls: budget limit + velocity limit + policy + thresholds.

---

## Risks, Gaps, and Edge Cases

### P0 — Must Address in v1

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **False positives from multi-agent orchestration** | HIGH | HIGH | Burst allowance: the velocity log measures cost/window, not instantaneous rate. A burst of 10 concurrent requests totaling $2 won't trip a $5/minute limit. |
| **DO eviction losing velocity state** | HIGH | HIGH | Store velocity log in SQLite (durable). Do NOT use in-memory state for velocity tracking. |
| **Key rotation evasion** | LOW | HIGH | User-level velocity check catches all keys. The DO is keyed by userId — all keys share the same DO. |

### P1 — Address in v1 or Soon After

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Slow-burn loops** (under per-minute velocity) | MEDIUM | MEDIUM | Existing budget limits are the backstop. v2 adds per-hour velocity window for sustained over-spend detection. |
| **Webhook storm** from velocity alerts | MEDIUM | LOW | 5-minute dedup cooldown on `velocity.exceeded` webhook. |
| **Configuration errors** (velocity set too low) | MEDIUM | LOW | Dashboard UX should show recent request rate when configuring. Consider `velocity_policy: "warn"` mode (v2). |

### P2 — Monitor / Defer

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Clock skew on DO migration** | LOW | LOW | Defensive programming: treat negative elapsed time as window reset. |
| **Velocity log storage growth** | LOW | LOW | Alarm-based cleanup (delete entries older than max retention). Steady-state is bounded. |

### Hidden Complexity

1. **`populateIfEmpty` RPC signature change** — Adding velocity config params changes the RPC signature. Rolling deploy safety: old Workers send 7 args (new params default), new Workers send 9 args to old DOs (extra args ignored by JS). Same pattern as thresholdPercentages.

2. **DO SQLite migration** — Adding tables/columns to existing DO SQLite. Handled by `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE ... ADD COLUMN` (which are no-ops if already applied). The `_schema_version` table tracks migration state.

3. **Velocity check before or after period reset?** — After. If a budget period just reset (spend → 0), the velocity log should also reset. Otherwise, pre-reset spend appears as velocity in the new period. Simplest: the velocity log is independent of periods (always measures raw rate), and the period reset doesn't affect it.

---

## Recommended Technical Direction

### What to Do Now (v1)

1. **Postgres migration:** Add `velocity_limit_microdollars` (nullable) and `velocity_window_seconds` (default 60) to `budgets` table
2. **Schema + validation:** Add velocity fields to `createBudgetInputSchema`, `budgetResponseSchema`, `budgetEntitySchema`
3. **DO SQLite:** Add `velocity_log` table + index, add `velocity_limit`, `velocity_window`, `velocity_tripped_at` columns to DO `budgets` table
4. **DO `checkAndReserve`:** Add Phase 0 velocity check (log append + sum query + circuit breaker)
5. **DO `populateIfEmpty`:** Accept velocity config parameters
6. **DO `alarm`:** Add velocity_log cleanup (delete entries older than 2x max window)
7. **Proxy route handlers:** Handle `velocity_exceeded` denial — return 429 with `Retry-After`
8. **Webhook:** Add `velocity.exceeded` event type with 5-minute dedup
9. **Budget status API:** Include velocity state in response
10. **Tests:** DO velocity unit tests, route handler tests, validation tests, webhook tests

### What to Defer

- **Multi-window velocity** (per-minute + per-hour) — v2
- **Request count limits** (in addition to cost limits) — v2
- **Adaptive/anomaly velocity** (EMA, Z-score) — v3 or never
- **Request body hashing** for loop fingerprinting — v2
- **Dashboard UX** for velocity configuration — v1.1 (API-first)
- **`velocity_policy: "warn"` mode** — v2

### What to Avoid

- **In-memory velocity state** — exploitable via DO eviction
- **Sliding window algorithms** — more complex than fixed/append-log, marginal accuracy gain
- **Throttle/delay enforcement** — Workers have 30s CPU limit; holding requests causes timeouts
- **HITL escalation for velocity** — flooding the approval queue defeats the purpose
- **Adaptive baselines for v1** — cold start problem, complexity, unpredictable behavior
- **Separate velocity configuration resource** — keep it on the budget entity

---

## Open Questions

1. **Should there be a default velocity limit for all budgets?** A platform-wide default (e.g., $100/minute) would protect users who haven't configured velocity limits. Pro: safety net. Con: could block legitimate high-volume users. Recommendation: defer to v1.1, add as a Worker env var `DEFAULT_VELOCITY_LIMIT_MICRODOLLARS`.

2. **Should velocity limits be independent of policy?** The plan recommends velocity always hard-denies regardless of `policy` field. But should a `warn`-policy budget be allowed to have a warn-only velocity limit? Recommendation: v1 always enforces. v2 adds `velocity_policy` field.

3. **How should velocity interact with `soft_block` policy?** When velocity is exceeded on a `soft_block` budget, should it deny (velocity wins) or warn (policy wins)? Recommendation: velocity always wins — it's a safety mechanism, not a budget control.

4. **Should the velocity log include reconciled cost (actual) or estimated cost?** The log is appended during `checkAndReserve` which only has the estimate. The actual cost comes later during reconciliation. Recommendation: use estimate. It's available on the hot path and is close enough for velocity detection. Exact cost accuracy doesn't matter for rate detection.

5. **What cooldown duration should be the default?** 60 seconds matches the default velocity window and is long enough for a human to receive a webhook alert. But should cooldown be separately configurable? Recommendation: default 60s, separately configurable in v1.1.

---

## Sources and References

### Official Documentation
- [Cloudflare Durable Objects — SQLite Storage](https://developers.cloudflare.com/durable-objects/api/storage-api/) — storage persistence, limits, transactionSync
- [Cloudflare Durable Objects — Alarms](https://developers.cloudflare.com/durable-objects/api/alarms/) — alarm scheduling for cleanup
- [Cloudflare Workers — Security Model](https://developers.cloudflare.com/workers/reference/security-model/) — `Date.now()` returns time of last I/O
- [Cloudflare Workers — Limits](https://developers.cloudflare.com/workers/platform/limits/) — CPU time, subrequest limits
- [PostgreSQL Window Functions](https://www.postgresql.org/docs/current/functions-window.html) — sliding window queries

### Platform and Product References
- [Stripe Issuing — Spending Controls](https://docs.stripe.com/issuing/controls/spending-controls) — velocity limit model, multi-interval, "most restrictive wins"
- [Marqeta — JIT Funding](https://www.marqeta.com/platform/jit-funding) — velocity controls, amount + count dimensions
- [Stripe Issuing — Authorization Controls](https://docs.stripe.com/issuing/controls/real-time-authorizations) — 2-second authorization deadline
- [TrueFoundry Agent Gateway FinOps](https://www.truefoundry.com/blog/agent-gateway-series-part-4-of-7-finops-for-autonomous-systems) — velocity monitoring, stop-loss
- [AgentBudget](https://agentbudget.dev) — client-side circuit breaker for loop detection

### Agent Framework References
- [Claude Agent SDK — Hooks](https://docs.anthropic.com/en/docs/agents/hooks) — PreToolUse, PostToolUse lifecycle
- [OpenAI Agents SDK — max_turns](https://openai.github.io/openai-agents-python/usage/) — turn limits, RunHooks
- [AutoGen Termination Conditions](https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/tutorial/termination.html) — TokenUsageTermination, composable conditions
- [Anthropic — Building Effective Agents](https://www.anthropic.com/engineering/building-effective-agents) — safety recommendations (no velocity controls discussed)

### Academic Research
- [AGENTSAFE: Unified Framework for Ethical Assurance](https://arxiv.org/abs/2512.03180) (Dec 2025) — anomaly detection, interruptibility
- [AIR: Improving Agent Safety through Incident Response](https://arxiv.org/abs/2602.11749) (Feb 2026) — incident detection framework
- [Reflection-Driven Control for Trustworthy Code Agents](https://arxiv.org/abs/2512.21354) (Dec 2025) — self-monitoring
- [STRATUS: Multi-agent System for Autonomous Reliability Engineering](https://arxiv.org/abs/2506.02009) (Jun 2025) — transactional safety invariants

### Industry Research
- [$400M Cloud Leak: AI FinOps 2026](https://analyticsweek.com/finops-for-agentic-ai-cloud-cost-2026/) — enterprise cost overrun data
- [Microsoft: 80% Fortune 500 Use AI Agents](https://www.microsoft.com/en-us/security/blog/2026/02/10/80-of-fortune-500-use-active-ai-agents-observability-governance-and-security-shape-the-new-frontier/)

### Internal Codebase References
- `apps/proxy/src/durable-objects/user-budget.ts` — DO with SQLite budget enforcement, `checkAndReserve`, `reconcile`, `alarm`
- `apps/proxy/src/lib/budget-orchestrator.ts` — request lifecycle: estimate → reserve → forward → reconcile
- `apps/proxy/src/lib/budget-do-lookup.ts` — `DOBudgetEntity` interface, Postgres budget lookup for DO seeding
- `apps/proxy/src/lib/budget-do-client.ts` — DO RPC client (`doBudgetCheck`, `doBudgetReconcile`)
- `apps/proxy/src/lib/webhook-thresholds.ts` — hardcoded `THRESHOLDS = [50, 80, 90, 95]`, `detectThresholdCrossings`
- `apps/proxy/src/lib/webhook-events.ts` — webhook payload builders
- `packages/db/src/schema.ts` — `budgets` table definition, `BudgetRow` type
- `lib/validations/budgets.ts` — `createBudgetInputSchema`, `budgetResponseSchema`, `budgetEntitySchema`
- `app/api/budgets/route.ts` — budget CRUD API
- `app/api/budgets/status/route.ts` — budget status API (API key authenticated)
