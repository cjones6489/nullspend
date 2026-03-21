# NullSpend Systems Test Architecture

> **Purpose:** Define an end-to-end test suite that exercises the full proxy pipeline — from inbound HTTP request through OpenAI, back through cost calculation, budget enforcement, and database persistence — verifying every integration boundary in a single pass.
>
> **What this covers that existing tests don't:** The 20 unit test files in `apps/proxy/src/__tests__/` test each module in isolation with mocked dependencies. The 5 pressure test scripts in `scripts/` test the cost engine and database layer directly (bypassing the proxy). The smoke test (`smoke.test.ts`) only tests health/404 endpoints. **No existing test sends a request through the running proxy to a real LLM and verifies the cost event appears in the database.** This document defines that test.

---

## 1. The Pipeline Under Test

Every request through NullSpend traverses 14 discrete stages. A systems test must verify each stage independently while also proving they compose correctly as a pipeline.

```
Stage 1:  HTTP ingress         → index.ts: method/path routing
Stage 2:  Rate limiting        → index.ts: Upstash sliding window (120/min/IP)
Stage 3:  Body validation      → index.ts: size check (1MB), JSON parse, object check
Stage 4:  Authentication       → auth.ts: timing-safe x-nullspend-auth comparison
Stage 5:  Model validation     → openai.ts: isKnownModel() check
Stage 6:  Stream option inject → request-utils.ts: force stream_options.include_usage
Stage 7:  Budget lookup        → budget-lookup.ts: Redis pipeline → Postgres slow path
Stage 8:  Cost estimation      → cost-estimator.ts: pre-request max cost estimate
Stage 9:  Budget reservation   → budget.ts: checkAndReserve Lua script (atomic)
Stage 10: Upstream forward     → openai.ts: fetch to api.openai.com with sanitized headers
Stage 11: Response parsing     → sse-parser.ts (stream) or JSON parse (non-stream)
Stage 12: Cost calculation     → cost-calculator.ts: usage → microdollars
Stage 13: Cost persistence     → cost-logger.ts: Drizzle insert via waitUntil()
Stage 14: Budget reconciliation→ budget.ts + budget-spend.ts: reconcile Lua + Postgres update
```

The test must prove: correct data flows between each stage, failures at any stage produce the correct error response (and don't leak through to later stages), and the entire pipeline composes into an accurate FinOps record.

---

## 2. Test Infrastructure Architecture

### 2.1 Deployment Topology

```
┌─────────────────────────────────────────────────────────┐
│                    TEST RUNNER                           │
│              (pnpm tsx scripts/systems-test.ts)          │
│                                                         │
│  ┌─────────────┐  ┌─────────────┐  ┌────────────────┐  │
│  │ HTTP Client  │  │ Redis       │  │ Postgres       │  │
│  │ (fetch)      │  │ Inspector   │  │ Inspector      │  │
│  └──────┬───────┘  └──────┬──────┘  └──────┬─────────┘  │
│         │                 │                │             │
└─────────┼─────────────────┼────────────────┼─────────────┘
          │                 │                │
          ▼                 ▼                ▼
┌──────────────┐    ┌──────────┐     ┌──────────────┐
│  Proxy       │───▶│ Upstash  │     │  Supabase    │
│  (wrangler   │    │ Redis    │     │  Postgres    │
│   dev :8787) │    └──────────┘     └──────────────┘
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  OpenAI API  │
│  (real)      │
└──────────────┘
```

The systems test runs against the **actual local dev proxy** (`pnpm proxy:dev` on port 8787) connected to **real Upstash Redis** and **real Supabase Postgres**. It sends requests through the proxy to **real OpenAI endpoints**. This is a true integration test — no mocks.

### 2.2 Required Environment

```bash
# .env.local (same as the proxy's dev config)
OPENAI_API_KEY=sk-...
PLATFORM_AUTH_KEY=test-platform-key-...
UPSTASH_REDIS_REST_URL=https://...upstash.io
UPSTASH_REDIS_REST_TOKEN=...
DATABASE_URL=postgresql://...supabase.co/postgres
```

### 2.3 Test Runner Design

```typescript
interface SystemsTestContext {
  proxyBase: string;             // http://127.0.0.1:8787
  platformAuthKey: string;       // PLATFORM_AUTH_KEY for x-nullspend-auth
  openaiKey: string;             // OPENAI_API_KEY (forwarded as Authorization)
  db: DrizzleInstance;           // Direct Postgres connection for verification
  redis: Redis;                  // Direct Redis connection for state inspection
  apiKeyId: string;              // Pre-existing API key from DB
  userId: string;                // Owner of that API key
  insertedCostEventIds: string[];// Track for cleanup
  createdBudgetIds: string[];    // Track for cleanup
}
```

Every test function receives this context. Cleanup runs in `finally` blocks to delete test artifacts regardless of pass/fail.

### 2.4 Test Identification and Isolation

Every test run generates a unique `RUN_ID` (e.g., `systest-1710249600000`). All test-created budgets use entity IDs prefixed with this `RUN_ID`. All test-created cost events are tracked by ID. Cleanup deletes everything with the `RUN_ID` prefix.

This prevents cross-contamination between test runs and ensures the test suite is safe to run repeatedly against a shared dev database.

---

## 3. Test Suites

### SUITE 1: Proxy Ingress & Rejection (Stages 1–5)

These tests verify the proxy correctly rejects invalid requests before any cost or budget processing occurs. None of these should produce cost events or budget mutations.

#### Test 1.1: Missing Auth Header → 401

```
POST /v1/chat/completions
Headers: (no x-nullspend-auth)
Body: {"model": "gpt-4o-mini", "messages": [...]}

Assert: status === 401
Assert: body.error === "unauthorized"
Assert: no cost event inserted (query DB by recent timestamp)
```

**What this proves:** Auth check fires before budget lookup, cost estimation, or upstream forwarding.

#### Test 1.2: Wrong Auth Header → 401

```
POST /v1/chat/completions
Headers: x-nullspend-auth: wrong-key-value
Body: {"model": "gpt-4o-mini", "messages": [...]}

Assert: status === 401
Assert: body.error === "unauthorized"
```

**What this proves:** Timing-safe comparison correctly rejects invalid keys.

#### Test 1.3: Unknown Model → 400

```
POST /v1/chat/completions
Headers: x-nullspend-auth: (valid)
         Authorization: Bearer (valid OpenAI key)
Body: {"model": "nonexistent-model-xyz", "messages": [...]}

Assert: status === 400
Assert: body.error === "invalid_model"
Assert: no cost event inserted
Assert: no budget mutation in Redis
```

**What this proves:** `isKnownModel()` gate fires after auth but before budget/upstream.

#### Test 1.4: Invalid JSON Body → 400

```
POST /v1/chat/completions
Headers: x-nullspend-auth: (valid)
Body: "{not valid json!!!"

Assert: status === 400
Assert: body.error === "bad_request"
```

#### Test 1.5: Array Body (Not Object) → 400

```
POST /v1/chat/completions
Headers: x-nullspend-auth: (valid)
Body: [{"model": "gpt-4o"}]

Assert: status === 400
Assert: body.message contains "JSON object"
```

#### Test 1.6: Body Over 1MB → 413

```
POST /v1/chat/completions
Headers: x-nullspend-auth: (valid)
         Content-Length: 2000000
Body: (1.5MB of padding)

Assert: status === 413
Assert: body.error === "payload_too_large"
```

**What this proves:** Pre-read Content-Length check and post-read byte-count check both work.

#### Test 1.7: Unsupported Endpoint → 404

```
POST /v1/embeddings
Headers: x-nullspend-auth: (valid)

Assert: status === 404
Assert: body.message contains "not yet supported"
```

#### Test 1.8: GET to Chat Completions → 404

```
GET /v1/chat/completions

Assert: status === 404 (only POST is routed)
```

---

### SUITE 2: Happy Path — Non-Streaming (Stages 1–14, Complete Pipeline)

This is the core pipeline test. It sends a real request through the proxy to OpenAI and verifies every stage produced the correct result.

#### Test 2.1: Full Non-Streaming Pipeline

**Setup:**
- Create a test budget in Postgres: entity_type=`api_key`, entity_id=`{apiKeyId}`, max_budget=`50000000` (i.e., $50), spend=`0`, policy=`strict_block`
- Populate Redis cache via `populateCache` Lua script (or let the proxy do it on first lookup)

**Request:**
```
POST /v1/chat/completions
Headers:
  x-nullspend-auth: (valid platform key)
  Authorization: Bearer (valid OpenAI key)
  x-nullspend-user-id: (userId)
  x-nullspend-key-id: (apiKeyId)
  Content-Type: application/json
Body:
  {
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "Say exactly: 'systems test OK'"}],
    "max_tokens": 20
  }
```

**Assertions — HTTP Response:**
```
Assert: status === 200
Assert: content-type includes "application/json"
Assert: body.choices[0].message.content exists and is non-empty
Assert: body.usage.prompt_tokens > 0
Assert: body.usage.completion_tokens > 0
Assert: body.model is a string (may differ from request model due to alias resolution)
Assert: body.id exists (OpenAI request ID)
```

**Assertions — Cost Event (query DB after short delay for waitUntil):**
```
Wait: 3 seconds (waitUntil is async)
Query: SELECT * FROM cost_events WHERE user_id = ? ORDER BY created_at DESC LIMIT 1

Assert: event.provider === "openai"
Assert: event.model is a string matching body.model or request model
Assert: event.input_tokens === body.usage.prompt_tokens
Assert: event.output_tokens === body.usage.completion_tokens
Assert: event.cost_microdollars > 0
Assert: event.duration_ms > 0
Assert: event.api_key_id === apiKeyId
Assert: event.user_id === userId
```

**Assertions — Cost Math Verification:**
```
Compute expected cost locally:
  pricing = getModelPricing("openai", "gpt-4o-mini")
  cachedTokens = body.usage.prompt_tokens_details?.cached_tokens ?? 0
  uncachedInput = body.usage.prompt_tokens - cachedTokens
  expectedCost = Math.round(
    costComponent(uncachedInput, pricing.inputPerMTok) +
    costComponent(cachedTokens, pricing.cachedInputPerMTok) +
    costComponent(body.usage.completion_tokens, pricing.outputPerMTok)
  )

Assert: event.cost_microdollars === expectedCost
```

**Assertions — Budget State (inspect Redis):**
```
Query: HGETALL {budget}:api_key:{apiKeyId}

Assert: spend increased by event.cost_microdollars
Assert: reserved === 0 (reservation was reconciled)
```

**Assertions — Postgres Budget Spend:**
```
Query: SELECT spend_microdollars FROM budgets WHERE entity_type='api_key' AND entity_id=?

Assert: spend_microdollars === event.cost_microdollars
```

**What this proves:** The complete non-streaming pipeline works: auth → budget check → reserve → forward → parse → calculate → persist → reconcile. Every integration boundary is verified: proxy ↔ OpenAI, proxy ↔ Redis, proxy ↔ Postgres.

---

### SUITE 3: Happy Path — Streaming (Stages 1–14)

#### Test 3.1: Full Streaming Pipeline

**Request:**
```
POST /v1/chat/completions
Headers: (same as 2.1)
Body:
  {
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "Count from 1 to 5, comma separated."}],
    "max_tokens": 30,
    "stream": true
  }
```

**Assertions — HTTP Response:**
```
Assert: status === 200
Assert: content-type includes "text/event-stream"
Assert: cache-control === "no-cache, no-transform"
```

**Assertions — SSE Stream:**
```
Read all chunks from the response body.
Parse SSE events (split by "data: ").

Assert: at least one data chunk contains parseable JSON with choices
Assert: stream ends with "data: [DONE]"
Assert: concatenated content from all delta chunks forms coherent text
```

**Assertions — stream_options Injection:**
```
Assert: final SSE chunk (before [DONE]) contains a usage object
  (This proves ensureStreamOptions correctly injected include_usage: true)
Assert: usage.prompt_tokens > 0
Assert: usage.completion_tokens > 0
```

**Assertions — Cost Event:**
```
Wait: 3 seconds
Query: latest cost event

Assert: same cost math verification as Test 2.1
Assert: event.input_tokens matches the usage from the final SSE chunk
Assert: event.output_tokens matches the usage from the final SSE chunk
```

**Assertions — Budget State:**
```
Assert: Redis spend increased correctly
Assert: Redis reserved === 0
Assert: Postgres spend_microdollars matches Redis spend
```

#### Test 3.2: Stream With User-Provided stream_options (Override)

**Request:**
```
Body:
  {
    "model": "gpt-4o-mini",
    "messages": [...],
    "stream": true,
    "stream_options": {"include_usage": false}
  }
```

**Assertions:**
```
Assert: status === 200
Assert: final chunk still contains usage
  (Proves ensureStreamOptions overrides user's false → true)
Assert: cost event is recorded
```

**What this proves:** The proxy always gets usage data from streams regardless of what the caller requested. This is critical — without it, streaming requests would produce no cost events.

---

### SUITE 4: Budget Enforcement (Stages 7–9)

#### Test 4.1: Budget Exceeded → 429

**Setup:**
- Create budget: max=`1000` (i.e., $0.001), spend=`900`, policy=`strict_block`
- Populate Redis cache

**Request:**
```
POST /v1/chat/completions (valid auth, valid model)
Body: {"model": "gpt-4o", "messages": [...], "max_tokens": 100}
  (estimated cost will exceed remaining $0.0001)
```

**Assertions:**
```
Assert: status === 429
Assert: body.error === "budget_exceeded"
Assert: body.details.entity_key contains the budget entity key
Assert: body.details.remaining_microdollars is a number
Assert: body.details.estimated_microdollars > body.details.remaining_microdollars
Assert: body.details.budget_limit_microdollars === 1000
Assert: no cost event inserted (request never reached OpenAI)
Assert: Redis reserved === 0 (no reservation was created)
```

**What this proves:** Budget enforcement fires before upstream forwarding. The 429 response contains actionable details for the caller.

#### Test 4.2: Budget Just Barely Passes → 200 + Reservation Lifecycle

**Setup:**
- Create budget: max=`10000000` ($10), spend=`0`, policy=`strict_block`

**Request:**
```
Body: {"model": "gpt-4o-mini", "messages": [{"role": "user", "content": "Say OK"}], "max_tokens": 5}
```

**Assertions — During Request (if inspectable):**
```
Assert: Redis reserved > 0 (reservation was created before upstream call)
```

**Assertions — After Response:**
```
Assert: status === 200
Assert: Redis reserved === 0 (reservation reconciled)
Assert: Redis spend increased by actual cost (not estimated cost)
Assert: Postgres spend matches Redis spend
```

**What this proves:** The reservation lifecycle works: reserve estimate → forward → reconcile with actual. The budget tracks actual spend, not estimated.

#### Test 4.3: No Budget Configured → Passthrough (No 503)

**Setup:**
- Ensure no budget exists for a test entity
- Ensure Redis negative cache is clear

**Request:**
```
Headers: x-nullspend-key-id: nonexistent-key-id-12345
Body: {"model": "gpt-4o-mini", "messages": [...]}
```

**Assertions:**
```
Assert: status === 200 (request passes through)
Assert: cost event is recorded (cost tracking works without budget enforcement)
Assert: Redis has negative cache marker for this entity
  (HGETALL returns null, but GET {budget}:api_key:nonexistent-key-id-12345:none returns "1")
```

**What this proves:** Missing budgets don't block requests. Negative caching prevents repeated Postgres lookups. Cost tracking is independent of budget enforcement.

#### Test 4.4: Budget Lookup — Postgres Slow Path

**Setup:**
- Create budget in Postgres but do NOT populate Redis cache
- Flush the specific Redis key if it exists

**Request:**
```
(Standard valid request)
```

**Assertions:**
```
Assert: status === 200
Assert: Redis cache now populated (HGETALL returns maxBudget, spend, reserved, policy)
Assert: Redis TTL is approximately 60 seconds (BUDGET_CACHE_TTL)
Assert: cost event recorded
Assert: budget spend updated
```

**What this proves:** The Postgres slow path works and correctly populates the Redis cache for subsequent requests.

#### Test 4.5: Concurrent Requests Against Same Budget

**Setup:**
- Create budget: max=`5000000` ($5), spend=`0`

**Request:**
- Fire 5 requests in parallel using `Promise.allSettled`

**Assertions:**
```
Assert: all 5 return 200 (budget is large enough)
Wait: 5 seconds
Query: all cost events for this test run

Assert: sum of cost_microdollars across all 5 events ≈ Redis spend
Assert: Redis reserved === 0 (all reservations reconciled)
Assert: Postgres spend ≈ Redis spend (within race tolerance)
Assert: no budget was over-reserved (reserved never exceeded remaining)
```

**What this proves:** Atomic Lua scripts prevent race conditions under concurrent load. No request bypasses the budget and no budget goes negative.

---

### SUITE 5: Upstream Error Handling (Stage 10)

#### Test 5.1: OpenAI Returns 4xx (Invalid API Key)

**Request:**
```
Headers:
  Authorization: Bearer sk-invalid-key-that-will-fail
  x-nullspend-auth: (valid platform key)
Body: {"model": "gpt-4o-mini", "messages": [...]}
```

**Assertions:**
```
Assert: status === 401 (proxied from OpenAI)
Assert: body contains OpenAI's error message
Assert: no cost event inserted (failed requests cost $0)
Assert: if budget existed, reservation reconciled with actualCost=0
Assert: Redis reserved === 0
```

**What this proves:** Upstream errors are forwarded to the client. Budget reservations are cleaned up on failure (Fix 6). No phantom cost is recorded.

#### Test 5.2: OpenAI Returns 429 (Rate Limited)

**Request:**
(This is hard to trigger reliably. Alternative: verify the proxy forwards OpenAI's 429 status and rate-limit headers.)

```
If OpenAI returns 429:
  Assert: proxy response status === 429
  Assert: x-ratelimit-* headers forwarded from OpenAI
  Assert: retry-after header forwarded
  Assert: no cost event
  Assert: reservation reconciled with 0
```

**What this proves:** OpenAI rate-limit headers pass through to the client (via `buildClientHeaders`). The client can distinguish proxy-level 429 (budget exceeded, with `error: "budget_exceeded"`) from OpenAI-level 429 (with OpenAI's error format).

---

### SUITE 6: Header Sanitization (Stages 4, 10)

#### Test 6.1: Proxy Headers Stripped From Upstream Request

This test requires inspection of what the proxy sends to OpenAI. Since we can't inspect OpenAI's received headers directly, we verify indirectly:

```
POST /v1/chat/completions
Headers:
  x-nullspend-auth: (valid)
  x-nullspend-user-id: user-123
  x-nullspend-key-id: key-456
  Authorization: Bearer (valid)
  x-custom-header: should-not-appear

Assert: status === 200 (OpenAI didn't reject unexpected headers)
Assert: cost event user_id === "user-123" (attribution headers were read by proxy)
Assert: cost event api_key_id === "key-456"
```

**What this proves:** Attribution headers are consumed by the proxy (not forwarded), and the proxy constructs a clean header set for OpenAI.

#### Test 6.2: OpenAI Response Headers Forwarded

```
Assert: response has content-type header
Assert: response has x-request-id header (from OpenAI)
Assert: response has x-ratelimit-* headers (if present)
Assert: response does NOT have server, cf-ray, or other internal headers
```

---

### SUITE 7: Cost Accuracy — Multi-Model (Stages 11–12)

Run the full pipeline (proxy → OpenAI → DB) for each supported model and verify cost math.

#### Test 7.1: Model Matrix

```
Models to test:
  - gpt-4o-mini     (cheapest, high volume)
  - gpt-4o          (standard pricing)
  - gpt-4.1-nano    (newest cheap model)
  - gpt-4.1-mini    (newest mid-tier)
  - o4-mini         (reasoning model — has reasoning_tokens)

For each model:
  Send request through proxy
  Wait for cost event
  Assert: cost event math matches hand-computed expected cost
  Assert: token counts match OpenAI response usage
  Assert: model field resolves correctly (alias handling)
```

#### Test 7.2: Reasoning Token Tracking (o4-mini)

```
Request: {"model": "o4-mini", "messages": [{"role": "user", "content": "What is 17*23?"}], "max_completion_tokens": 256}

Assert: cost event.reasoning_tokens > 0
Assert: cost event.reasoning_tokens <= cost event.output_tokens
Assert: cost math uses output rate for ALL completion tokens (reasoning + visible)
```

**What this proves:** The proxy correctly extracts and persists reasoning_tokens from o4-mini responses without double-counting them in cost calculation.

#### Test 7.3: Model Alias Resolution

```
Request model: "gpt-4o"
OpenAI may return model: "gpt-4o-2024-08-06"

Assert: cost event uses pricing for "gpt-4o" (request model, not response model)
  OR: if request model has no pricing, falls back to response model
Assert: cost event.model field records the resolved model
```

---

### SUITE 8: Reconciliation Edge Cases (Stage 14)

#### Test 8.1: Reservation Cleaned Up After Upstream Failure

**Setup:** Create budget, send request with invalid OpenAI key

```
Assert: reservation was created (Redis reserved increased)
Assert: after response, reservation reconciled to 0
Assert: Redis reserved === 0
Assert: Redis spend unchanged (failed request = $0)
```

#### Test 8.2: Successive Requests Accumulate Spend

```
Send request 1 through proxy → cost = C1
Send request 2 through proxy → cost = C2
Send request 3 through proxy → cost = C3

Assert: Redis spend === C1 + C2 + C3
Assert: Postgres spend === C1 + C2 + C3
Assert: Redis reserved === 0 after all three complete
Assert: sum of DB cost events === C1 + C2 + C3
```

**What this proves:** Spend accumulates correctly across multiple requests. No drift between Redis and Postgres.

#### Test 8.3: Budget Reaches Exact Exhaustion

**Setup:** Create budget with max = exactly enough for one request

```
Send request 1 → should pass (200)
Send request 2 → should be blocked (429)

Assert: request 1 produced a cost event
Assert: request 2 did NOT produce a cost event
Assert: Redis spend ≈ max budget after request 1
Assert: 429 response details show remaining ≈ 0
```

---

### SUITE 9: Dashboard Data Integrity (Stages 13–14 → Dashboard)

#### Test 9.1: Cost Events Visible in Summary API

After running multiple model tests, call the dashboard cost-events summary API directly:

```
GET /api/cost-events/summary?period=7d
Authorization: (Supabase auth token for the test user)

Assert: response includes daily_spend with today's date
Assert: response includes model_breakdown with models we tested
Assert: response includes key_breakdown with our test API key
Assert: total_cost >= sum of costs from our test events
```

**What this proves:** The proxy's cost events are queryable by the dashboard. The aggregation queries return correct results.

#### Test 9.2: Budget State Visible in Budgets API

```
GET /api/budgets
Authorization: (Supabase auth)

Assert: our test budget appears with correct max, spend, and policy
Assert: spend matches what was tracked through the proxy
```

---

### SUITE 10: Negative Cache & Cache Lifecycle (Stage 7)

#### Test 10.1: Negative Cache Prevents Repeated Postgres Lookups

```
Phase 1: Send request with entity that has no budget
  Assert: Postgres was queried (can check via query count or timing)
  Assert: negative cache set: GET {budget}:api_key:{id}:none === "1"

Phase 2: Send same request again
  Assert: response is 200 (passthrough)
  Assert: negative cache hit — Postgres NOT queried again
```

#### Test 10.2: Cache TTL Expiry Forces Refresh

```
Phase 1: Create budget, let proxy populate cache
Phase 2: Update budget max in Postgres directly (bypass proxy)
Phase 3: Wait for TTL expiry (60 seconds) or flush Redis key
Phase 4: Send request — proxy should pick up new budget from Postgres

Assert: new max budget is reflected in Redis cache
```

---

### SUITE 11: Streaming Edge Cases (Stage 11)

#### Test 11.1: Long Streaming Response (High Token Count)

```
Request: {"model": "gpt-4o-mini", "messages": [{"role": "user", "content": "Write a 500 word essay about the ocean."}], "max_tokens": 1000, "stream": true}

Assert: all SSE chunks arrive without corruption
Assert: final usage chunk has accurate token counts
Assert: cost event matches usage
Assert: no partial or duplicated chunks in stream
```

#### Test 11.2: Streaming Non-Streaming Comparison (Same Prompt)

```
Send same prompt twice — once streaming, once non-streaming.

Assert: prompt_tokens identical (same input)
Assert: cost events both recorded
Assert: costs are in the same reasonable range (output may differ slightly)
```

---

### SUITE 12: Latency & Performance Baselines

These tests don't assert correctness but establish performance baselines that can be tracked over time.

#### Test 12.1: Proxy Overhead Measurement

```
Send request directly to OpenAI → measure total latency (T_direct)
Send same request through proxy → measure total latency (T_proxy)

Record: overhead_ms = T_proxy - T_direct
Record: overhead_pct = overhead_ms / T_direct * 100

Soft assert: overhead_pct < 15%
  (Budget lookup + header processing + cost logging should add < 50ms)
```

#### Test 12.2: Health Check Latency Under Load

```
Fire 50 concurrent /health requests during a proxy request.

Assert: all /health responses < 50ms
Assert: all /health responses are 200
```

---

## 4. Execution Order & Dependencies

Tests must run in this order because some suites depend on state created by earlier suites:

```
Phase 1: Infrastructure Checks
  - Verify proxy is up (/health)
  - Verify Redis is reachable (/health/ready)
  - Verify DB is accessible (direct Drizzle query)
  - Verify test API key exists

Phase 2: Rejection Tests (Suite 1)
  - No cost events should exist from these tests
  - Verify assertion: 0 new cost events after Suite 1

Phase 3: Happy Path (Suites 2, 3)
  - These create cost events and budget state
  - Record: cost event IDs, budget entity IDs

Phase 4: Budget Enforcement (Suite 4)
  - Depends on Phase 1 infrastructure
  - Creates its own budget fixtures

Phase 5: Error Handling (Suites 5, 6)
  - Tests upstream failures and header behavior

Phase 6: Cost Accuracy (Suite 7)
  - Multi-model matrix — creates many cost events
  - Most expensive suite in terms of OpenAI spend

Phase 7: Reconciliation (Suite 8)
  - Depends on budget fixture setup

Phase 8: Dashboard Integration (Suite 9)
  - Depends on cost events from Phase 3 and Phase 6

Phase 9: Cache Lifecycle (Suite 10)
  - Depends on budget fixtures

Phase 10: Streaming Edge Cases (Suite 11)
  - Additional streaming scenarios

Phase 11: Performance Baselines (Suite 12)
  - Non-blocking, informational

Phase 12: Cleanup
  - Delete all test budgets (by RUN_ID prefix)
  - Delete all test cost events (by tracked IDs)
  - Flush test Redis keys
```

---

## 5. Wait Strategy for waitUntil()

The proxy logs cost events and reconciles budgets inside `waitUntil()`, which runs after the HTTP response is sent. The test runner must wait for these background tasks to complete before verifying DB/Redis state.

**Strategy: Poll with timeout.**

```typescript
async function waitForCostEvent(
  db: DrizzleInstance,
  userId: string,
  afterTimestamp: Date,
  timeoutMs: number = 10_000,
  pollIntervalMs: number = 500,
): Promise<CostEvent | null> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const [event] = await db
      .select()
      .from(costEvents)
      .where(
        and(
          eq(costEvents.userId, userId),
          gte(costEvents.createdAt, afterTimestamp),
        ),
      )
      .orderBy(desc(costEvents.createdAt))
      .limit(1);

    if (event) return event;
    await sleep(pollIntervalMs);
  }

  return null; // Timeout — test should fail
}
```

**Why not a fixed delay?** A 3-second sleep works most of the time but is either too long (slows down the suite) or too short (flaky on slow networks). Polling with a 10-second timeout is both fast (returns as soon as the event appears) and reliable (handles slow Supabase responses).

**Redis state converges faster than Postgres** because budget reconciliation uses the same waitUntil() but Redis writes are sub-millisecond. Use a shorter timeout (3s) for Redis assertions.

---

## 6. Cleanup & Idempotency

```typescript
async function cleanup(ctx: SystemsTestContext): Promise<void> {
  // 1. Delete test cost events
  if (ctx.insertedCostEventIds.length > 0) {
    await ctx.db
      .delete(costEvents)
      .where(inArray(costEvents.id, ctx.insertedCostEventIds));
  }

  // 2. Delete test budgets
  if (ctx.createdBudgetIds.length > 0) {
    await ctx.db
      .delete(budgets)
      .where(inArray(budgets.id, ctx.createdBudgetIds));
  }

  // 3. Flush test Redis keys
  const keysToDelete = [
    ...ctx.createdBudgetIds.map(id => `{budget}:api_key:${id}`),
    ...ctx.createdBudgetIds.map(id => `{budget}:api_key:${id}:none`),
  ];
  if (keysToDelete.length > 0) {
    await ctx.redis.del(...keysToDelete);
  }
}
```

---

## 7. Expected OpenAI Spend

Estimated cost per full test run:

| Suite | Requests | Model | Est. Cost |
|-------|----------|-------|-----------|
| Suite 2: Non-streaming | 1 | gpt-4o-mini | ~$0.0001 |
| Suite 3: Streaming (×2) | 2 | gpt-4o-mini | ~$0.0002 |
| Suite 4: Budget tests (×7) | ~7 | gpt-4o-mini | ~$0.0007 |
| Suite 5: Error handling | 1 | gpt-4o-mini | $0 (fails at OpenAI) |
| Suite 7: Model matrix (×5) | 5 | mixed | ~$0.005 |
| Suite 8: Reconciliation (×5) | ~5 | gpt-4o-mini | ~$0.0005 |
| Suite 11: Streaming edge (×2) | 2 | gpt-4o-mini | ~$0.001 |
| Suite 12: Performance | 2 | gpt-4o-mini | ~$0.0002 |
| **Total** | **~25** | | **~$0.01** |

Each full systems test run costs approximately **one cent**. Safe to run frequently.

---

## 8. Output Format

```
╔══════════════════════════════════════════════════════╗
║         NullSpend Systems Test Suite v1.0             ║
╚══════════════════════════════════════════════════════╝
Run ID: systest-1710249600000
Proxy:  http://127.0.0.1:8787
DB:     postgresql://...supabase.co (connected)
Redis:  https://...upstash.io (PONG)
API Key: "dev-key" (abc12345...)

━━━ SUITE 1: Proxy Ingress & Rejection ━━━
  [PASS] 1.1 Missing auth → 401
  [PASS] 1.2 Wrong auth → 401
  [PASS] 1.3 Unknown model → 400
  [PASS] 1.4 Invalid JSON → 400
  [PASS] 1.5 Array body → 400
  [PASS] 1.6 Body over 1MB → 413
  [PASS] 1.7 Unsupported endpoint → 404
  [PASS] 1.8 GET to chat completions → 404

━━━ SUITE 2: Happy Path — Non-Streaming ━━━
  [PASS] 2.1 Full pipeline: 200, cost event recorded
         Model: gpt-4o-mini | Tokens: 18in/8out | Cost: 5µ$ ($0.000005)
         Budget: reserved=0, spend=5µ$ | DB matches ✓

━━━ SUITE 3: Happy Path — Streaming ━━━
  [PASS] 3.1 Full streaming pipeline: 200, SSE valid, usage extracted
  [PASS] 3.2 stream_options override: include_usage forced true

...

╔══════════════════════════════════════════════════════╗
║                   RESULTS SUMMARY                    ║
╚══════════════════════════════════════════════════════╝
  Suites:     12
  Tests:      ~35
  Passed:     35
  Failed:     0
  OpenAI spend: ~$0.01
  Duration:   45s
  Cleanup:    12 cost events, 5 budgets, 10 Redis keys

  === ALL SYSTEMS PASS ===
```

---

## 9. File Structure

```
scripts/
  systems-test.ts              ← Main entry point & orchestrator
  systems-test/
    context.ts                 ← SystemsTestContext setup/teardown
    helpers.ts                 ← waitForCostEvent, assert helpers, sleep
    cleanup.ts                 ← Idempotent cleanup logic
    suites/
      01-ingress-rejection.ts  ← Suite 1: auth, model, body validation
      02-non-streaming.ts      ← Suite 2: full non-streaming pipeline
      03-streaming.ts          ← Suite 3: full streaming pipeline
      04-budget-enforcement.ts ← Suite 4: 429, passthrough, concurrent
      05-upstream-errors.ts    ← Suite 5: OpenAI failure handling
      06-header-sanitization.ts← Suite 6: header forwarding/stripping
      07-cost-accuracy.ts      ← Suite 7: multi-model cost verification
      08-reconciliation.ts     ← Suite 8: reservation lifecycle
      09-dashboard-integrity.ts← Suite 9: API query verification
      10-cache-lifecycle.ts    ← Suite 10: negative cache, TTL
      11-streaming-edge.ts     ← Suite 11: long streams, comparison
      12-performance.ts        ← Suite 12: latency baselines
```

---

## 10. What This Proves When It Passes

A passing systems test run means:

1. **The proxy authenticates correctly** — invalid keys are rejected, valid keys pass.
2. **Budget enforcement works end-to-end** — overspend is blocked, reservations are created and cleaned up, Redis and Postgres stay in sync.
3. **Cost tracking is accurate to the microdollar** — the proxy's calculated cost matches hand-computed expected cost for every model.
4. **Streaming works** — SSE chunks pass through unmodified, usage is extracted from the final chunk, and the cost event is accurate.
5. **Concurrent requests don't bypass budgets** — atomic Lua scripts prevent race conditions.
6. **Failed requests cost $0** — upstream errors trigger reservation cleanup, not phantom charges.
7. **The dashboard sees real data** — cost events inserted by the proxy are queryable by the dashboard API.
8. **Header sanitization is correct** — proxy headers don't leak to OpenAI, OpenAI headers forward to the client.
9. **Cache lifecycle works** — Redis cache populates from Postgres, TTL expires, negative cache prevents unnecessary queries.
10. **The proxy adds minimal latency** — overhead is measurable and within acceptable bounds.

This is the final gate before shipping. If the systems test passes, the pipeline is production-ready.
