# Budget Enforcement Architecture & Cache Invalidation

## Root Cause Analysis: Budget Smoke Test Failures

**Date:** 2026-03-18
**Symptom:** Budget smoke tests get `200 OK` instead of `429 budget_exceeded`. Non-budget tests get `429` instead of `200` after budget tests run.
**Root cause:** Three-layer state management with incomplete test cleanup and missing auth cache invalidation.

**Resolution (2026-03-18):** Removed the `hasBudgets` early-exit from the budget orchestrator. The proxy now always calls the DO for budget checks, eliminating the 60-second enforcement bypass window. The auth cache `hasBudgets` flag and its Postgres EXISTS subquery were removed entirely. Auth cache TTL reduced from 60s to 30s.

## The Two Layers of Budget State

The proxy has two layers of budget state (the `hasBudgets` auth cache layer was removed — see Resolution above):

```
Layer 1: DO Lookup Cache (budget entities)
  ├── Location: Worker isolate module-level Map
  ├── TTL: 60 seconds (DO_LOOKUP_TTL_MS)
  ├── Source: Postgres query via lookupBudgetsForDO()
  ├── Purpose: Avoid redundant Postgres queries for DO entity list
  └── Invalidation: invalidateDoLookupCacheForUser() via /internal/budget/invalidate

Layer 2: Durable Object SQLite (authoritative budget data)
  ├── Location: Cloudflare Durable Object persistent storage
  ├── TTL: Permanent (until explicitly modified)
  ├── Source: Synced from Postgres via syncBudgets() RPC
  ├── Purpose: Transactional budget enforcement (check + reserve atomically)
  └── Invalidation: removeBudget() / resetSpend() / syncBudgets() RPCs
```

## The Request Flow

```
Request → Auth → Budget Orchestrator → DO Lookup (Layer 1) → DO Check (Layer 2)
                                              ↓                     ↓
                                     No entities in Postgres?    DO SQLite has
                                     → DO gets empty sync        budget row?
                                     → No enforcement            → enforce / skip
```

## Why Smoke Tests Fail

### Problem 1: Tests write to Redis, but proxy reads from DO

The `setupBudget()` function writes directly to Redis:
```typescript
await redis.hset(key, { maxBudget, spend, reserved, policy });
```

But the proxy's budget enforcement goes through the Durable Object, not Redis. Redis is used for a legacy fast-path that was replaced by the DO architecture. The budget data in Redis is never read by the proxy for enforcement decisions.

### Problem 2: Auth cache retains stale `hasBudgets`

When the first request authenticates, the auth cache stores `hasBudgets: true/false` for 60 seconds. If:
- Non-budget tests run first → `hasBudgets: false` is cached
- Budget tests create budgets in Postgres
- Auth cache still says `hasBudgets: false` for up to 60 seconds
- `checkBudget()` returns `skipped` immediately

### Problem 3: DO retains budget state after test cleanup

After a budget test, `afterEach` deletes Redis keys and Postgres rows, but:
- The DO still has the budget in its SQLite storage
- The next request triggers `doBudgetPopulate()` which syncs from Postgres
- If Postgres is empty, `syncBudgets([])` should purge the DO's ghost rows
- But the auth cache may say `hasBudgets: false` (from the cleanup), so the budget orchestrator skips the DO entirely
- The DO's stale state then leaks into subsequent test runs

### Problem 4: Non-budget tests get 429 after budget tests

Budget tests create budgets → DO has budget state → budget test teardown cleans Postgres/Redis but not DO → next non-budget test triggers auth → auth queries Postgres → no budgets → `hasBudgets: false` cached → BUT the DO still has the budget from the previous test.

If the auth cache hasn't expired yet (still has `hasBudgets: true` from during the budget test), the request goes through the full enforcement pipeline, hits the DO, which still has the restrictive budget, and returns 429.

## The Fix

### 1. Budget cleanup must go through the internal API

Instead of directly manipulating Redis/Postgres, smoke tests should call `/internal/budget/invalidate` with `action: "remove"` to properly clean up:
- DO SQLite storage (via `doBudgetRemove`)
- DO lookup cache (via `invalidateDoLookupCacheForUser`)

### 2. Auth cache must be invalidated when budgets change

The internal invalidation endpoint should also clear the auth cache entry for the affected user's API key. Add `invalidateAuthCacheForUser()` to `api-key-auth.ts`.

### 3. Budget setup must go through the DO

Instead of writing to Redis directly, smoke tests should:
1. Insert budget row into Postgres
2. Call the proxy to trigger a request (which will sync to DO via `doBudgetPopulate`)
3. OR call the internal invalidation endpoint to trigger DO sync

### 4. Redis writes are unnecessary

The smoke tests write to Redis (`redis.hset`) but the proxy doesn't read budget data from Redis for enforcement. The Redis writes in `setupBudget()` are vestigial from an older architecture. Remove them.

### Problem 5: `waitUntil` reconciliation races with test cleanup

After a request completes, reconciliation runs in `waitUntil()` — asynchronously, outside the request lifecycle. This reconciliation writes actual spend back to the DO. If a test's `afterEach` cleanup runs before reconciliation completes:

1. Test warm-up request completes (200) → spend reserved in DO
2. `afterEach` calls `doBudgetRemove` → user budget deleted from DO
3. Reconciliation from step 1 runs (via `waitUntil` or queue consumer) → writes spend back to DO, re-creating the budget row with non-zero spend
4. Next test's `setupBudget` calls `syncBudgets` → UPSERT preserves the stale spend (spend is not overwritten on conflict)
5. Next test sees accumulated spend from the previous test

This is a fundamental race condition in the test architecture. The smoke tests cannot reliably clean up DO state because `waitUntil` tasks are not awaitable from outside the Worker.

**Applied fixes:**
- `removeBudget()` now also deletes all associated reservations in a transaction, preventing late-arriving reconciliation from affecting a re-created budget row
- Added `sync` action to `/internal/budget/invalidate` endpoint that forces Postgres→DO sync (bypasses Worker isolate caches)
- Added 5-second `afterEach` delay to wait for `waitUntil` reconciliation before cleanup
- DO's `checkAndReserve()` now checks ALL budget rows in its SQLite storage, not just the entities passed by the Worker (handles stale DO lookup cache)

**Remaining limitation:** These fixes address the reconciliation race but NOT the multi-isolate cache problem (see Problem 6)

### Problem 6: Multi-isolate cache invalidation

Cloudflare Workers distribute requests across multiple isolates. Module-level caches (auth cache, DO lookup cache) are per-isolate. The `/internal/budget/invalidate` endpoint invalidates caches in the isolate that handles the invalidation request, but other isolates retain stale data until their cache TTL expires (60 seconds). This means budget changes propagate with up to 60-second delay across the full Worker fleet.

## Resolved: Multi-Isolate Auth Cache (`hasBudgets`)

**Fixed 2026-03-18.** The `hasBudgets` early-exit was removed entirely. The proxy now always calls the DO for budget checks. The `hasBudgets` field was removed from `ApiKeyIdentity`, `AuthResult`, and the auth SQL query. Auth cache TTL was reduced from 60s to 30s. Budget creation/deletion takes effect immediately on the next request (no stale-cache window).

## Production Implications

- **Budget creation in the dashboard** inserts into Postgres and calls `/internal/budget/invalidate` which invalidates DO lookup caches. The next request syncs from Postgres to DO and enforces immediately.
- **Budget deletion** propagates through the same path. No stale-cache enforcement bypass window.
- **The DO-level all-entity check** means ALL budget rows in SQLite are checked — even if the Worker's entity list was incomplete. This is a defense-in-depth improvement.
- **Auth cache TTL** is 30s (reduced from 60s). Only caches userId/keyId/hasWebhooks — no budget state.
