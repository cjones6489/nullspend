# Deep Technical Research Document

## Topic

**Session-Level Budget Aggregation for NullSpend**

Current budget enforcement is per-request: `checkAndReserve()` checks whether a single request's estimated cost fits within the remaining budget. An agent making 1,000 requests at $0.01 each can blow past a $5 budget because no individual request exceeds the limit. Session-level budget aggregation tracks cumulative spend per logical session and enforces a per-session cap, closing this fundamental gap in the enforcement model.

This is the last remaining P1 item on the roadmap. NullSpend already carries `sessionId` through the entire pipeline (header → context → cost events → Postgres index) but never uses it for enforcement.

## Executive Summary

**Recommended approach:** Add a `session_spend` table to the existing UserBudgetDO SQLite database (v4 migration) with a `sessionLimitMicrodollars` column on the `budgets` table. Session limits are opt-in, configured per budget entity, and enforced atomically inside the existing `checkAndReserve()` transaction. No new infrastructure (Redis, external queues) is needed.

**Key architectural decisions:**
1. Session limit is a property of the budget entity (like velocity limits), not a separate entity
2. Sessions are defined by the client via `X-NullSpend-Session-Id` header — no server-side lifecycle management
3. Enforcement uses estimated cost (not actual), with correction during `reconcile()`
4. Session spend cleanup piggybacks on the existing alarm handler
5. Session limits are independent of budget period resets (a session spans calendar boundaries)
6. Session limits always enforce `strict_block` regardless of budget policy

**Biggest risks:** (1) Alarm contention — single alarm must now handle both reservation expiry and session cleanup. (2) Storage growth — agents using per-request UUIDs as session IDs create unbounded rows. (3) Session spend inflation — if only estimated cost is tracked without reconciliation correction, session spend becomes unreliable.

**Competitive position:** LiteLLM is the only competitor with per-session budget enforcement (`max_budget_per_session`), but their implementation has known enforcement bypass bugs due to non-atomic check-then-increment. NullSpend's `transactionSync()` eliminates this class of bug. No other platform (Portkey, Helicone, OpenRouter, Cloudflare AI Gateway, Kong) offers session-level enforcement.

## Research Method

Seven specialized agents conducted parallel research:

1. **Documentation Research** — Cloudflare DO SQLite API, alarm constraints, storage limits, concurrency model
2. **Competitive/Platform Patterns** — LiteLLM, Portkey, Helicone, Langfuse, OpenRouter, Stripe Issuing, Marqeta velocity controls, AWS/GCP budget patterns
3. **Open Source/Repo Research** — AgentBudget, Helicone sessions, Langfuse traces, durable-utils migrations, Pecorino leaky bucket, BudgetGuard, LiteLLM source code
4. **Architecture** — Four design options (DO SQLite table, virtual budget entities, in-memory accumulation, Redis) with full tradeoff analysis
5. **DX/Product Experience** — Mental model, configuration UX, SDK changes, error responses, naming conventions
6. **Frontier/Emerging Patterns** — TrueFoundry micro-budgets, Agent Contracts paper, Stripe ACP, x402 protocol, MCP 2026 roadmap, OTel GenAI SIG
7. **Risk/Failure Mode** — 13 risk categories, 30+ specific failure modes spanning concurrency, storage, alarms, data integrity, feature interactions, and rolling deploy

---

## Official Documentation Findings

### Cloudflare Durable Objects SQLite

- **Storage limit:** 10 GB per DO instance. Session spend rows at ~100-200 bytes each means millions of rows before approaching limits.
- **`transactionSync()`:** Synchronous callback, atomic commit-or-rollback. All SQL within the callback executes as one transaction. Cannot use `await` inside — all operations must be synchronous SQLite queries. Perfect for session check-then-increment.
- **Concurrency model:** All requests to a DO are serialized by input gates — not concurrent. Multiple requests queue in FIFO order. This eliminates race conditions for session spend updates without explicit locking.
- **`blockConcurrencyWhile()` timeout:** 30 seconds. If initialization takes longer, the DO is terminated. Implication: do NOT load all session rows at startup — use lazy loading.
- **Alarms:** A DO can have only ONE alarm scheduled at a time. Calling `setAlarm()` overrides the previous alarm. At-least-once execution with exponential backoff (2s base, up to 6 retries). This is the single most important constraint for session cleanup design.
- **DO eviction:** No explicit timeout documented. DOs persist in memory during active use. SQLite data persists to disk and survives eviction — re-initialization re-reads from disk. Session spend data survives eviction because it's in SQLite, not in-memory.

### SQLite TTL Patterns

- SQLite has no built-in TTL. Expiry must be implemented via an `expires_at` column + explicit DELETE queries.
- Index on `expires_at` enables efficient cleanup: `DELETE FROM session_spend WHERE last_seen < ? LIMIT 100`.
- Batch deletion with LIMIT prevents large transactions from blocking the DO.

---

## Modern Platform and Ecosystem Patterns

### Per-Session Budget Enforcement (Only LiteLLM)

LiteLLM is the only production AI gateway with explicit per-session budget caps:
- `max_budget_per_session` (float, USD) — cumulative spend cap per trace ID
- `max_iterations` — call count cap per session
- Sessions identified by client-provided trace ID (`require_trace_id_on_calls_by_agent: true`)
- Architecture: in-memory L1 cache → Redis L2 cache → Postgres (batch flush every 60s)
- **Known weakness:** Non-atomic check-then-increment creates enforcement drift (~10 requests at 100 RPS). Multiple GitHub issues report budget enforcement bypass (issues #14097, #12905, #9658).

### Per-Key/Per-User Budgets (Industry Standard)

Every major platform offers this; none offer per-session:
- **Portkey:** Per-key budgets, auto-expire on exhaustion, no time-based reset
- **OpenRouter:** Guardrail policies on users/keys, "most restrictive wins" layering
- **Cloudflare AI Gateway:** Per-gateway rate limiting, cost tracking, no budget enforcement
- **Kong:** Dollar-based quotas per user/app/time period, no session grouping

### Session Tracking for Observability (No Enforcement)

- **Helicone:** Three headers (`Helicone-Session-Id`, `Session-Path`, `Session-Name`). Cost aggregation in ClickHouse. Observability only — no enforcement.
- **Langfuse:** `sessionId` groups traces. Cost aggregation at query time. Observability only.
- **AgentOps:** Session replay with per-session cost tracking. Observability only.

### Financial Infrastructure (Stripe/Marqeta)

- **Stripe Issuing:** Spending controls at `per_authorization`, `daily`, `weekly`, `monthly`, `yearly`, `all_time` intervals. Layered controls — most restrictive wins. Real-time authorization with 2-second webhook window. No session concept.
- **Marqeta:** Velocity controls with `TRANSACTION`, `DAY`, `WEEK`, `MONTH`, `LIFETIME` windows. Up to 90 controls per program. No session grouping.

**Key insight:** Financial infrastructure validates the "hierarchical, most-restrictive-wins" pattern. Neither Stripe nor Marqeta has a session concept because card payments don't have natural session boundaries. AI agent workflows do — this is the gap NullSpend fills.

---

## Relevant Repos, Libraries, and Technical References

### Production-Quality References

| Repo | Stars | Relevance |
|---|---|---|
| [BerriAI/litellm](https://github.com/BerriAI/litellm) | 20k+ | Only production gateway with `max_budget_per_session`. Architecture reference (and cautionary tale for non-atomic enforcement). |
| [Helicone/helicone](https://github.com/Helicone/helicone) | 5.3k | Session header pattern (`Helicone-Session-Id`). ClickHouse cost aggregation. |
| [langfuse/langfuse](https://github.com/langfuse/langfuse) | 10k+ | OTel-style session attribute propagation. ClickHouse `SUM(total_cost)` by session. |

### Experimental / Design References

| Repo | Stars | Relevance |
|---|---|---|
| [sahiljagtap08/agentbudget](https://github.com/sahiljagtap08/agentbudget) | 32 | Hierarchical sub-budget pattern. `with session(budget=5.00):` context manager. Loop detection. Clean session data model. |
| [lambrospetrou/durable-utils](https://github.com/lambrospetrou/durable-utils) | 85 | DO SQLite migration library. Validates NullSpend's existing `_schema_version` pattern. |
| [cheddar-me/pecorino](https://github.com/cheddar-me/pecorino) | 98 | Leaky bucket rate limiter in pure SQL. Time-based drain without background jobs. |

### Key Pattern: LiteLLM's Enforcement Bug

LiteLLM's session budget enforcement separates the check (read spend from cache) from the increment (write spend after response). Under load, multiple requests read the same cached spend value, all pass the check, and all increment — resulting in overspend. NullSpend's `transactionSync()` wrapping both read and write eliminates this class of bug entirely.

---

## Architecture Options

### Option A: Session Spend Table in DO SQLite (Recommended)

**Overview:** Add `session_spend` table to DO SQLite with `(session_id, entity_key)` composite primary key. Check session spend inside `checkAndReserve()` within the existing `transactionSync()` block. Cleanup via alarm.

**Strengths:**
- Atomic check-then-increment (no race conditions)
- Co-located with budget state (no split-brain)
- Sub-millisecond queries (SQLite in-memory after load)
- Follows established patterns (velocity_state table, reservation table)
- Backward compatible (old workers ignore session_spend)

**Weaknesses:**
- Storage growth if session IDs have high cardinality
- Alarm contention (single alarm shared with reservation cleanup)
- Session spend lost if DO SQLite is dropped (schema re-init) — rare but possible

**Complexity cost:** Low-medium. ~50 LOC in `checkAndReserve()`, v4 schema migration, alarm handler extension.

**Scaling:** 10k+ sessions per user before SQLite performance degrades (with proper indexing). Cleanup alarm prevents unbounded growth.

**Maintainability:** Excellent. Same patterns as velocity_state and reservations — any engineer who understands the existing DO code can maintain this.

**DX:** Transparent to agents. No new headers or SDK changes. Session limit configured in dashboard alongside velocity limits.

**When appropriate:** Always. This is the default choice for NullSpend's architecture.

### Option B: Session as Virtual Budget Entities

**Overview:** Treat each session as a temporary budget row (`entity_type = "session"`, `entity_id = session_id`). Reuse existing budget check logic.

**Strengths:** Zero new query logic — existing `checkAndReserve()` handles it.

**Weaknesses:**
- Budget rows per session = aggressive storage growth
- `populateIfEmpty()` RPC per new session = chatty
- Cleanup complexity (budget rows have no TTL mechanism)
- Semantic confusion (sessions are ephemeral, budgets are persistent)

**Complexity cost:** Medium. Requires per-session `populateIfEmpty()` calls and cleanup logic.

**When appropriate:** Never. Different lifecycle (ephemeral vs persistent) means different storage.

### Option C: In-Memory / Postgres Accumulation

**Overview:** Query Postgres `SUM(cost_microdollars) WHERE session_id = ?` during `checkAndReserve()`.

**Strengths:** Zero storage growth in DO. Simple.

**Weaknesses:**
- **Fundamentally flawed:** Race condition between check (before upstream call) and log (after response). Concurrent requests see stale Postgres data.
- +50-100ms latency per request (Postgres network round-trip)
- Postgres dependency on hot path

**When appropriate:** Never. The race condition makes this unsuitable for enforcement.

### Option D: Redis-Based Session Tracking

**Overview:** Track session spend in Upstash Redis with TTL keys. Check Redis before DO budget check.

**Strengths:** Natural TTL (Redis EXPIRE). Zero DO storage growth.

**Weaknesses:**
- Split-brain between Redis (session state) and DO (budget state)
- Reconciliation complexity (must adjust Redis on actual cost)
- Redis failure mode (session check fails if Redis down)
- +5ms latency per request (Redis network call)

**When appropriate:** As a future optimization if DO session storage becomes a bottleneck. Not for initial implementation.

---

## Recommended Approach for Our Platform

### Design: Option A with DX refinements

**Session limit as a budget property:**
```sql
-- Postgres (budgets table)
ALTER TABLE budgets ADD COLUMN session_limit_microdollars BIGINT;  -- nullable, null = disabled

-- DO SQLite (v4 migration)
ALTER TABLE budgets ADD COLUMN session_limit INTEGER;  -- maps from Postgres

CREATE TABLE IF NOT EXISTS session_spend (
  session_id TEXT NOT NULL,
  entity_key TEXT NOT NULL,
  spend INTEGER NOT NULL DEFAULT 0,
  request_count INTEGER NOT NULL DEFAULT 0,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  PRIMARY KEY (session_id, entity_key)
);
CREATE INDEX IF NOT EXISTS idx_session_spend_last_seen ON session_spend(last_seen);
```

**Enforcement flow (inside `checkAndReserve` transactionSync):**
1. Existing Phase 0: Velocity check
2. **New Phase 0.7: Session limit check** — if `sessionId` is provided and matching budget has `session_limit > 0`:
   - Query `session_spend` for `(session_id, entity_key)`
   - Lazy TTL: if `now - last_seen > SESSION_EXPIRY_MS`, treat as expired (delete row, start fresh)
   - If `current_spend + estimate > session_limit` → deny with `session_limit_exceeded`
3. Existing Phase 1.5: Period resets + checkedEntities
4. Existing Phase 2: Budget check
5. **New Phase 3.5: Update session_spend** — after all checks pass, UPSERT session_spend row
6. Existing Phase 3: Reserve

**Reconciliation correction (inside `reconcile`):**
- After settling actual cost, adjust session spend: `UPDATE session_spend SET spend = spend + (actual - estimate) WHERE session_id = ? AND entity_key = ?`
- This prevents session spend inflation from overestimates

**Alarm cleanup (inside `alarm`):**
- After existing reservation cleanup: `DELETE FROM session_spend WHERE last_seen < ? LIMIT 500`
- Use `SESSION_EXPIRY_MS = 24 * 60 * 60 * 1000` (24 hours) as default
- Reschedule alarm for `MIN(next_reservation_expiry, next_session_expiry)`

**Why this approach wins:**
- Correctness: atomic check + increment in `transactionSync()` — eliminates LiteLLM's race condition
- Performance: +1 SQLite SELECT, +1 SQLite UPSERT per request (~0.5ms total)
- Simplicity: follows velocity_state and reservation table patterns exactly
- No new infrastructure: no Redis, no Queues, no external state
- Backward compatible: old workers without session awareness pass null sessionId, no session check runs

### Configuration model

- `sessionLimitMicrodollars` on budget entity (nullable, null = disabled)
- No separate session TTL config — use a sensible default (24h) and let agent-defined session IDs handle lifecycle
- Dashboard: collapsible "Session limit" section in budget dialog (same pattern as velocity limits and threshold alerts)
- API: `POST /api/budgets` accepts `sessionLimitMicrodollars`
- SDK: `BudgetEntity.sessionLimitMicrodollars: number | null`

### Error response

```json
{
  "error": {
    "code": "session_limit_exceeded",
    "message": "Request blocked: session cumulative spend exceeds per-session limit.",
    "details": {
      "sessionId": "sess_abc123",
      "sessionSpendMicrodollars": 4800000,
      "sessionLimitMicrodollars": 5000000,
      "entityType": "api_key",
      "entityId": "ns_key_..."
    }
  }
}
```

HTTP 429, no `Retry-After` header (unlike velocity limits, the session is done — start a new one).

### Naming

- Feature: "Session limits" (parallels "Velocity limits")
- Field: `sessionLimitMicrodollars` (parallels `velocityLimitMicrodollars`)
- Error code: `session_limit_exceeded` (parallels `velocity_exceeded`)
- Webhook: `session.limit_exceeded` (parallels `velocity.exceeded`)

---

## Frontier and Emerging Patterns

### TrueFoundry — Per-Request Budget Context (Early-adopter)
- Every request carries budget metadata (micro-budget), not just a global cap. Agent-to-agent budget delegation where Manager Agents "pay" Worker Agents from their own wallet. Shadow FinOps model predicts costs before execution.
- **Relevance:** Validates NullSpend's architecture. Their velocity-based circuit breaker mirrors NullSpend's existing velocity limits. Agent-to-agent delegation is a future roadmap item (3.9 Hierarchical Budget Delegation).
- **Adopt:** Watch for now. Design session limits to be compatible with future sub-session delegation.

### Agent Contracts Paper (arXiv:2601.08815, Jan 2026 — Experimental)
- Formal framework where an Agent Contract unifies resource constraints, temporal boundaries, and success criteria. Establishes **conservation laws**: delegated budgets must respect parent constraints. 90% token reduction, 525x lower variance, zero conservation violations.
- **Relevance:** The conservation law (parent budget >= sum of child budgets, always) should be a design constraint for future hierarchical session budgets.
- **Adopt:** Design for later. Current session limits are flat (one session, one limit). Conservation laws matter when we add sub-session delegation.

### Stripe ACP / x402 Protocol (Early-adopter)
- Stripe's Agentic Commerce Protocol uses Shared Payment Tokens (SPTs) scoped to seller, time, and amount. x402 uses HTTP 402 for micropayments with reusable sessions.
- **Relevance:** The "scoped token with time and amount bounds" concept maps directly to session budgets.
- **Adopt:** Watch. Potentially integrate as a payment rail for NullSpend-enforced agent transactions.

### MCP 2026 Roadmap (Experimental)
- Prioritizes scalable session handling (create, resume, migrate). No cost/budget semantics yet. Donated to Linux Foundation.
- **Relevance:** As MCP adds session semantics, NullSpend should be the enforcement layer.
- **Adopt:** Design for later. Consider contributing a cost-metering SEP.

### OTel GenAI SIG (Early-adopter)
- `gen_ai.conversation.id` exists as session/thread identifier. Agent spans in development. No `cost.total` attribute.
- **Relevance:** NullSpend should emit OTel-compatible attributes with `gen_ai.conversation.id` as the session correlation key.
- **Adopt:** Design for later (Priority 3.3 OTel GenAI Span Emission).

### Budget-Aware Agent Behavior (BAVT Paper, arXiv:2603.12634 — Experimental)
- Budget-conditioned node selection uses remaining resource ratio as a scaling exponent — broad exploration at high budget, greedy exploitation at low budget.
- **Relevance:** As session budget depletes, HITL escalation thresholds could decrease (require approval for smaller amounts).
- **Adopt:** Design for later. Interesting interaction with existing HITL approval flows.

---

## Opportunities to Build Something Better

### 1. Atomic Enforcement (vs. LiteLLM's Race Condition)
LiteLLM's `max_budget_per_session` has known enforcement bypass bugs because check and increment are separate async operations. NullSpend's `transactionSync()` wraps both in a single atomic SQLite transaction. This is a structural advantage, not just an implementation detail.

### 2. Edge-Native Enforcement (vs. Everyone Else's Centralized DB)
Every competitor checks budgets against a central database (Postgres, Redis). NullSpend's Durable Object puts the budget check at the edge, co-located with the user's state, with sub-millisecond latency. Adding session spend to the same DO maintains this advantage.

### 3. Unified Enforcement Hierarchy (vs. Fragmented Controls)
No competitor offers budget limit + velocity limit + session limit + threshold alerts + HITL approval as a single coherent system on one budget entity. NullSpend does. Session limits are the missing piece.

### 4. Session Limits Without Server-Side Lifecycle (vs. AgentBudget's Context Manager)
AgentBudget requires `with session(budget=5.00):` — the agent framework must manage session lifecycle. NullSpend's approach is header-based: agents already send `X-NullSpend-Session-Id`, and enforcement is transparent. No framework integration required.

### 5. Cross-Framework Session Enforcement
AgentBudget is Python-only, in-process. NullSpend enforces session budgets at the proxy layer, working with any framework (Claude Agent SDK, OpenAI Agents, LangChain, CrewAI, AG2) in any language. This is the right architectural layer for budget enforcement.

---

## Risks, Gaps, and Edge Cases

### Critical Risks

1. **Alarm contention (single alarm):** The DO has one alarm. Currently used for reservation expiry. Session cleanup needs the same alarm. Solution: multiplex — schedule alarm for `MIN(next_reservation_expiry, now + SESSION_CLEANUP_INTERVAL)`, handle both in the alarm handler. If reservation cleanup overrides the session cleanup alarm, stale sessions accumulate until the next alarm fires.

2. **Session spend inflation from overestimates:** `checkAndReserve` increments session spend by estimate. If actual cost < estimate, session spend is overstated until `reconcile()` corrects it. If reconcile fails (Postgres write error, upstream timeout), session spend stays inflated. Mitigation: `reconcile()` must adjust session spend with `(actual - estimate)` delta, and reservation expiry in `alarm()` must also decrement session spend.

3. **Unbounded session table growth:** An agent using UUID-per-request as session ID creates one row per request. Power user at 1000 req/min = 60K rows/hour. Mitigation: aggressive cleanup (24h TTL), plus a cardinality guard — if session_spend table exceeds N rows for a user, oldest sessions are evicted.

### High Risks

4. **Session ID collisions:** Two agents using session ID "main" share the same session spend counter. One agent's spend blocks the other. Mitigation: document that session IDs must be unique per user. Consider namespacing by key ID: `(session_id, entity_key)` composite key.

5. **Reservation expiry without session spend correction:** When a reservation expires (upstream timeout), `alarm()` decrements `reserved` but session spend was already incremented during `checkAndReserve()`. The cost never materialized, but session spend says it did. Mitigation: store `session_id` on reservations so alarm can reverse session spend on expiry.

6. **Rolling deploy — `populateIfEmpty` signature change:** Adding `sessionLimit` parameter (12th positional arg). Old workers send 11 args → new DO uses default (null). New workers send 12 args → old DO ignores extra arg (JS behavior). Safe, but adds to growing parameter count. Consider options object in future refactor.

### Medium Risks

7. **Period reset vs. session duration:** Budget period resets mid-session. Budget spend goes to 0, but session spend stays. Defined behavior: session limits are independent of budget periods. A session that spans midnight still accumulates.

8. **Session limit > budget limit:** Contradictory configuration. Session limit of $10 on a $5 budget means the $5 budget always denies first. Mitigation: validate on create/update that `sessionLimit <= maxBudget` (when both are set), or document that session limit only applies within the overall budget.

9. **`resetSpend()` and `removeBudget()` don't clear session spend:** Admin resets budget, but stale session spend rows remain. Mitigation: extend both methods to `DELETE FROM session_spend WHERE entity_key = ?`.

10. **Velocity + session interaction ambiguity:** A request could be denied by velocity (rate too high) or session (cumulative too much). Check order determines which error the agent sees. Defined behavior: velocity first (Phase 0), then session (Phase 0.7), then budget (Phase 2). Each returns a distinct error code.

---

## Recommended Technical Direction

### Design Pattern
Session spend as a DO SQLite table with TTL-based cleanup, following the velocity_state precedent.

### Architecture
- v4 schema migration: `session_spend` table + `session_limit` column on `budgets`
- Enforcement inside existing `transactionSync()` block
- Cleanup via multiplexed alarm handler
- Reconciliation correction in `reconcile()`

### Implementation Approach
1. **Postgres schema:** Add `session_limit_microdollars BIGINT` to budgets table (Drizzle migration)
2. **DO schema:** v4 migration — `session_spend` table + `session_limit` column on budgets
3. **populateIfEmpty:** Add `sessionLimit` parameter (12th, default null)
4. **checkAndReserve:** Add Phase 0.7 (session check) and Phase 3.5 (session spend update)
5. **reconcile:** Add session spend delta correction
6. **alarm:** Extend to clean expired sessions
7. **removeBudget/resetSpend:** Clear session_spend rows
8. **Budget lookup interfaces:** Add `sessionLimitMicrodollars` to `BudgetEntity`, `DOBudgetEntity`, `CheckedEntity`
9. **Error responses:** New `session_limit_exceeded` code
10. **Dashboard:** Collapsible "Session limit" section in budget dialog
11. **Tests:** Session enforcement, reconciliation correction, alarm cleanup, interaction with velocity/budget/period reset

### What to Do Now
- Implement the full feature as described above (~2-3 hours)

### What to Defer
- Hierarchical sub-session budgets (roadmap item 3.9)
- Session-level threshold webhooks (`session.threshold.warning/critical`)
- OTel `gen_ai.conversation.id` emission
- Session spend dashboard page (active sessions list/detail)
- `x-nullspend-session-path` hierarchical path tracking (Helicone pattern)
- Session limit interaction with HITL approval flows

### What to Avoid
- Redis-based session tracking (split-brain, unnecessary infra)
- Virtual budget entities for sessions (wrong lifecycle model)
- Postgres-based session spend queries in hot path (race condition, latency)
- Server-side session lifecycle management (inactivity timeouts, explicit open/close)
- Mandatory session IDs (breaks backward compat)
- Session spend as a separate DO (coordination overhead)

---

## Open Questions

1. **Should `sessionId` on reservations enable alarm to reverse session spend on expiry?** This adds a column to the reservations table but prevents false session spend inflation from expired reservations. Worth the complexity?

2. **Should there be a max session count per user?** If a user has 10,000 unique session IDs, is that a problem? The cleanup alarm handles old sessions, but active concurrent sessions could accumulate. A guard like "max 1,000 active sessions per DO" would prevent abuse.

3. **Should the dashboard show active sessions?** Phase 1 could skip this (session spend is internal enforcement state). Phase 2 could add a "Sessions" tab showing active sessions with spend, request count, and remaining limit. The data is already queryable from `cost_events` in Postgres.

4. **Should session limits be available via the SDK budget check API?** `GET /api/budgets/status` currently returns budget state. Should it return session state too? This requires the caller to specify which session they're asking about.

5. **How should MCP sessions interact with session limits?** MCP events already carry `sessionId`. The MCP budget check path (`handleMcpBudgetCheck`) goes through the same `checkBudget` orchestrator. Session limits should apply to MCP the same as OpenAI/Anthropic. But should MCP tool cost events count toward the session spend the same way?

---

## Sources and References

### Official Documentation
- [Cloudflare Durable Objects SQLite Storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
- [Cloudflare Durable Objects Limits](https://developers.cloudflare.com/durable-objects/platform/limits/)
- [Cloudflare Durable Objects Best Practices](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/)
- [Cloudflare Durable Objects Alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)
- [Cloudflare Agents SDK](https://developers.cloudflare.com/agents/)
- [Stripe Issuing Spending Controls](https://docs.stripe.com/issuing/controls/spending-controls)
- [Stripe Real-Time Authorizations](https://docs.stripe.com/issuing/controls/real-time-authorizations)
- [Marqeta Velocity Controls](https://www.marqeta.com/docs/core-api/velocity-controls)
- [Marqeta Controlling Spending](https://www.marqeta.com/docs/developer-guides/controlling-spending)
- [AWS Budget Controls](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-controls.html)
- [Claude Agent SDK Cost Tracking](https://platform.claude.com/docs/en/agent-sdk/cost-tracking)
- [OpenAI Agents SDK Usage](https://openai.github.io/openai-agents-python/usage/)

### Specifications and Standards
- [MCP 2026 Roadmap](http://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/)
- [OTel GenAI Agent Spans Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-agent-spans/)
- [OTel GenAI Attribute Registry](https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/)
- [FOCUS FinOps Spec v1.3](https://focus.finops.org/)
- [Stripe Agentic Commerce Protocol (ACP)](https://www.agenticcommerce.dev/)
- [Google Agent Payments Protocol (AP2)](https://ap2-protocol.org/)
- [x402 Protocol](https://www.x402.org/)

### Platform and Product References
- [LiteLLM Budgets & Rate Limits](https://docs.litellm.ai/docs/proxy/users)
- [LiteLLM Spend Tracking](https://docs.litellm.ai/docs/proxy/cost_tracking)
- [LiteLLM Budget & Spend Architecture (DeepWiki)](https://deepwiki.com/BerriAI/litellm/3.3-budget-and-spend-tracking)
- [Portkey Budget Limits](https://portkey.ai/docs/product/ai-gateway/virtual-keys/budget-limits)
- [Portkey Cost Management](https://portkey.ai/docs/product/observability/cost-management)
- [Helicone Sessions](https://docs.helicone.ai/features/sessions)
- [Langfuse Sessions](https://langfuse.com/docs/observability/features/sessions)
- [Langfuse Data Model](https://langfuse.com/docs/observability/data-model)
- [OpenRouter Guardrails](https://openrouter.ai/docs/guides/features/guardrails)
- [Cloudflare AI Gateway Rate Limiting](https://developers.cloudflare.com/ai-gateway/features/rate-limiting/)
- [Cloudflare AI Gateway Costs](https://developers.cloudflare.com/ai-gateway/observability/costs/)
- [Kong AI Cost Control](https://konghq.com/blog/product-releases/ai-cost-control)
- [TrueFoundry FinOps for A2A Economy](https://www.truefoundry.com/blog/agent-gateway-series-part-4-of-7-finops-for-autonomous-systems)
- [Bifrost Budget & Limits](https://docs.getbifrost.ai/features/governance/budget-and-limits)
- [Microsoft MCP Gateway](https://github.com/microsoft/mcp-gateway)

### Repositories and Code References
- [BerriAI/litellm](https://github.com/BerriAI/litellm) — 20k+ stars, production AI gateway with session budget enforcement
- [sahiljagtap08/agentbudget](https://github.com/sahiljagtap08/agentbudget) — 32 stars, hierarchical session budget SDK
- [Helicone/helicone](https://github.com/Helicone/helicone) — 5.3k stars, session header pattern and cost aggregation
- [langfuse/langfuse](https://github.com/langfuse/langfuse) — 10k+ stars, OTel-style session attribute propagation
- [lambrospetrou/durable-utils](https://github.com/lambrospetrou/durable-utils) — 85 stars, DO SQLite migration patterns
- [cheddar-me/pecorino](https://github.com/cheddar-me/pecorino) — 98 stars, SQL-based leaky bucket rate limiter
- [AgentOps-AI/agentops](https://github.com/AgentOps-AI/agentops) — session replay with cost tracking
- [maximhq/bifrost](https://github.com/maximhq/bifrost) — 4-tier hierarchical budgets in Go

### Issue Trackers and Discussions
- [LiteLLM Budget Enforcement Bug #9658](https://github.com/BerriAI/litellm/pull/9658)
- [LiteLLM Budget Precedence Issue #14097](https://github.com/BerriAI/litellm/issues/14097)
- [LiteLLM Budget Bypass #12905](https://github.com/BerriAI/litellm/issues/12905)

### Academic Papers
- [Agent Contracts (arXiv:2601.08815, January 2026)](https://arxiv.org/abs/2601.08815) — Conservation laws for multi-agent budget delegation
- [Agent Behavioral Contracts (arXiv:2602.22302, February 2026)](https://arxiv.org/abs/2602.22302) — Hard vs. soft constraint enforcement
- [Budget-Aware Value Tree Search (arXiv:2603.12634, March 2026)](https://arxiv.org/abs/2603.12634) — Budget-conditioned agent behavior
- [Self-Resource Allocation in Multi-Agent LLM Systems (arXiv:2504.02051, April 2025)](https://arxiv.org/abs/2504.02051)
- [AI Runtime Infrastructure (arXiv:2603.00495, March 2026)](https://arxiv.org/html/2603.00495v1) — Theoretical justification for NullSpend's architectural position

### Blog Posts and Articles
- [FinOps for Agents (InfoWorld)](https://www.infoworld.com/article/4138748/finops-for-agents-loop-limits-tool-call-caps-and-the-new-unit-economics-of-agentic-saas.html)
- [$400M Cloud Leak (AnalyticsWeek)](https://analyticsweek.com/finops-for-agentic-ai-cloud-cost-2026/)
- [FinOps Foundation State of FinOps 2026](https://data.finops.org/)
- [Boris Tane: Database Per User with DOs + Drizzle](https://boristane.com/blog/durable-objects-database-per-user/)

### Internal Codebase References
- `apps/proxy/src/durable-objects/user-budget.ts` — DO with budgets, reservations, velocity_state tables; checkAndReserve, reconcile, alarm, populateIfEmpty
- `apps/proxy/src/index.ts:230` — sessionId extraction from `x-nullspend-session` header
- `apps/proxy/src/lib/context.ts` — `RequestContext.sessionId: string | null`
- `apps/proxy/src/lib/budget-orchestrator.ts` — Budget check flow, builds BudgetEntity from CheckedEntity
- `apps/proxy/src/lib/budget-do-lookup.ts` — `BudgetEntity` and `DOBudgetEntity` interfaces
- `apps/proxy/src/lib/budget-do-client.ts` — `doBudgetUpsertEntities` calls `populateIfEmpty`
- `packages/db/src/schema.ts:99-119` — Postgres budgets table definition
- `packages/db/src/schema.ts:141-155` — cost_events with session_id column and index
- `lib/validations/budgets.ts` — Zod schemas for budget create/update
- `app/(dashboard)/app/budgets/page.tsx` — Budget dialog with velocity and threshold sections
