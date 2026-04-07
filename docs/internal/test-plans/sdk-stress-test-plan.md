# Design: SDK Stress Test & Live Production Validation

Generated: 2026-04-06
Branch: main
Repo: cjones6489/nullspend
Status: DRAFT — awaiting /plan-eng-review
Mode: Builder (infrastructure/tooling)

---

## 0. Purpose of This Document

This is a design document for a NEW stress test file that exercises every SDK feature end-to-end against the deployed NullSpend worker + dashboard. It will be implemented in a fresh session using this doc as the spec.

Do NOT start implementation from this document alone. Read it, run `/plan-eng-review` on it, resolve the open questions, THEN write the test file.

---

## 1. Context & Motivation

### What's already tested

Smoke tests against the deployed proxy cover the customer primitive data path:
- `apps/proxy/smoke-customer-primitive.test.ts` — 8 tests, all passing as of commit f7fa50d
- `X-NullSpend-Customer` header → `cost_events.customer_id` column
- Tag fallback when header is absent
- Header precedence over tag on conflict
- Invalid header → warning response + null column
- Customer budget enforcement via Durable Object (tight + generous budgets)
- Margin query `coalesce(customer_id, tags->>'customer')` backcompat

Unit tests (mocked) cover SDK internals:
- `packages/sdk/src/client.test.ts` — NullSpend class, customer() method signature
- `packages/sdk/src/tracked-fetch.test.ts` — buildTrackedFetch behavior
- `packages/sdk/src/policy-cache.test.ts` — policy cache TTL, invalidation
- `apps/proxy/src/__tests__/customer.test.ts` — parseCustomerHeader, resolveCustomerId

### What's NOT tested (the gap this doc addresses)

The SDK runs in the caller's process, not in the worker. Every SDK feature that transforms user code into proxy-hitting requests or direct-provider tracking has **zero end-to-end coverage in production**. Specifically:

**Customer session wrapper (`client.customer(id)`)** — the feature we designed for the multi-tenant scaling pain point:
- Memoized per-provider fetch caching
- customerId propagation through the tracked fetch to the eventual cost event
- Plan tag auto-injection from CustomerSessionOptions
- Validates empty/whitespace customerId throws
- Works with both OpenAI and Anthropic SDKs as drop-in fetch replacement

**Tracked fetch enforcement layer**:
- Mandate violation throws MandateViolationError before sending request
- Budget exhaustion throws BudgetExceededError via policy cache
- Session limit throws SessionLimitExceededError client-side
- Proxy 429 interception converts upstream denial codes to typed errors (budget_exceeded, velocity_exceeded, session_limit_exceeded, tag_budget_exceeded)
- `onDenied` callback fires with structured DenialReason before throw
- `safeDenied` wrapper swallows callback errors (doesn't crash host process)
- Policy fetch failure → fall-open, but manual sessionLimitMicrodollars still enforced

**Direct-mode cost event ingestion** (SDK → dashboard, not via proxy):
- `reportCost(event)` single event with customer field
- `reportCostBatch(events)` batch ingest
- `queueCost(event)` + `flush()` client-side batching
- CostReporter flush interval, queue drop behavior, `onDropped` callback
- `shutdown()` graceful drain

**Concurrency & race conditions**:
- Many customers sharing one key, interleaved requests
- Same customer, many concurrent requests racing to same budget
- OpenAI + Anthropic mixed on the same customer session
- Policy cache consistency across concurrent tracked-fetch instances
- Session spend accumulation accuracy under bursty load

**Data lifecycle**:
- Create real API keys, customers, and budgets via SQL (production-shaped)
- Modify budgets mid-test and verify DO sync catches up
- Delete all test data on teardown (no orphans)

---

## 2. SDK Surface Area Inventory

Everything the test must exercise, enumerated from `packages/sdk/src/`:

### 2.1 NullSpend class (`client.ts`)

```typescript
new NullSpend({
  baseUrl: string,           // Dashboard API URL (for /api/cost-events, /api/policy)
  apiKey: string,            // ns_live_sk_...
  apiVersion?: string,       // Default: "2026-04-01"
  fetch?: typeof fetch,
  requestTimeoutMs?: number, // Default: 30_000
  maxRetries?: number,       // Default: 2, max 10
  retryBaseDelayMs?: number, // Default: 500
  maxRetryTimeMs?: number,   // Default: 0 (no cap)
  onRetry?: (info: RetryInfo) => void | boolean,
  costReporting?: {
    batchSize?: number,      // Default: 10, clamped [1, 100]
    flushIntervalMs?: number,// Default: 5000, min 100
    maxQueueSize?: number,   // Default: 1000
    onDropped?: (count: number) => void,
    onFlushError?: (error: Error, events: CostEventInput[]) => void,
  },
})
```

Methods to exercise:
- `createTrackedFetch(provider, options?)` — requires costReporting
- `customer(customerId, options?)` — returns CustomerSession
- `reportCost(event)` — POST /api/cost-events
- `reportCostBatch(events)` — POST /api/cost-events/batch
- `queueCost(event)` — client-side queue
- `flush()` — drain queue
- `shutdown()` — graceful close
- `checkBudget()` — GET /api/budgets/status
- `listBudgets()` — GET /api/budgets
- `listCostEvents(options?)` — GET /api/cost-events
- `requestBudgetIncrease(...)` — proposed budget increase flow (may be out of scope — see §18)

### 2.2 TrackedFetchOptions (`types.ts:215-230`)

```typescript
{
  customer?: string,
  sessionId?: string,
  tags?: Record<string, string>,
  traceId?: string,
  actionId?: string,
  enforcement?: boolean,
  sessionLimitMicrodollars?: number,
  onCostError?: (error: Error) => void,
  onDenied?: (reason: DenialReason) => void,
}
```

### 2.3 CustomerSessionOptions (`types.ts:243-258`)

```typescript
{
  plan?: string,                       // Becomes tags.plan
  sessionId?: string,
  sessionLimitMicrodollars?: number,
  tags?: Record<string, string>,
  enforcement?: boolean,
  onCostError?: (error: Error) => void,
  onDenied?: (reason: DenialReason) => void,
}
```

### 2.4 CustomerSession (`types.ts:260-269`)

```typescript
{
  openai: typeof globalThis.fetch,              // Memoized
  anthropic: typeof globalThis.fetch,           // Memoized
  fetch: (provider) => typeof globalThis.fetch, // Memoized getter
  customerId: string,                           // Readonly
}
```

### 2.5 DenialReason union (`types.ts`)

```typescript
| { type: "budget"; remaining: number; entityType?; entityId?; limit?; spend? }
| { type: "mandate"; mandate; requested; allowed }
| { type: "session_limit"; sessionSpend; sessionLimit }
| { type: "velocity"; retryAfterSeconds?; limit?; window?; current? }
| { type: "tag_budget"; tagKey?; tagValue?; remaining?; limit?; spend? }
```

### 2.6 Error classes (`errors.ts`)

- `NullSpendError` — base class
- `TimeoutError` — request timeout
- `RejectedError` — non-retryable server error
- `BudgetExceededError` — budget.exceeded
- `MandateViolationError` — mandate violation
- `SessionLimitExceededError` — session limit
- `VelocityExceededError` — velocity limit
- `TagBudgetExceededError` — tag budget

Every error type must be thrown and caught at least once in the test.

---

## 3. Known SDK Limitations & Gaps

These are real issues I discovered while reading the SDK source. The stress test MUST exercise them to either confirm they're blockers or document current behavior. File findings at the end of the test run, separate from pass/fail.

### 3.1 `isProxied()` URL hardcode (`tracked-fetch.ts:292-307`)

```typescript
function isProxied(url: string, init?: RequestInit): boolean {
  if (url.includes("proxy.nullspend.com")) return true;  // ← hardcoded
  if (init?.headers) { /* checks for x-nullspend-key */ }
  return false;
}
```

**Problem:** Our deployed proxy is at `nullspend.cjones6489.workers.dev`, not `proxy.nullspend.com`. The URL match fails. The SDK will try to track cost client-side for proxied requests, causing **double-counting** unless the caller manually sets `x-nullspend-key` in request headers.

**Impact on test:** When testing customer session with OpenAI pointed at our proxy URL, cost events may be written twice — once by the proxy, once by the SDK's tracked-fetch queue. The verification phase must detect this.

**Mitigation options:**
- Test explicitly sets `x-nullspend-key` in OpenAI client default headers so `isProxied()` returns true via header check
- OR test points OpenAI at api.openai.com directly (true direct mode) and lets the SDK track
- Document the hardcode as a finding to fix in a follow-up PR

### 3.2 `customer()` does not inject X-NullSpend-Customer header

Reading `client.ts:227-264` and `tracked-fetch.ts:56-73`: the `customer()` method stores `customer` in metadata for cost event construction, but does NOT inject `X-NullSpend-Customer` into the outgoing request headers. If the tracked fetch is used with an OpenAI client pointed at our proxy, the proxy will never see the customer header → cost_events.customer_id will be null.

**Impact on test:** Customer session wrapper in "proxy mode" is non-functional today. The test must either:
- Test direct mode only (OpenAI SDK → openai.com, SDK tracks client-side)
- Mix customer() with manual header injection for proxy mode
- Document as a gap the SDK should close

### 3.3 `extractBody()` returns null for Request objects (`tracked-fetch.ts:309-317`)

If the caller passes a `Request` object instead of `(url, init)`, body extraction fails. The model is defaulted to "unknown" and OpenAI streaming won't include usage (missing stream_options.include_usage). Non-streaming still works but with model="unknown" in the cost event.

**Impact on test:** Must verify the test uses `(url, init)` form, not `new Request(...)` form, to exercise the full cost tracking path.

### 3.4 CostReporter queue drop behavior under flood

Default `maxQueueSize = 1000`. Under a stress scenario that floods events faster than `flushIntervalMs` can drain, events get dropped. The `onDropped` callback fires but events are lost. The test must verify the callback fires under load AND that no cost event corruption happens (e.g., partial batch writes).

---

## 4. Test Architecture

### 4.1 File location & naming

`apps/proxy/stress-sdk-features.test.ts`

Matches existing convention (`stress-*.test.ts`). Included by `vitest.stress.config.ts` via the `stress-*.test.ts` glob. Runs sequentially with other stress files (`fileParallelism: false`).

### 4.2 Dependencies

Add to `apps/proxy/package.json` devDependencies:
```json
"@nullspend/sdk": "workspace:*"
```

Already added during this session (commit pending). `pnpm install` has been run.

### 4.3 New environment variables

Add to `.env.smoke`:

```bash
# Dashboard URL for SDK direct-mode cost event ingestion.
# Required for Phase 3 direct-ingest tests; if unset, those tests skip.
NULLSPEND_DASHBOARD_URL=https://nullspend.com
```

Everything else (PROXY_URL, NULLSPEND_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, INTERNAL_SECRET, DATABASE_URL, NULLSPEND_SMOKE_USER_ID, NULLSPEND_SMOKE_KEY_ID) is already required by existing smoke/stress tests.

### 4.4 Intensity scaling

Match the existing pattern from `stress-budget-races.test.ts`:

```typescript
const INTENSITY = (process.env.STRESS_INTENSITY ?? "medium") as "light" | "medium" | "heavy";

const CUSTOMER_COUNT    = { light: 5,  medium: 15, heavy: 30  }[INTENSITY];
const CONCURRENT_REQS   = { light: 10, medium: 25, heavy: 50  }[INTENSITY];
const RACE_REQS         = { light: 15, medium: 30, heavy: 60  }[INTENSITY];
const BATCH_EVENTS      = { light: 20, medium: 50, heavy: 100 }[INTENSITY];
const SESSION_BURST     = { light: 10, medium: 20, heavy: 40  }[INTENSITY];
```

Default medium. Run heavy manually when investigating.

### 4.5 Test data isolation

All test data uses a deterministic prefix + TEST_RUN_ID for cleanup:

```typescript
const TEST_RUN_ID = Date.now().toString(36);
const PREFIX = `stress-sdk-${TEST_RUN_ID}`;

// Customer IDs:   stress-sdk-mno2xyz-customer-01 … stress-sdk-mno2xyz-customer-30
// Tag values:     stress-sdk-mno2xyz
// Session IDs:    stress-sdk-mno2xyz-session-01 …
// Trace IDs:      stress-sdk-mno2xyz-trace-01 …
```

All DELETE queries filter by `entity_id LIKE 'stress-sdk-${TEST_RUN_ID}-%'` or `tags->>'_ns_test_run_id' = '${TEST_RUN_ID}'`.

### 4.6 Cost event tagging for cleanup

Every cost event generated by the test is tagged with `_ns_test_run_id: TEST_RUN_ID`. Teardown can DELETE FROM cost_events WHERE tags->>'_ns_test_run_id' = $RUN_ID. The tags column is JSONB GIN-indexed, so this is efficient.

### 4.7 Tolerance bands

Under concurrent load, cost event reconciliation takes 5–15 seconds via the queue consumer. The verification phase uses:

- **Strict assertions:** counts, denial presence, customer_id population
- **Tolerance bands:** budget spend within ±5% of expected (queue retry + reconcile timing)
- **Eventual consistency wait:** 15s after last request before querying cost_events

---

## 5. Test Data Fixtures

Created in `beforeAll`, deleted in `afterAll`. All SQL uses parameterized queries via postgres.js tagged templates.

### 5.1 Customer budgets (created in Postgres, synced to DO)

| Fixture | entity_id | max_budget | policy | velocity | session_limit | Purpose |
|---|---|---|---|---|---|---|
| `customer-generous-01…05` | `stress-sdk-${RUN}-customer-01…05` | $10 | strict_block | none | none | Happy path, concurrent requests |
| `customer-tight-01…03` | `stress-sdk-${RUN}-tight-01…03` | 1 µ¢ | strict_block | none | none | Immediate denial |
| `customer-velocity` | `stress-sdk-${RUN}-velocity` | $1 | strict_block | 500 µ¢/10s, cooldown 5s | none | Velocity testing |
| `customer-session` | `stress-sdk-${RUN}-session` | $1 | strict_block | none | 5000 µ¢ | Session limit testing |
| `customer-plan-pro` | `stress-sdk-${RUN}-plan-pro` | $5 | warn | none | none | Plan tag routing |

### 5.2 Tag budget (for customer vs tag interaction test)

| Fixture | entity_type | entity_id | max_budget | Purpose |
|---|---|---|---|---|
| `tag-budget` | `tag` | `customer=stress-sdk-${RUN}-dual-attr` | $1 | Verify customer coalesce with tag fallback |

Then also create a customer budget `stress-sdk-${RUN}-dual-attr` to test precedence.

### 5.3 User budget (baseline, shared by all tests)

Reuses the existing smoke user budget if present; otherwise creates one at $100 to avoid the top-level user budget blocking tests.

### 5.4 NOT creating new API keys

The test reuses `NULLSPEND_API_KEY` / `NULLSPEND_SMOKE_KEY_ID` from env. Creating real API keys requires hitting the dashboard API with an auth'd session — too much friction. If we later need per-test keys, add that in a follow-up.

### 5.5 Setup sequence

```
1. Connect to Postgres (postgres.js, max: 3 connections)
2. Look up SMOKE_ORG_ID from api_keys table via NULLSPEND_SMOKE_KEY_ID
3. Assert hasBudgets = true for SMOKE_ORG_ID (sanity check)
4. INSERT all customer budgets (ON CONFLICT DO UPDATE)
5. INSERT tag budget + dual-attr customer budget
6. For each budget: call syncBudget(orgId, entityType, entityId)
7. Wait 2000ms for DO population to settle under concurrent sync traffic
8. Verify at least one budget is readable from DO via proxy health check
9. Set up OpenAI + Anthropic rate limit awareness (backoff if 429)
```

### 5.6 Teardown sequence

```
1. Wait 15 seconds for in-flight reconciliations + cost event writes
2. DELETE FROM cost_events WHERE tags->>'_ns_test_run_id' = TEST_RUN_ID
3. For each created budget: invalidateBudget(orgId, entityType, entityId, "remove")
4. DELETE FROM budgets WHERE entity_id LIKE 'stress-sdk-${RUN}-%'
5. DELETE FROM budgets WHERE entity_type = 'tag' AND entity_id = 'customer=stress-sdk-${RUN}-dual-attr'
6. sql.end() — close Postgres pool
7. ns.shutdown() — close SDK cost reporter queue
```

Teardown must be in `afterAll` with try/catch per step so one failure doesn't leave orphans.

---

## 6. Phase 1 — Functional Tests (one assertion per SDK feature)

Goal: prove every SDK surface area works end-to-end once before stressing.

Each test below is a single `it()` block. Run sequentially. First thing the verification phase checks.

### 6.1 NullSpend client construction

- **1.1** Construct NullSpend with valid config → no throw
- **1.2** Construct without baseUrl → throws NullSpendError("baseUrl is required")
- **1.3** Construct without apiKey → throws NullSpendError("apiKey is required")
- **1.4** Construct with costReporting → costReporter is non-null
- **1.5** Construct without costReporting → createTrackedFetch throws
- **1.6** apiVersion defaults to "2026-04-01" when omitted

### 6.2 createTrackedFetch

- **2.1** Create fetch for "openai" → returns callable function
- **2.2** Create fetch for "anthropic" → returns callable function
- **2.3** Without costReporting configured → throws
- **2.4** With enforcement: true → creates PolicyCache instance (verify via policyCaches.size)
- **2.5** Tracked fetch against non-tracked URL (e.g., GET https://api.openai.com/v1/models) → passes through, no cost event

### 6.3 customer() session

- **3.1** `ns.customer("acme")` → returns CustomerSession with correct customerId
- **3.2** `ns.customer("")` → throws
- **3.3** `ns.customer("   ")` → throws
- **3.4** `session.openai === session.openai` (memoized) — same reference
- **3.5** `session.fetch("openai") === session.openai` (memoized)
- **3.6** `session.customerId === "acme"` (readonly)
- **3.7** With `plan: "pro"` option → tags.plan injected into metadata (verify via cost event)
- **3.8** With `tags: { env: "prod" }` + `plan: "pro"` → both tags present

### 6.4 Direct-mode cost event ingest

(Skip entire section if NULLSPEND_DASHBOARD_URL is unset; mark skipped.)

- **4.1** `ns.reportCost(event)` single event with customer field → 200 OK, cost_events row with customer_id populated
- **4.2** `ns.reportCostBatch([event1, event2])` → both rows inserted, idempotent via requestId
- **4.3** `ns.queueCost(event)` + `ns.flush()` → row eventually written
- **4.4** `ns.shutdown()` after queueCost → drain completes
- **4.5** Dual-provider batch (one openai, one anthropic) → both persist

### 6.5 Proxy-mode end-to-end (SDK as orchestrator, proxy handles tracking)

Since `customer()` doesn't inject the X-NullSpend-Customer header (gap §3.2), we test proxy-mode by manually constructing request headers. This proves the SDK can coexist with proxy-mode when the caller sets `x-nullspend-key`.

- **5.1** Fetch wrapper with `x-nullspend-key` header → SDK detects proxy via isProxied(), passes through, proxy tracks cost event with customer_id
- **5.2** OpenAI chat completion via SDK-wrapped fetch pointed at proxy URL → cost event has customer_id, request_id matches

### 6.6 Enforcement: mandate violation

Precondition: set up a test API key with allowedModels = ["gpt-4o-mini"] (skip if we can't — see §18 open questions).

- **6.1** Call tracked fetch with model="gpt-4" → throws MandateViolationError before sending request
- **6.2** `onDenied` callback fires with `{ type: "mandate", mandate, requested: "gpt-4", allowed: ["gpt-4o-mini"] }`
- **6.3** No cost event written (request never sent)

### 6.7 Enforcement: client-side budget denial (via policy cache)

- **7.1** Point SDK at an exhausted customer budget (`stress-sdk-${RUN}-tight-01`)
- **7.2** Call tracked fetch → policy cache sees remaining ≤ 0 → throws BudgetExceededError
- **7.3** `onDenied` fires with `{ type: "budget", remaining, limit, spend }`

### 6.8 Enforcement: client-side session limit

- **8.1** Create tracked fetch with `sessionId: "test-session"`, `sessionLimitMicrodollars: 5000`
- **8.2** Make 3 consecutive calls, each ~2000 µ¢ estimated cost
- **8.3** 4th call → throws SessionLimitExceededError
- **8.4** `onDenied` fires with `{ type: "session_limit", sessionSpend, sessionLimit }`

### 6.9 Enforcement: proxy 429 interception

These test the SDK's ability to convert proxy denial responses into typed errors. Use direct fetch against the proxy (not SDK tracked fetch) to trigger the 429, then feed the response back through the SDK's interception logic... actually, the interception is inside the SDK's tracked fetch, so we need to use tracked fetch pointed at the proxy.

- **9.1** Point tracked fetch at proxy with `x-nullspend-key`, target an exhausted customer budget → proxy returns 429 `customer_budget_exceeded`. Verify: tracked fetch receives 429, but since the URL isn't "proxy.nullspend.com" AND enforcement is true, it runs the interception code path. Expected: throws BudgetExceededError with correct remaining/limit/spend from details.
- **9.2** Target a velocity-limited customer → 429 `velocity_exceeded` → throws VelocityExceededError with retryAfterSeconds from Retry-After header
- **9.3** Target a session-limited customer → 429 `session_limit_exceeded` → throws SessionLimitExceededError
- **9.4** Target a tag-budget entity → 429 `tag_budget_exceeded` → throws TagBudgetExceededError

Note: **depends on whether isProxied() correctly detects our deployed proxy URL**. See §3.1. The test may need to use the header-based detection path.

---

## 7. Phase 2 — Concurrent Stress Scenarios

Goal: exercise each feature under load to find races, leaks, drops, accuracy drift.

### 7.1 Concurrent customer budget races (same customer, many requests)

**Scenario:** One customer budget at $10 (generous). 50 concurrent SDK calls hit it in parallel via customer session wrapper + direct fetch to proxy (using raw fetch, not tracked-fetch, to avoid double-counting).

**Assertions:**
- All 50 requests return 200
- After 15s reconcile wait: budget spend = sum of actualCost for all 50 requests (within ±2% tolerance)
- `cost_events` has exactly 50 rows with customer_id = this customer
- No reservations leaked (DO's reservations table should be empty after reconcile)

**Failure modes targeted:** reservation leaks, double-reconcile, spend drift, missing customer_id

### 7.2 Concurrent customer budget races (same customer, tight budget)

**Scenario:** Customer budget at 1 microdollar. 30 concurrent requests try to pass. Only zero should succeed.

**Assertions:**
- All 30 requests return 429 `customer_budget_exceeded`
- No cost events for this customer
- Budget spend still = 0 after reconcile wait
- DO reservations table empty

**Failure modes targeted:** race condition in checkAndReserve, phantom reservations, partial spend drift

### 7.3 Rapid customer switching (one process, many customers, interleaved)

**Scenario:** 15 customers, 5 concurrent workers per customer (75 total concurrent requests). Each worker round-robins through its customer 3 times. Total: 225 requests.

**Assertions:**
- All requests return 200 (budgets are generous)
- Customer session cache inside NullSpend reuses fetch instances (no leak of policy caches)
- After reconcile wait: cost_events group-by customer_id = 15 distinct IDs, each with 15 rows
- Budget spend per customer matches sum of actual costs (±5% tolerance)

**Failure modes targeted:** customer session cache eviction bugs, cross-contamination of tags between sessions, metadata leak

### 7.4 Mixed provider on same customer session

**Scenario:** For 5 customers, alternate OpenAI and Anthropic requests in one process. 10 requests per customer, alternating. Uses `session.fetch("openai")` and `session.fetch("anthropic")`.

**Assertions:**
- All requests return 200
- cost_events has 25 OpenAI rows + 25 Anthropic rows for the 5 customers
- Each provider's cost events have correct provider, model, customer_id
- No provider metadata bleeds into the other

**Failure modes targeted:** shared metadata state between providers, wrong pricing applied

### 7.5 Session limit under burst

**Scenario:** 1 customer, 1 sessionId, sessionLimitMicrodollars = 5000 (enough for ~3 small requests). Fire 20 concurrent requests with the same session.

**Assertions:**
- Some requests succeed (roughly 3 based on estimate accuracy)
- Remaining requests throw SessionLimitExceededError client-side
- `onDenied` called for each denial with consistent structure
- Session spend tracking reflects actual successful requests (cost_events sum)

**Failure modes targeted:** client-side session counter races, accumulation bugs, denied requests still making network calls

### 7.6 Direct SDK ingest under load

(Skip if NULLSPEND_DASHBOARD_URL unset.)

**Scenario:** Generate 100 synthetic cost events (no real OpenAI calls). Push to `ns.queueCost()` in rapid succession with batchSize=10, flushIntervalMs=500.

**Assertions:**
- All 100 events eventually appear in cost_events with correct customer_id
- No drops (verify `onDropped` callback not fired)
- Idempotent: re-running the same batch doesn't duplicate (requestId unique constraint)
- `onFlushError` not fired unless network actually flakes

**Failure modes targeted:** queue drops, flush race with shutdown, retry logic gaps

### 7.7 Policy cache staleness

**Scenario:** Start with a customer budget at $10. SDK makes requests in a loop (enforcement: true, caches policy). While the loop runs, test code UPDATES the budget to 1 microdollar in Postgres + calls syncBudget to force DO sync. Continue loop for another 60 seconds (policy cache TTL).

**Assertions:**
- Initial requests succeed
- After budget drop + sync, cached policy is stale → requests still succeed client-side
- Requests arrive at proxy, which has fresh DO state → proxy returns 429
- SDK intercepts 429, converts to BudgetExceededError
- After policy TTL (60s): next client-side check sees new policy, denies before sending

**Failure modes targeted:** stale cache holding the line forever, interception fallthrough, TTL not honored

---

## 8. Phase 3 — Mid-Test Data Mutation

Goal: test the create/modify/delete lifecycle against the DO sync path.

### 8.1 Budget increase mid-stream

**Scenario:** Customer budget at 100 µ¢ (tiny). Fire 5 requests (expect 4 denials). UPDATE max_budget to $10, syncBudget. Fire 5 more requests (expect all pass). Verify cost_events reflect both phases with correct customer_id.

### 8.2 Budget delete mid-stream

**Scenario:** Customer budget exists, requests pass. DELETE the budget in Postgres + invalidateBudget("remove"). Fire requests → no budget to enforce, requests pass (or skipped depending on hasBudgets flag). Verify cost_events still tag customer_id from the header (proxy tag-injection path still works without a budget).

### 8.3 Budget spend reset mid-stream

**Scenario:** Customer budget at $10. Fire 10 requests (consume some). After reconcile, use invalidateBudget(..., "reset_spend") to reset. Verify subsequent requests see full $10 again.

### 8.4 Customer ID collision

**Scenario:** Two concurrent sessions use the same customerId. Both make requests. Verify cost_events has correct aggregation (both sessions' events attribute to the same customer), no cross-session metadata leak.

### 8.5 Plan tag modification

**Scenario:** Session 1 uses `plan: "free"`. Session 2 uses `plan: "pro"` with same customer. Both make requests. Verify tags.plan is per-session in cost_events (no cross-contamination).

---

## 9. Phase 4 — Verification

After all stress phases, verify the accumulated state.

### 9.1 Cost events integrity

```sql
-- Count events by customer for this test run
SELECT customer_id, COUNT(*) as cnt, SUM(cost_microdollars)::text as total
FROM cost_events
WHERE tags->>'_ns_test_run_id' = ${TEST_RUN_ID}
GROUP BY customer_id
ORDER BY customer_id;
```

Assertions:
- Every expected customer has the expected row count (±1 for timing edge cases)
- No rows with NULL customer_id for tests that expected attribution
- No duplicate requestId + provider pairs

### 9.2 Budget spend accuracy

```sql
SELECT entity_id, spend_microdollars::text, max_budget_microdollars::text
FROM budgets
WHERE entity_type = 'customer'
  AND entity_id LIKE 'stress-sdk-${TEST_RUN_ID}-%';
```

For each non-denial customer: verify spend is within tolerance band of expected (sum of cost events).

### 9.3 No reservation leaks

Query the DO's state via the /internal endpoint or a health check. Verify the reservations table is empty after 15s reconcile wait.

### 9.4 Margin query coalesce behavior

Run the margin query that customers page uses. Verify all test customers show up with correct spend (validates the `coalesce(customer_id, tags->>'customer')` pattern works under load).

### 9.5 No orphan data

After teardown, re-query:
- budgets WHERE entity_id LIKE 'stress-sdk-%' → should be 0
- cost_events WHERE tags->>'_ns_test_run_id' = RUN_ID → should be 0

If non-zero, teardown is broken.

---

## 10. Concurrency Intensity Matrix

| Metric | light | medium (default) | heavy |
|---|---|---|---|
| Total customers created | 5 | 15 | 30 |
| Concurrent requests (simple) | 10 | 25 | 50 |
| Concurrent requests (race) | 15 | 30 | 60 |
| Synthetic batch events | 20 | 50 | 100 |
| Session burst requests | 10 | 20 | 40 |
| Phase 2.3 customers × workers | 5×3=15 | 15×5=75 | 30×8=240 |
| Phase 2.4 mixed provider total | 10 | 50 | 150 |
| Estimated OpenAI API calls | ~80 | ~200 | ~450 |
| Estimated Anthropic API calls | ~20 | ~50 | ~120 |
| Estimated run duration | 3–5 min | 6–10 min | 15–25 min |
| Estimated LLM API cost | < $0.05 | < $0.15 | < $0.50 |

---

## 11. Cost Budget Estimation

All requests use the cheapest models with max_tokens=3 to minimize spend:
- OpenAI: `gpt-4o-mini` — $0.15/$0.60 per 1M tokens (in/out)
- Anthropic: `claude-3-haiku-20240307` — $0.25/$1.25 per 1M tokens (in/out)

Per-request cost (small prompt, max_tokens=3):
- OpenAI: ~3–5 µ¢ (~$0.00000003)
- Anthropic: ~5–8 µ¢

Medium intensity: ~250 requests × 5 µ¢ = ~$0.01. Even heavy is well under $1.

**Recommendation:** run medium on every CI/manual invocation. Run heavy only when investigating a specific failure.

---

## 12. Environment Variables

### Required (test fails if any missing)

```bash
PROXY_URL=https://nullspend.cjones6489.workers.dev
NULLSPEND_API_KEY=ns_live_sk_...
NULLSPEND_SMOKE_USER_ID=<text UUID string from auth.uid()::text>
NULLSPEND_SMOKE_KEY_ID=<UUID from api_keys.id>
INTERNAL_SECRET=<shared with worker>
DATABASE_URL=postgresql://...
OPENAI_API_KEY=sk-proj-...
ANTHROPIC_API_KEY=sk-ant-...
```

### Optional (tests skip if unset)

```bash
NULLSPEND_DASHBOARD_URL=https://nullspend.com  # Skips Phase 1.4, Phase 2.6 if unset
STRESS_INTENSITY=medium                         # light | medium | heavy
```

### Derived at runtime

```bash
SMOKE_ORG_ID — looked up from api_keys WHERE id = NULLSPEND_SMOKE_KEY_ID
```

---

## 13. Failure Modes This Test Hunts

Explicit list of bugs the test is designed to catch. File a finding for each one hit during a run.

1. **Customer session wrapper double-counting** — SDK tracks via client + proxy tracks via header = 2 events per request. Detected via: cost_events row count > request count.
2. **Customer ID not propagating through proxy** — SDK's customer() doesn't set X-NullSpend-Customer → proxy writes NULL customer_id. Detected via: tests in §6.5 finding NULL customer_id.
3. **Policy cache stale after budget mutation** — cached policy served past TTL, client-side enforcement lags behind actual budget state. Detected in §7.7.
4. **Session spend counter drift** — concurrent requests in same session race the counter, denials leak or wrong count. Detected in §7.5.
5. **Queue drop events under flood** — CostReporter maxQueueSize hit, events silently lost. Detected via: onDropped callback firing in §7.6.
6. **Reservation leaks after denied requests** — DO holds a reservation that never reconciles. Detected via: §9.3 reservations table non-empty.
7. **Proxy 429 interception misclassification** — SDK throws wrong error type or falls through to raw 429. Detected in §6.9.
8. **Customer budget enforcement race** — two concurrent requests both pass when only one should. Detected in §7.2.
9. **isProxied() URL hardcode false negative** — SDK tries to track through the proxy, produces cost event with wrong metadata. Detected via: looking for cost events with duplicate request_id but different sources.
10. **Idempotency violation on requestId** — batch retry produces duplicate cost_events rows. Detected via: unique constraint should prevent, but test asserts too.
11. **Shutdown race during active flush** — `ns.shutdown()` called while batch is in-flight drops events. Detected via: event count mismatch after shutdown.
12. **Onboard tag collision** — two sessions with conflicting tags.plan corrupt each other's cost events. Detected in §8.5.

---

## 14. Test File Skeleton

```typescript
/**
 * SDK Stress Test — production validation suite.
 *
 * Exercises every NullSpend SDK feature against the deployed proxy + dashboard
 * under concurrent load with real OpenAI and Anthropic API calls. Creates test
 * data fixtures, stresses them, mutates them mid-test, verifies final state,
 * and cleans up all artifacts.
 *
 * Requires:
 *   - Deployed proxy at PROXY_URL
 *   - NULLSPEND_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY
 *   - INTERNAL_SECRET, DATABASE_URL
 *   - NULLSPEND_SMOKE_USER_ID, NULLSPEND_SMOKE_KEY_ID
 *   - NULLSPEND_DASHBOARD_URL (optional — skips direct-mode tests)
 *
 * Run: cd apps/proxy && pnpm test:stress stress-sdk-features.test.ts
 * Intensity: STRESS_INTENSITY={light|medium|heavy} (default medium)
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { NullSpend } from "@nullspend/sdk";
import {
  BudgetExceededError,
  MandateViolationError,
  SessionLimitExceededError,
  VelocityExceededError,
  TagBudgetExceededError,
  NullSpendError,
} from "@nullspend/sdk";
import {
  BASE,
  OPENAI_API_KEY,
  ANTHROPIC_API_KEY,
  NULLSPEND_API_KEY,
  NULLSPEND_SMOKE_USER_ID,
  NULLSPEND_SMOKE_KEY_ID,
  INTERNAL_SECRET,
  DATABASE_URL,
  authHeaders,
  anthropicAuthHeaders,
  smallRequest,
  smallAnthropicRequest,
  isServerUp,
  invalidateBudget,
  syncBudget,
  waitForCostEvent,
} from "./smoke-test-helpers.js";

// ── Intensity scaling ─────────────────────────────────────────────
const INTENSITY = (process.env.STRESS_INTENSITY ?? "medium") as "light" | "medium" | "heavy";
const CUSTOMER_COUNT    = { light: 5,  medium: 15, heavy: 30  }[INTENSITY];
const CONCURRENT_REQS   = { light: 10, medium: 25, heavy: 50  }[INTENSITY];
const RACE_REQS         = { light: 15, medium: 30, heavy: 60  }[INTENSITY];
const BATCH_EVENTS      = { light: 20, medium: 50, heavy: 100 }[INTENSITY];
const SESSION_BURST     = { light: 10, medium: 20, heavy: 40  }[INTENSITY];
const RECONCILE_WAIT_MS = 15_000;

// ── Test run isolation ────────────────────────────────────────────
const TEST_RUN_ID = Date.now().toString(36);
const PREFIX = `stress-sdk-${TEST_RUN_ID}`;
const DASHBOARD_URL = process.env.NULLSPEND_DASHBOARD_URL;

// ── Shared state ──────────────────────────────────────────────────
let sql: postgres.Sql;
let SMOKE_ORG_ID: string;
let ns: NullSpend;          // For direct-mode tests (if dashboard URL set)
let nsProxy: NullSpend;     // For proxy-interception tests

// ── Findings log ──────────────────────────────────────────────────
const findings: Array<{ phase: string; finding: string; severity: "info" | "warn" | "bug" }> = [];

function logFinding(phase: string, finding: string, severity: "info" | "warn" | "bug" = "info") {
  findings.push({ phase, finding, severity });
  console.log(`[${severity.toUpperCase()}] [${phase}] ${finding}`);
}

describe("SDK stress test — production validation", () => {
  beforeAll(async () => {
    // § 5.5 setup sequence
    // … validation, fixture creation, sync, wait
  }, 60_000);

  afterAll(async () => {
    // § 5.6 teardown sequence
    // … wait 15s, delete cost events, invalidate budgets, close connections
    console.log("\n=== FINDINGS REPORT ===");
    for (const f of findings) {
      console.log(`[${f.severity.toUpperCase()}] [${f.phase}] ${f.finding}`);
    }
  }, 60_000);

  // ═══════════════════════════════════════════════════════════════
  // PHASE 1 — Functional tests (each feature once)
  // ═══════════════════════════════════════════════════════════════
  describe("Phase 1: NullSpend client construction", () => {
    // § 6.1 — tests 1.1 through 1.6
  });

  describe("Phase 1: createTrackedFetch", () => {
    // § 6.2 — tests 2.1 through 2.5
  });

  describe("Phase 1: customer() session", () => {
    // § 6.3 — tests 3.1 through 3.8
  });

  describe.skipIf(!DASHBOARD_URL)("Phase 1: Direct-mode cost event ingest", () => {
    // § 6.4 — tests 4.1 through 4.5
  });

  describe("Phase 1: Proxy-mode end-to-end", () => {
    // § 6.5 — tests 5.1 through 5.2
  });

  describe("Phase 1: Enforcement - mandate violation", () => {
    // § 6.6 — tests 6.1 through 6.3
  });

  describe("Phase 1: Enforcement - client-side budget denial", () => {
    // § 6.7 — tests 7.1 through 7.3
  });

  describe("Phase 1: Enforcement - client-side session limit", () => {
    // § 6.8 — tests 8.1 through 8.4
  });

  describe("Phase 1: Enforcement - proxy 429 interception", () => {
    // § 6.9 — tests 9.1 through 9.4
  });

  // ═══════════════════════════════════════════════════════════════
  // PHASE 2 — Concurrent stress scenarios
  // ═══════════════════════════════════════════════════════════════
  describe("Phase 2: Concurrent customer budget races (generous)", () => {
    // § 7.1
  });

  describe("Phase 2: Concurrent customer budget races (tight)", () => {
    // § 7.2
  });

  describe("Phase 2: Rapid customer switching", () => {
    // § 7.3
  });

  describe("Phase 2: Mixed provider on same customer", () => {
    // § 7.4
  });

  describe("Phase 2: Session limit under burst", () => {
    // § 7.5
  });

  describe.skipIf(!DASHBOARD_URL)("Phase 2: Direct SDK ingest under load", () => {
    // § 7.6
  });

  describe("Phase 2: Policy cache staleness", () => {
    // § 7.7
  });

  // ═══════════════════════════════════════════════════════════════
  // PHASE 3 — Mid-test data mutation
  // ═══════════════════════════════════════════════════════════════
  describe("Phase 3: Budget mutation lifecycle", () => {
    // § 8.1 through 8.5
  });

  // ═══════════════════════════════════════════════════════════════
  // PHASE 4 — Verification
  // ═══════════════════════════════════════════════════════════════
  describe("Phase 4: Post-stress verification", () => {
    // § 9.1 through 9.5
  });
});

// ── Helper functions (bottom of file) ─────────────────────────────

/** Insert a customer budget and sync to DO. */
async function createCustomerBudget(
  entityId: string,
  maxBudgetMicrodollars: number,
  opts?: { policy?: "strict_block" | "soft_block" | "warn"; velocityLimit?: number; sessionLimit?: number },
) { /* … */ }

/** Delete all test budgets for this run. */
async function cleanupBudgets() { /* … */ }

/** Wait for pending reconciliations to settle. */
async function waitForReconcile(ms: number = RECONCILE_WAIT_MS) { /* … */ }

/** Count cost events matching a filter, retry until stable. */
async function countCostEvents(filter: { customerId?: string; runId?: string }): Promise<number> { /* … */ }

/** Fire N concurrent requests, returning per-request status + request IDs. */
async function fireConcurrent(count: number, builder: (i: number) => Promise<Response>): Promise<FireResult[]> { /* … */ }

/** Assert budget spend is within tolerance of expected value. */
function assertSpendWithinTolerance(actual: number, expected: number, tolerancePercent: number = 5) { /* … */ }
```

Target file length: 900–1200 lines including helpers and comments.

---

## 15. Open Questions for Fresh Session

These MUST be answered before writing the test. Recommend running `/plan-eng-review` on this doc to surface more.

1. **NULLSPEND_DASHBOARD_URL** — what's the correct URL? Does the dashboard have `/api/cost-events/batch` deployed and reachable from this machine? If yes: add to `.env.smoke`. If no: Phase 1.4 and 2.6 skip until it's set up.

2. **API key mandate restrictions** — §6.6 requires an API key with `allowedModels = ["gpt-4o-mini"]` to test mandate violation. The existing `NULLSPEND_SMOKE_KEY_ID` probably has no restrictions. Options:
   - (a) Create a second key manually via dashboard before the test run, add `NULLSPEND_MANDATE_KEY_ID` env var
   - (b) Insert + delete a key row directly via SQL in the test (requires raw SQL that mirrors the dashboard's key hash generation — brittle)
   - (c) Skip §6.6 and document as unverified

3. **Anthropic rate limits** — heavy intensity fires ~120 Anthropic calls. Will we hit rate limits on claude-3-haiku? Need to verify tier. If limited, add backoff or reduce heavy counts.

4. **Policy endpoint existence** — does `GET /api/policy` exist on the dashboard? If not, `createTrackedFetch` with enforcement will fail policy fetch, fall-open, and §6.9 (proxy 429 interception) becomes the only enforcement path. Verify before testing.

5. **Reservation table visibility** — §9.3 wants to verify DO reservations table is empty. Does the `/internal/velocity-state` or similar endpoint expose reservation count? If not, add a new read-only endpoint or skip the assertion.

6. **requestId generation** — in direct-mode cost event ingest (§6.4), does the SDK auto-generate requestId or does the caller need to? Check ingest Zod schema in `lib/cost-events/ingest.ts`. Test must match.

7. **SMOKE_ORG_ID derivation** — current smoke tests look it up via `SELECT DISTINCT org_id FROM budgets WHERE user_id = ${SMOKE_USER_ID}`. This assumes a budget exists. Stress test should use `SELECT org_id FROM api_keys WHERE id = ${SMOKE_KEY_ID}` instead — more reliable.

8. **§6.9 proxy detection** — if isProxied() doesn't match our proxy URL and we rely on x-nullspend-key header detection, does that actually hit the interception code path? Trace through tracked-fetch.ts carefully. Test may need a temporary workaround to force the code path.

9. **Anthropic request format** — the proxy uses smallAnthropicRequest() with `claude-3-haiku-20240307`. Is this model still supported? Anthropic has deprecated several 3.x models. Verify before the test run.

10. **Test parallelism across stress files** — `fileParallelism: false` is set. Does this stress test need to run after existing stress files (race with shared NULLSPEND_SMOKE_USER_ID budget state)? Probably yes — use the same user ID but distinct entity types/IDs to avoid conflicts.

11. **Cleanup idempotency** — if the test crashes mid-run, can the next run's teardown clean up the stale fixtures? Recommend a manual cleanup helper: `pnpm stress:cleanup` that deletes everything matching `stress-sdk-%`. Add to package.json.

12. **Cost event ingest auth** — direct-mode ingest uses the same NULLSPEND_API_KEY. Does `/api/cost-events/batch` accept the proxy API key, or does it require a different token type (e.g., session)? Check `app/api/cost-events/batch/route.ts`.

---

## 16. Success Criteria

The test is considered "done" when:

- **All Phase 1 (§6) functional tests pass** at medium intensity
- **All Phase 2 (§7) concurrent tests pass** at medium intensity without drops, races, or tolerance violations
- **All Phase 3 (§8) mutation tests pass** with correct post-mutation behavior
- **Phase 4 (§9) verification** shows zero orphan data after teardown
- **Findings log** is populated with every SDK limitation encountered (not treated as test failures — they're informational for follow-up PRs)
- **Heavy intensity** runs end-to-end at least once with no drops, races, or tolerance violations
- **Document updated** with run results and any discovered-but-not-planned issues

---

## 17. Out of Scope

The following are intentionally NOT in this test, because they're either covered elsewhere or too out of scope for one file:

- MCP server / MCP proxy testing (separate test surface: `packages/mcp-*`)
- Budget increase proposal flow (`requestBudgetIncrease` — separate Action-based flow, needs HITL mock)
- Dashboard UI testing (that's `/qa` with browser automation)
- Webhook delivery (separate stress test exists at `stress-concurrency.test.ts` tangentially)
- Margin Stripe revenue sync (separate lib/margins tests cover this)
- Tool call attribution / actionId tracking (separate feature)
- Cancelled streaming requests (covered by `stress-streaming.test.ts`)
- Queue DLQ behavior under worker crash (requires infra manipulation)

---

## 18. Risks & Mitigations

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Test cost exceeds budget | Low | Low | max_tokens=3, gpt-4o-mini, estimate < $0.50 heavy |
| OpenAI rate limit hit at heavy | Medium | Medium | Backoff on 429, reduce heavy counts to empirical limit |
| Anthropic model deprecated mid-run | Low | High | Verify model in Question 9, pin to current |
| Test data pollutes prod DB | Low | High | Strict PREFIX + TEST_RUN_ID, teardown error handling |
| Deploys invalidate cached policy mid-run | Low | Medium | Run test in a single time window, don't deploy during |
| Shared smoke user budget blocks test | Medium | Medium | Ensure user budget is generous; use distinct entity IDs |
| Teardown crashes leave orphans | Medium | Medium | Try/catch per step; cleanup helper script; document prefix for manual cleanup |
| Heavy intensity hits 300s test timeout | Medium | Low | Increase timeout in vitest.stress.config.ts if needed |
| Hyperdrive connection pool exhaustion | Low | Medium | Use max:3 pool, release connections on test exit |
| Customer session cache leak (policyCaches Set grows unbounded) | Medium | Low | Only call createTrackedFetch once per provider per session |

---

## 19. Implementation Steps (for fresh session)

1. Read this document end-to-end
2. Run `/plan-eng-review` on this document with the file path in context
3. Resolve all Open Questions in §15 — some by checking code, some by asking user
4. Verify new env vars are set (add to `.env.smoke` if needed)
5. Verify SDK dist is built: `cd packages/sdk && pnpm build`
6. Create `apps/proxy/stress-sdk-features.test.ts` following §14 skeleton
7. Implement Phase 1 (functional) first — simpler, proves feature availability
8. Run Phase 1 at light intensity; iterate until all pass
9. Implement Phase 2 (concurrent) — the actual stress
10. Run Phase 2 at light; iterate; then medium
11. Implement Phases 3, 4 (mutation, verification)
12. Run full suite at medium 3 times to verify stability
13. Run at heavy once; investigate any failures
14. Write findings section in this doc based on actual run results
15. Create cleanup helper script: `apps/proxy/scripts/cleanup-stress-sdk.ts`
16. Add `test:stress:cleanup` to package.json
17. Document run procedure in `apps/proxy/CLAUDE.md` or `TESTING.md`
18. `/ship`

---

## 20. References

- SDK source: `packages/sdk/src/client.ts`, `tracked-fetch.ts`, `policy-cache.ts`, `types.ts`
- Existing stress tests: `apps/proxy/stress-budget-races.test.ts`, `stress-concurrency.test.ts`
- Smoke test helpers: `apps/proxy/smoke-test-helpers.ts`
- Customer primitive smoke: `apps/proxy/smoke-customer-primitive.test.ts`
- Stress config: `apps/proxy/vitest.stress.config.ts`
- Schema: `packages/db/src/schema.ts`
- Cost ingest: `lib/cost-events/ingest.ts`
- Policy endpoint: `app/api/policy/route.ts` (verify exists)
- Internal budget invalidate: `apps/proxy/src/routes/internal.ts`
- DO: `apps/proxy/src/durable-objects/user-budget.ts`

---

## 21. Notes for the Fresh-Session Implementer

- This is infrastructure code. Take the time to get it right. One good stress test is worth ten flaky ones.
- Don't skip the findings log. Every SDK limitation you hit is future PR material. Log it, don't fix it in this file.
- Run at light intensity first. Don't burn $0.50 on a broken test.
- If Phase 1 fails for a feature, DO NOT proceed to Phase 2 for that feature. Fix Phase 1 first.
- The DO reconcile wait is load-bearing. 15s might not be enough on heavy. Tune empirically.
- If you're tempted to skip teardown because "tests pass" — don't. Orphan data corrupts future runs.
- When in doubt, add more console.log. Stress test failures are invisible without breadcrumbs.
- The `isProxied` hardcode is real. Don't let it block you — use the header path or test direct mode.

Good luck.
