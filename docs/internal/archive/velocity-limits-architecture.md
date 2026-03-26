# Velocity Limits (Loop/Runaway Detection) Architecture

**Date:** 2026-03-20
**Status:** Proposed
**Research:** See `docs/research/velocity-limits-deep-research.md` (synthesized), `docs/research/velocity-limits-technical-research.md` (platform constraints + algorithms), `docs/research/velocity-limits-frontier-risk-analysis.md` (frontier patterns + failure modes).

---

## Problem Statement

NullSpend's budget enforcement stops agents when budgets are *exhausted*. It cannot detect *abnormal spending velocity*. An agent burning $50/minute when the expected rate is $5/minute sails through until the $500 budget is gone.

```
Agent enters recursive loop at 3:00 PM
├── 3:00 — $5 spent (normal)          ← budget: $495 remaining, no alarm
├── 3:01 — $50 spent total            ← budget: $450 remaining, no alarm
├── 3:02 — $95 spent total            ← budget: $405 remaining, threshold webhook at 50%? nope, not yet
├── 3:05 — $250 spent total           ← budget: $250 remaining, 50% threshold fires
├── 3:08 — $400 spent total           ← budget: $100 remaining, 80% threshold fires
├── 3:09 — $475 spent total           ← budget: $25 remaining, 95% threshold fires
└── 3:10 — $500 spent. Budget exhausted. Agent blocked.
```

With velocity limits at $10/minute:
```
Agent enters recursive loop at 3:00 PM
├── 3:00 — $5 spent (normal)          ← velocity: $5/min, under limit
├── 3:01 — $50 spent total            ← velocity: $45/min, EXCEEDS $10/min limit
│                                        → circuit breaker trips
│                                        → webhook: velocity.exceeded
│                                        → all requests denied for 60s cooldown
├── 3:02 — cooldown active            ← requests denied with 429 + Retry-After
└── 3:02 — $50 total damage vs. $500
```

### Competitive whitespace

No competitor offers real-time cost-velocity detection at the proxy layer. AgentBudget has client-side circuit breaking (requires SDK adoption). Agent frameworks (Claude SDK, OpenAI Agents SDK, AutoGen) count turns, not dollars-per-second.

---

## Architecture Decision: Sliding Window Counter

### Why not the alternatives

| Approach | Why rejected |
|---|---|
| **Reservations table query** | Reservations deleted on reconcile — fast-completing loops leave no trace |
| **In-memory circular buffer** | DO eviction (~30s inactivity) resets state — exploitable by pausing |
| **Append-only velocity log** | Unbounded growth, needs alarm-based cleanup, O(N) sum queries under burst |
| **Fixed-window counters** | Boundary problem: burst at window edge sees only half the velocity |
| **Hybrid memory + SQLite** | Over-engineered for ~0.005ms latency savings over pure SQLite |

### Why sliding window counter wins

Cloudflare uses this exact algorithm for their WAF rate limiting across 400M+ requests with **0.003% error**:

```
weighted_count = prev_window_count * ((window_size - elapsed) / window_size) + current_window_count
```

- **O(1) per entity** — one row read + one upsert, not a growing log
- **No cleanup needed** — two counters rotate in place vs. alarm-based garbage collection
- **99.97% accuracy** — proven at Cloudflare scale
- **SQLite-durable** — survives DO eviction, loads during `blockConcurrencyWhile`
- **Zero new alarm logic** — the existing alarm handler is untouched

---

## DO SQLite Schema Changes

Schema version bump from v1 to v2 in `initSchema()`:

```sql
-- New table for velocity state (sliding window counter)
CREATE TABLE IF NOT EXISTS velocity_state (
  entity_key TEXT PRIMARY KEY,       -- "user:u1" or "api_key:k1"
  window_size_ms INTEGER NOT NULL,
  window_start_ms INTEGER NOT NULL,
  current_count INTEGER NOT NULL DEFAULT 0,
  current_spend INTEGER NOT NULL DEFAULT 0,
  prev_count INTEGER NOT NULL DEFAULT 0,
  prev_spend INTEGER NOT NULL DEFAULT 0,
  tripped_at INTEGER                  -- circuit breaker: ms timestamp, NULL = not tripped
);

-- Extend budgets table with velocity config
-- (ALTER TABLE ADD COLUMN is no-op if column already exists in SQLite)
ALTER TABLE budgets ADD COLUMN velocity_limit INTEGER;      -- microdollars per window, NULL = no limit
ALTER TABLE budgets ADD COLUMN velocity_window INTEGER DEFAULT 60000;  -- ms, default 1 min
ALTER TABLE budgets ADD COLUMN velocity_cooldown INTEGER DEFAULT 60000; -- ms, default 1 min
```

The `velocity_state` row for an entity is created/updated when `populateIfEmpty` seeds a budget with velocity config. One row per entity (typically 2: user + api_key).

---

## Postgres Schema Changes

```sql
ALTER TABLE budgets ADD COLUMN velocity_limit_microdollars BIGINT;
ALTER TABLE budgets ADD COLUMN velocity_window_seconds INTEGER DEFAULT 60;
ALTER TABLE budgets ADD COLUMN velocity_cooldown_seconds INTEGER DEFAULT 60;
```

All nullable. `NULL` velocity_limit = no velocity enforcement (opt-in). Flows to DO via `populateIfEmpty`.

---

## Validation Schema Changes

**`lib/validations/budgets.ts` — `createBudgetInputSchema`:**
```typescript
velocityLimitMicrodollars: z.number().int().positive().optional(),
velocityWindowSeconds: z.number().int().min(10).max(3600).optional(),
velocityCooldownSeconds: z.number().int().min(10).max(3600).optional(),
```

All optional. Omitting preserves existing value on upsert (same pattern as `thresholdPercentages`).

**`budgetResponseSchema` and `budgetEntitySchema`:**
```typescript
velocityLimitMicrodollars: z.number().nullable(),
velocityWindowSeconds: z.number().nullable(),
velocityCooldownSeconds: z.number().nullable(),
```

---

## DO `checkAndReserve` Changes

Velocity check integrates as **Phase 0** — before the existing budget check, inside the same `transactionSync`:

```typescript
async checkAndReserve(
  keyId: string | null,
  estimateMicrodollars: number,
  reservationTtlMs: number = 30_000,
): Promise<CheckResult> {
  const now = Date.now();
  let result: CheckResult = { status: "approved", hasBudgets: false };
  // ...

  this.ctx.storage.transactionSync(() => {
    // Phase 1: Query matching budgets (EXISTING)
    const rows = ...;
    if (rows.length === 0) { result = { status: "approved", hasBudgets: false }; return; }

    // ── Phase 0: Velocity check (NEW) ───────────────────────────
    for (const row of rows) {
      if (!row.velocity_limit) continue;

      const entityKey = `${row.entity_type}:${row.entity_id}`;
      const windowMs = row.velocity_window ?? 60_000;
      const cooldownMs = row.velocity_cooldown ?? 60_000;

      // Read velocity state
      const vs = this.ctx.storage.sql.exec<VelocityState>(
        "SELECT * FROM velocity_state WHERE entity_key = ?", entityKey
      ).toArray()[0];

      // Circuit breaker: if tripped and still in cooldown, fast-deny
      if (vs?.tripped_at && (now - vs.tripped_at < cooldownMs)) {
        const retryAfter = Math.ceil((vs.tripped_at + cooldownMs - now) / 1000);
        result = {
          status: "denied",
          hasBudgets: true,
          velocityDenied: true,
          deniedEntity: entityKey,
          retryAfterSeconds: retryAfter,
        };
        return;
      }

      // If circuit breaker expired, clear it
      if (vs?.tripped_at && (now - vs.tripped_at >= cooldownMs)) {
        this.ctx.storage.sql.exec(
          "UPDATE velocity_state SET tripped_at = NULL WHERE entity_key = ?",
          entityKey,
        );
        // Emit velocity.recovered event (via result metadata)
      }

      // Sliding window counter logic
      if (vs) {
        let windowStart = vs.window_start_ms;
        let prevCount = vs.prev_count;
        let prevSpend = vs.prev_spend;
        let currCount = vs.current_count;
        let currSpend = vs.current_spend;

        // Window rotation
        if (now >= windowStart + windowMs) {
          prevCount = currCount;
          prevSpend = currSpend;
          currCount = 0;
          currSpend = 0;
          windowStart = now - (now % windowMs);
        }

        // Sliding window estimation (weighted)
        const elapsed = now - windowStart;
        const weight = Math.max(0, (windowMs - elapsed) / windowMs);
        const estimatedSpend = prevSpend * weight + currSpend;

        // Check velocity threshold (include this request's estimate)
        if (estimatedSpend + estimateMicrodollars > row.velocity_limit) {
          // Trip circuit breaker
          this.ctx.storage.sql.exec(
            "UPDATE velocity_state SET tripped_at = ? WHERE entity_key = ?",
            now, entityKey,
          );
          result = {
            status: "denied",
            hasBudgets: true,
            velocityDenied: true,
            deniedEntity: entityKey,
            retryAfterSeconds: Math.ceil(cooldownMs / 1000),
            velocityDetails: {
              limitMicrodollars: row.velocity_limit,
              windowSeconds: Math.round(windowMs / 1000),
              currentMicrodollars: Math.round(estimatedSpend),
            },
          };
          return;
        }

        // Increment counter (this request approved)
        this.ctx.storage.sql.exec(
          `UPDATE velocity_state SET
            window_start_ms = ?, prev_count = ?, prev_spend = ?,
            current_count = ?, current_spend = ?
          WHERE entity_key = ?`,
          windowStart, prevCount, prevSpend,
          currCount + 1, currSpend + estimateMicrodollars,
          entityKey,
        );
      }
      // If no velocity_state row exists yet, it will be created by populateIfEmpty
    }

    // ── Phase 1.5: Period resets (EXISTING) ─────────────────────
    // ── Phase 2: Budget check (EXISTING) ────────────────────────
    // ── Phase 3: Reserve (EXISTING) ─────────────────────────────
  });

  // ...existing alarm scheduling, loadBudgets, return result
}
```

Key design decisions:
- **Velocity denied = no reservation created.** No cleanup needed for velocity denials.
- **Circuit breaker is a fast-path.** Once tripped, it's a single timestamp comparison — no velocity_state read needed.
- **Estimate included in check.** `estimatedSpend + estimateMicrodollars > limit` prevents the Nth request from sneaking through.

---

## DO `populateIfEmpty` Changes

Add velocity config parameters (backward-compatible — extra args ignored by old DOs):

```typescript
async populateIfEmpty(
  entityType: string,
  entityId: string,
  maxBudget: number,
  spend: number,
  policy: string,
  resetInterval: string | null,
  periodStart: number,
  velocityLimit: number | null = null,        // NEW
  velocityWindow: number = 60_000,            // NEW
  velocityCooldown: number = 60_000,          // NEW
): Promise<boolean> {
  // ... existing budget upsert ...

  // Upsert velocity config into budgets table
  this.ctx.storage.sql.exec(
    `UPDATE budgets SET
      velocity_limit = ?, velocity_window = ?, velocity_cooldown = ?
    WHERE entity_type = ? AND entity_id = ?`,
    velocityLimit, velocityWindow, velocityCooldown,
    entityType, entityId,
  );

  // Create/update velocity_state row if velocity is configured
  if (velocityLimit !== null) {
    const entityKey = `${entityType}:${entityId}`;
    this.ctx.storage.sql.exec(
      `INSERT INTO velocity_state
        (entity_key, window_size_ms, window_start_ms, current_count, current_spend, prev_count, prev_spend)
       VALUES (?, ?, ?, 0, 0, 0, 0)
       ON CONFLICT(entity_key) DO UPDATE SET
        window_size_ms = excluded.window_size_ms`,
      entityKey, velocityWindow, Date.now(),
    );
  } else {
    // Remove velocity_state if velocity limit was cleared
    this.ctx.storage.sql.exec(
      "DELETE FROM velocity_state WHERE entity_key = ?",
      `${entityType}:${entityId}`,
    );
  }

  this.loadBudgets();
  return !existed;
}
```

---

## `DOBudgetEntity` Interface Changes

**`apps/proxy/src/lib/budget-do-lookup.ts`:**

```typescript
export interface DOBudgetEntity {
  entityType: string;
  entityId: string;
  maxBudget: number;
  spend: number;
  policy: string;
  resetInterval: string | null;
  periodStart: number;
  velocityLimit: number | null;        // NEW
  velocityWindow: number;              // NEW
  velocityCooldown: number;            // NEW
}
```

The `lookupBudgetsForDO` function reads the new columns from Postgres and passes them through.

---

## `CheckResult` Interface Changes

```typescript
export interface CheckResult {
  status: "approved" | "denied";
  hasBudgets: boolean;
  reservationId?: string;
  deniedEntity?: string;
  remaining?: number;
  maxBudget?: number;
  spend?: number;
  periodResets?: Array<{ entityType: string; entityId: string; newPeriodStart: number }>;
  checkedEntities?: CheckedEntity[];
  // NEW:
  velocityDenied?: boolean;
  retryAfterSeconds?: number;
  velocityDetails?: {
    limitMicrodollars: number;
    windowSeconds: number;
    currentMicrodollars: number;
  };
  velocityRecovered?: Array<{ entityType: string; entityId: string }>; // for webhook
}
```

---

## Proxy Route Handler Changes

**`apps/proxy/src/routes/openai.ts` and `apps/proxy/src/routes/anthropic.ts`:**

When `checkResult.velocityDenied` is true, return 429 instead of forwarding to provider:

```typescript
if (budgetOutcome.velocityDenied) {
  return new Response(
    JSON.stringify({
      error: {
        code: "velocity_exceeded",
        message: "Request blocked: spending rate exceeds velocity limit. Retry after cooldown.",
        details: budgetOutcome.velocityDetails ?? null,
      },
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(budgetOutcome.retryAfterSeconds ?? 60),
      },
    },
  );
}
```

---

## Webhook Events

### New event types

Add to the webhook event taxonomy:

```typescript
| "velocity.exceeded"     // Velocity limit tripped, circuit breaker activated
| "velocity.recovered"    // Cooldown expired, requests allowed again
```

### `velocity.exceeded` payload

```json
{
  "id": "evt_...",
  "type": "velocity.exceeded",
  "api_version": "2026-04-01",
  "created_at": 1710892800,
  "data": {
    "object": {
      "budget_entity_type": "user",
      "budget_entity_id": "u1",
      "velocity_limit_microdollars": 5000000,
      "velocity_window_seconds": 60,
      "velocity_current_microdollars": 5200000,
      "cooldown_seconds": 60,
      "triggered_by_request_id": "req_..."
    }
  }
}
```

### Webhook dedup

5-minute cooldown on `velocity.exceeded` per entity. Store `last_velocity_webhook_ms` on the `velocity_state` row. Before dispatching:

```typescript
if (now - vs.last_velocity_webhook_ms < 300_000) return; // suppress
```

### `velocity.recovered`

Emitted lazily on the first successful request after a cooldown expires. Detected in the circuit breaker expiry branch of `checkAndReserve`.

---

## Budget Status API Changes

**`app/api/budgets/status/route.ts`** — extend entity mapping:

```typescript
const entities = rows.map((row) => ({
  // ...existing fields...
  velocity: row.velocityLimitMicrodollars != null ? {
    limitMicrodollars: row.velocityLimitMicrodollars,
    windowSeconds: row.velocityWindowSeconds ?? 60,
    cooldownSeconds: row.velocityCooldownSeconds ?? 60,
  } : null,
}));
```

Note: current velocity spend and tripped state live in the DO, not Postgres. The status API returns the *configuration*. A future enhancement could add a DO RPC to read live velocity state for the dashboard.

---

## Error Response

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

Using 429 is correct — consistent with budget exhaustion and rate limiting. The `Retry-After` header tells agents when to retry. The error code `velocity_exceeded` is distinct from `budget_exceeded`.

---

## Interaction with Existing Systems

### Check order: Velocity first, then budget

| Velocity | Budget | Outcome | Error code |
|---|---|---|---|
| OK | OK | Approved | — |
| OK | Exceeded | Denied | `budget_exceeded` |
| Exceeded | OK | Denied | `velocity_exceeded` |
| Exceeded | Exceeded | Denied | `velocity_exceeded` (checked first) |

Rationale: velocity check is cheaper (one row read) than budget check (multiple entities + reservation). If velocity is exceeded, skip budget check entirely.

### Velocity is policy-independent

The `policy` field (`strict_block`, `soft_block`, `warn`) controls budget *exhaustion* behavior. Velocity limits always enforce regardless of policy — they are a safety mechanism, not a budget control. A `warn`-policy budget with a velocity limit will warn on budget exhaustion but hard-deny on velocity violation.

### Rolling deploy safety

`populateIfEmpty` adds 3 new parameters with defaults. Old Workers send 7 args (new params default to `null`/`60000`/`60000`). New Workers send 10 args to old DOs (extra args ignored by JS). Same pattern as thresholdPercentages.

---

## Test Plan

### DO velocity unit tests (`apps/proxy/src/__tests__/velocity-*.test.ts`)

| Test | What it verifies |
|---|---|
| Velocity check allows request under limit | Sliding window counter increments, request approved |
| Velocity check denies request over limit | Returns `velocityDenied: true` with details |
| Circuit breaker trips on velocity violation | `tripped_at` set, subsequent requests fast-denied |
| Circuit breaker auto-recovers after cooldown | `tripped_at` cleared, request approved |
| Sliding window rotation | Previous window counter shifts on window boundary |
| Weighted estimation accuracy | `prevSpend * weight + currSpend` matches expected |
| No velocity check when limit is NULL | Requests pass through without velocity_state read |
| Velocity denied = no reservation | No row in reservations table after velocity denial |
| Multiple entities checked | Both user + api_key velocity checked, most restrictive wins |
| populateIfEmpty creates velocity_state | Row created with correct window_size |
| populateIfEmpty with null velocity clears state | velocity_state row deleted |
| Webhook dedup | Second velocity violation within 5min doesn't emit event |

### Route handler tests

| Test | What it verifies |
|---|---|
| Returns 429 with velocity_exceeded on velocity denial | Correct status, error code, Retry-After header |
| Includes velocity details in error response | limit, window, current spend, cooldown |
| Forwards to provider when velocity is OK | Normal flow unaffected |

### Validation tests

| Test | What it verifies |
|---|---|
| Accepts valid velocityLimitMicrodollars | Positive integer |
| Accepts valid velocityWindowSeconds | 10-3600 |
| Rejects velocityWindowSeconds < 10 | Min enforcement |
| Rejects velocityWindowSeconds > 3600 | Max enforcement |
| Omitting velocity fields is valid | Optional, DB default |
| budgetResponseSchema includes velocity fields | Response shape |

---

## Estimated Scope

| Component | Lines | Effort |
|---|---|---|
| Postgres migration + schema | ~10 | 15min |
| Validation schemas | ~15 | 15min |
| Budget API routes (CRUD + status) | ~30 | 30min |
| DO SQLite schema + initSchema | ~20 | 15min |
| DO checkAndReserve velocity check | ~80 | 45min |
| DO populateIfEmpty changes | ~25 | 15min |
| DOBudgetEntity + budget-do-lookup | ~15 | 15min |
| budget-do-client + orchestrator | ~20 | 15min |
| Proxy route handlers (velocity denial) | ~30 | 15min |
| Webhook event builders | ~40 | 20min |
| Tests (DO + route + validation) | ~300 | 1.5h |
| **Total** | **~585** | **~4.5h** |

---

## What to Defer

| Item | When | Why defer |
|---|---|---|
| Multi-window velocity (per-minute + per-hour) | v1.1 | Single window catches the common case; multi-window is additive |
| Request count limits (in addition to cost) | v1.1 | Cost-based catches both cheap and expensive loops |
| Global default velocity limit (env var) | v1.1 | One-line check, but requires choosing a sensible default |
| Dashboard velocity configuration UI | v1.1 | API-first; dashboard form follows |
| `velocity_policy: "warn"` mode | v2 | Nice UX but not security-critical |
| Adaptive/anomaly velocity (EMA, Z-score) | v3+ | Cold start problem, unpredictable, complex |
| Request body hashing for loop fingerprinting | v2 | Secondary signal, adds storage overhead |
| Live velocity state in budget status API | v1.1 | Requires new DO RPC; config-only is sufficient for launch |

---

## Open Questions

1. **Should there be a platform-wide default velocity limit?** A global default (e.g., $100/minute) would protect users before configuration. Recommendation: defer to v1.1, add as Worker env var.

2. **Should velocity limits be independent of budget policy?** Current recommendation is velocity always hard-denies. Should `warn`-policy budgets be allowed to have warn-only velocity? Recommendation: v1 always enforces.

3. **Should cooldown be separately configurable?** Current design defaults cooldown = window (60s). Users might want 5-minute cooldown with 1-minute window. Recommendation: include in v1 as optional field.

4. **What about the `velocity.recovered` event timing?** It's emitted lazily (on first successful request after cooldown). If the agent stops sending requests, the event never fires. Is this acceptable? Recommendation: yes — if no requests arrive, there's no one listening for the event anyway.
