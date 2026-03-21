# Technical Deep Dive: Budget Enforcement Bugs & Remediation

> **Purpose:** Working reference for Cursor. Every bug below is from a production
> competitor tool. Each has a technical remediation and test spec for NullSpend.
>
> **Scope filter:** Only bugs that affect budget enforcement — the V1 differentiator.
> Excludes cost calculation accuracy (see `02-anthropic-cost-bugs.md` and
> `03-openai-cost-bugs.md`) and streaming parsing (see `04-streaming-bugs.md`).
>
> **Strategic alignment:** Budget enforcement is NullSpend's #1 competitive wedge.
> OpenClaw (250K+ stars) has zero budget enforcement. LiteLLM's enforcement has
> 7+ documented bypass vulnerabilities. Portkey gates enforcement to $5K+/month.
> Getting this right at $49/month is the entire product thesis.

---

## Anti-Patterns to Internalize

Before the bugs: five architectural mistakes that cause them all. These are the
design constraints for NullSpend's budget system.

| Anti-Pattern | Competitor | NullSpend Rule |
|---|---|---|
| Route-based enforcement | LiteLLM | Identity-based. Tied to API key, checked before routing. |
| Mutually exclusive entity checks | LiteLLM | Check ALL entities (key, user). Enforce most restrictive. |
| Post-hoc tracking without reservation | LiteLLM | Atomic check-and-reserve via Redis Lua. |
| Non-atomic budget operations | LiteLLM | All budget state mutations via Lua scripts. |
| No enforcement at all | OpenClaw, DenchClaw, ClawMetry, Helicone, Langfuse | Hard block at proxy layer. |

---

## Bug BE-1: Route bypass — $764 on $50 budget

**Source:** LiteLLM #12977 (July 2025, architecturally unfixed)

**What happens:** AzureOpenAI client sends requests to
`/openai/deployments/{model}/chat/completions?api-version=...` instead of
`/v1/chat/completions`. LiteLLM's budget middleware uses route matching against
`LiteLLMRoutes.llm_api_routes.value` — a hardcoded list. Azure paths aren't in
the list. Budget checking is completely skipped. User documented $764.78 spend
against a $50 budget.

**Root cause:** Budget enforcement tied to URL pattern matching.

**Remediation:**

Budget check is the FIRST thing in the request pipeline, keyed on the
authenticated identity (API key), not the URL path. The proxy handler looks
like this:

```typescript
// Simplified request flow — budget check happens BEFORE provider detection
async function handleRequest(request: Request): Promise<Response> {
  // 1. Authenticate — extract NullSpend API key
  const auth = await authenticateRequest(request);
  if (!auth.ok) return errorResponse(401, auth.error);

  // 2. Budget check — identity-based, not route-based
  const budget = await checkBudget(auth.apiKeyId, estimateCost(request));
  if (!budget.ok) return budgetExceededResponse(budget);

  // 3. NOW detect provider and route
  const provider = detectProvider(request);
  const upstream = await forwardToProvider(provider, request);

  // 4. Post-response reconciliation
  ctx.waitUntil(reconcileCost(auth.apiKeyId, budget.reservationId, upstream));

  return upstream.response;
}
```

There is exactly ONE code path from request to upstream. Budget check is on it.
No route can bypass it because the check happens before routing.

**Test (pseudocode — CRITICAL):**

```typescript
describe("BE-1: Identity-based enforcement, not route-based", () => {
  it("enforces budget on /v1/chat/completions", async () => {
    const key = await createApiKey({ budgetMicrodollars: 50_000_000 }); // $50
    await spendBudget(key.id, 49_500_000); // $49.50 spent

    const res = await proxy("/v1/chat/completions", {
      headers: { "X-NullSpend-Auth": key.token },
      body: { model: "gpt-4o", messages: [{ role: "user", content: "hi" }], max_tokens: 500 }
    });

    // Estimated cost of ~500 output tokens on gpt-4o exceeds $0.50 remaining
    expect(res.status).toBe(429);
    expect(res.json().error).toBe("budget_exceeded");
  });

  it("enforces SAME budget on /v1/messages (Anthropic path)", async () => {
    const key = await createApiKey({ budgetMicrodollars: 50_000_000 });
    await spendBudget(key.id, 49_500_000);

    const res = await proxy("/v1/messages", {
      headers: { "X-NullSpend-Auth": key.token },
      body: { model: "claude-sonnet-4-6", messages: [{ role: "user", content: "hi" }], max_tokens: 500 }
    });

    expect(res.status).toBe(429);
    expect(res.json().error).toBe("budget_exceeded");
  });

  it("enforces budget on ANY future provider path", async () => {
    const key = await createApiKey({ budgetMicrodollars: 1_000_000 }); // $1
    await spendBudget(key.id, 999_000); // $0.999 spent

    // Even a made-up path gets budget-checked because check is pre-routing
    const res = await proxy("/v1/some-future-endpoint", {
      headers: { "X-NullSpend-Auth": key.token },
      body: { model: "gpt-future", messages: [{ role: "user", content: "hi" }], max_tokens: 100 }
    });

    // Should get 429 (budget) not 404 (unknown route) — budget check is first
    expect(res.status).toBe(429);
  });
});
```

---

## Bug BE-2: Team membership nullifies user budgets

**Source:** LiteLLM #12905 (July 2025)

**What happens:** In `auth_checks.py`, the budget check explicitly skips user
enforcement when the key belongs to a team:
```python
if (user_object is not None
    and user_object.max_budget is not None
    and (team_object is None or team_object.team_id is None)):  # ← BUG
```
A user with `max_budget: 10.0` and `spend: 15.0` passes if team-associated.

**Root cause:** Mutually exclusive entity hierarchy — checks one level, not all.

**Remediation:**

V1 only has key-level budgets, so this bug can't occur yet. But the design
must prevent it when we add user/team budgets:

```typescript
// When team/org budgets are added (post-V1), check ALL entities:
async function checkAllBudgets(
  keyId: string,
  userId?: string,
  teamId?: string
): Promise<BudgetCheckResult> {
  const checks = await Promise.all([
    checkBudget(keyId),                         // always
    userId ? checkBudget(userId) : null,         // if user identified
    teamId ? checkBudget(teamId) : null,         // if team identified
  ].filter(Boolean));

  // Enforce MOST RESTRICTIVE — if any entity is over budget, block
  const blocked = checks.find(c => !c.ok);
  if (blocked) return blocked;

  // Return the entity with least remaining budget (for reporting)
  return checks.reduce((a, b) =>
    a.remainingMicrodollars < b.remainingMicrodollars ? a : b
  );
}
```

**Key design constraint:** Never `if/else` between entity types. Always check
all applicable entities independently.

**Test (acceptance criteria):**

```
BE-2a: V1 — key budget enforced regardless of any future entity association
  GIVEN: API key with $10 budget, $10 spent
  WHEN: Request arrives
  THEN: 429 returned

BE-2b: Future — user budget enforced even when key has headroom
  GIVEN: Key budget $100 (spent $20), user budget $10 (spent $10)
  WHEN: Request arrives with this key + user
  THEN: 429 returned (user budget exhausted)

BE-2c: Future — most restrictive wins across all entities
  GIVEN: Key budget $50, user budget $10, team budget $100
  WHEN: User spend reaches $10
  THEN: Blocked on user budget, even though key and team have headroom
```

---

## Bug BE-3: End-user budgets never enforced

**Source:** LiteLLM #11083 (May 2025, fix PR #9658 closed without merge)

**What happens:** Budget is set for end-user via `user` field but
`UserAPIKeyAuth` never populates `max_budget` from `LiteLLM_BudgetTable`.

**Root cause:** End-user identity decoupled from key identity.

**Remediation (V1):** Not in scope — V1 only has key-level budgets. But the
data model must support it. The `budgets` table already has a `userId` field.
When we add user-level enforcement, the lookup is:

```sql
SELECT b.limit_microdollars, COALESCE(SUM(ce.cost_microdollars), 0) as spent
FROM budgets b
LEFT JOIN cost_events ce ON ce.user_id = b.user_id
  AND ce.created_at >= b.current_period_start
WHERE b.user_id = $1
```

**Test (acceptance criteria):**

```
BE-3: User-level budgets are independently enforced (future)
  GIVEN: User "user-123" has $10 budget, separate from key budget
  WHEN: User's cumulative spend reaches $10
  THEN: 429 returned, even if key has remaining budget
```

---

## Bug BE-4: Passthrough routes skip budget middleware

**Source:** LiteLLM #13882, partially fixed by PR #15805 (Oct 2025)

**What happens:** `/bedrock`, `/anthropic`, `/vertex-ai` passthrough routes
use a different code path that bypasses middleware entirely.

**Root cause:** Multiple code paths to upstream, not all budget-checked.

**Remediation:** Same as BE-1 — single code path. In NullSpend's architecture,
every request goes through the same handler:

```
Request → authenticate → budget check → detect provider → forward → reconcile
```

There are no "passthrough" routes. The proxy always interprets the response
to extract usage data. If we can't extract usage (unknown provider format),
we apply a conservative cost estimate rather than $0.

**Test (acceptance criteria):**

```
BE-4: No provider route bypasses budget enforcement
  GIVEN: API key with exhausted budget
  WHEN: Request sent to /v1/chat/completions (OpenAI)
  THEN: 429
  WHEN: Request sent to /v1/messages (Anthropic)
  THEN: 429
  WHEN: Request sent to any route
  THEN: 429 (not 404 — budget check is first)
```

---

## Bug BE-5: Budget reset race condition

**Source:** LiteLLM #14266 (non-atomic reset)

**What happens:** `budget_reset_at` timestamp updates but `spend` doesn't zero
for random keys. Two separate DB operations race with each other.

**Root cause:** Non-atomic budget state transition.

**Remediation:**

Budget reset is a single Redis Lua script:

```lua
-- KEYS[1] = "budget:remaining:{entity_id}"
-- KEYS[2] = "budget:reservations:{entity_id}"
-- ARGV[1] = budget_limit_microdollars
-- ARGV[2] = new_period_start_epoch

-- Atomically: clear reservations, reset remaining to full limit
redis.call('DEL', KEYS[2])                    -- clear all reservations
redis.call('SET', KEYS[1], ARGV[1])           -- reset remaining to limit
return {1, tonumber(ARGV[1])}                 -- success, new remaining
```

The Postgres ledger records the reset event separately via `waitUntil()`,
but the enforcement state (Redis) transitions atomically.

**Test (pseudocode — CRITICAL):**

```typescript
describe("BE-5: Atomic budget reset", () => {
  it("resets atomically while concurrent requests are in-flight", async () => {
    const key = await createApiKey({ budgetMicrodollars: 10_000_000 }); // $10
    await spendBudget(key.id, 8_500_000); // $8.50 spent

    // Fire 5 concurrent requests while reset happens
    const [resetResult, ...requestResults] = await Promise.all([
      resetBudget(key.id),
      proxy("/v1/chat/completions", { headers: { "X-NullSpend-Auth": key.token }, body: smallRequest }),
      proxy("/v1/chat/completions", { headers: { "X-NullSpend-Auth": key.token }, body: smallRequest }),
      proxy("/v1/chat/completions", { headers: { "X-NullSpend-Auth": key.token }, body: smallRequest }),
      proxy("/v1/chat/completions", { headers: { "X-NullSpend-Auth": key.token }, body: smallRequest }),
      proxy("/v1/chat/completions", { headers: { "X-NullSpend-Auth": key.token }, body: smallRequest }),
    ]);

    // After reset, remaining should be $10 minus cost of any requests that
    // went through after the reset. No request should see a partially-reset state.
    const budget = await getBudgetState(key.id);
    expect(budget.remainingMicrodollars).toBeGreaterThan(0);
    expect(budget.remainingMicrodollars).toBeLessThanOrEqual(10_000_000);
  });
});
```

---

## Bug BE-6: Budget precedence confusion with JWT tokens

**Source:** LiteLLM #14097 (Aug 2025)

**What happens:** JWT tokens create a precedence hierarchy where customer/user
budgets are silently ignored.

**Root cause:** Conditional check ordering drops budget checks.

**Remediation (V1):** NullSpend V1 uses API key auth only (no JWT). The
`X-NullSpend-Auth` header identifies the key. Budget is looked up by key ID.
No precedence confusion possible with a single auth method and single entity
type.

**Test (acceptance criteria):**

```
BE-6: Auth method does not affect budget enforcement
  GIVEN: API key with $10 budget, $10 spent
  WHEN: Authenticated via X-NullSpend-Auth header
  THEN: 429 returned
  (Future: when JWT/OAuth added, same budget must apply)
```

---

## Bug BE-7: Cannot remove budget once set

**Source:** LiteLLM #19781 (January 2026)

**What happens:** Setting budget back to unlimited fails with float parsing error.

**Root cause:** API accepts float for budget, rejects empty string for "no budget."

**Remediation:**

Budget CRUD API uses Zod validation that explicitly handles removal:

```typescript
const budgetSchema = z.object({
  limitMicrodollars: z.number().int().positive().nullable(), // null = no limit
  resetInterval: z.enum(["daily", "weekly", "monthly", "total"]).nullable(),
});

// DELETE /api/budgets/:id removes the budget entirely
// PATCH /api/budgets/:id with { limitMicrodollars: null } makes it unlimited
```

When a budget is deleted: remove the Redis keys, mark as deleted in Postgres.
Subsequent requests pass through without enforcement (cost still tracked).

**Test (pseudocode — CRITICAL):**

```typescript
describe("BE-7: Full budget lifecycle", () => {
  it("creates, enforces, and removes budget cleanly", async () => {
    const key = await createApiKey();

    // 1. No budget — requests pass through
    let res = await proxy("/v1/chat/completions", { headers: auth(key) });
    expect(res.status).toBe(200);

    // 2. Create budget
    await createBudget(key.id, { limitMicrodollars: 1_000_000 }); // $1

    // 3. Spend over budget — blocked
    await spendBudget(key.id, 1_000_000);
    res = await proxy("/v1/chat/completions", { headers: auth(key) });
    expect(res.status).toBe(429);

    // 4. Delete budget — unblocked
    await deleteBudget(key.id);
    res = await proxy("/v1/chat/completions", { headers: auth(key) });
    expect(res.status).toBe(200);

    // 5. Verify no orphaned Redis state
    const redisState = await getRedisKeys(`budget:*:${key.id}`);
    expect(redisState).toHaveLength(0);
  });
});
```

---

## Bug BE-8: Concurrent requests all pass budget check simultaneously

**Source:** LiteLLM architectural pattern (documented in tech spec §5)

**What happens:** LiteLLM checks stale spend values before requests. 10
concurrent requests all see "budget has $5 remaining" and all pass. Total
spend: $50 on a $5 budget.

**Root cause:** No reservation system. Check and debit are separate operations.

**Remediation:**

The Redis Lua script (from tech spec) handles this atomically:

1. Clean expired reservations
2. Read remaining budget
3. Sum outstanding reservations
4. Calculate effective remaining = remaining - reserved
5. If estimated cost > effective remaining → reject
6. Otherwise, create reservation with TTL

Because this is a Lua script, steps 1-6 execute as a single atomic operation.
No concurrent request can interleave.

**Test (pseudocode — CRITICAL):**

```typescript
describe("BE-8: Concurrent request budget enforcement", () => {
  it("does not allow collective overspend", async () => {
    const key = await createApiKey({ budgetMicrodollars: 1_000_000 }); // $1

    // Fire 20 concurrent requests, each estimated at $0.10
    const results = await Promise.all(
      Array(20).fill(null).map(() =>
        proxy("/v1/chat/completions", {
          headers: { "X-NullSpend-Auth": key.token },
          body: { model: "gpt-4o", messages: [{ role: "user", content: "hi" }], max_tokens: 50 }
        })
      )
    );

    const allowed = results.filter(r => r.status === 200);
    const blocked = results.filter(r => r.status === 429);

    // At $0.10 each with $1 budget, approximately 10 should pass
    expect(allowed.length).toBeLessThanOrEqual(12); // some margin for estimation
    expect(blocked.length).toBeGreaterThan(0);

    // Total spend should not exceed $1 + one request's max cost
    const totalSpend = await getTotalSpend(key.id);
    expect(totalSpend).toBeLessThanOrEqual(1_100_000); // $1.10 max
  });
});
```

---

## Bug BE-9: Reservation never released on failed upstream

**Source:** Architectural concern (not a specific competitor bug, but a failure
mode we must handle)

**What happens (hypothetical):** Proxy reserves $0.50 from budget, forwards
to upstream, upstream times out or crashes. Reservation is never reconciled.
Budget permanently loses $0.50.

**Remediation:**

Reservations have a TTL (default: 120 seconds). The Lua script cleans expired
reservations on every budget check. If the upstream fails:

```typescript
try {
  const upstream = await fetch(providerUrl, request);
  const actualCost = calculateCost(upstream);
  await reconcile(reservationId, actualCost); // release surplus
} catch (error) {
  // Upstream failed — release entire reservation
  await releaseReservation(reservationId);
  return errorResponse(502, "Upstream provider error");
}
```

Even if the release call fails (network error to Redis), the TTL ensures
the reservation expires automatically.

**Test (pseudocode):**

```typescript
describe("BE-9: Reservation cleanup on failure", () => {
  it("releases reservation when upstream times out", async () => {
    const key = await createApiKey({ budgetMicrodollars: 10_000_000 });

    // Mock upstream to timeout
    mockUpstream.timeout(30_000);

    const budgetBefore = await getRemainingBudget(key.id);
    const res = await proxy("/v1/chat/completions", { headers: auth(key) });
    expect(res.status).toBe(502);

    // Wait for reservation cleanup
    await sleep(200);
    const budgetAfter = await getRemainingBudget(key.id);

    // Budget should be fully restored (no permanent leak)
    expect(budgetAfter).toBe(budgetBefore);
  });

  it("auto-expires reservations after TTL", async () => {
    const key = await createApiKey({ budgetMicrodollars: 5_000_000 });

    // Create a reservation that will never be reconciled
    await createOrphanedReservation(key.id, 500_000, ttlSeconds: 2);

    // Immediately, effective budget is reduced
    const budgetDuring = await getEffectiveBudget(key.id);
    expect(budgetDuring).toBe(4_500_000);

    // After TTL, reservation expires
    await sleep(2500);
    const budgetAfter = await getEffectiveBudget(key.id);
    expect(budgetAfter).toBe(5_000_000); // fully restored
  });
});
```

---

## Bug BE-10: Unknown model pricing = $0 = budget bypass

**Source:** Portkey docs on cost management

**What happens:** Portkey: "If a specific request log shows 0 cents in the
COST column, it means that Portkey does not currently track pricing for that
model, and it will not count towards the provider's budget limit."

**Root cause:** Unknown models default to $0, effectively bypassing budgets.

**Remediation:**

When model pricing is unknown, apply a conservative fallback estimate:

```typescript
function getModelPricing(provider: string, model: string): ModelPricing {
  const known = pricingDb.lookup(provider, model);
  if (known) return known;

  // Fallback: use the most expensive model in the provider's family
  const fallback = pricingDb.getMostExpensiveForProvider(provider);
  if (fallback) return { ...fallback, isFallback: true };

  // Last resort: hard-coded conservative estimate
  return {
    inputPerMTok: 10_000_000,   // $10/MTok (conservative)
    outputPerMTok: 30_000_000,  // $30/MTok (conservative)
    isFallback: true,
  };
}
```

The `isFallback` flag is included in cost events so users know which costs
are estimates. The dashboard shows a warning: "Cost estimated — pricing not
available for model X."

**Test (acceptance criteria):**

```
BE-10a: Unknown model still enforces budget
  GIVEN: API key with $5 budget, $4.50 spent
  WHEN: Request with model="unknown-model-2026" and max_tokens=1000
  THEN: Budget check uses conservative estimate, may return 429
  AND: Cost event logged with isFallback=true

BE-10b: Known model uses exact pricing
  GIVEN: Request with model="gpt-4o"
  THEN: Cost event uses exact pricing, isFallback=false
```

---

## OpenClaw Ecosystem Gap: Zero Enforcement

**Source:** OpenClaw docs, DenchClaw $3K/day, ClawMetry Product Hunt discussion

**What this is:** Not a bug — it's the absence of the feature entirely. OpenClaw
has 250K+ stars and no budget caps. DenchClaw users spent $3K in a day. ClawMetry
shows costs but can't stop them.

**Remediation:** This IS NullSpend. The entire product. The one-line base URL
change that adds budget enforcement to any OpenClaw, DenchClaw, or LLM-calling
agent.

**Validation test:**

```
OpenClaw integration test:
  GIVEN: OpenClaw configured with OPENAI_BASE_URL=https://proxy.nullspend.com/v1
  AND: NullSpend API key with $5/day budget
  WHEN: OpenClaw agent runs tasks that accumulate >$5 in API costs
  THEN: Agent receives 429 from NullSpend proxy
  AND: Agent's error handling displays budget exceeded message
  AND: No further API costs are incurred
```

---

## Implementation Checklist

In priority order for this week's sprint:

- [ ] Redis Lua check-and-reserve script (BE-8)
- [ ] Pre-request budget check in proxy handler (BE-1, BE-4)
- [ ] Post-response reconciliation with reservation release (BE-9)
- [ ] HTTP 429 response format with budget details
- [ ] Budget CRUD API: create, list, delete, reset (BE-5, BE-7)
- [ ] Reservation TTL auto-expiry (BE-9)
- [ ] Unknown model fallback pricing (BE-10)
- [ ] Integration test: concurrent requests against budget (BE-8)
- [ ] Integration test: full budget lifecycle (BE-7)
- [ ] Integration test: route-independent enforcement (BE-1)
