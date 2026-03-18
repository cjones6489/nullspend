# Unified Enforcement Architecture — Implementation Guide

> **Revised: 2026-03-18.** Updated to reflect DO-based architecture
> (Durable Objects SQLite replaced Redis Lua), CF Queues reconciliation,
> and Phase 2A completion. All Redis references replaced with DO/KV
> equivalents.

This document breaks the unified enforcement architecture into incremental
subphases. Each subphase is independently testable, deployable, and
non-breaking. No subphase requires more than one session to implement.

**Prerequisites:** Read `unified-enforcement-architecture.md` for the full
design rationale. This document covers *how* to build it, not *why*.

---

## Phase Map

```
Phase 2A — SDK retry, idempotency, batching infrastructure
Phase 2B — Cost reporting API endpoint
Phase 2C — SDK reportCost() + reportCostBatch()
Phase 2D — Budget status API endpoint
Phase 2E — SDK checkBudget()
Phase 2F — SDK client-side event batching

Phase 3A — EnforcementCheck interface + shared types
Phase 3B — Extract PolicyCheck from proxy
Phase 3C — Extract BudgetCheck into interface wrapper
Phase 3D — Wire enforcement pipeline in proxy
Phase 3E — VelocityCheck (new)
Phase 3F — Enforcement API endpoint
Phase 3G — SDK enforce()
Phase 3H — Conditional approval thresholds
Phase 3I — Config caching in Worker

Phase 4A — Approval webhook events
Phase 4B — Pre-built policy templates
Phase 4C — Dashboard approval rules UI
Phase 4D — Feedback loops / auto-remediation
```

---

## Phase 2A — SDK Retry, Idempotency, Batching Infrastructure [DONE]

**Goal:** Add retry logic, idempotency key generation, and request
infrastructure to the SDK *without changing any public API*.

**Status: Shipped.** The SDK client (`packages/sdk/src/client.ts`) has a
private `request()` method with exponential backoff + jitter, `Retry-After`
header support, idempotency key generation for mutating requests,
configurable retry limits (`maxRetries`, `retryBaseDelayMs`, `maxRetryTimeMs`),
`onRetry` callback, and a wall-time retry cap. Retry helpers are in
`packages/sdk/src/retry.ts`.

**Why first:** Every subsequent SDK feature (reportCost, checkBudget,
enforce) needs retry and idempotency. Building the foundation first means
we don't retrofit it later.

### What to build

**1. Retry logic** in `packages/sdk/src/client.ts`

Add a private `_request()` method that wraps `fetch` with:
- Exponential backoff with jitter: `min(baseDelay * 2^attempt, maxDelay) + random(0, jitter)`
- Default: 3 retries, 500ms base, 5s max, 200ms jitter
- Retry on: 429, 500, 502, 503, 504, network errors (`TypeError`)
- Never retry: 400, 401, 403, 404, 409, 422 (business logic errors)
- Respect `Retry-After` header on 429 responses
- Configurable via `NullSpendConfig`:
  ```typescript
  maxRetries?: number;      // default: 3; 0 to disable
  retryBaseDelayMs?: number; // default: 500
  ```

**2. Idempotency key generation**

For POST requests that create resources (not for GET/polling), auto-generate
an `Idempotency-Key` header:
```typescript
// Format: ns_{uuid-v4}
// Stored on the request, reused across retries
const idempotencyKey = `ns_${crypto.randomUUID()}`;
```

The API endpoints should accept this header and deduplicate. For Phase 2A,
just *send* the header — endpoint deduplication comes in 2B/2D.

**3. Updated NullSpendConfig type**

```typescript
interface NullSpendConfig {
  baseUrl: string;
  apiKey: string;
  fetch?: typeof globalThis.fetch;
  requestTimeoutMs?: number;  // existing, default 30s
  maxRetries?: number;        // new, default 3
  retryBaseDelayMs?: number;  // new, default 500
}
```

### What to change

| File | Change |
|------|--------|
| `packages/sdk/src/client.ts` | Add `_request()` with retry + idempotency. Migrate existing methods to use it. |
| `packages/sdk/src/types.ts` | Add `maxRetries`, `retryBaseDelayMs` to `NullSpendConfig` |

### How to test

- Unit test: `_request()` retries on 429/5xx, respects `Retry-After`, stops on 4xx
- Unit test: idempotency key generated for POST, same key reused across retries
- Unit test: `maxRetries: 0` disables retry
- Unit test: jitter stays within bounds
- Integration: existing `proposeAndWait()` tests still pass (regression)

### Validation criteria

- `pnpm test` passes (root tests unaffected)
- `packages/sdk` tests all pass
- No public API changes — existing consumers see no difference

---

## Phase 2B — Cost Reporting API Endpoint

**Goal:** Add `POST /api/cost-events` and `POST /api/cost-events/batch`
endpoints that accept cost events from the SDK via API key auth.

**Why before SDK method:** The endpoint must exist and be tested before the
SDK calls it. API-first development.

### What to build

**1. Schema validation** for incoming cost events

```typescript
// In a new file: lib/cost-events/ingest.ts
interface CostEventInput {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
  costMicrodollars: number;
  durationMs?: number;
  sessionId?: string;
  eventType?: "llm" | "tool" | "custom";
  toolName?: string;
  toolServer?: string;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string;
}
```

**2. Idempotency deduplication**

- Accept `Idempotency-Key` header (or `idempotencyKey` in body)
- Check `cost_events.request_id` for duplicates (reuse `requestId` column)
- If duplicate found, return 200 with the existing event (not 409)
- If no key provided, skip dedup (fire-and-forget is valid)

**3. `POST /api/cost-events`** — single event ingestion

- Auth: `assertApiKeyWithIdentity()` (same as proxy)
- Validate input, insert into `cost_events` table
- Set `event_type` from input (default: `"custom"`)
- Set `api_key_id` and `user_id` from auth identity
- Dispatch webhook if configured (reuse existing webhook dispatch)
- Return `201 { id, createdAt }`

**4. `POST /api/cost-events/batch`** — batch ingestion

- Auth: same as single
- Accept `{ events: CostEventInput[] }` (max 100 per batch)
- Insert all events in a single Drizzle transaction
- Dispatch webhooks for each event (batch the dispatches too)
- Return `201 { inserted: number, ids: string[] }`

### What to change

| File | Change |
|------|--------|
| `app/api/cost-events/route.ts` | Add POST handler alongside existing GET |
| `app/api/cost-events/batch/route.ts` | New file — batch POST handler |
| `lib/cost-events/ingest.ts` | New file — shared validation + insert logic |

### How to test

- Unit test: valid single event → 201 with id
- Unit test: valid batch (10 events) → 201 with ids
- Unit test: batch > 100 events → 400
- Unit test: missing required fields → 400 with field-level errors
- Unit test: idempotency key dedup → 200 on second POST, no duplicate row
- Unit test: API key auth required → 401 without key
- Unit test: revoked key → 401
- Unit test: webhook fires on cost event insertion

### Validation criteria

- `pnpm test` passes
- Manually test with `curl` against dev server
- Existing `GET /api/cost-events` still works

---

## Phase 2C — SDK `reportCost()` and `reportCostBatch()`

**Goal:** Add cost reporting methods to the SDK that call the endpoints
from Phase 2B.

### What to build

**1. New SDK methods**

```typescript
class NullSpend {
  // ... existing methods ...

  async reportCost(event: CostEventInput): Promise<{ id: string }>;
  async reportCostBatch(events: CostEventInput[]): Promise<{ ids: string[] }>;
}
```

**2. New types** in `packages/sdk/src/types.ts`

```typescript
interface CostEventInput {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
  costMicrodollars: number;
  durationMs?: number;
  sessionId?: string;
  eventType?: "llm" | "tool" | "custom";
  toolName?: string;
  toolServer?: string;
  metadata?: Record<string, unknown>;
}

interface ReportCostResponse {
  id: string;
  createdAt: string;
}

interface ReportCostBatchResponse {
  inserted: number;
  ids: string[];
}
```

**3. Export new types and methods**

### What to change

| File | Change |
|------|--------|
| `packages/sdk/src/client.ts` | Add `reportCost()`, `reportCostBatch()` |
| `packages/sdk/src/types.ts` | Add cost event types |
| `packages/sdk/src/index.ts` | Export new types |

### How to test

- Unit test: `reportCost()` sends POST to `/api/cost-events` with correct body
- Unit test: `reportCostBatch()` sends POST to `/api/cost-events/batch`
- Unit test: retries on 429/5xx (uses `_request()` from 2A)
- Unit test: idempotency key sent on POST
- Unit test: error handling — 400 → `NullSpendError`, 401 → `NullSpendError`

### Validation criteria

- SDK tests pass
- Integration: SDK → dev server → verify row in cost_events table

---

## Phase 2D — Budget Status API Endpoint

**Goal:** Add `GET /api/budgets/status` that returns the current budget
state for an API key's associated entities.

### What to build

**1. `GET /api/budgets/status`**

- Auth: `assertApiKeyWithIdentity()`
- Query: find all budgets where `entity_type='api_key' AND entity_id=keyId`
  OR `entity_type='user' AND entity_id=userId`
- For each budget, read current spend from Postgres (see Option A/B below)
- Return:
  ```json
  {
    "hasBudgets": true,
    "entities": [
      {
        "entityType": "api_key",
        "entityId": "key_abc",
        "limitMicrodollars": 10000000,
        "spendMicrodollars": 3500000,
        "remainingMicrodollars": 6500000,
        "policy": "strict_block",
        "resetInterval": "monthly",
        "currentPeriodStart": "2026-03-01T00:00:00Z"
      }
    ]
  }
  ```

**2. Accurate spend via DO or Postgres**

The canonical spend is in the UserBudgetDO (updated atomically via
`transactionSync()`). The Postgres `spend_microdollars` column may lag
slightly due to async reconciliation via CF Queues.

Two options for this endpoint:
- **Option A (simpler):** Read from Postgres. Slightly stale but avoids
  routing through the proxy. Sufficient for informational `checkBudget()`.
- **Option B (accurate):** Route through proxy internal endpoint
  (`POST /internal/budget/status`) → DO RPC. Same atomic view the proxy
  uses for enforcement.

Start with Option A. The staleness window is typically <5s (queue
consumer processing time). Include a `source: "postgres"` field so the
SDK knows accuracy level. Upgrade to Option B if users need real-time.

### What to change

| File | Change |
|------|--------|
| `app/api/budgets/status/route.ts` | New file — GET handler |

### How to test

- Unit test: returns budget entities for authenticated key
- Unit test: returns `hasBudgets: false` when no budgets configured
- Unit test: spend values reflect Postgres state (Option A)
- Unit test: 401 without API key

### Validation criteria

- `pnpm test` passes
- Manually test with curl

---

## Phase 2E — SDK `checkBudget()`

**Goal:** Add budget status method to the SDK.

### What to build

```typescript
class NullSpend {
  async checkBudget(): Promise<BudgetStatus>;
}

interface BudgetStatus {
  hasBudgets: boolean;
  entities: Array<{
    entityType: string;
    entityId: string;
    limitMicrodollars: number;
    spendMicrodollars: number;
    remainingMicrodollars: number;
    policy: string;
    resetInterval: string | null;
    currentPeriodStart: string | null;
  }>;
}
```

### What to change

| File | Change |
|------|--------|
| `packages/sdk/src/client.ts` | Add `checkBudget()` |
| `packages/sdk/src/types.ts` | Add `BudgetStatus`, `BudgetEntity` types |
| `packages/sdk/src/index.ts` | Export new types |

### How to test

- Unit test: sends GET to `/api/budgets/status`
- Unit test: parses response correctly
- Unit test: retries on transient errors

### Validation criteria

- SDK tests pass

---

## Phase 2F — SDK Client-Side Event Batching

**Goal:** Add an automatic batching layer so high-frequency `reportCost()`
calls are queued locally and flushed in batches.

**Why separate from 2C:** The basic `reportCost()` works without batching.
Batching is an optimization that adds complexity (flush timers, shutdown
hooks). Ship the simple version first, optimize second.

### What to build

**1. `CostReporter` internal class**

```typescript
class CostReporter {
  private queue: CostEventInput[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private client: NullSpend,
    private options: {
      batchSize: number;     // default: 10
      flushIntervalMs: number; // default: 5000
      maxQueueSize: number;  // default: 1000
    }
  ) {}

  enqueue(event: CostEventInput): void;
  async flush(): Promise<void>;
  async shutdown(): Promise<void>;
}
```

**2. Opt-in batching on SDK**

```typescript
const ns = new NullSpend({
  apiKey: "ns_xxx",
  baseUrl: "https://nullspend.com",
  costReporting: {
    batching: true,          // default: false (backward compat)
    batchSize: 10,
    flushIntervalMs: 5000,
  },
});

// When batching is enabled, reportCost() queues locally
ns.reportCost(event); // returns immediately (queued)

// Explicit flush (e.g., before process exit)
await ns.flush();

// Graceful shutdown (flushes remaining queue)
await ns.shutdown();
```

**3. Process exit hooks** (Node.js only)

- `process.on('beforeExit', () => reporter.flush())`
- `process.on('SIGTERM', () => reporter.shutdown())`
- Guard: only register if `typeof process !== 'undefined'`

### What to change

| File | Change |
|------|--------|
| `packages/sdk/src/cost-reporter.ts` | New file — batching logic |
| `packages/sdk/src/client.ts` | Integrate CostReporter when batching enabled |
| `packages/sdk/src/types.ts` | Add `CostReportingConfig` to `NullSpendConfig` |

### How to test

- Unit test: enqueue 10 events → auto-flush when batch size reached
- Unit test: enqueue 3 events, wait 5s → auto-flush on interval
- Unit test: `flush()` sends current queue immediately
- Unit test: `shutdown()` clears timer and flushes
- Unit test: queue overflow (> maxQueueSize) drops oldest events + warns
- Unit test: batching disabled → `reportCost()` sends immediately (regression)

### Validation criteria

- SDK tests pass
- No behavior change when `batching: false` (default)

---

## Phase 3A — EnforcementCheck Interface + Shared Types

**Goal:** Define the enforcement pipeline interfaces as a shared package
that both the proxy and SDK can import. *No behavior changes yet.*

**Why a new package:** The enforcement types need to be importable by
`apps/proxy/`, `packages/sdk/`, `packages/mcp-proxy/`, and the dashboard
API routes. Putting them in `packages/db/` would work but muddies that
package's purpose. A lightweight types-only package is cleaner.

### What to build

**1. New package** `packages/enforcement/`

```
packages/enforcement/
├── package.json       # @nullspend/enforcement
├── tsconfig.json
└── src/
    ├── index.ts       # exports
    ├── types.ts       # interfaces
    └── pipeline.ts    # runner (pure function)
```

**2. Core interfaces** in `types.ts`

```typescript
export interface EnforcementContext {
  userId: string;
  keyId: string;
  provider: string;
  model: string;
  estimatedCostMicrodollars: number;
  toolName?: string;
  actionType?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
}

export interface EnforcementDenial {
  check: string;        // "policy", "budget", "velocity", "approval"
  code: string;         // machine-readable: "model_not_allowed", "budget_exceeded"
  reason: string;       // human-readable
  details: Record<string, unknown>;
}

export type EnforcementResult =
  | { allowed: true; reservationId?: string }
  | { allowed: false; denial: EnforcementDenial };

export interface EnforcementCheck {
  name: string;
  check(ctx: EnforcementContext): Promise<EnforcementResult>;
}
```

**3. Pipeline runner** in `pipeline.ts`

```typescript
export async function runEnforcementPipeline(
  checks: EnforcementCheck[],
  ctx: EnforcementContext
): Promise<EnforcementResult> {
  for (const check of checks) {
    const result = await check.check(ctx);
    if (!result.allowed) return result;
  }
  return { allowed: true };
}
```

This is intentionally simple — an array of checks, executed in order, with
early return on first denial. No middleware pattern, no framework. The
complexity is in the individual checks, not the runner.

### What to change

| File | Change |
|------|--------|
| `packages/enforcement/` | New package (3 files) |
| `pnpm-workspace.yaml` | Already includes `packages/*` |
| Root `package.json` | No change needed if workspace glob covers it |

### How to test

- Unit test: pipeline runs checks in order
- Unit test: first denial short-circuits (subsequent checks not called)
- Unit test: all checks pass → `{ allowed: true }`
- Unit test: empty checks array → `{ allowed: true }`
- Unit test: reservationId from BudgetCheck forwarded in result

### Validation criteria

- Package builds: `cd packages/enforcement && pnpm tsc --noEmit`
- Tests pass
- No changes to any existing package

---

## Phase 3B — Extract PolicyCheck from Proxy

**Goal:** Factor the proxy's existing inline policy logic into a
`PolicyCheck` that implements the `EnforcementCheck` interface.

**Current state:** The proxy has `isKnownModel()` in the route handler. We
extract this into a reusable check and add the two missing policy checks
from the architecture doc.

### What to build

**1. PolicyCheck** in `packages/enforcement/src/checks/policy-check.ts`

```typescript
export interface PolicyConfig {
  modelAllowlist?: string[];       // if set, only these models allowed
  modelBlocklist?: string[];       // if set, these models blocked
  maxRequestCostMicrodollars?: number; // per-request cost cap
  maxToolDefinitions?: number;     // max tool definitions per request
}

export class PolicyCheck implements EnforcementCheck {
  name = "policy";

  constructor(private config: PolicyConfig) {}

  async check(ctx: EnforcementContext): Promise<EnforcementResult> {
    // 1. Model allowlist/blocklist
    // 2. Per-request cost cap
    // 3. Tool definition limit (future, from ctx.metadata)
    // All in-memory, no IO, sub-ms
  }
}
```

**2. Tests**

The PolicyCheck is a pure function — no DO calls, no Postgres, no network.
It should have thorough unit tests covering every rule combination.

### What to change

| File | Change |
|------|--------|
| `packages/enforcement/src/checks/policy-check.ts` | New file |
| `packages/enforcement/src/checks/index.ts` | New file, exports checks |
| `packages/enforcement/src/index.ts` | Re-export checks |

### What NOT to change yet

- The proxy's existing `isKnownModel()` call stays in place. We don't wire
  the PolicyCheck into the proxy until Phase 3D. This phase only *creates*
  the check; it doesn't *use* it in production yet.

### How to test

- Unit test: model in allowlist → allowed
- Unit test: model not in allowlist → denied with `model_not_allowed`
- Unit test: model in blocklist → denied
- Unit test: no allowlist/blocklist → allowed (no model filtering)
- Unit test: estimated cost > cap → denied with `cost_cap_exceeded`
- Unit test: estimated cost ≤ cap → allowed
- Unit test: no cost cap → allowed (no cost filtering)
- Unit test: empty config → all requests allowed

### Validation criteria

- `packages/enforcement` tests pass
- No changes to proxy or MCP proxy behavior

---

## Phase 3C — Extract BudgetCheck into Interface Wrapper

**Goal:** Wrap the proxy's existing DO budget logic in an
`EnforcementCheck` interface *without reimplementing it*.

**Key principle:** The existing `checkAndReserve()` DO RPC works and is
battle-tested (atomic `transactionSync()` in UserBudgetDO). We wrap it,
not rewrite it.

### What to build

**1. BudgetCheck** in `packages/enforcement/src/checks/budget-check.ts`

```typescript
export interface BudgetCheckDeps {
  // Injected — the check doesn't own the DO binding or Postgres
  lookupBudgets: (identity: { keyId: string; userId: string }) =>
    Promise<BudgetEntity[]>;
  checkAndReserve: (entityKeys: string[], estimateMicrodollars: number) =>
    Promise<BudgetCheckResult>;
}

export class BudgetCheck implements EnforcementCheck {
  name = "budget";

  constructor(private deps: BudgetCheckDeps) {}

  async check(ctx: EnforcementContext): Promise<EnforcementResult> {
    const entities = await this.deps.lookupBudgets({
      keyId: ctx.keyId,
      userId: ctx.userId,
    });

    if (entities.length === 0) return { allowed: true };

    const entityKeys = entities.map(e => e.entityKey);
    const result = await this.deps.checkAndReserve(
      entityKeys,
      ctx.estimatedCostMicrodollars
    );

    if (result.status === "denied") {
      return {
        allowed: false,
        denial: {
          check: "budget",
          code: "budget_exceeded",
          reason: `Budget exceeded for ${result.entityKey}`,
          details: {
            entityKey: result.entityKey,
            remaining: result.remaining,
            maxBudget: result.maxBudget,
            spend: result.spend,
          },
        },
      };
    }

    return { allowed: true, reservationId: result.reservationId };
  }
}
```

**Why dependency injection:** The BudgetCheck should not import the DO
binding or Postgres directly. The proxy passes its own `lookupBudgets` and
`checkAndReserve` functions (which use its DO binding + Postgres connection).
The API endpoint passes different implementations (e.g., routing through the
proxy's internal endpoint). Same interface, different backends.

### What to change

| File | Change |
|------|--------|
| `packages/enforcement/src/checks/budget-check.ts` | New file |
| `packages/enforcement/src/checks/index.ts` | Export BudgetCheck |

### How to test

- Unit test: no budgets → allowed (deps return empty array)
- Unit test: budget has headroom → allowed with reservationId
- Unit test: budget exceeded → denied with remaining/maxBudget details
- All tests use mock deps (no real DO binding)

### Validation criteria

- Enforcement package tests pass
- No changes to proxy or MCP proxy

---

## Phase 3D — Wire Enforcement Pipeline in Proxy

**Goal:** Replace the proxy's inline enforcement logic with the pipeline
from Phase 3A, using PolicyCheck (3B) and BudgetCheck (3C).

**This is the highest-risk phase.** The proxy is production infrastructure.
Changes must be behavior-identical to the current implementation.

### Strategy: Parallel execution with comparison

Before flipping over, add a feature flag (env var `ENFORCEMENT_PIPELINE=1`)
that runs BOTH the old inline logic AND the new pipeline, compares results,
and logs discrepancies. Ship with the flag off. Enable in staging. When
results match across N requests, flip the flag to use the pipeline result.

### What to build

**1. Pipeline construction** in proxy route handlers

```typescript
// In anthropic.ts / openai.ts route handler:
const pipeline = [
  new PolicyCheck({ modelAllowlist: /* from config */ }),
  new BudgetCheck({
    lookupBudgets: (id) => lookupBudgetsForDO(connStr, id),
    checkAndReserve: (entities, est) => doBudgetCheck(env, userId, entities, est),
  }),
];

const result = await runEnforcementPipeline(pipeline, {
  userId: auth.userId,
  keyId: auth.keyId,
  provider: "anthropic",
  model: requestModel,
  estimatedCostMicrodollars: estimate,
});
```

**2. Comparison mode** (temporary, removed after validation)

```typescript
if (env.ENFORCEMENT_PIPELINE === "compare") {
  const [oldResult, newResult] = await Promise.all([
    runOldEnforcement(...),
    runEnforcementPipeline(pipeline, ctx),
  ]);
  if (oldResult.allowed !== newResult.allowed) {
    console.error("ENFORCEMENT_MISMATCH", { old: oldResult, new: newResult });
  }
  // Use old result (safe)
}
```

**3. Full cutover** (after comparison validated)

Replace inline logic with pipeline result. Remove old code paths.

### What to change

| File | Change |
|------|--------|
| `apps/proxy/src/routes/anthropic.ts` | Construct + run pipeline |
| `apps/proxy/src/routes/openai.ts` | Same |
| `apps/proxy/package.json` | Add `@nullspend/enforcement` dependency |

### How to test

- All existing proxy tests must pass unchanged (behavior identical)
- New test: pipeline denied → 429 with same response shape as before
- New test: pipeline allowed → request forwarded as before
- Comparison mode test: mock a mismatch → verify log output

### Validation criteria

- `pnpm proxy:test` passes with zero failures
- Comparison mode shows zero mismatches in staging
- After cutover: `pnpm proxy:test` still passes

---

## Phase 3E — VelocityCheck (New Enforcement Check)

**Goal:** Add rate-based velocity controls.

**Why this matters:** Budget caps catch total spend. Velocity limits catch
runaway agents — "50 LLM calls per minute" or "$10/hour" stops an agent
looping before it exhausts the full budget.

**Architecture note:** The original design used Redis sorted sets for
sliding window counters. With the DO migration, two options:
1. **DO-based:** Add a `velocity` SQLite table to UserBudgetDO. Atomic
   with budget checks (same `transactionSync()`). Per-user isolation.
   Downside: no cross-user velocity limits.
2. **KV/external:** Use Cloudflare KV or Upstash Redis for velocity
   counters. Decoupled from budget DO. Supports cross-user limits.
   Downside: separate consistency domain.

Recommendation: Start with DO-based (Option 1) for per-key/per-user
velocity. Most velocity rules are per-agent, not global. Add external
store only if cross-user velocity is needed.

### What to build

**1. VelocityCheck** in `packages/enforcement/src/checks/velocity-check.ts`

```typescript
export interface VelocityRule {
  name: string;                    // "hourly_spend_limit"
  entity: "api_key" | "user" | "session";
  metric: "request_count" | "cost_microdollars";
  limit: number;                   // max value in window
  windowSeconds: number;           // sliding window size
}

export interface VelocityCheckDeps {
  // Sliding window check (DO SQLite or external store)
  checkVelocity: (
    key: string,
    value: number,
    limit: number,
    windowSeconds: number
  ) => Promise<{ allowed: boolean; current: number }>;
}

export class VelocityCheck implements EnforcementCheck {
  name = "velocity";

  constructor(
    private rules: VelocityRule[],
    private deps: VelocityCheckDeps
  ) {}

  async check(ctx: EnforcementContext): Promise<EnforcementResult>;
}
```

**2. DO SQLite implementation (recommended)**

Sliding window counter using a `velocity_events` table in the UserBudgetDO:

```sql
-- Table schema (created via transactionSync in DO constructor)
CREATE TABLE IF NOT EXISTS velocity_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_name TEXT NOT NULL,
  entity_key TEXT NOT NULL,
  value INTEGER NOT NULL,        -- 1 for count, microdollars for cost
  created_at INTEGER NOT NULL    -- epoch ms
);
CREATE INDEX IF NOT EXISTS idx_velocity_window
  ON velocity_events(rule_name, entity_key, created_at);
```

```typescript
// Inside transactionSync():
// 1. Prune expired entries
sql.exec("DELETE FROM velocity_events WHERE created_at < ?", nowMs - windowMs);
// 2. Sum current window
const current = sql.exec(
  "SELECT COALESCE(SUM(value), 0) as total FROM velocity_events WHERE rule_name = ? AND entity_key = ? AND created_at >= ?",
  ruleName, entityKey, nowMs - windowMs
).one().total;
// 3. Check limit
if (current + value > limit) return { allowed: false, current };
// 4. Insert new entry
sql.exec("INSERT INTO velocity_events (rule_name, entity_key, value, created_at) VALUES (?, ?, ?, ?)",
  ruleName, entityKey, value, nowMs);
return { allowed: true, current: current + value };
```

This runs atomically with budget checks in the same DO instance.
Per-user isolation is automatic (one DO per userId).

### What to change

| File | Change |
|------|--------|
| `packages/enforcement/src/checks/velocity-check.ts` | New file |
| `packages/enforcement/src/checks/index.ts` | Export VelocityCheck |

### How to test

- Unit test: under limit → allowed
- Unit test: at limit → denied with current count
- Unit test: window slides — old entries expire
- Unit test: cost-based velocity accumulates correctly
- Unit test: no rules configured → allowed (skip)
- Unit test: multiple rules — first denial wins

### Validation criteria

- Enforcement package tests pass
- Not wired into proxy yet (Phase 3D already wired Policy + Budget)

### Follow-up (not this phase)

Wire VelocityCheck into the proxy pipeline between PolicyCheck and
BudgetCheck. Add velocity rule configuration to the dashboard.

---

## Phase 3F — Enforcement API Endpoint

**Goal:** Add `POST /v1/enforce` to the **proxy** (CF Workers) so the SDK
can run the full enforcement pipeline via HTTP with direct DO access.

**Why on the proxy, not the dashboard:** The proxy owns the DO binding
(`env.USER_BUDGET`), the budget orchestrator, and the check-and-reserve
logic. Routing through the dashboard would add a network hop and couple
SDK enforcement latency to both services. The MCP proxy already calls the
CF Workers proxy for budget checks (`POST /v1/mcp/budget/check`) — this
endpoint is the generalized version of that pattern.

### What to build

**1. `POST /v1/enforce`** in `apps/proxy/src/routes/enforce.ts`

- Auth: API key auth (same `apiKeyAuth()` used by LLM routes)
- Accept:
  ```json
  {
    "provider": "anthropic",
    "model": "claude-sonnet-4-20250514",
    "estimatedCostMicrodollars": 50000,
    "toolName": "web_search",
    "sessionId": "session-abc"
  }
  ```
- Construct pipeline: PolicyCheck + VelocityCheck + BudgetCheck
  (approval not included — that's a separate flow)
- Run `runEnforcementPipeline()` using the existing budget orchestrator
  (`checkBudget()` → DO RPC)
- Return:
  ```json
  // Allowed:
  { "allowed": true, "reservationId": "res_abc" }

  // Denied:
  {
    "allowed": false,
    "denial": {
      "check": "budget",
      "code": "budget_exceeded",
      "reason": "Budget exceeded for api_key:key_abc",
      "details": { "remaining": 500000, "maxBudget": 10000000 }
    }
  }
  ```

**2. Route registration** in `apps/proxy/src/index.ts`

Add `/v1/enforce` to the router alongside `/v1/chat/completions`,
`/v1/messages`, and `/v1/mcp/*`.

**3. Policy config loading**

The endpoint needs to load the user's policy configuration. For Phase 3F,
policies are stored as a JSON column on the `api_keys` or `budgets` table
(or a new `policies` table — decide during implementation). Start simple:
hardcoded defaults + per-key overrides.

### What to change

| File | Change |
|------|--------|
| `apps/proxy/src/routes/enforce.ts` | New file — POST handler |
| `apps/proxy/src/index.ts` | Route `/v1/enforce` to handler |

### How to test

- Unit test: allowed → 200 with `allowed: true`
- Unit test: policy denied → 200 with denial details
- Unit test: budget denied → 200 with denial details (DO RPC mocked)
- Unit test: 401 without API key
- Unit test: missing required fields → 400

### Validation criteria

- `pnpm proxy:test` passes
- Manually test with curl against `wrangler dev`

---

## Phase 3G — SDK `enforce()`

**Goal:** Add enforcement method to the SDK that calls the proxy's
`POST /v1/enforce` endpoint.

**Note:** The SDK's `baseUrl` is already the proxy gateway URL (e.g.,
`https://proxy.nullspend.com`). The `enforce()` method calls the same
host the developer already configured — no additional URL needed.

### What to build

```typescript
class NullSpend {
  async enforce(context: {
    provider: string;
    model: string;
    estimatedCostMicrodollars: number;
    toolName?: string;
    sessionId?: string;
  }): Promise<EnforcementResult>;
}
```

### What to change

| File | Change |
|------|--------|
| `packages/sdk/src/client.ts` | Add `enforce()` — sends POST to `/v1/enforce` |
| `packages/sdk/src/types.ts` | Add enforcement types (or re-export from `@nullspend/enforcement`) |

### How to test

- Unit test: sends POST to `/v1/enforce` (proxy, not dashboard)
- Unit test: parses allowed/denied response
- Unit test: retries on transient errors
- Integration: SDK → wrangler dev → verify enforcement runs with DO

---

## Phase 3H — Conditional Approval Thresholds

**Goal:** Extend the approval system so tools can have cost-based
thresholds instead of binary gated/ungated.

### What to build

**1. Approval rule schema**

```typescript
interface ApprovalRule {
  toolName: string | "*";
  condition: "always" | "cost_above" | "never";
  thresholdMicrodollars?: number;  // for cost_above
}

// Examples:
// { toolName: "delete_file", condition: "always" }
// { toolName: "*", condition: "cost_above", thresholdMicrodollars: 500000 }
// { toolName: "read_file", condition: "never" }
```

**2. ApprovalCheck** in `packages/enforcement/src/checks/approval-check.ts`

```typescript
export class ApprovalCheck implements EnforcementCheck {
  name = "approval";

  constructor(
    private rules: ApprovalRule[],
    private deps: {
      createAction: (input: CreateActionInput) => Promise<{ id: string }>;
      waitForDecision: (id: string, timeoutMs: number) => Promise<ActionRecord>;
    }
  ) {}

  async check(ctx: EnforcementContext): Promise<EnforcementResult> {
    const rule = this.findMatchingRule(ctx);
    if (!rule || rule.condition === "never") return { allowed: true };
    if (rule.condition === "cost_above" &&
        ctx.estimatedCostMicrodollars < rule.thresholdMicrodollars!) {
      return { allowed: true };
    }
    // Requires approval
    const action = await this.deps.createAction({ ... });
    const decision = await this.deps.waitForDecision(action.id, ...);
    // ...
  }
}
```

**3. Update MCP proxy gating logic**

Replace the binary `isToolGated()` with `ApprovalCheck` using rules
derived from the existing config (`gatedTools`, `passthroughTools`).

### What to change

| File | Change |
|------|--------|
| `packages/enforcement/src/checks/approval-check.ts` | New file |
| `packages/mcp-proxy/src/gate.ts` | Refactor to use ApprovalCheck |

### How to test

- Unit test: condition "always" → approval required
- Unit test: condition "never" → no approval
- Unit test: condition "cost_above" with cost below threshold → no approval
- Unit test: condition "cost_above" with cost above threshold → approval required
- Unit test: wildcard rule matches all tools
- Unit test: specific tool rule overrides wildcard
- MCP proxy regression: existing gated/passthrough behavior preserved

---

## Phase 3I — Config Caching in Worker

**Goal:** Cache policy configuration in the Cloudflare Worker's global
scope so PolicyCheck never makes a network call.

### What to build

**1. Policy cache** with TTL-based refresh

```typescript
// Module-level cache in CF Worker (persists across requests within isolate)
let policyCache: Map<string, { config: PolicyConfig; expiresAt: number }>;

async function getPolicyConfig(
  keyId: string,
  connectionString: string
): Promise<PolicyConfig> {
  const cached = policyCache.get(keyId);
  if (cached && Date.now() < cached.expiresAt) return cached.config;
  // Fetch from Postgres, cache for 60s
  const config = await loadPolicyFromDb(keyId, connectionString);
  policyCache.set(keyId, { config, expiresAt: Date.now() + 60_000 });
  return config;
}
```

**2. Stale-while-revalidate**

If the cache entry is expired but a fresh fetch fails (DB down), serve the
stale entry rather than failing the request. Log the staleness.

### What to change

| File | Change |
|------|--------|
| `apps/proxy/src/lib/policy-cache.ts` | New file |
| `apps/proxy/src/routes/anthropic.ts` | Use cached policy config |
| `apps/proxy/src/routes/openai.ts` | Same |

### How to test

- Unit test: first request → cache miss → fetch from DB
- Unit test: second request within TTL → cache hit (no DB call)
- Unit test: expired entry + DB failure → stale entry served
- Unit test: cache eviction when max size reached

---

## Phase 4A — Approval Webhook Events

**Goal:** Fire webhook events for approval lifecycle:
`action.pending`, `action.approved`, `action.rejected`, `action.expired`.

### What to build

**1. New event types** in webhook dispatch

```typescript
type WebhookEventType =
  | "cost_event.created"      // existing
  | "budget.threshold"        // existing
  | "budget.exceeded"         // existing
  | "action.pending"          // new
  | "action.approved"         // new
  | "action.rejected"         // new
  | "action.expired";         // new
```

**2. Fire events from action state transitions**

- `POST /api/actions` (create) → fire `action.pending`
- `POST /api/actions/{id}/approve` → fire `action.approved`
- `POST /api/actions/{id}/reject` → fire `action.rejected`
- Expiry check → fire `action.expired`

### What to change

| File | Change |
|------|--------|
| `app/api/actions/route.ts` | Fire `action.pending` on create |
| `app/api/actions/[id]/approve/route.ts` | Fire `action.approved` |
| `app/api/actions/[id]/reject/route.ts` | Fire `action.rejected` |
| Webhook types | Add new event types |

### How to test

- Unit test: action creation fires `action.pending` webhook
- Unit test: approval fires `action.approved` webhook with action details
- Unit test: webhook only fires if endpoint has the event type enabled
- Integration: end-to-end webhook delivery via QStash

---

## Phase 4B — Pre-Built Policy Templates

**Goal:** Ship default policy configurations that new users get
automatically, reducing time-to-value.

### What to build

**1. Policy templates**

```typescript
const POLICY_TEMPLATES = {
  conservative: {
    name: "Conservative",
    description: "Strict controls for production use",
    modelAllowlist: [
      "claude-sonnet-4-20250514", "gpt-4o-mini",
      "claude-haiku-4-5-20251001",
    ],
    maxRequestCostMicrodollars: 1_000_000, // $1 per request
    velocityRules: [
      { name: "hourly_cost", entity: "api_key", metric: "cost_microdollars",
        limit: 5_000_000, windowSeconds: 3600 }, // $5/hour
      { name: "minute_requests", entity: "api_key", metric: "request_count",
        limit: 60, windowSeconds: 60 }, // 60 req/min
    ],
  },
  permissive: {
    name: "Permissive",
    description: "Minimal controls for development",
    modelAllowlist: null, // all models allowed
    maxRequestCostMicrodollars: 10_000_000, // $10 per request
    velocityRules: [],
  },
  balanced: {
    name: "Balanced",
    description: "Recommended defaults for most teams",
    modelAllowlist: null,
    maxRequestCostMicrodollars: 5_000_000, // $5 per request
    velocityRules: [
      { name: "hourly_cost", entity: "api_key", metric: "cost_microdollars",
        limit: 50_000_000, windowSeconds: 3600 }, // $50/hour
    ],
  },
};
```

**2. Template selection on API key creation**

When creating an API key, optionally specify a policy template. Default:
`balanced`.

**3. Dashboard UI** (settings page)

Show available templates. Let user pick one or customize.

### What to change

| File | Change |
|------|--------|
| `packages/enforcement/src/templates.ts` | New file — template definitions |
| `app/api/keys/route.ts` | Accept `policyTemplate` on key creation |
| Dashboard settings page | Template picker UI |

---

## Phase 4C — Dashboard Approval Rules UI

**Goal:** Let users configure approval rules (which tools require approval,
cost thresholds) in the dashboard instead of only via MCP proxy env vars.

### What to build

**1. `approval_rules` table**

```sql
CREATE TABLE approval_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES auth.users(id),
  tool_pattern TEXT NOT NULL,           -- tool name or "*"
  condition TEXT NOT NULL DEFAULT 'always', -- 'always', 'cost_above', 'never'
  threshold_microdollars BIGINT,
  priority INTEGER NOT NULL DEFAULT 0,  -- higher = evaluated first
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**2. CRUD API routes**

```
GET    /api/approval-rules          — list rules
POST   /api/approval-rules          — create rule
PUT    /api/approval-rules/{id}     — update rule
DELETE /api/approval-rules/{id}     — delete rule
```

**3. MCP proxy reads rules from API**

On startup, the MCP proxy fetches approval rules from
`GET /api/approval-rules` and uses them instead of (or merged with)
the local `GATED_TOOLS` env var config.

### What to change

| File | Change |
|------|--------|
| `packages/db/src/schema.ts` | Add `approvalRules` table |
| `drizzle/` | New migration |
| `app/api/approval-rules/` | New CRUD routes |
| `packages/mcp-proxy/src/gate.ts` | Fetch + merge remote rules |
| Dashboard | Approval rules UI page |

---

## Phase 4D — Feedback Loops / Auto-Remediation

**Goal:** When spend velocity exceeds configurable thresholds, automatically
tighten enforcement — not just deny individual requests, but adjust policy
for subsequent requests.

**This is the most complex phase and should only be built after all prior
phases are validated in production.**

### What to build

**1. Velocity alert triggers**

```typescript
interface VelocityAlert {
  condition: "spend_rate_above";
  thresholdMicrodollarsPerHour: number;
  action: "tighten_cost_cap" | "block_expensive_models" | "notify_only";
  tightenedCostCapMicrodollars?: number;
  blockedModels?: string[];
}
```

**2. Auto-tightening mechanism**

When a velocity alert fires:
- Write a temporary policy override to the UserBudgetDO (TTL = 1 hour)
  or KV store (if cross-user scope needed)
- PolicyCheck reads temporary overrides before static config
- Dashboard shows active auto-remediation with "dismiss" button

**3. Alert → action pipeline**

```
Velocity exceeds threshold
  → QStash sends alert event
  → Alert handler writes DO/KV override
  → Subsequent requests hit tighter policy
  → Dashboard shows alert banner
  → Human can dismiss or make permanent
```

### What to change

| File | Change |
|------|--------|
| `packages/enforcement/src/checks/policy-check.ts` | Read temporary overrides from DO/KV |
| `app/api/alerts/` | New routes for alert management |
| Webhook dispatch | Fire velocity alert events |
| Dashboard | Alert banner + management UI |

### How to test

- Unit test: temporary override tightens cost cap
- Unit test: override expires after TTL
- Unit test: dismiss clears override
- Integration: high-velocity requests → auto-tightening triggers

---

## Dependency Graph

```
Phase 2A ──→ Phase 2B ──→ Phase 2C
                │
                └──→ Phase 2F (batching, after 2C works)

Phase 2D ──→ Phase 2E

Phase 3A ──→ Phase 3B ──→ Phase 3D (wire into proxy)
         ├──→ Phase 3C ──┘
         ├──→ Phase 3E (velocity, can parallel with 3B/3C)
         └──→ Phase 3H (approval check)

Phase 3D ──→ Phase 3F ──→ Phase 3G (SDK enforce)
Phase 3D ──→ Phase 3I (config caching)

Phase 3H ──→ Phase 4A (approval webhooks)
         ──→ Phase 4C (approval rules UI)

Phase 3B ──→ Phase 4B (policy templates)
Phase 3E ──→ Phase 4D (feedback loops, last)
```

Phases within the same number (e.g., 2A-2F) are generally sequential.
Phases across numbers can overlap when dependencies allow — e.g., Phase 3A
can start while Phase 2E is being validated.

---

## Risk Assessment per Phase

| Phase | Risk | Mitigation |
|-------|------|------------|
| 2A (SDK retry) | **Done** — shipped | N/A |
| 2B (cost event API) | Low — new endpoint, no existing code changed | Input validation + idempotency |
| 2C (SDK reportCost) | Low — new method, no existing behavior changed | Unit tests |
| 2D (budget status API) | Low — read-only endpoint | Postgres read (Option A) |
| 2E (SDK checkBudget) | Low — new method | Unit tests |
| 2F (SDK batching) | Medium — flush timing, shutdown hooks | Opt-in only; default off |
| 3A (interfaces) | Zero — types only | N/A |
| 3B (PolicyCheck) | Low — new code, not yet wired | Pure function, thorough tests |
| 3C (BudgetCheck) | Low — wrapper only | Mock-based tests |
| **3D (wire pipeline)** | **High — changes proxy request path** | **Compare mode first** |
| 3E (VelocityCheck) | Medium — new DO SQLite table | Isolated tests; not wired until validated |
| 3F (enforce API) | Low — new endpoint | Unit tests |
| 3G (SDK enforce) | Low — new method | Unit tests |
| 3H (conditional approval) | Medium — changes MCP proxy gating | Regression tests |
| 3I (config caching) | Medium — caching correctness | Stale-while-revalidate; TTL-based |
| 4A (approval webhooks) | Low — additive | Unit tests on event dispatch |
| 4B (policy templates) | Low — additive | Default template is permissive |
| 4C (approval rules UI) | Medium — new table + MCP config source | Feature flag on MCP side |
| 4D (feedback loops) | High — auto-modifying enforcement | Manual dismiss; TTL expiry; notify-only first |
