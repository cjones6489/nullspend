# NullSpend: DO + KV Migration — Implementation Tracker

> **Reference spec**: `docs/technical-outlines/nullspend-do-migration-revised.md`
>
> Each phase is designed to be independently deployable and testable. Do not start a phase until the previous phase's verification criteria are met. Every phase ends with "all existing tests still pass" as a baseline.

---

## Status Overview

| Phase | Name | Status | Notes |
|-------|------|--------|-------|
| 0 | Pre-flight checks | Not started | |
| 1 | Infrastructure setup | Not started | |
| 2 | Webhook cache → KV | Not started | |
| 3 | UserBudgetDO class | Not started | |
| 4 | Budget orchestrator + route wiring | Not started | |
| 5 | Shadow mode validation | Not started | |
| 6 | DO cutover | Not started | |
| 7 | Cleanup | Not started | |

---

## Phase 0: Pre-flight Checks

> Verify the codebase is clean and all tests pass before touching anything.

### Steps

- [ ] **0.1** Run `pnpm test` — all root tests pass
- [ ] **0.2** Run `pnpm proxy:test` — all proxy tests pass
- [ ] **0.3** Run `pnpm typecheck` — no type errors
- [ ] **0.4** Run `pnpm lint` — clean
- [ ] **0.5** Verify git status is clean on main

### Verification

All four commands exit 0. This is our known-good baseline.

---

## Phase 1: Infrastructure Setup

> Add wrangler bindings (KV, DO, SQLite migration), Env type, and the empty UserBudgetDO class. Deploy with `BUDGET_ENGINE=redis` — DOs exist but are not called.

### Steps

- [ ] **1.1** Create KV namespace: `wrangler kv namespace create CACHE_KV`
  - Copy the returned ID into `wrangler.jsonc`
  - Also create preview namespace: `wrangler kv namespace create CACHE_KV --preview`
- [ ] **1.2** Update `apps/proxy/wrangler.jsonc`:
  - Add `"BUDGET_ENGINE": "redis"` to `vars`
  - Add `kv_namespaces` binding for `CACHE_KV`
  - Add `durable_objects.bindings` for `USER_BUDGET` → `UserBudgetDO`
  - Add `migrations` with `new_sqlite_classes: ["UserBudgetDO"]`
  - **No cron trigger** (inline resets handle period rollovers)
- [ ] **1.3** Create `apps/proxy/src/env.ts` — explicit Env interface
  - Existing fields: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `HYPERDRIVE`, `PROXY_RATE_LIMIT`, `PROXY_KEY_RATE_LIMIT`, `QSTASH_TOKEN`, `FORCE_DB_PERSIST`, `SKIP_DB_PERSIST`
  - New fields: `BUDGET_ENGINE`, `USER_BUDGET`, `CACHE_KV`
  - Update all files that reference `Env` (currently implicit global type)
- [ ] **1.4** Create empty DO class: `apps/proxy/src/durable-objects/user-budget.ts`
  - Skeleton with constructor, `blockConcurrencyWhile`, schema init
  - No RPC methods yet — just enough to satisfy the wrangler binding
- [ ] **1.5** Export the DO class from `apps/proxy/src/index.ts`:
  - `export { UserBudgetDO } from "./durable-objects/user-budget.js";`
- [ ] **1.6** Update `.dev.vars` (local dev) to include `BUDGET_ENGINE=redis`

### Files touched

```
apps/proxy/wrangler.jsonc          — KV, DO, migration bindings
apps/proxy/src/env.ts              — NEW: explicit Env type
apps/proxy/src/index.ts            — re-export UserBudgetDO
apps/proxy/src/durable-objects/    — NEW directory
apps/proxy/src/durable-objects/user-budget.ts — NEW: skeleton DO
apps/proxy/.dev.vars               — BUDGET_ENGINE=redis
```

### Verification

- [ ] `pnpm proxy:test` passes (no regressions)
- [ ] `pnpm typecheck` passes
- [ ] `wrangler dev` starts without errors, `GET /health` returns 200
- [ ] `wrangler dev` logs show DO binding is registered (check startup output)
- [ ] Existing budget enforcement works identically (BUDGET_ENGINE=redis)

### Rollback

Delete the new files and revert `wrangler.jsonc`. No behavior has changed.

---

## Phase 2: Webhook Cache → Workers KV

> Replace the Redis-backed webhook endpoint cache with Workers KV. Auth cache stays in-memory (already optimal). This is the lowest-risk migration — webhook cache is fail-open and non-critical.

### Context

Current: `webhook-cache.ts` uses `Redis.get/set` with 5min TTL for endpoint metadata (no secrets).
Target: Same interface, backed by `CACHE_KV` instead of Redis.

### Steps

- [ ] **2.1** Create `apps/proxy/src/lib/cache-kv.ts`:
  - `getCachedWebhookEndpoints(kv, userId)` — KV get with JSON parse
  - `setCachedWebhookEndpoints(kv, userId, endpoints)` — KV put with 300s TTL
  - `invalidateWebhookEndpoints(kv, userId)` — KV delete
- [ ] **2.2** Update `webhook-cache.ts`:
  - Add optional `kv: KVNamespace | null` parameter to `getWebhookEndpoints`
  - If `kv` is provided, use KV path; otherwise fall back to Redis path
  - This allows gradual rollover — callers pass KV when available
- [ ] **2.3** Update route handlers to pass `env.CACHE_KV` to webhook functions:
  - `openai.ts`, `anthropic.ts`, `mcp.ts` — anywhere `getWebhookEndpoints` is called
  - May need to thread `env.CACHE_KV` through `RequestContext` or pass `env` directly
- [ ] **2.4** Write tests for `cache-kv.ts`:
  - Mock `KVNamespace` (get/put/delete)
  - Test: cache hit returns data, cache miss returns null, TTL is set correctly
  - Test: invalidation deletes the key
- [ ] **2.5** Update `webhook-cache.test.ts` to cover the KV path

### Files touched

```
apps/proxy/src/lib/cache-kv.ts          — NEW: KV cache functions
apps/proxy/src/lib/webhook-cache.ts     — Add KV path alongside Redis
apps/proxy/src/lib/context.ts           — Possibly add CACHE_KV to context
apps/proxy/src/routes/openai.ts         — Pass KV to webhook functions
apps/proxy/src/routes/anthropic.ts      — Same
apps/proxy/src/routes/mcp.ts            — Same
apps/proxy/src/__tests__/cache-kv.test.ts       — NEW
apps/proxy/src/__tests__/webhook-cache.test.ts  — Update for KV path
```

### Verification

- [ ] `pnpm proxy:test` passes (all existing + new cache-kv tests)
- [ ] `pnpm typecheck` passes
- [ ] Manual test with `wrangler dev`:
  - Trigger a webhook-enabled request
  - Verify KV is written (check via `wrangler kv key list --binding CACHE_KV`)
  - Second request should hit KV cache (no DB query in logs)
- [ ] Webhook dispatch still works end-to-end

### Rollback

Set `kv` parameter to `null` in callers — falls back to Redis path automatically.

---

## Phase 3: UserBudgetDO — Full Implementation + Tests

> Implement the complete Durable Object class with all RPC methods. Test with `cloudflare:test` vitest plugin. DO is deployed but NOT called from any route handler yet.

### Steps

- [ ] **3.1** Complete `apps/proxy/src/durable-objects/user-budget.ts`:
  - Schema init with `_schema_version` migration tracking
  - `budgets` table + `reservations` table
  - In-memory `Map<string, BudgetRow>` cache loaded via `loadBudgets()`
  - `blockConcurrencyWhile` in constructor for cold-start init
- [ ] **3.2** Implement RPC methods:
  - `checkAndReserve(entities, estimateMicrodollars, reservationTtlMs?)` — transactionSync
  - `reconcile(reservationId, actualCostMicrodollars)` — transactionSync
  - `populateIfEmpty(entityType, entityId, maxBudget, spend, policy, resetInterval, periodStart)`
  - `getBudgetState()` — read-only, for debugging/dashboard
- [ ] **3.3** Implement `alarm()` handler — expired reservation cleanup
- [ ] **3.4** Implement `currentPeriodStart()` helper — inline budget period resets
- [ ] **3.5** Configure vitest for DO tests:
  - Check if `@cloudflare/vitest-pool-workers` is already a dependency
  - Add `vitest.do.config.ts` if needed, or integrate with existing config
  - Ensure `cloudflare:test` env provides `USER_BUDGET` binding
- [ ] **3.6** Write DO unit tests (`apps/proxy/src/__tests__/user-budget-do.test.ts`):
  - Populate and check budget within limit → approved
  - Check budget exceeding limit → denied
  - Multi-entity atomic check — most restrictive wins
  - Reconcile updates spend correctly, clears reservation
  - Reconcile with unknown reservation → not_found
  - Inline period reset — expired daily budget resets spend to 0
  - Alarm cleans up expired reservations
  - Concurrent requests serialize correctly (Promise.all)
  - `populateIfEmpty` skips if already populated
  - `soft_block` policy allows over-budget requests (behavior change test)
  - `warn` policy allows over-budget requests (behavior change test)
- [ ] **3.7** Ensure existing tests still pass (DO export doesn't break anything)

### Files touched

```
apps/proxy/src/durable-objects/user-budget.ts  — Full implementation
apps/proxy/src/__tests__/user-budget-do.test.ts — NEW: DO tests
apps/proxy/vitest.do.config.ts                  — NEW if needed
apps/proxy/package.json                         — @cloudflare/vitest-pool-workers if needed
```

### Verification

- [ ] DO-specific tests pass (vitest with Workers pool)
- [ ] `pnpm proxy:test` passes (existing tests unaffected)
- [ ] `pnpm typecheck` passes
- [ ] `wrangler dev` starts cleanly — DO registered but not called

### Rollback

DO exists but is never called. No behavior change. Delete the file to roll back.

---

## Phase 4: Budget Orchestrator + Route Wiring

> Create a `BudgetOrchestrator` that encapsulates the Redis/DO/shadow switch, then wire it into all three route handlers. With `BUDGET_ENGINE=redis`, behavior is identical to current code.

### Context

Currently, budget enforcement logic is duplicated across `openai.ts`, `anthropic.ts`, and `mcp.ts`:
1. `lookupBudgets()` → Redis pipeline + Postgres fallback
2. `estimateMaxCost()` → cost estimation
3. `checkAndReserve()` → Redis Lua script
4. `reconcileReservation()` → Redis Lua + Postgres write-back

Instead of triplicating `if (BUDGET_ENGINE === "durable-objects")` branches, extract a `BudgetOrchestrator` that:
- Takes `BUDGET_ENGINE` mode as config
- Exposes `check(env, ctx, entities, estimate)` → `BudgetCheckResult`
- Exposes `reconcile(env, ctx, reservationId, actualCost, entities)` → void
- Internally routes to Redis or DO based on mode

### Steps

- [ ] **4.1** Create `apps/proxy/src/lib/budget-do-client.ts`:
  - `doBudgetCheck(env, userId, entities, estimate)` → DO checkAndReserve
  - `doBudgetReconcile(env, userId, reservationId, actualCost, entities, connectionString)` → DO reconcile + Postgres write-back
  - `doBudgetPopulate(env, userId, entityType, entityId, maxBudget, spend, policy, resetInterval, periodStart)` → DO populateIfEmpty
- [ ] **4.2** Create `apps/proxy/src/lib/budget-orchestrator.ts`:
  - `BudgetOrchestrator` class or functions
  - `checkBudget(mode, env, ctx, entities, estimate)` → routes to Redis or DO
  - `reconcileBudget(mode, env, ctx, reservationId, actualCost, entities)` → routes to Redis or DO
  - Shadow mode: Redis primary + DO shadow in waitUntil with divergence logging
  - DO mode: needs to handle `lookupBudgets` → DO `populateIfEmpty` for cold starts
- [ ] **4.3** Define a `BudgetEntity` interface shared across Redis and DO paths:
  - Core fields: `entityType`, `entityId`, `maxBudget`, `spend`, `policy`
  - Redis-specific: `entityKey` (Redis hash key format)
  - DO path doesn't need `entityKey` — use entityType:entityId
- [ ] **4.4** Update `openai.ts` to use orchestrator:
  - Replace inline budget enforcement block with orchestrator calls
  - `BUDGET_ENGINE=redis` must produce identical behavior to current code
- [ ] **4.5** Update `anthropic.ts` to use orchestrator (same pattern)
- [ ] **4.6** Update `mcp.ts` to use orchestrator (same pattern)
- [ ] **4.7** Write orchestrator unit tests:
  - Redis mode: calls Redis functions, returns same results
  - DO mode: calls DO client, includes Postgres write-back
  - Shadow mode: calls both, logs divergences, returns Redis result
  - Error handling: fail-closed on DO errors (503)
- [ ] **4.8** Verify all existing route handler tests still pass with orchestrator

### Files touched

```
apps/proxy/src/lib/budget-do-client.ts      — NEW: DO client functions
apps/proxy/src/lib/budget-orchestrator.ts   — NEW: mode-aware orchestration
apps/proxy/src/routes/openai.ts             — Use orchestrator
apps/proxy/src/routes/anthropic.ts          — Use orchestrator
apps/proxy/src/routes/mcp.ts               — Use orchestrator
apps/proxy/src/lib/context.ts              — Possibly thread env/mode
apps/proxy/src/__tests__/budget-orchestrator.test.ts     — NEW
apps/proxy/src/__tests__/budget-do-client.test.ts        — NEW
```

### Verification

- [ ] `pnpm proxy:test` passes — ALL existing tests, including route handler tests
- [ ] `pnpm typecheck` passes
- [ ] New orchestrator tests pass
- [ ] With `BUDGET_ENGINE=redis`: behavior is byte-for-byte identical to pre-orchestrator
- [ ] Manual test: budget enforcement works in `wrangler dev`

### Rollback

Revert route handlers to inline budget logic. Orchestrator is additive — removing it restores previous behavior.

---

## Phase 5: Shadow Mode Validation

> Deploy with `BUDGET_ENGINE=shadow`. Redis is primary for all decisions. DOs receive parallel writes and results are compared. This validates the DO logic against real traffic without any user impact.

### Prerequisites

- Phase 4 complete — orchestrator wired into all route handlers
- Existing proxy tests and smoke tests passing
- DO tests from Phase 3 passing

### Steps

- [ ] **5.1** Set `BUDGET_ENGINE=shadow` in environment (wrangler secret or .dev.vars)
- [ ] **5.2** Verify shadow path activates:
  - Budget check: Redis returns result, DO receives parallel check via waitUntil
  - Budget reconcile: both Redis and DO reconcile
  - DO populateIfEmpty called to seed DO state from Postgres
- [ ] **5.3** Monitor divergence logs:
  - **Expected divergences**: `soft_block`/`warn` entities (DO approves, Redis denies)
  - **Unexpected divergences**: `strict_block` entities with different results → investigate
- [ ] **5.4** Run smoke tests against shadow mode:
  - Budget approval path works (Redis primary)
  - Budget denial path works (Redis primary)
  - DO shadow logs appear (check worker logs)
- [ ] **5.5** Verify DO state is accumulating correctly:
  - Check DO SQLite via `getBudgetState()` debug endpoint or logs
  - Compare DO spend values against Postgres spend values
- [ ] **5.6** Fix any unexpected divergences found
- [ ] **5.7** Run shadow mode for sufficient time/traffic to build confidence

### Verification

- [ ] All existing tests pass (shadow mode is transparent to tests using `redis` mode)
- [ ] Worker logs show DO shadow writes happening
- [ ] No unexpected divergences in strict_block entities
- [ ] DO spend values track Postgres spend values within reservation-window tolerance

### Rollback

`wrangler secret put BUDGET_ENGINE redis` → instant, zero-downside rollback.

---

## Phase 6: DO Cutover

> Switch to `BUDGET_ENGINE=durable-objects`. DOs are now primary for budget enforcement. Redis budget code remains in codebase but is inactive.

### Prerequisites

- Shadow mode validated with no unexpected divergences
- DO spend values match Postgres within tolerance

### Steps

- [ ] **6.1** Set `BUDGET_ENGINE=durable-objects` in environment
- [ ] **6.2** Monitor immediately after cutover:
  - p50/p99 latency for budget check operations
  - Approval/denial rates (should match shadow period)
  - Error rates — watch for DO `.overloaded` or connection errors
  - Reconciliation success rate
- [ ] **6.3** Verify Postgres write-back is working:
  - Dashboard spend displays match expected values
  - `cost_events` and `budgets.spend_microdollars` stay in sync
- [ ] **6.4** Verify alarm-based reservation cleanup:
  - Make a request, kill it mid-stream → reservation should expire and clean up
- [ ] **6.5** Run full smoke test suite against DO mode
- [ ] **6.6** Monitor for 1+ week before proceeding to cleanup

### Verification

- [ ] Budget enforcement works correctly (approvals and denials)
- [ ] Latency is acceptable (p50 < 20ms, p99 < 100ms for budget check)
- [ ] Dashboard spend values are accurate
- [ ] No DO overload errors in logs
- [ ] Smoke tests pass

### Rollback

`wrangler secret put BUDGET_ENGINE redis` → instant rollback to Redis. DOs retain their state for next attempt.

---

## Phase 7: Cleanup

> Remove Redis budget code, feature flag, and any dead paths. Upstash Redis remains for rate limiting, idempotency, and health only.

### Prerequisites

- DO mode running stably for 1+ week
- No rollbacks needed during Phase 6

### Steps

- [ ] **7.1** Remove Redis Lua scripts and wrappers:
  - `apps/proxy/src/lib/budget.ts` — `checkAndReserve`, `reconcile`, `populateCache` Lua scripts
- [ ] **7.2** Remove Redis budget lookup:
  - `apps/proxy/src/lib/budget-lookup.ts` — Redis pipeline + Postgres fallback
  - This was replaced by DO `populateIfEmpty` + `checkAndReserve`
- [ ] **7.3** Remove `budget-reconcile.ts`:
  - The `reconcileReservation` wrapper is replaced by `doBudgetReconcile`
- [ ] **7.4** Keep `budget-spend.ts`:
  - `updateBudgetSpend()` is still called by `doBudgetReconcile` for Postgres write-back
- [ ] **7.5** Remove `BUDGET_ENGINE` toggle:
  - Hardcode orchestrator to DO path
  - Remove `redis` and `shadow` branches
  - Remove `BUDGET_ENGINE` from Env type and wrangler vars
- [ ] **7.6** Evaluate `ctx.redis` removal from `RequestContext`:
  - If Redis is only used for rate limiting (handled in `index.ts`, not via ctx.redis)
    and webhook cache is fully on KV — ctx.redis may be removable
  - Check if any remaining callers need it
  - If webhook `getWebhookEndpointsWithSecrets` still needs Redis for invalidation
    from dashboard, keep it; otherwise remove
- [ ] **7.7** Remove Redis webhook cache code from `webhook-cache.ts`:
  - If Phase 2 left a dual Redis/KV path, remove the Redis fallback
- [ ] **7.8** Update tests:
  - Remove tests for deleted Redis budget code
  - Update route handler tests to not mock Redis budget operations
  - Ensure DO tests cover all scenarios the old Redis tests covered
- [ ] **7.9** Update documentation:
  - `apps/proxy/CLAUDE.md` — update architecture section
  - `CLAUDE.md` (root) — update if budget enforcement is mentioned
  - `TESTING.md` — update test map

### Files removed

```
apps/proxy/src/lib/budget.ts           — DELETED (Lua scripts)
apps/proxy/src/lib/budget-lookup.ts    — DELETED (Redis lookup)
apps/proxy/src/lib/budget-reconcile.ts — DELETED (Redis reconcile wrapper)
```

### Files kept

```
apps/proxy/src/lib/budget-spend.ts     — KEPT (Postgres write-back, used by DO path)
apps/proxy/src/lib/budget-do-client.ts — KEPT (DO client)
apps/proxy/src/lib/budget-orchestrator.ts — SIMPLIFIED (DO-only, no branching)
```

### Verification

- [ ] `pnpm proxy:test` passes with updated test suite
- [ ] `pnpm typecheck` passes
- [ ] `pnpm lint` passes
- [ ] No references to deleted files remain (grep for imports)
- [ ] Manual smoke test — budget enforcement works
- [ ] `ctx.redis` is only used where still needed (rate limiting setup, remaining Redis uses)

---

## Cross-Cutting Concerns

### Redis dependency after migration

After Phase 7, Upstash Redis is still used for:
- **Rate limiting** (proxy + dashboard) — `@upstash/ratelimit` in `index.ts`
- **Dashboard idempotency** — `SET NX` in dashboard API routes
- **Health check** — `redis.ping()` in `/health/ready`

The proxy worker still needs `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` env vars.

### Test strategy per phase

| Phase | Run what | Why |
|-------|----------|-----|
| 0 | `pnpm test` + `pnpm proxy:test` + `pnpm typecheck` + `pnpm lint` | Baseline |
| 1 | `pnpm proxy:test` + `pnpm typecheck` | Infra only, no behavior change |
| 2 | `pnpm proxy:test` (inc. new KV tests) | Webhook cache path changed |
| 3 | DO tests (vitest workers pool) + `pnpm proxy:test` | DO class tested in isolation |
| 4 | `pnpm proxy:test` (all, inc. new orchestrator tests) | Route handlers rewired |
| 5 | Smoke tests against running `wrangler dev` | Shadow mode is runtime behavior |
| 6 | Full smoke test suite | Cutover — everything must work |
| 7 | `pnpm proxy:test` (updated suite) + `pnpm typecheck` | Deleted code, updated tests |

### Key files quick reference

| File | Role | Phase |
|------|------|-------|
| `wrangler.jsonc` | Bindings config | 1 |
| `src/env.ts` | Env type | 1 |
| `src/durable-objects/user-budget.ts` | DO class | 1 (skeleton), 3 (full) |
| `src/lib/cache-kv.ts` | KV cache functions | 2 |
| `src/lib/webhook-cache.ts` | Webhook cache (Redis→KV) | 2 |
| `src/lib/budget-do-client.ts` | DO client + PG write-back | 4 |
| `src/lib/budget-orchestrator.ts` | Redis/DO/shadow switch | 4 |
| `src/routes/openai.ts` | Route handler (budget wiring) | 4 |
| `src/routes/anthropic.ts` | Route handler (budget wiring) | 4 |
| `src/routes/mcp.ts` | Route handler (budget wiring) | 4 |
| `src/lib/budget.ts` | Lua scripts (DELETED Phase 7) | 7 |
| `src/lib/budget-lookup.ts` | Redis lookup (DELETED Phase 7) | 7 |
| `src/lib/budget-reconcile.ts` | Redis reconcile (DELETED Phase 7) | 7 |
| `src/lib/budget-spend.ts` | Postgres write-back (KEPT) | — |
