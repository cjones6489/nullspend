# Webhook Event Stream — Phased Build Plans

Each phase below is a self-contained build plan with file-by-file changes,
test expectations, and verification steps. Phases are sequential — each
depends on the prior phase being complete.

**Technical outline:** `docs/technical-outlines/webhook-event-stream.md`

---

## Phase WH-1: Schema, Auth & Proxy Infra (Foundation) ✅ COMPLETE

**Goal:** Tables exist, proxy knows who has webhooks, signing and dispatch
primitives are tested and ready. No webhooks fire yet.

### Files changed/created

| File | Change |
|------|--------|
| `drizzle/0017_webhook_endpoints.sql` | DDL: webhook_endpoints table + RLS + trigger |
| `drizzle/0018_webhook_deliveries.sql` | DDL: webhook_deliveries table + RLS |
| `packages/db/src/schema.ts` | Drizzle table definitions + exported types |
| `apps/proxy/src/lib/api-key-auth.ts` | `hasWebhooks` EXISTS subquery on `webhook_endpoints` |
| `apps/proxy/src/lib/auth.ts` | `hasWebhooks` on `AuthResult` interface |
| `apps/proxy/src/lib/context.ts` | Updated comment for Redis init condition |
| `apps/proxy/src/index.ts` | Redis init: `hasBudgets \|\| hasWebhooks` |
| `apps/proxy/src/lib/webhook-signer.ts` | HMAC-SHA256 sign + verify + parse |
| `apps/proxy/src/lib/webhook-events.ts` | Event type definitions + payload builders |
| `apps/proxy/src/lib/webhook-cache.ts` | Redis-cached endpoint lookup (fail-open) |
| `apps/proxy/src/lib/webhook-dispatch.ts` | QStash publisher + `dispatchToEndpoints` |
| `apps/proxy/src/lib/webhook-thresholds.ts` | Budget threshold crossing detection |
| `apps/proxy/.dev.vars.example` | Added `QSTASH_TOKEN` |
| `apps/proxy/src/__tests__/webhook-signer.test.ts` | 9 tests |
| `apps/proxy/src/__tests__/webhook-events.test.ts` | 8 tests |
| `apps/proxy/src/__tests__/webhook-cache.test.ts` | 7 tests |
| `apps/proxy/src/__tests__/webhook-dispatch.test.ts` | 10 tests |
| `apps/proxy/src/__tests__/webhook-thresholds.test.ts` | 11 tests |
| 12 existing test files | Added `hasWebhooks: false` to auth objects |

### Audit fixes incorporated

- Event type filter: `ep.eventTypes.length === 0 || ep.eventTypes.includes(event.type)`
- Threshold detection: `// TODO: Redis dedup for threshold alerts (v1.1)` comment
- Webhook cache fail-open (returns `[]` on error)
- Signing secrets stored raw in DB (HMAC needs the raw key)
- `hasWebhooks` flag on AuthResult, Redis init when `hasBudgets || hasWebhooks`
- Dispatch errors never block (fail-open pattern in `dispatchToEndpoints`)

### Post-audit fixes applied

- **Secrets not cached in Redis:** Split `CachedWebhookEndpoint` (metadata only, cached) from `WebhookEndpointWithSecret` (includes secret, DB-only). Redis never stores signing secrets. Dispatch calls `getWebhookEndpointsWithSecrets()` which always queries DB.
- **Missing `hasWebhooks` in 3 mcp-route test auth overrides:** Fixed lines 319, 481, 649.
- **Removed `enabled` from `CachedWebhookEndpoint`:** Only enabled endpoints are cached, so the field was always `true` — redundant.
- **Added test: empty DB result** for `getWebhookEndpoints` (user has no endpoints).
- **Added test: `getWebhookEndpointsWithSecrets`** — verifies secrets are returned from DB path.
- **Added assertion: cached JSON does not contain secrets.**

### Verification

```
pnpm db:build        # ✅ clean
pnpm typecheck       # ✅ clean
pnpm proxy:test      # ✅ 670 passed (40 files)
pnpm test            # ✅ 469 passed (47 files)
```

---

## Phase WH-2: Proxy Route Integration (Webhooks Fire)

**Goal:** Webhooks actually fire on cost events and budget actions.
Wires primitives from WH-1 into route handlers.

### Pre-WH-2 fix (do first)

Wrap `queryActiveEndpoints` in `webhook-cache.ts` with `withDbConnection`
from `db-semaphore.js`. The CF Workers 6-connection-per-isolate limit is
managed by the semaphore (`MAX_CONCURRENT = 2` for background tasks). Without
this, webhook DB queries compete unsemaphored with `logCostEvent` and
`updateBudgetSpend` inside `waitUntil`, risking connection exhaustion that
degrades cost tracking — not just webhooks.

Also: regenerate `worker-configuration.d.ts` by running
`wrangler types --env-file .dev.vars.example` so `env.QSTASH_TOKEN` is in
the `Env` interface. Without this, WH-2 cannot pass typecheck.

### Files to modify (~6)

| File | Change |
|------|--------|
| `apps/proxy/src/lib/webhook-cache.ts` | Wrap `queryActiveEndpoints` in `withDbConnection` |
| `apps/proxy/src/index.ts` | Create `WebhookDispatcher` from `env.QSTASH_TOKEN`, add to `ctx` |
| `apps/proxy/src/lib/context.ts` | Add `webhookDispatcher: WebhookDispatcher \| null` to `RequestContext` |
| `apps/proxy/src/routes/openai.ts` | Dispatch after cost log + reconciliation; dispatch on budget denial |
| `apps/proxy/src/routes/anthropic.ts` | Same pattern as openai |
| `apps/proxy/src/routes/mcp.ts` | Dispatch after batch insert (one webhook per event) |
| `apps/proxy/worker-configuration.d.ts` | Regenerate to include `QSTASH_TOKEN` |

### Integration points (openai.ts as reference)

**Two-step lookup:** The cache split from WH-1 audit means dispatch requires:
1. `getWebhookEndpoints(redis, connectionString, userId)` — fast, Redis-cached, no secrets
2. `getWebhookEndpointsWithSecrets(connectionString, userId)` — DB only, has secrets, semaphore-protected

Use the cached call as a **gate check** (any endpoints at all?), then
fetch with secrets only when dispatch is actually needed.

**Payload assembly:** `calculateOpenAICost()` returns the cost event core
fields but NOT `upstreamDurationMs`, `sessionId`, `toolCallsRequested`, or
`toolDefinitionTokens`. These come from the `enrichment` object and
`result.toolCalls`, already assembled in the route handler for `logCostEvent`.
The webhook payload must merge the same fields:

```typescript
const webhookData = {
  ...costEvent,               // from calculateOpenAICost
  ...enrichment,              // { upstreamDurationMs, sessionId, toolDefinitionTokens }
  toolCallsRequested: result.toolCalls,
  createdAt: new Date().toISOString(),  // proxy timestamp
};
const event = buildCostEventPayload(webhookData);
```

#### Streaming path

**CRITICAL: Separate try/catch.** The existing streaming `waitUntil` block
(openai.ts:214-263) has a try/catch where the catch handler reconciles with
`actualCost=0` as a last-resort cleanup. If webhook dispatch is placed inside
this try block and throws, the catch fires a second reconciliation that
overwrites the real spend with 0 — silent data corruption.

Webhook dispatch must go in its **own try/catch AFTER the existing one closes**,
still inside the same `.then()` callback:

```typescript
waitUntil(
  resultPromise.then(async (result) => {
    // --- Existing try/catch (cost log + reconciliation) ---
    try {
      const costEvent = calculateOpenAICost(...);
      await logCostEvent(connectionString, { ...costEvent, ...enrichment, toolCallsRequested: result.toolCalls });
      if (reservationId && redis) {
        await reconcileReservation(redis, reservationId, costEvent.costMicrodollars, budgetEntities, connectionString);
      }
    } catch (err) {
      console.error(...);
      if (reservationId && redis) {
        try { await reconcileReservation(redis, reservationId, 0, budgetEntities, connectionString); }
        catch { /* already logged */ }
      }
      return; // Don't dispatch webhooks if cost tracking failed
    }

    // --- NEW: Webhook dispatch (separate try/catch) ---
    try {
      if (ctx.webhookDispatcher && ctx.auth.hasWebhooks) {
        const cached = await getWebhookEndpoints(redis, connectionString, ctx.auth.userId);
        if (cached.length > 0) {
          const endpoints = await getWebhookEndpointsWithSecrets(connectionString, ctx.auth.userId);
          const webhookData = { ...costEvent, ...enrichment, toolCallsRequested: result.toolCalls };
          const event = buildCostEventPayload(webhookData);
          await dispatchToEndpoints(ctx.webhookDispatcher, endpoints, event);

          if (budgetEntities.length > 0) {
            const thresholdEvents = detectThresholdCrossings(budgetEntities, costEvent.costMicrodollars, requestId);
            for (const te of thresholdEvents) {
              await dispatchToEndpoints(ctx.webhookDispatcher, endpoints, te);
            }
          }
        }
      }
    } catch (err) {
      console.error("[openai-route] Webhook dispatch failed:", err);
      // Fail-open: cost tracking already succeeded above
    }
  }),
);
```

#### Non-streaming path

The non-streaming path uses separate `waitUntil` calls for `logCostEvent` and
`reconcileReservation` (they run concurrently). Add webhook dispatch as a
**third `waitUntil`** — it runs independently:

```typescript
// After existing waitUntil(logCostEvent(...)) and waitUntil(reconcileReservation(...))
if (ctx.webhookDispatcher && ctx.auth.hasWebhooks) {
  waitUntil((async () => {
    try {
      const cached = await getWebhookEndpoints(redis, connectionString, ctx.auth.userId);
      if (cached.length > 0) {
        const endpoints = await getWebhookEndpointsWithSecrets(connectionString, ctx.auth.userId);
        const webhookData = { ...costEvent, ...enrichment, toolCallsRequested };
        const event = buildCostEventPayload(webhookData);
        await dispatchToEndpoints(ctx.webhookDispatcher, endpoints, event);
        // threshold detection same as streaming
      }
    } catch (err) {
      console.error("[openai-route] Webhook dispatch failed:", err);
    }
  })());
}
```

#### Budget denied path

Insert **before** the `return errorResponse(...)` on the denial branch.
All needed data is in scope at that point:

```typescript
if (checkResult.status === "denied") {
  // Webhook dispatch for budget exceeded (non-blocking)
  if (ctx.webhookDispatcher && ctx.auth.hasWebhooks) {
    waitUntil((async () => {
      try {
        const cached = await getWebhookEndpoints(redis, connectionString, ctx.auth.userId);
        if (cached.length > 0) {
          const endpoints = await getWebhookEndpointsWithSecrets(connectionString, ctx.auth.userId);
          const event = buildBudgetExceededPayload({
            budgetEntityType: budgetEntities[0].entityType,
            budgetEntityId: budgetEntities[0].entityId,
            budgetLimitMicrodollars: budgetEntities[0].maxBudget,
            budgetSpendMicrodollars: budgetEntities[0].spend + budgetEntities[0].reserved,
            estimatedRequestCostMicrodollars: estimate,  // local var from estimateMaxCost()
            model: requestModel,
            provider: "openai",  // or "anthropic" in anthropic.ts
          });
          await dispatchToEndpoints(ctx.webhookDispatcher, endpoints, event);
        }
      } catch (err) {
        console.error("[openai-route] Budget webhook dispatch failed:", err);
      }
    })());
  }

  return errorResponse("budget_exceeded", "Request blocked: estimated cost exceeds remaining budget", 429);
}
```

#### MCP route

Fire **one webhook per cost event** in the batch, not one per batch. Share the
`getWebhookEndpointsWithSecrets` call — fetch once, dispatch N times:

```typescript
// After logCostEventsBatch and reconciliation loop, still inside the single waitUntil
if (ctx.webhookDispatcher && ctx.auth.hasWebhooks) {
  try {
    const cached = await getWebhookEndpoints(redis, connectionString, ctx.auth.userId);
    if (cached.length > 0) {
      const endpoints = await getWebhookEndpointsWithSecrets(connectionString, ctx.auth.userId);
      for (const row of costEventRows) {
        const event = buildCostEventPayload(row);
        await dispatchToEndpoints(ctx.webhookDispatcher, endpoints, event);
      }
    }
  } catch (err) {
    console.error("[mcp-events] Webhook dispatch failed:", err);
  }
}
```

Note: MCP webhooks show `input_tokens=0`, `output_tokens=0` (correct — MCP
tools don't report token counts). `provider` is `"mcp"`, `model` is
`"serverName/toolName"`.

### Key design decisions

- Dispatch happens AFTER reconciliation (not before) — cost tracking is never delayed
- **Streaming: separate try/catch** — webhook errors cannot trigger the reconciliation fallback handler
- **Non-streaming: separate waitUntil** — dispatch runs concurrently with log and reconcile
- **Budget denied: waitUntil before return** — non-blocking, doesn't delay the 429 response
- All dispatch is guarded by `ctx.auth.hasWebhooks` — no Redis/DB calls for users without webhooks
- Dispatch errors are logged but never block the proxy response (fail-open)
- Two-step lookup: cached metadata as gate check, DB fetch with secrets only when needed
- Webhook DB queries go through the connection semaphore (pre-WH-2 fix)
- MCP: one webhook per cost event in batch, single secrets fetch shared across batch

### Audit-driven additions for WH-2

**1. `CostEventData` interface: add enrichment fields**

The current `CostEventData` interface in `webhook-events.ts` is missing the
`createdAt` field that the technical outline specifies inside `data`. Add it:

```diff
 interface CostEventData {
   requestId: string;
+  createdAt?: string;     // ISO 8601 timestamp
   provider: string;
   ...
 }
```

Route handlers pass `createdAt: new Date().toISOString()` (proxy wall-clock
time). This is the same moment the cost event is logged — close enough to the
DB `DEFAULT NOW()`.

**2. Auth cache staleness: accept and document (option a)**

60-second delay is acceptable for v1. After WH-3 ships (dashboard API), the
create-endpoint response can note: "Webhook delivery begins within ~1 minute."
The blind window only affects the very first request after endpoint creation;
subsequent requests within the same isolate hit the same cache entry which
expires normally.

**3. `QSTASH_TOKEN` not in `Env` type**

Before WH-2 implementation:
1. Run `wrangler types --env-file .dev.vars.example` to regenerate
   `worker-configuration.d.ts` with `QSTASH_TOKEN` in the `Env` interface
2. For production: `wrangler secret put QSTASH_TOKEN`

**4. Dispatcher creation placement**

In `index.ts`, create the dispatcher AFTER auth succeeds, conditionally:

```typescript
const ctx: RequestContext = {
  body: result.body,
  auth,
  redis: (auth.hasBudgets || auth.hasWebhooks) ? Redis.fromEnv(env) : null,
  connectionString,
  sessionId: request.headers.get("x-nullspend-session") ?? null,
  webhookDispatcher: auth.hasWebhooks
    ? createWebhookDispatcher((env as Record<string, unknown>).QSTASH_TOKEN as string | undefined)
    : null,
};
```

If `hasWebhooks` is true but `QSTASH_TOKEN` is not set,
`createWebhookDispatcher` returns null. Log a warning at this point so
operators can detect the misconfiguration:

```typescript
if (auth.hasWebhooks && !ctx.webhookDispatcher) {
  console.warn("[proxy] User has webhooks but QSTASH_TOKEN is not configured");
}
```

**5. Budget denied payload data sources**

At the denial point, these values are in scope:
- `budgetEntities[0].entityType` / `.entityId` / `.maxBudget` — from budget lookup
- `budgetEntities[0].spend + budgetEntities[0].reserved` — approximates current spend
- `estimate` — local var from `estimateMaxCost()` / `estimateAnthropicMaxCost()`
- `requestModel` — from `extractModelFromBody()`
- Provider: hardcoded `"openai"` in openai.ts, `"anthropic"` in anthropic.ts

### Test plan

- All existing 670 tests pass unchanged (`hasWebhooks: false` = no dispatch code runs)
- **Streaming dispatch tests** (openai + anthropic):
  - `hasWebhooks: true`, endpoints exist → `dispatchToEndpoints` called with correct cost event payload including enrichment fields
  - Verify dispatch happens AFTER reconciliation completes (not before)
  - Verify webhook dispatch error does NOT trigger double reconciliation (critical regression test)
  - Verify `reconcileReservation` is called exactly once with real cost even when dispatch throws
- **Non-streaming dispatch tests:**
  - Same payload verification
  - Verify dispatch `waitUntil` fires independently of logCostEvent/reconcile `waitUntil`s
- **Budget denied tests:**
  - `budget.exceeded` event dispatched in `waitUntil` before 429 return
  - Payload contains correct entity type, limit, spend, estimate, model, provider
  - Response is still 429 even if dispatch throws
- **MCP batch tests:**
  - Batch of 3 events → 3 separate webhook dispatches
  - Single `getWebhookEndpointsWithSecrets` call (not 3)
  - Dispatch error on event 2 doesn't prevent event 3 dispatch
- **Gate check tests:**
  - `hasWebhooks: true` but 0 endpoints in cache → no DB secrets fetch, no QStash publish
- **Misconfiguration test:**
  - `hasWebhooks: true` but `QSTASH_TOKEN` absent → dispatcher is null, no dispatch, warning logged
- **Semaphore test:**
  - Webhook secrets query goes through `withDbConnection` (verify import and wrapping)

### Verification

```bash
pnpm proxy:test      # All existing + ~20 new tests pass
pnpm typecheck       # Clean (requires worker-configuration.d.ts regeneration)
```

### Post-deploy verification

After WH-2 ships:
1. Insert a test webhook endpoint via direct DB insert for a test user
2. Send a request through the proxy with that user's API key
3. Check QStash dashboard for published message with correct headers
4. Verify `X-NullSpend-Signature`, `X-NullSpend-Webhook-Id` headers present
5. Production deploy requires: `wrangler secret put QSTASH_TOKEN`

---

## Phase WH-3: Dashboard API (CRUD + Management)

**Goal:** Users can create, list, update, delete, and test webhook endpoints
through the dashboard API. No UI yet — API-only.

### Codebase patterns to follow

- **Auth:** `resolveSessionUserId()` from `@/lib/auth/session`
- **DB:** `getDb()` from `@/lib/db/client` → Drizzle direct queries (no service layer)
- **Input:** `readJsonBody(request)` + Zod `.parse()` from `@/lib/utils/http`
- **Errors:** `handleRouteError(error)` — handles Zod, auth, payload errors
- **Client:** `apiGet/apiPost/apiDelete` from `@/lib/api/client` (no `apiPatch` exists)
- **Schema:** `@nullspend/db` for table imports (`webhookEndpoints`, `webhookDeliveries`)
- **Params:** `readRouteParams(params)` for Next.js dynamic route params

### Files to create (~11)

| File | Change |
|------|--------|
| `lib/validations/webhooks.ts` | Zod schemas (create input, update input, record, delivery record) |
| `lib/api/client.ts` | Add `apiPatch` helper |
| `app/api/webhooks/route.ts` | `GET` list, `POST` create |
| `app/api/webhooks/[id]/route.ts` | `PATCH` update, `DELETE` |
| `app/api/webhooks/[id]/test/route.ts` | `POST` send test event |
| `app/api/webhooks/[id]/rotate-secret/route.ts` | `POST` rotate signing secret |
| `app/api/webhooks/[id]/deliveries/route.ts` | `GET` delivery log |
| `app/api/webhooks/route.test.ts` | CRUD + validation tests |
| `app/api/webhooks/[id]/route.test.ts` | Update, delete, ownership tests |
| `app/api/webhooks/[id]/test/route.test.ts` | Test endpoint tests |
| `app/api/webhooks/[id]/rotate-secret/route.test.ts` | Rotate secret tests |

### Step 1: Validation schemas (`lib/validations/webhooks.ts`)

```typescript
import { z } from "zod";

export const WEBHOOK_EVENT_TYPES = [
  "cost_event.created",
  "budget.threshold.warning",
  "budget.threshold.critical",
  "budget.exceeded",
  "request.blocked",
  "request.blocked.budget",
] as const;

export const MAX_WEBHOOK_ENDPOINTS_PER_USER = 10;

// URL validation: reject private IPs, localhost, non-HTTPS
function isValidWebhookUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    const hostname = parsed.hostname;
    if (hostname === "localhost" || hostname === "127.0.0.1") return false;
    if (hostname.startsWith("10.")) return false;
    if (hostname.startsWith("192.168.")) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return false;
    if (hostname === "169.254.169.254") return false;  // AWS metadata
    return true;
  } catch { return false; }
}

export const createWebhookInputSchema = z.object({
  url: z.string().url().refine(isValidWebhookUrl, {
    message: "URL must be HTTPS and not point to private/reserved IP addresses",
  }),
  description: z.string().trim().max(200).optional(),
  eventTypes: z.array(z.enum(WEBHOOK_EVENT_TYPES)).default([]),
});

export const updateWebhookInputSchema = z.object({
  url: z.string().url().refine(isValidWebhookUrl, { ... }).optional(),
  description: z.string().trim().max(200).nullable().optional(),
  eventTypes: z.array(z.enum(WEBHOOK_EVENT_TYPES)).optional(),
  enabled: z.boolean().optional(),
});

export const webhookRecordSchema = z.object({
  id: z.string().uuid(),
  url: z.string(),
  description: z.string().nullable(),
  eventTypes: z.array(z.string()),
  enabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const webhookDeliveryRecordSchema = z.object({
  id: z.string().uuid(),
  eventType: z.string(),
  eventId: z.string(),
  status: z.string(),
  attempts: z.number(),
  lastAttemptAt: z.string().nullable(),
  responseStatus: z.number().nullable(),
  createdAt: z.string(),
});
```

### Step 2: Add `apiPatch` to client (`lib/api/client.ts`)

```typescript
export async function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "PATCH",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return handleResponse<T>(response);
}
```

### Step 3: Route handlers

**`app/api/webhooks/route.ts` (GET list + POST create)**

```typescript
// GET: resolveSessionUserId → db.select from webhookEndpoints
//      WHERE userId = user, ORDER BY createdAt DESC
//      NEVER return signingSecret column
//      Return { data: WebhookRecord[] }

// POST: resolveSessionUserId → readJsonBody → createWebhookInputSchema.parse
//       COUNT existing endpoints → reject if >= 10
//       Generate secret: `whsec_${randomBytes(32).toString("hex")}`
//       INSERT with returning → return { data: { ...record, signingSecret } }
//       The raw secret is shown ONCE in this response

import { randomBytes } from "node:crypto";
```

**`app/api/webhooks/[id]/route.ts` (PATCH update + DELETE)**

```typescript
// PATCH: resolveSessionUserId → readRouteParams → readJsonBody
//        → updateWebhookInputSchema.parse
//        UPDATE WHERE id = params.id AND userId = user
//        Use .returning() — if empty, endpoint not found or not owned → 404
//        Return { data: updatedRecord }  (no secret)

// DELETE: resolveSessionUserId → readRouteParams
//         DELETE WHERE id = params.id AND userId = user
//         Use .returning() — if empty → 404
//         Return { success: true }
```

**`app/api/webhooks/[id]/test/route.ts` (POST test event)**

```typescript
// POST: resolveSessionUserId → readRouteParams
//       SELECT endpoint WHERE id AND userId (ownership check)
//       Build synthetic cost_event.created payload (fake data)
//       Sign with endpoint's signingSecret (Node.js crypto.createHmac)
//       POST directly to endpoint.url with NullSpend headers
//       Return { success, statusCode, responsePreview }
//       3-second timeout on the outbound fetch
```

**`app/api/webhooks/[id]/rotate-secret/route.ts` (POST rotate)**

```typescript
// POST: resolveSessionUserId → readRouteParams
//       Generate new secret: `whsec_${randomBytes(32).toString("hex")}`
//       UPDATE signingSecret WHERE id AND userId
//       .returning() — if empty → 404
//       Return { data: { signingSecret: newSecret } }
//       (v1: simple swap. v1.1: dual-signing window)
```

**`app/api/webhooks/[id]/deliveries/route.ts` (GET delivery log)**

```typescript
// GET: resolveSessionUserId → readRouteParams
//      Verify endpoint ownership: SELECT FROM webhookEndpoints WHERE id AND userId
//      SELECT FROM webhookDeliveries WHERE endpointId = params.id
//      ORDER BY createdAt DESC, LIMIT 50
//      Return { data: DeliveryRecord[] }
```

### Step 4: No Redis cache invalidation in v1

The dashboard does NOT have a Redis client. The proxy's webhook cache
has a 5-minute TTL that expires naturally. For v1, this is acceptable:
- Create/update/delete take effect within 5 minutes
- The auth cache (`hasWebhooks`) has 60s TTL separately

If latency becomes a problem, add a Redis client to the dashboard later.
This avoids introducing a new infrastructure dependency in WH-3.

### Step 5: Dashboard-side signer for test endpoint

Use Node.js `crypto.createHmac` (not Web Crypto API — dashboard runs on
Node.js, not CF Workers). Same HMAC-SHA256 algorithm, same signature format.

```typescript
// lib/webhooks/signer.ts
import { createHmac } from "node:crypto";

export function signPayload(payload: string, secret: string, timestamp: number): string {
  const content = `${timestamp}.${payload}`;
  const hex = createHmac("sha256", secret).update(content).digest("hex");
  return `t=${timestamp},v1=${hex}`;
}
```

### Key implementation details

- **Secret generation:** `whsec_` + `randomBytes(32).toString("hex")` = 68-char secret
- **Ownership check:** Every `[id]` route does `WHERE id = $id AND userId = $user`.
  If `.returning()` is empty, the endpoint doesn't exist OR isn't owned → 404.
  This prevents enumeration attacks (don't distinguish "not found" from "forbidden").
- **No PATCH in existing client:** Add `apiPatch` to `lib/api/client.ts`.
  Follow same pattern as `apiPost` but with `method: "PATCH"`.
- **Max 10 endpoints:** Check `COUNT(*) WHERE userId = user` before INSERT.
  Return 409 with clear message if at limit.
- **Event types default:** Empty array `[]` means "all events" (same as proxy logic).
- **Deliveries route:** Read-only. No write endpoint — delivery status is
  updated by QStash callbacks (deferred to v1.1).

### Test plan

**`app/api/webhooks/route.test.ts`:**
- POST create: valid input → 200 + secret returned
- POST create: invalid URL (http://) → 400
- POST create: private IP → 400
- POST create: missing url → 400
- POST create: 11th endpoint → 409 (limit)
- GET list: returns endpoints without secrets
- GET list: only returns user's own endpoints

**`app/api/webhooks/[id]/route.test.ts`:**
- PATCH update: valid fields → 200
- PATCH update: non-owned endpoint → 404
- PATCH update: nonexistent id → 404
- DELETE: owned endpoint → 200
- DELETE: non-owned endpoint → 404

**`app/api/webhooks/[id]/test/route.test.ts`:**
- POST test: valid endpoint → sends webhook, returns status
- POST test: non-owned → 404
- POST test: target URL unreachable → returns error status

**`app/api/webhooks/[id]/rotate-secret/route.test.ts`:**
- POST rotate: valid → 200 + new secret
- POST rotate: non-owned → 404

### Verification

```bash
pnpm test            # Dashboard tests pass (all new + existing)
pnpm typecheck       # Clean
```

---

## Phase WH-4: Dashboard UI (Settings Page)

**Goal:** Users can manage webhooks from the Settings page.

### Files to create/modify (~4)

| File | Change |
|------|--------|
| `lib/queries/webhooks.ts` | React Query hooks (list, create, update, delete, test, rotate) |
| `components/settings/webhooks-section.tsx` | Main UI component |
| `app/(dashboard)/app/settings/page.tsx` | Add `<WebhooksSection />` |

### UI pattern (follow `components/settings/slack-section.tsx`)

- Card with title "Webhooks"
- **Empty state:** "No webhook endpoints configured" + "Add Endpoint" button
- **Table:** URL (truncated), enabled toggle, event type badges, description, actions
- **Create dialog:**
  - URL input (required)
  - Description input (optional)
  - Event type checkboxes (empty = all events)
  - Submit → show raw signing secret in a copy-able alert (shown once!)
- **Test button** per endpoint (inline, calls POST /api/webhooks/:id/test)
- **Delete** with confirmation dialog
- **Rotate secret** with confirmation dialog → show new secret once

### Key UX details

- Post-create secret display: use a `<code>` block with copy button, warning that it won't be shown again
- Event type badges: colored pills for each event type
- Enabled toggle: instant PATCH, no save button
- URL truncation: show domain + first path segment, full URL on hover

### Test plan

- Visual: Settings → Webhooks section renders
- Create flow: form → submit → secret shown
- Toggle endpoint enabled/disabled
- Delete with confirmation

### Verification

```bash
pnpm dev             # Visual: Settings → Webhooks section renders
pnpm typecheck       # Clean
```

---

## Deferred to Fast-Follow (v1.1)

| Feature | Why deferred |
|---------|-------------|
| QStash callback route (delivery status tracking) | Webhooks work without it; delivery log shows "pending" until added |
| Threshold alert dedup via Redis | Concurrent duplicates are rare at current scale |
| Secret rotation dual-signing (24h window) | Simple rotation ships first |
| `cost_dollars` convenience field in payloads | Keep payloads minimal; add if customers ask |
| Activity page webhook indicators | UI enhancement, not core functionality |

---

## Phase Dependencies

```
WH-1 (Schema + Auth + Infra) ✅
  └── WH-2 (Route Integration — webhooks fire)
        └── WH-3 (Dashboard API — CRUD)
              └── WH-4 (Dashboard UI)
```

Each phase is independently shippable. After WH-2, the system works end-to-end
(endpoints managed via DB inserts). After WH-3, it's API-complete. WH-4 is pure UI.
