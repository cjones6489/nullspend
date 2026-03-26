# QStash → Cloudflare Queue: Webhook Delivery Migration

Replace `@upstash/qstash` with a native Cloudflare Queue for webhook delivery. Eliminates the last external dependency from the proxy.

**Status:** Planning
**Estimated effort:** 1.5 days across 3 sub-phases
**Risk:** Low — mirrors the existing cost-event-queue pattern exactly

---

## Why

1. **Open-source blocker** — QStash requires an Upstash account. Self-hosters need native webhook delivery.
2. **Dependency reduction** — removes the last external service from the proxy (`@upstash/qstash`).
3. **Cost at scale** — Cloudflare Queues at $0.40/M operations is cheaper than QStash per-message pricing.
4. **Consistency** — webhook delivery uses the same Queue pattern as cost events and reconciliation.

## Current Architecture

```
Route handler (waitUntil)
  → sign payload (HMAC-SHA256)
  → qstash.publishJSON({ url, body, headers, retries: 5 })
  → QStash delivers to endpoint with retries
```

**QStash touchpoints (blast radius):**

| File | What | Lines |
|------|------|-------|
| `lib/webhook-dispatch.ts` | QStash Client import + `publishJSON` call | 62 lines total |
| `index.ts` | `createWebhookDispatcher(env.QSTASH_TOKEN)` | 6 lines |
| `lib/context.ts` | `webhookDispatcher: WebhookDispatcher \| null` | 1 line (interface stays) |
| `routes/openai.ts` | 8 `dispatchToEndpoints` / `dispatcher.dispatch` calls | Unchanged — dispatcher interface stays |
| `routes/anthropic.ts` | 8 dispatch calls | Unchanged |
| `routes/mcp.ts` | 5 dispatch calls | Unchanged |
| `package.json` | `@upstash/qstash: ^2.9.0` | Remove |
| `.dev.vars.example` | `QSTASH_TOKEN=...` | Remove |
| `__tests__/webhook-dispatch.test.ts` | Mocks `@upstash/qstash` Client | Rewrite |
| 14 other test files | Mock `webhookDispatcher` on context | **No change** — they mock the dispatcher interface, not QStash |

**Key insight:** The `WebhookDispatcher` interface (`dispatch(endpoint, event)`) and `dispatchToEndpoints()` function are **unchanged**. Only the internal implementation of `createWebhookDispatcher()` changes. The 21 dispatch calls across 3 route handlers don't need to change at all.

## Proposed Architecture

```
Route handler (waitUntil)
  → sign payload (HMAC-SHA256)  [same as today]
  → WEBHOOK_QUEUE.send({ url, payload, headers })  [replaces QStash]
  → Queue consumer: fetch(url, { body: payload, headers })
    → 200: ack
    → 5xx: retry with exponential backoff
    → 4xx: ack (permanent failure, log)
    → timeout/error: retry
  → After max_retries: → DLQ (log + metric + ack)
```

## Technical Constraints (from research)

| Constraint | Value | Impact |
|-----------|-------|--------|
| Max message size | 128 KB | No issue — webhook payloads are 1-5 KB |
| Queue.send() latency | ~60ms p50 | No issue — runs in waitUntil |
| Consumer wall clock limit | 15 min | No issue — even 10 serial slow endpoints take <2 min |
| Consumer CPU limit | 30s default | No issue — fetch overhead is minimal |
| Delivery guarantee | At-least-once | Document for consumers. Webhook ID enables client-side dedup. |
| Message ordering | None guaranteed | No issue — webhook events are independent |
| Retry delay | Configurable per-message | Enables exponential backoff via `msg.retry({ delaySeconds })` |
| DLQ | Automatic after max_retries | Same pattern as cost-event DLQ |

---

## Implementation Plan

### Sub-phase A: Queue Infrastructure + Dispatcher Rewrite (~half day)

**Goal:** Replace QStash with Queue in the dispatch path. Deploy and verify webhook delivery.

> **Re-evaluation gate:** Before starting, verify existing webhook smoke tests pass with QStash.

**Changes:**

1. **`wrangler.jsonc`** — Add webhook queue bindings:
   ```jsonc
   // In queues.producers:
   { "binding": "WEBHOOK_QUEUE", "queue": "nullspend-webhooks" }

   // In queues.consumers:
   {
     "queue": "nullspend-webhooks",
     "max_batch_size": 10,
     "max_batch_timeout": 2,
     "max_retries": 5,
     "dead_letter_queue": "nullspend-webhooks-dlq",
     "retry_delay": 10
   },
   {
     "queue": "nullspend-webhooks-dlq",
     "max_retries": 0
   }
   ```

2. **`lib/webhook-queue.ts`** — **NEW** — Queue message type + enqueue helper:
   ```typescript
   export interface WebhookQueueMessage {
     url: string;
     payload: string;         // pre-serialized JSON
     headers: Record<string, string>;  // includes signature, webhook-id, timestamp
     endpointId: string;      // for logging
     eventType: string;       // for logging
   }

   export async function enqueueWebhook(
     queue: Queue,
     message: WebhookQueueMessage,
   ): Promise<void> {
     await queue.send(message);
   }
   ```

3. **`lib/webhook-dispatch.ts`** — Rewrite `createWebhookDispatcher`:
   - Change parameter from `qstashToken: string` to `queue: Queue`
   - Replace `qstash.publishJSON()` with `enqueueWebhook(queue, msg)`
   - Keep all signing, event filtering, and header construction exactly the same
   - Keep `dispatchToEndpoints()` unchanged
   - Remove `@upstash/qstash` import

4. **`index.ts`** — Change dispatcher creation:
   ```typescript
   // Before:
   const webhookDispatcher = auth.hasWebhooks
     ? createWebhookDispatcher(env.QSTASH_TOKEN || undefined)
     : null;

   // After:
   const webhookDispatcher = auth.hasWebhooks
     ? createWebhookDispatcher(env.WEBHOOK_QUEUE || undefined)
     : null;
   ```

5. **`webhook-queue-handler.ts`** — **NEW** — Queue consumer (~50 lines):
   ```typescript
   export const WEBHOOK_QUEUE_NAME = "nullspend-webhooks";

   export async function handleWebhookQueue(
     batch: MessageBatch<WebhookQueueMessage>,
   ): Promise<void> {
     for (const msg of batch.messages) {
       try {
         const res = await fetch(msg.body.url, {
           method: "POST",
           headers: msg.body.headers,
           body: msg.body.payload,
           signal: AbortSignal.timeout(30_000),
         });

         if (res.ok) {
           msg.ack();
         } else if (res.status >= 500) {
           // Server error — retry with exponential backoff
           const delay = Math.min(10 * (2 ** (msg.attempts - 1)), 3600);
           msg.retry({ delaySeconds: delay });
         } else {
           // 4xx — permanent failure, don't retry
           msg.ack();
           console.error(`[webhook-queue] ${res.status} from ${msg.body.url}`);
         }
       } catch (err) {
         // Network error or timeout — retry
         const delay = Math.min(10 * (2 ** (msg.attempts - 1)), 3600);
         msg.retry({ delaySeconds: delay });
       }
     }
   }
   ```

6. **`webhook-dlq-handler.ts`** — **NEW** — DLQ consumer (~20 lines):
   ```typescript
   export const WEBHOOK_DLQ_NAME = "nullspend-webhooks-dlq";

   export async function handleWebhookDlq(
     batch: MessageBatch<WebhookQueueMessage>,
   ): Promise<void> {
     for (const msg of batch.messages) {
       console.error("[webhook-dlq] Permanently failed:", {
         url: msg.body.url,
         endpointId: msg.body.endpointId,
         eventType: msg.body.eventType,
         attempts: msg.attempts,
       });
       emitMetric("webhook_delivery_failed", {
         endpointId: msg.body.endpointId,
         eventType: msg.body.eventType,
       });
       msg.ack(); // always ack DLQ messages
     }
   }
   ```

7. **`index.ts` queue router** — Add webhook queue routing:
   ```typescript
   // In the queue() handler, add:
   if (batch.queue === WEBHOOK_QUEUE_NAME) {
     await handleWebhookQueue(batch);
   } else if (batch.queue === WEBHOOK_DLQ_NAME) {
     await handleWebhookDlq(batch);
   }
   ```

**Validation:**
- `pnpm typecheck` — clean
- `pnpm proxy:test` — passes (route handler tests use mock dispatcher, unaffected)
- Deploy to Cloudflare
- Manually trigger a webhook delivery and verify the endpoint receives it

---

### Sub-phase B: Tests + Dependency Removal (~half day)

**Goal:** Rewrite webhook-dispatch tests, remove QStash dependency, clean env files.

1. **`__tests__/webhook-dispatch.test.ts`** — Rewrite:
   - Remove `@upstash/qstash` mock
   - Mock `queue.send()` instead
   - Test same behaviors: event filtering, HMAC signing, header construction, rotation window
   - Test queue send failure handling

2. **`__tests__/webhook-queue-handler.test.ts`** — **NEW**:
   - Test successful delivery (fetch returns 200 → ack)
   - Test server error (fetch returns 500 → retry with backoff)
   - Test client error (fetch returns 400 → ack, permanent failure)
   - Test network error (fetch throws → retry)
   - Test timeout (AbortSignal fires → retry)

3. **`__tests__/webhook-dlq-handler.test.ts`** — **NEW**:
   - Test always-ack behavior
   - Test metric emission

4. **`package.json`** — Remove `@upstash/qstash`
5. **`.dev.vars.example`** — Remove `QSTASH_TOKEN`
6. **`worker-configuration.d.ts`** — Remove `QSTASH_TOKEN` from Env, add `WEBHOOK_QUEUE`
7. **`pnpm install`** — Update lockfile

**Validation:**
- `pnpm proxy:test` — all pass
- `pnpm typecheck` — clean
- `grep -r "qstash\|QStash" apps/proxy/src/` — zero matches

---

### Sub-phase C: Smoke Test + Documentation (~half day)

**Goal:** End-to-end verification with real webhook delivery. Update docs.

1. **Run webhook smoke tests** (if they exist) against the deployed proxy
2. **Create a test webhook endpoint** (e.g., webhook.site) and verify:
   - Webhook arrives with correct HMAC signature
   - Headers include `X-NullSpend-Signature`, `X-NullSpend-Webhook-Id`, `X-NullSpend-Webhook-Timestamp`
   - Payload matches expected event shape
   - Retry behavior works (intentionally return 500, verify retry arrives)

3. **Update documentation:**
   - `docs/api-reference/` — remove any QStash references
   - `apps/proxy/CLAUDE.md` — update webhook-dispatch description
   - `TESTING.md` — add webhook-queue-handler and webhook-dlq-handler to test table
   - `docs/internal/research/proxy-latency-optimization.md` — note QStash removed

4. **Update `lib/webhooks/invalidate-cache.ts`** (dashboard) — add TODO noting that webhook delivery is now Queue-based (no impact on invalidation, which is KV-based)

**Validation:**
- End-to-end webhook delivery confirmed
- All docs updated
- `grep -r "qstash\|QStash\|QSTASH" apps/proxy/` — zero matches (excluding historical docs)

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Queue consumer can't reach external URLs | Very Low | High | Verified via CF docs — consumers can `fetch()` external HTTPS. Same as any Worker. |
| Message too large | Very Low | Medium | Webhook payloads are 1-5 KB, limit is 128 KB. |
| Duplicate delivery | Medium | Low | At-least-once semantics. `X-NullSpend-Webhook-Id` enables consumer-side dedup. Industry standard (Stripe, GitHub). |
| Slow endpoint blocks consumer | Low | Low | 30s `AbortSignal.timeout` + 15 min wall clock limit. Even 10 serial slow endpoints take <2 min. |
| Queue send fails in waitUntil | Low | Low | Same risk as cost-event-queue. Fire-and-forget in waitUntil — failure doesn't affect the proxy response. |

## Files Changed Summary

| File | Action | Sub-phase |
|------|--------|-----------|
| `wrangler.jsonc` | Add webhook queue config | A |
| `lib/webhook-queue.ts` | **NEW** — message type + enqueue helper | A |
| `lib/webhook-dispatch.ts` | Rewrite — Queue instead of QStash | A |
| `webhook-queue-handler.ts` | **NEW** — consumer with fetch + retry | A |
| `webhook-dlq-handler.ts` | **NEW** — DLQ consumer | A |
| `index.ts` | Change dispatcher creation + add queue routing | A |
| `__tests__/webhook-dispatch.test.ts` | Rewrite for Queue mock | B |
| `__tests__/webhook-queue-handler.test.ts` | **NEW** | B |
| `__tests__/webhook-dlq-handler.test.ts` | **NEW** | B |
| `package.json` | Remove `@upstash/qstash` | B |
| `.dev.vars.example` | Remove `QSTASH_TOKEN` | B |
| `worker-configuration.d.ts` | Update Env type | B |
| Docs (4+ files) | Remove QStash references | C |

**Key invariant:** The `WebhookDispatcher` interface and `dispatchToEndpoints()` function are unchanged. The 14 test files that mock `ctx.webhookDispatcher` need zero changes. The 21 dispatch calls across 3 route handlers need zero changes.
