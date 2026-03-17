# NullSpend: Revised Redis → Durable Objects Migration Spec

> **Synthesized from**: Deep DO research (platform docs, known issues, pricing, architecture patterns) + Claude Code codebase audit (actual Redis usage inventory, Vercel constraint discovery, per-area recommendations). This is the optimal migration plan.

---

## Executive Summary: What Migrates, What Stays

The Claude Code assessment revealed a critical constraint the initial research missed: **the dashboard runs on Vercel and cannot access Cloudflare Durable Objects**. This means rate limiting, idempotency, and health checks must stay on Upstash Redis. The revised plan is surgical:

| Component | Current | Target | Rationale |
|---|---|---|---|
| **Budget enforcement** | Upstash Redis (3 Lua scripts) | **Cloudflare Durable Objects** | Core product — DO eliminates Lua, gives sub-ms atomicity |
| **Webhook cache** | Upstash Redis (GET/SET+EX) | **Workers KV** | Read-heavy, native TTL, CF-native |
| **Auth cache** | Upstash Redis (GET/SET+EX) | **Workers KV** | Same pattern as webhook cache |
| **Negative budget cache** | Upstash Redis | **Worker in-memory Map** | Zero-latency, ephemeral, zero-cost |
| **Proxy rate limiting** | @upstash/ratelimit | **Keep Upstash** | Battle-tested lib, reimplementation = risk for zero benefit |
| **Dashboard rate limiting** | @upstash/ratelimit | **Keep Upstash** | Vercel can't reach DOs — no alternative |
| **Dashboard idempotency** | Upstash Redis SET NX | **Keep Upstash** | Vercel-only, working, simple |
| **Health check** | redis.ping() | **Keep Upstash** | Trivial, uses whatever Redis exists |

**Net result**: The proxy Worker loses its Redis dependency for budget enforcement and caching. Upstash Redis remains for rate limiting (both proxy and dashboard), idempotency (dashboard), and health. This eliminates 3 Lua scripts and ~150 lines of the most complex Redis code while keeping battle-tested libraries for everything else.

---

## Part 1: Architecture Design Decisions

### Decision 1: One DO Per User, Not Per Entity

The initial research proposed one DO per budget entity (one for the API key, one for the user), requiring a saga pattern for multi-entity budget checks. Claude Code identified a better approach: **one DO per user holding all that user's budgets.**

This is the right call because:

**It preserves the current Lua script's strongest property.** The existing `checkAndReserve` Lua script checks ALL entity budgets (API key + user) in a single atomic operation. A per-user DO does the same — all budget entities for that user live in one DO instance, checked in one synchronous call. No saga, no compensation, no cross-DO coordination.

**The data model maps cleanly.** Each user has 1-10 API keys, each potentially with its own budget, plus a user-level budget. A single SQLite table in the DO stores all of them:

```
UserBudgetDO (one per user_id)
  ├── budgets table: [{entity_type, entity_id, max_budget, spend, reserved, policy, reset_interval, period_start}]
  ├── reservations table: [{id, entity_ids[], amount, created_at, expires_at}]
  └── in-memory cache of budget state for zero-latency reads
```

**The contention risk is manageable.** A single user is unlikely to have API keys generating >500 combined RPS. If they do, that's a scaling problem to solve with monitoring and per-key sharding — not a reason to pre-optimize with a saga pattern now.

**When to revisit.** If NullSpend adds team-level or org-level budgets (hierarchical budgets), the per-user model may need to evolve to a per-team DO that holds all team member budgets. But that's a Phase 2+ concern.

### Decision 2: SQLite Storage, Not KV Storage

Use `new_sqlite_classes` in wrangler.jsonc. This is non-reversible — KV-backed DOs cannot migrate to SQLite later. SQLite is correct for NullSpend because:

- **ACID transactions via `transactionSync()`** — atomic read-check-write for budget enforcement
- **Relational queries** — `WHERE entity_type = ? AND entity_id = ?` for budget lookups
- **10GB per DO** (GA since April 2025) — more than enough for any user's budget history
- **Sub-millisecond reads** from the local SQLite database colocated with the DO process

### Decision 3: Workers KV for All Caching, Not DOs

Auth cache, webhook cache, and negative budget markers all move to Workers KV. Both assessments independently reached this conclusion:

- **Native TTL** (`expirationTtl`) — no alarm-based cleanup needed
- **Edge caching** — reads hit the nearest Cloudflare PoP, sub-5ms globally
- **$0.50/million reads** — dramatically cheaper than DO requests for read-heavy patterns
- **Simple API** — `get(key, "json")` / `put(key, value, { expirationTtl: 300 })`

### Decision 4: Keep @upstash/ratelimit Everywhere

This was the biggest correction from the Claude Code assessment. The research proposed migrating proxy rate limiting to DOs. Three factors make this wrong:

1. **The dashboard runs on Vercel.** DOs are only accessible from Cloudflare Workers. If the proxy uses DO-based rate limiting and the dashboard uses Upstash, you maintain two rate limiting implementations. That's complexity for zero benefit.

2. **@upstash/ratelimit is purpose-built.** Sliding window, token bucket, fixed window — all available via one line of config. The library handles edge cases (window boundaries, cleanup, ephemeral caching for already-blocked keys) that took years of production usage to discover.

3. **Rate limiting is the highest-volume operation.** Every request hits it twice (IP + key). At 10M requests/month, that's 20M DO requests just for rate limiting. The per-request DO billing makes this the worst possible DO use case.

### Decision 5: Feature-Flagged Migration with Shadow Mode

A `BUDGET_ENGINE` environment variable controls the rollout:

- `redis` — current behavior, no DOs involved (default)
- `shadow` — Redis is primary, DOs receive shadow writes via `waitUntil()` for validation
- `durable-objects` — DOs are primary for budget enforcement
- Redis code remains intact until validation is complete

---

## Part 2: Wrangler Configuration

```jsonc
// apps/proxy/wrangler.jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "nullspend",
  "main": "src/index.ts",
  "compatibility_date": "2026-03-09",
  "compatibility_flags": ["nodejs_compat"],
  "vars": {
    "PROXY_RATE_LIMIT": "600",
    "BUDGET_ENGINE": "redis"
  },
  "hyperdrive": [
    {
      "binding": "HYPERDRIVE",
      "id": "ae987aca79704f1fa94bf2c4bb761f14"
    }
  ],
  // NEW: Workers KV for auth + webhook caching
  "kv_namespaces": [
    { "binding": "CACHE_KV", "id": "<create-via-wrangler-kv-namespace-create>" }
  ],
  // NEW: Durable Object for budget enforcement
  "durable_objects": {
    "bindings": [
      {
        "name": "USER_BUDGET",
        "class_name": "UserBudgetDO"
      }
    ]
  },
  // NEW: Must use new_sqlite_classes (not new_classes — cannot migrate later)
  "migrations": [
    {
      "tag": "v1",
      "new_sqlite_classes": ["UserBudgetDO"]
    }
  ],
  // NEW: Cron trigger for budget period resets + reconciliation
  "triggers": {
    "crons": ["*/5 * * * *"]
  }
}
```

**Pre-deploy setup commands:**
```bash
# Create KV namespace
wrangler kv namespace create CACHE_KV
# Copy the ID into wrangler.jsonc

# Verify DO binding works locally
wrangler dev --test-scheduled
```

### Environment Type Definition

```typescript
// src/env.ts (updated)
import type { UserBudgetDO } from "./durable-objects/user-budget";

export interface Env {
  // Existing — kept for rate limiting, idempotency, health
  UPSTASH_REDIS_REST_URL: string;
  UPSTASH_REDIS_REST_TOKEN: string;
  HYPERDRIVE: Hyperdrive;
  PROXY_RATE_LIMIT: string;

  // NEW: migration control
  BUDGET_ENGINE: "redis" | "durable-objects" | "shadow";

  // NEW: Durable Object binding
  USER_BUDGET: DurableObjectNamespace<UserBudgetDO>;

  // NEW: Workers KV for auth + webhook + negative budget caching
  CACHE_KV: KVNamespace;
}
```

---

## Part 3: UserBudgetDO — Complete Implementation

This single DO class replaces all three Redis Lua scripts. The per-user model means `checkAndReserve` across multiple entity budgets is a single synchronous operation within one DO — identical to how the Lua script works today.

```typescript
// src/durable-objects/user-budget.ts
import { DurableObject } from "cloudflare:workers";

// ── Types ──────────────────────────────────────────────────────────

interface BudgetRow {
  entity_type: string;   // "api_key" | "user"
  entity_id: string;
  max_budget: number;    // microdollars
  spend: number;         // microdollars
  reserved: number;      // microdollars
  policy: string;        // "strict_block" | "soft_block" | "warn"
  reset_interval: string | null;  // "daily" | "weekly" | "monthly" | null
  period_start: number;  // epoch ms
}

interface CheckResult {
  status: "approved" | "denied";
  reservationId?: string;
  deniedEntity?: string;
  remaining?: number;
  maxBudget?: number;
  spend?: number;
}

interface ReconcileResult {
  status: "reconciled" | "not_found";
  spends?: Record<string, number>;
}

// ── Helpers ─────────────────────────────────────────────────────────

/** Compute the start of the current budget period. */
function currentPeriodStart(interval: string, periodStart: number, now: number): number {
  let start = periodStart;
  const msPerDay = 86_400_000;
  const intervalMs: Record<string, number> = {
    daily: msPerDay,
    weekly: 7 * msPerDay,
    monthly: 30 * msPerDay,  // approximate; exact month math below
    yearly: 365 * msPerDay,
  };

  // Fast path for daily/weekly (fixed intervals)
  if (interval === "daily" || interval === "weekly") {
    const step = intervalMs[interval];
    while (start + step <= now) {
      start += step;
    }
    return start;
  }

  // Month-accurate for monthly/yearly
  if (interval === "monthly") {
    const d = new Date(start);
    while (true) {
      const next = new Date(d);
      next.setUTCMonth(next.getUTCMonth() + 1);
      if (next.getTime() > now) break;
      d.setUTCMonth(d.getUTCMonth() + 1);
    }
    return d.getTime();
  }

  if (interval === "yearly") {
    const d = new Date(start);
    while (true) {
      const next = new Date(d);
      next.setUTCFullYear(next.getUTCFullYear() + 1);
      if (next.getTime() > now) break;
      d.setUTCFullYear(d.getUTCFullYear() + 1);
    }
    return d.getTime();
  }

  return start;
}

// ── Durable Object ──────────────────────────────────────────────────

export class UserBudgetDO extends DurableObject {
  private budgets: Map<string, BudgetRow> = new Map();
  private initialized = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.initSchema();
      this.loadBudgets();
      this.initialized = true;
    });
  }

  /** One-time schema creation. Tracked via _schema_version table. */
  private initSchema(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS _schema_version (version INTEGER PRIMARY KEY)
    `);
    const row = this.ctx.storage.sql.exec<{ version: number }>(
      "SELECT MAX(version) as version FROM _schema_version"
    ).toArray()[0];
    const currentVersion = row?.version ?? 0;

    if (currentVersion < 1) {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS budgets (
          entity_type TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          max_budget INTEGER NOT NULL DEFAULT 0,
          spend INTEGER NOT NULL DEFAULT 0,
          reserved INTEGER NOT NULL DEFAULT 0,
          policy TEXT NOT NULL DEFAULT 'strict_block',
          reset_interval TEXT,
          period_start INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (entity_type, entity_id)
        )
      `);
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS reservations (
          id TEXT PRIMARY KEY,
          amount INTEGER NOT NULL,
          entity_keys TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        )
      `);
      this.ctx.storage.sql.exec(
        "INSERT OR IGNORE INTO _schema_version (version) VALUES (1)"
      );
    }
  }

  /** Load all budgets into in-memory Map for zero-latency reads. */
  private loadBudgets(): void {
    const rows = this.ctx.storage.sql.exec<BudgetRow>(
      "SELECT * FROM budgets"
    ).toArray();
    this.budgets.clear();
    for (const row of rows) {
      this.budgets.set(`${row.entity_type}:${row.entity_id}`, row);
    }
  }

  // ── RPC Methods (called from Worker via stub.method()) ────────────

  /**
   * Replaces checkAndReserve Lua script.
   * Checks ALL entity budgets atomically (single-threaded, no interleaving).
   * Handles budget period resets inline (eliminates LiteLLM's reset race bug).
   */
  async checkAndReserve(
    entities: Array<{ type: string; id: string }>,
    estimateMicrodollars: number,
    reservationTtlMs: number = 30_000,
  ): Promise<CheckResult> {
    const reservationId = crypto.randomUUID();
    const now = Date.now();

    // Single transactionSync = atomic read-check-reset-reserve
    // No event loop yield = no interleaving = no race conditions
    let result: CheckResult = { status: "approved", reservationId };

    this.ctx.storage.transactionSync(() => {
      // Phase 1: Check all entities (with inline period reset)
      for (const entity of entities) {
        const key = `${entity.type}:${entity.id}`;
        const row = this.ctx.storage.sql.exec<BudgetRow>(
          "SELECT * FROM budgets WHERE entity_type = ? AND entity_id = ?",
          entity.type, entity.id
        ).toArray()[0];

        if (!row) continue; // No budget configured = no limit

        // Inline budget period reset (replaces cron-only approach)
        if (row.reset_interval && row.period_start > 0) {
          const newPeriodStart = currentPeriodStart(
            row.reset_interval, row.period_start, now
          );
          if (newPeriodStart > row.period_start) {
            this.ctx.storage.sql.exec(
              `UPDATE budgets SET spend = 0, reserved = 0, period_start = ?
               WHERE entity_type = ? AND entity_id = ?`,
              newPeriodStart, entity.type, entity.id
            );
            row.spend = 0;
            row.reserved = 0;
            row.period_start = newPeriodStart;
          }
        }

        const remaining = row.max_budget - row.spend - row.reserved;

        if (row.policy === "strict_block" && estimateMicrodollars > remaining) {
          result = {
            status: "denied",
            deniedEntity: key,
            remaining,
            maxBudget: row.max_budget,
            spend: row.spend,
          };
          return; // Exit transactionSync — no reservation made
        }
      }

      // Phase 2: Reserve across all entities that have budgets
      const entityKeys: string[] = [];
      for (const entity of entities) {
        const key = `${entity.type}:${entity.id}`;
        const exists = this.ctx.storage.sql.exec<{ c: number }>(
          "SELECT COUNT(*) as c FROM budgets WHERE entity_type = ? AND entity_id = ?",
          entity.type, entity.id
        ).toArray()[0];

        if (exists && exists.c > 0) {
          this.ctx.storage.sql.exec(
            "UPDATE budgets SET reserved = reserved + ? WHERE entity_type = ? AND entity_id = ?",
            estimateMicrodollars, entity.type, entity.id
          );
          entityKeys.push(key);
        }
      }

      // Store reservation for crash recovery
      this.ctx.storage.sql.exec(
        `INSERT INTO reservations (id, amount, entity_keys, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
        reservationId,
        estimateMicrodollars,
        JSON.stringify(entityKeys),
        now,
        now + reservationTtlMs
      );
    });

    // Update in-memory cache
    this.loadBudgets();

    // Schedule alarm for reservation expiry
    if (result.status === "approved") {
      const nextExpiry = now + reservationTtlMs;
      const currentAlarm = await this.ctx.storage.getAlarm();
      if (!currentAlarm || currentAlarm > nextExpiry) {
        await this.ctx.storage.setAlarm(nextExpiry);
      }
    }

    return result;
  }

  /**
   * Replaces reconcile Lua script.
   * Settles reservation after actual cost is known.
   */
  async reconcile(
    reservationId: string,
    actualCostMicrodollars: number,
  ): Promise<ReconcileResult> {
    const row = this.ctx.storage.sql.exec<{
      amount: number;
      entity_keys: string;
    }>(
      "SELECT amount, entity_keys FROM reservations WHERE id = ?",
      reservationId
    ).toArray()[0];

    if (!row) return { status: "not_found" };

    const entityKeys: string[] = JSON.parse(row.entity_keys);
    const spends: Record<string, number> = {};

    this.ctx.storage.transactionSync(() => {
      for (const key of entityKeys) {
        const [entityType, entityId] = key.split(":");

        // Increment spend, decrement reserved (with clamping)
        this.ctx.storage.sql.exec(
          `UPDATE budgets SET
            spend = spend + ?,
            reserved = MAX(0, reserved - ?)
           WHERE entity_type = ? AND entity_id = ?`,
          actualCostMicrodollars, row.amount, entityType, entityId
        );

        const updated = this.ctx.storage.sql.exec<{ spend: number }>(
          "SELECT spend FROM budgets WHERE entity_type = ? AND entity_id = ?",
          entityType, entityId
        ).toArray()[0];
        if (updated) spends[key] = updated.spend;
      }

      this.ctx.storage.sql.exec(
        "DELETE FROM reservations WHERE id = ?",
        reservationId
      );
    });

    this.loadBudgets();
    return { status: "reconciled", spends };
  }

  /**
   * Replaces populateCache Lua script.
   * Atomic skip-if-exists population from Postgres.
   */
  async populateIfEmpty(
    entityType: string,
    entityId: string,
    maxBudget: number,
    spend: number,
    policy: string,
    resetInterval: string | null,
    periodStart: number,
  ): Promise<boolean> {
    const key = `${entityType}:${entityId}`;
    if (this.budgets.has(key)) return false;

    this.ctx.storage.sql.exec(
      `INSERT OR IGNORE INTO budgets
       (entity_type, entity_id, max_budget, spend, reserved, policy, reset_interval, period_start)
       VALUES (?, ?, ?, ?, 0, ?, ?, ?)`,
      entityType, entityId, maxBudget, spend, policy,
      resetInterval, periodStart
    );

    this.loadBudgets();
    return true;
  }

  /** Read-only budget state (for dashboard queries or debugging). */
  async getBudgetState(): Promise<BudgetRow[]> {
    return Array.from(this.budgets.values());
  }

  /**
   * Alarm handler: clean up expired reservations.
   * Replaces Redis TTL-based reservation expiry.
   */
  async alarm(): Promise<void> {
    const now = Date.now();
    const expired = this.ctx.storage.sql.exec<{
      id: string;
      amount: number;
      entity_keys: string;
    }>(
      "SELECT id, amount, entity_keys FROM reservations WHERE expires_at <= ?",
      now
    ).toArray();

    if (expired.length > 0) {
      this.ctx.storage.transactionSync(() => {
        for (const rsv of expired) {
          const keys: string[] = JSON.parse(rsv.entity_keys);
          for (const key of keys) {
            const [entityType, entityId] = key.split(":");
            this.ctx.storage.sql.exec(
              "UPDATE budgets SET reserved = MAX(0, reserved - ?) WHERE entity_type = ? AND entity_id = ?",
              rsv.amount, entityType, entityId
            );
          }
          this.ctx.storage.sql.exec(
            "DELETE FROM reservations WHERE id = ?", rsv.id
          );
        }
      });
      this.loadBudgets();
    }

    // Reschedule for next expiring reservation
    const next = this.ctx.storage.sql.exec<{ next_exp: number | null }>(
      "SELECT MIN(expires_at) as next_exp FROM reservations"
    ).toArray()[0];
    if (next?.next_exp) {
      await this.ctx.storage.setAlarm(next.next_exp);
    }
  }
}
```

### Why This Implementation Is Correct

**Atomicity**: `transactionSync()` executes synchronously — no `await`, no event loop yield, no interleaving. This is the DO equivalent of a Redis Lua script. The entire check-reset-reserve sequence is one atomic unit.

**Inline period reset**: The `checkAndReserve` method checks if the budget period has expired and resets spend to zero *within the same transactionSync*. This eliminates LiteLLM's documented race condition (issue #14266) where `budget_reset_at` advances but spend doesn't zero.

**Reservation crash recovery**: Reservations have explicit `expires_at` timestamps. The alarm handler cleans up expired reservations, releasing reserved budget. This replaces Redis key TTL.

**Global uniqueness protection**: Every `checkAndReserve` call performs storage operations, which triggers the fencing mechanism that detects stale DO instances during network partitions.

**Reserved clamping**: `MAX(0, reserved - ?)` prevents reserved from going negative (matching the clamping logic in the current `reconcile` Lua script).

---

## Part 4: Workers KV Cache Implementation

```typescript
// src/lib/cache-kv.ts
// Replaces Redis auth cache, webhook cache, and negative budget markers

const AUTH_TTL = 300;       // 5 minutes
const WEBHOOK_TTL = 300;    // 5 minutes
const NO_BUDGET_TTL = 300;  // 5 minutes

// ── Auth Cache ──────────────────────────────────────────────────────

interface CachedAuth {
  keyId: string;
  userId: string;
  teamId: string;
  permissions: string[];
  hasBudgets: boolean;
  cachedAt: number;
}

export async function getCachedAuth(
  kv: KVNamespace,
  apiKeyHash: string,
): Promise<CachedAuth | null> {
  return kv.get<CachedAuth>(`auth:${apiKeyHash}`, "json");
}

export async function setCachedAuth(
  kv: KVNamespace,
  apiKeyHash: string,
  auth: CachedAuth,
): Promise<void> {
  await kv.put(`auth:${apiKeyHash}`, JSON.stringify(auth), {
    expirationTtl: AUTH_TTL,
  });
}

// ── Webhook Config Cache ────────────────────────────────────────────

interface CachedWebhookConfig {
  endpoints: Array<{
    id: string;
    url: string;
    eventTypes: string[];
  }>;
}

export async function getCachedWebhookConfig(
  kv: KVNamespace,
  userId: string,
): Promise<CachedWebhookConfig | null> {
  return kv.get<CachedWebhookConfig>(`webhook:${userId}`, "json");
}

export async function setCachedWebhookConfig(
  kv: KVNamespace,
  userId: string,
  config: CachedWebhookConfig,
): Promise<void> {
  await kv.put(`webhook:${userId}`, JSON.stringify(config), {
    expirationTtl: WEBHOOK_TTL,
  });
}

// ── Negative Budget Cache ───────────────────────────────────────────
// For entities confirmed to have no budgets — avoids DO lookup

export async function isNoBudgetCached(
  kv: KVNamespace,
  apiKeyHash: string,
): Promise<boolean> {
  const val = await kv.get(`no-budget:${apiKeyHash}`);
  return val === "1";
}

export async function setCachedNoBudget(
  kv: KVNamespace,
  apiKeyHash: string,
): Promise<void> {
  await kv.put(`no-budget:${apiKeyHash}`, "1", {
    expirationTtl: NO_BUDGET_TTL,
  });
}
```

---

## Part 5: Worker Integration — How the Fetch Handler Calls DOs

```typescript
// src/lib/budget-do-client.ts
// Drop-in replacement for the Redis budget functions

import type { Env } from "../env";

interface BudgetEntity {
  type: string;  // "api_key" | "user"
  id: string;
}

export async function doBudgetCheck(
  env: Env,
  userId: string,
  entities: BudgetEntity[],
  estimateMicrodollars: number,
) {
  // One DO per user — all entity budgets checked in one call
  const doId = env.USER_BUDGET.idFromName(userId);
  const stub = env.USER_BUDGET.get(doId);

  return stub.checkAndReserve(
    entities.map((e) => ({ type: e.type, id: e.id })),
    estimateMicrodollars,
  );
}

export async function doBudgetReconcile(
  env: Env,
  userId: string,
  reservationId: string,
  actualCostMicrodollars: number,
) {
  const doId = env.USER_BUDGET.idFromName(userId);
  const stub = env.USER_BUDGET.get(doId);

  return stub.reconcile(reservationId, actualCostMicrodollars);
}

export async function doBudgetPopulate(
  env: Env,
  userId: string,
  entityType: string,
  entityId: string,
  maxBudget: number,
  spend: number,
  policy: string,
  resetInterval: string | null,
  periodStart: number,
) {
  const doId = env.USER_BUDGET.idFromName(userId);
  const stub = env.USER_BUDGET.get(doId);

  return stub.populateIfEmpty(
    entityType, entityId, maxBudget, spend, policy,
    resetInterval, periodStart,
  );
}
```

### Modified Route Handler (OpenAI example)

The key change in the route handler is minimal — swap `checkAndReserve(ctx.redis, ...)` for `doBudgetCheck(env, ...)`:

```typescript
// In openai.ts route handler (conceptual diff)

// BEFORE (Redis):
// checkResult = await checkAndReserve(ctx.redis, entityKeys, estimate);

// AFTER (DO):
if (env.BUDGET_ENGINE === "durable-objects") {
  const checkResult = await doBudgetCheck(
    env,
    auth.userId,  // Routes all entity budgets to one DO
    budgetEntities,
    estimate,
  );
  if (checkResult.status === "denied") {
    return errorResponse("budget_exceeded", "...", 429, {
      remaining: checkResult.remaining,
      maxBudget: checkResult.maxBudget,
      spend: checkResult.spend,
    });
  }
  reservationId = checkResult.reservationId;
} else {
  // Existing Redis path (kept during migration)
  const checkResult = await checkAndReserve(ctx.redis, entityKeys, estimate);
  // ... existing logic
}

// Reconciliation in waitUntil — same pattern, different backend
ctx.waitUntil(
  env.BUDGET_ENGINE === "durable-objects"
    ? doBudgetReconcile(env, auth.userId, reservationId!, actualCost)
    : reconcileReservation(ctx.redis, reservationId!, actualCost, budgetEntities, ctx.connectionString)
);
```

---

## Part 6: Known Issues Registry

### Critical

**1. Platform outages disable budget enforcement.**
Multiple CF outages in 2025: June 12 (2h28m, SQLite DOs specifically affected), November 18 (3h), December 5 (25m). Regional DO errors in July, October, March.
*Mitigation*: Fail-closed by default (reject requests when DO is unreachable). Configurable per-key `failOpenMode` for agents that must never stop. Log all bypass events for post-incident reconciliation.

**2. Global uniqueness violation during network partitions.**
Two instances of the same DO can briefly coexist. A stale instance using only in-memory state could authorize double-spending.
*Mitigation*: The `UserBudgetDO.checkAndReserve()` always performs `transactionSync()` which accesses storage and triggers the fencing check. Never add a pure in-memory fast path.

### High

**3. Single-location model adds cross-region latency.**
DOs run in one datacenter. Requests from distant regions add 50-200ms. Location hints are best-effort.
*Mitigation*: Use `locationHint` when creating stubs. Monitor p50/p99 per region. For the current user base (mostly US), this is likely <10ms overhead.

**4. Per-DO throughput ceiling of ~1,000 RPS.**
A single user with extremely high-volume API keys could overwhelm their `UserBudgetDO`.
*Mitigation*: Monitor for `.overloaded` errors. Most users are well under this. If hot users emerge, implement per-key sharding only for those specific users.

**5. Input gate race condition with non-storage I/O.**
If `fetch()` is called between reading and writing budget state, other requests can interleave.
*Mitigation*: All budget logic lives inside `transactionSync()` — pure synchronous SQL, no external I/O. Enforce this as a code review rule.

### Medium

**6. In-memory state loss on eviction (70-140s idle).**
*Mitigation*: `blockConcurrencyWhile()` in constructor reloads from SQLite. All critical state is in SQLite.

**7. Only one alarm per DO instance.**
*Mitigation*: Track `MIN(expires_at)` across all reservations. Alarm handler processes all expired, reschedules for next.

**8. SQLite billing activated January 2026.**
$1.00/million rows written after 50M included. Budget operations generate ~2-4 writes per request.
*Mitigation*: Monitor SQLite billing in CF dashboard. At 1M requests/month = ~4M writes/month, well within free tier.

**9. Code version skew during deployments.**
Workers and DOs may briefly run different code versions.
*Mitigation*: Design RPC methods with optional parameters. Never remove/rename methods — add new ones.

### Low

**10. Cannot migrate from KV-backed to SQLite-backed DOs.**
*Mitigation*: Using `new_sqlite_classes` from day one. Already handled in wrangler config.

**11. Vendor lock-in.**
DOs are entirely Cloudflare-specific.
*Mitigation*: Postgres remains the source of truth. DOs are an acceleration layer. If CF migration is ever needed, the DO layer can be replaced with any actor framework + Redis.

---

## Part 7: Cost Analysis

| Monthly Requests | Upstash Redis (budget ops only) | DO (per-user model) | Notes |
|---|---|---|---|
| 10K | $0 (free tier) | $0 (included in $5 Workers plan) | Upstash wins at tiny scale |
| 100K | $0.60 | $0 (within 1M included) | Break-even territory |
| 300K | $1.80 | $0 (within 1M included) | **DO wins** |
| 1M | $6.00 | ~$0.15 (marginal requests) | **DO saves ~$5.85** |
| 10M | $10.00 (Fixed plan) | ~$3.50 | **DO saves ~$6.50** |

**Assumptions**: Per-user DO model means 1 DO request for checkAndReserve + 1 for reconcile = 2 DO requests per proxied request (vs. 3+ Redis commands for Lua script + pipeline). SQLite writes are ~3 per request (budget update + reservation insert + reservation delete). Upstash PAYG at $0.20/100K commands; Fixed 250MB plan at $10/month for 10M+.

**Note**: Upstash Redis is NOT eliminated. It remains for rate limiting ($0.20/100K × ~2M rate limit commands at 1M requests = $4.00/month). Total infrastructure cost at 1M requests: ~$4.15/month (DO budget + Upstash rate limiting) vs ~$10.00/month (Upstash everything).

---

## Part 8: Testing Strategy

```typescript
// src/__tests__/user-budget-do.test.ts
import { env, runDurableObjectAlarm } from "cloudflare:test";
import { describe, it, expect } from "vitest";

describe("UserBudgetDO", () => {
  function getStub(userId: string) {
    return env.USER_BUDGET.get(env.USER_BUDGET.idFromName(userId));
  }

  it("populates and checks budget within limit", async () => {
    const stub = getStub("user-1");
    await stub.populateIfEmpty("api_key", "key-1", 50_000_000, 0, "strict_block", null, 0);

    const result = await stub.checkAndReserve(
      [{ type: "api_key", id: "key-1" }], 10_000_000
    );
    expect(result.status).toBe("approved");
  });

  it("denies when budget exceeded", async () => {
    const stub = getStub("user-2");
    await stub.populateIfEmpty("api_key", "key-2", 10_000_000, 8_000_000, "strict_block", null, 0);

    const result = await stub.checkAndReserve(
      [{ type: "api_key", id: "key-2" }], 5_000_000
    );
    expect(result.status).toBe("denied");
    expect(result.remaining).toBe(2_000_000);
  });

  it("checks multiple entities atomically — most restrictive wins", async () => {
    const stub = getStub("user-3");
    await stub.populateIfEmpty("user", "user-3", 100_000_000, 0, "strict_block", null, 0);
    await stub.populateIfEmpty("api_key", "key-3", 5_000_000, 4_000_000, "strict_block", null, 0);

    // User budget has room, but API key budget is nearly full
    const result = await stub.checkAndReserve(
      [{ type: "user", id: "user-3" }, { type: "api_key", id: "key-3" }],
      2_000_000
    );
    expect(result.status).toBe("denied");
    expect(result.deniedEntity).toBe("api_key:key-3");
  });

  it("reconciles actual cost correctly", async () => {
    const stub = getStub("user-4");
    await stub.populateIfEmpty("api_key", "key-4", 50_000_000, 0, "strict_block", null, 0);

    const check = await stub.checkAndReserve(
      [{ type: "api_key", id: "key-4" }], 20_000_000
    );
    expect(check.status).toBe("approved");

    const reconcile = await stub.reconcile(check.reservationId!, 15_000_000);
    expect(reconcile.status).toBe("reconciled");

    const state = await stub.getBudgetState();
    const budget = state.find((b) => b.entity_id === "key-4")!;
    expect(budget.spend).toBe(15_000_000);
    expect(budget.reserved).toBe(0);
  });

  it("inline period reset zeros spend on expired daily budget", async () => {
    const stub = getStub("user-5");
    const yesterday = Date.now() - 86_400_000 - 1000;
    await stub.populateIfEmpty("api_key", "key-5", 50_000_000, 50_000_000, "strict_block", "daily", yesterday);

    // Budget is fully spent but period expired → should reset and approve
    const result = await stub.checkAndReserve(
      [{ type: "api_key", id: "key-5" }], 10_000_000
    );
    expect(result.status).toBe("approved");
  });

  it("alarm cleans up expired reservations", async () => {
    const stub = getStub("user-6");
    await stub.populateIfEmpty("api_key", "key-6", 50_000_000, 0, "strict_block", null, 0);

    await stub.checkAndReserve(
      [{ type: "api_key", id: "key-6" }], 20_000_000, 1 // 1ms TTL
    );
    await new Promise((r) => setTimeout(r, 10));
    await runDurableObjectAlarm(stub);

    const state = await stub.getBudgetState();
    expect(state.find((b) => b.entity_id === "key-6")!.reserved).toBe(0);
  });

  it("concurrent requests serialize correctly", async () => {
    const stub = getStub("user-7");
    await stub.populateIfEmpty("api_key", "key-7", 50_000_000, 0, "strict_block", null, 0);

    // Two concurrent requests each wanting 30M against 50M budget
    const [a, b] = await Promise.all([
      stub.checkAndReserve([{ type: "api_key", id: "key-7" }], 30_000_000),
      stub.checkAndReserve([{ type: "api_key", id: "key-7" }], 30_000_000),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual(["approved", "denied"]);
  });
});
```

---

## Part 9: Deployment Sequence

### Week 1: Infrastructure Setup
1. `wrangler kv namespace create CACHE_KV` → copy ID into wrangler.jsonc
2. Add DO binding, SQLite migration, KV binding, cron trigger to wrangler.jsonc
3. Create `UserBudgetDO` class (exported from index.ts)
4. Deploy with `BUDGET_ENGINE=redis` — DOs exist but unused
5. Run full test suite locally with `wrangler dev --test-scheduled`
6. Verify DO appears in CF dashboard → Workers → Durable Objects

### Week 2: Auth/Webhook Cache Migration (Lowest Risk)
1. Implement Workers KV cache functions (auth, webhook, negative budget)
2. Wire KV cache into proxy routes, replacing Redis cache calls
3. Monitor KV hit rates and latency
4. Keep Redis auth cache code temporarily for rollback
5. Remove Redis auth/webhook cache code after 1 week stable

### Week 3: Shadow Mode for Budget Enforcement
1. Set `BUDGET_ENGINE=shadow`
2. Redis remains primary for all budget decisions
3. `waitUntil()` sends parallel DO writes for every budget operation
4. Log all Redis-vs-DO result discrepancies
5. Fix any divergences found

### Week 4: Budget Enforcement Cutover
1. Set `BUDGET_ENGINE=durable-objects`
2. DOs are now primary for budget enforcement
3. Monitor: check latency (p50, p99), approval/denial accuracy, reconciliation rates
4. Redis budget code remains in codebase but inactive
5. Run parallel validation for 1+ weeks

### Week 5+: Cleanup
1. Remove Redis Lua scripts (budget.ts, budget-reconcile.ts)
2. Remove budget-related Redis cache code (budget-lookup.ts, budget-spend.ts)
3. Remove `BUDGET_ENGINE` toggle (hardcode to DO path)
4. Keep Upstash Redis for rate limiting, idempotency, health
5. Update all documentation

### Rollback at Any Phase
- **Shadow mode issues**: Disable shadow path, zero user impact
- **Cutover issues**: `wrangler secret put BUDGET_ENGINE redis` → instant rollback
- **Data corruption**: Delete DO instance, it re-populates from Postgres on next access
- **Nuclear option**: Postgres is always the source of truth. Any cache layer can be rebuilt.

---

## Appendix: What This Spec Intentionally Does NOT Include

- **RateLimiterDO** — rate limiting stays on Upstash (Claude Code's recommendation, endorsed)
- **Dashboard Redis changes** — Vercel can't reach DOs, so idempotency/rate limiting stays as-is
- **Cloudflare Queues** — still recommended for reliable cost event logging (separate initiative, not part of this migration)
- **D1 or Analytics Engine** — not needed for this migration; Supabase Postgres remains the ledger
- **Per-entity DO sharding** — deferred until monitoring shows contention on per-user DOs
- **Hierarchical team budgets** — the per-user DO model supports this as a future extension but doesn't implement it
