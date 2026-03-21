# NullSpend Webhook Event Stream — Technical Outline

## Overview

Every cost event, budget threshold breach, and enforcement action fires a
signed webhook to customer-configured endpoints. Customers use this to build
Slack alerts, PagerDuty integrations, accounting pipelines, and custom
dashboards without NullSpend building any of those.

**Design philosophy:** NullSpend is the event source. The webhook is the
platform primitive. Everything else — Slack, email, PagerDuty — is built by
the customer or by us later on top of webhooks. Ship the pipe, not the
faucets.

**Key architectural decision: Use Upstash QStash as the delivery engine.**

QStash is already in our stack (we use Upstash Redis). It's designed for
CF Workers (HTTP-based, no TCP connections needed). It handles retries with
exponential backoff, dead letter queues, signature verification, and
guaranteed at-least-once delivery — all managed. $1 per 100K messages.
We don't build retry infrastructure. We don't manage delivery queues. We
publish to QStash, QStash delivers to the customer's endpoint.

This is the Svix pattern (Brex uses Svix for their webhooks) without the
Svix dependency. QStash gives us the delivery guarantees; we build the
event schema, signing, configuration, and logging ourselves.

---

## Architecture

```
Cost Event Created (proxy waitUntil / MCP batcher)
  │
  ├──→ Postgres (cost_events table) — existing flow, unchanged
  │
  └──→ Webhook Dispatcher (new)
        │
        ├── Look up webhook endpoints for this user (Redis-cached)
        ├── Build signed event payload
        └── Publish to QStash → QStash delivers to customer endpoint
                                  ├── Success (2xx) → done
                                  ├── Failure → QStash retries (exponential backoff)
                                  └── Exhausted → Dead Letter Queue → dashboard shows failure
```

The webhook dispatch happens in the same `waitUntil()` block as the cost
event insert. No new infrastructure. No new workers. No new cron jobs.

---

## Database Schema

### Migration: `drizzle/0017_webhook_endpoints.sql`

```sql
-- Webhook endpoint configuration
CREATE TABLE webhook_endpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  url TEXT NOT NULL,
  description TEXT,                           -- "Slack cost alerts", "PagerDuty", etc.
  signing_secret TEXT NOT NULL,               -- HMAC-SHA256 secret, generated server-side
  event_types TEXT[] NOT NULL DEFAULT '{}',   -- empty = all events, or specific types
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX webhook_endpoints_user_id_idx ON webhook_endpoints (user_id);

-- Delivery log (recent attempts for dashboard visibility)
CREATE TABLE webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id UUID NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  event_id TEXT NOT NULL,                     -- matches cost_events.request_id or internal event ID
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'delivered', 'failed', 'exhausted')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  response_status INTEGER,                    -- HTTP status from customer endpoint
  response_body_preview TEXT,                 -- first 200 chars of response (for debugging)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX webhook_deliveries_endpoint_id_idx
  ON webhook_deliveries (endpoint_id, created_at DESC);
CREATE INDEX webhook_deliveries_event_id_idx
  ON webhook_deliveries (event_id);
```

### Drizzle schema: `packages/db/src/schema.ts`

```typescript
export const webhookEndpoints = pgTable("webhook_endpoints", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull(),
  url: text("url").notNull(),
  description: text("description"),
  signingSecret: text("signing_secret").notNull(),
  eventTypes: text("event_types").array().notNull().default([]),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("webhook_endpoints_user_id_idx").on(table.userId),
]);

export const webhookDeliveries = pgTable("webhook_deliveries", {
  id: uuid("id").defaultRandom().primaryKey(),
  endpointId: uuid("endpoint_id").notNull()
    .references(() => webhookEndpoints.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  eventId: text("event_id").notNull(),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  responseStatus: integer("response_status"),
  responseBodyPreview: text("response_body_preview"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("webhook_deliveries_endpoint_id_idx").on(table.endpointId, table.createdAt),
  index("webhook_deliveries_event_id_idx").on(table.eventId),
]);
```

---

## Event Types

Start with a small, concrete set. Expand based on customer requests.

```typescript
type WebhookEventType =
  // Cost events (fired on every proxied request)
  | "cost_event.created"

  // Budget events (fired on threshold crossings)
  | "budget.threshold.warning"    // 50%, 80% of budget used
  | "budget.threshold.critical"   // 90%, 95% of budget used
  | "budget.exceeded"             // request blocked by budget

  // Enforcement events
  | "velocity.exceeded"           // velocity limit tripped, cooldown started
  | "velocity.recovered"          // velocity cooldown expired, requests resumed
  | "session.limit_exceeded"      // session spend exceeded per-session limit
  | "request.blocked"             // enforcement check denied request (reason in data.object.reason)
  | "budget.reset"                // budget period reset
  | "action.created"              // HITL action created
  | "action.approved"             // HITL action approved
  | "action.rejected"             // HITL action rejected
  | "action.expired"              // HITL action expired
  | "test.ping"                   // test webhook event
```

Customers configure which event types each endpoint receives. Empty array
means all events. This lets them send cost events to a data warehouse
endpoint and budget alerts to a Slack webhook — different endpoints for
different purposes.

---

## Event Payload Schema

Follow the Stripe/Svix standard: consistent envelope with typed data.

```typescript
interface WebhookEvent {
  id: string;                    // unique event ID (UUID)
  type: WebhookEventType;        // "cost_event.created", "budget.exceeded", etc.
  created_at: string;            // ISO 8601 timestamp
  data: Record<string, unknown>; // event-specific payload
}
```

### `cost_event.created` payload

```json
{
  "id": "evt_a1b2c3d4",
  "type": "cost_event.created",
  "created_at": "2026-03-16T14:23:01.000Z",
  "data": {
    "request_id": "req_xyz789",
    "event_type": "llm",
    "provider": "openai",
    "model": "gpt-4o",
    "input_tokens": 1250,
    "output_tokens": 340,
    "cached_input_tokens": 0,
    "cost_microdollars": 28500,
    "cost_dollars": 0.0285,
    "duration_ms": 2340,
    "upstream_duration_ms": 2310,
    "session_id": "refactor-auth",
    "tool_calls_requested": [
      { "name": "search_docs", "id": "call_abc" }
    ],
    "tool_definition_tokens": 1200,
    "api_key_id": "key_xxx",
    "created_at": "2026-03-16T14:23:01.000Z"
  }
}
```

### `budget.exceeded` payload

```json
{
  "id": "evt_e5f6g7h8",
  "type": "budget.exceeded",
  "created_at": "2026-03-16T14:23:01.000Z",
  "data": {
    "budget_entity_type": "api_key",
    "budget_entity_id": "key_xxx",
    "budget_limit_microdollars": 50000000,
    "budget_spend_microdollars": 48200000,
    "estimated_request_cost_microdollars": 3500000,
    "model": "gpt-4o",
    "provider": "openai",
    "blocked_at": "2026-03-16T14:23:01.000Z"
  }
}
```

### `budget.threshold.warning` payload

```json
{
  "id": "evt_i9j0k1l2",
  "type": "budget.threshold.warning",
  "created_at": "2026-03-16T14:23:01.000Z",
  "data": {
    "budget_entity_type": "user",
    "budget_entity_id": "user_abc",
    "budget_limit_microdollars": 50000000,
    "budget_spend_microdollars": 40100000,
    "threshold_percent": 80,
    "budget_remaining_microdollars": 9900000,
    "triggered_by_request_id": "req_xyz789"
  }
}
```

### Design notes on payload

Include `cost_dollars` alongside `cost_microdollars` for human readability.
Customers building Slack integrations don't want to divide by 1,000,000 in
their webhook handler.

Use snake_case for all payload fields (Stripe convention, most widely
expected).

Never include prompt content, response content, or API keys in webhook
payloads. Only metadata, costs, and identifiers.

---

## Webhook Signing (HMAC-SHA256)

Follow the Stripe standard exactly. Developers who've integrated Stripe
webhooks will recognize the pattern immediately.

### Signature generation

```typescript
// apps/proxy/src/lib/webhook-signer.ts

import { webcrypto } from "node:crypto"; // or Web Crypto API in Workers

const SIGNATURE_VERSION = "v1";

export async function signWebhookPayload(
  payload: string,
  secret: string,
  timestamp: number,
): Promise<string> {
  const signedContent = `${timestamp}.${payload}`;
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(signedContent),
  );

  const hex = [...new Uint8Array(signature)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return `t=${timestamp},${SIGNATURE_VERSION}=${hex}`;
}
```

### Headers sent with each webhook

```
X-NullSpend-Signature: t=1710612181,v1=5257a869...
X-NullSpend-Webhook-Id: evt_a1b2c3d4
X-NullSpend-Webhook-Timestamp: 1710612181
Content-Type: application/json
User-Agent: NullSpend-Webhooks/1.0
```

- `X-NullSpend-Webhook-Id` is the event ID (stable across retries —
  enables deduplication on the customer side)
- `X-NullSpend-Webhook-Timestamp` is the Unix timestamp (for replay
  attack prevention — customer should reject events older than 5 minutes)
- `X-NullSpend-Signature` contains timestamp + HMAC (Stripe format)

### Secret generation

When a customer creates a webhook endpoint, generate a 32-byte random
secret and store it hashed in the database. Display the raw secret to the
customer once (like an API key).

```typescript
const secret = `whsec_${crypto.randomUUID().replace(/-/g, "")}`;
// Store in webhook_endpoints.signing_secret
// Show to customer once, they copy it to their server config
```

---

## Webhook Dispatch (QStash Integration)

### Publishing events to QStash

```typescript
// apps/proxy/src/lib/webhook-dispatch.ts

import { Client } from "@upstash/qstash";

interface WebhookDispatchConfig {
  qstashToken: string;
}

export class WebhookDispatcher {
  private qstash: Client;

  constructor(config: WebhookDispatchConfig) {
    this.qstash = new Client({ token: config.qstashToken });
  }

  async dispatch(
    endpoint: WebhookEndpoint,
    event: WebhookEvent,
  ): Promise<void> {
    // Check event type filter
    if (
      endpoint.eventTypes.length > 0 &&
      !endpoint.eventTypes.includes(event.type)
    ) {
      return; // endpoint not subscribed to this event type
    }

    const payload = JSON.stringify(event);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = await signWebhookPayload(
      payload,
      endpoint.signingSecret,
      timestamp,
    );

    await this.qstash.publishJSON({
      url: endpoint.url,
      body: event,
      headers: {
        "X-NullSpend-Signature": signature,
        "X-NullSpend-Webhook-Id": event.id,
        "X-NullSpend-Webhook-Timestamp": String(timestamp),
        "User-Agent": "NullSpend-Webhooks/1.0",
      },
      retries: 5,
      // QStash callback: when delivery succeeds or is exhausted,
      // QStash calls our callback endpoint to update delivery status
      callback: `${NULLSPEND_GATEWAY_URL}/v1/internal/webhook-callback`,
      failureCallback: `${NULLSPEND_GATEWAY_URL}/v1/internal/webhook-failure`,
    });
  }
}
```

### QStash handles:
- **Retries**: 5 attempts with exponential backoff (configurable)
- **Timeout**: 15-second response window per attempt
- **DLQ**: Failed messages go to dead letter queue for inspection
- **Deduplication**: Built-in dedup by message ID
- **Signature**: QStash signs its own messages to our callback endpoints

### Callback endpoints (delivery status tracking)

Add two internal routes to the proxy for QStash callbacks:

```typescript
// POST /v1/internal/webhook-callback — delivery succeeded
// POST /v1/internal/webhook-failure  — delivery exhausted (all retries failed)
```

These update the `webhook_deliveries` table with status, attempt count,
and response info. They're called by QStash, not by customers, and should
verify QStash's own signature before processing.

---

## Endpoint Lookup Caching

Webhook endpoints change rarely (created once, maybe updated monthly).
Cache them aggressively to avoid a Postgres round-trip on every cost event.

```typescript
// Redis cache key: webhooks:user:{userId}
// Value: JSON array of active endpoints
// TTL: 300 seconds (5 minutes)

async function getWebhookEndpoints(
  redis: Redis,
  connectionString: string,
  userId: string,
): Promise<WebhookEndpoint[]> {
  const cacheKey = `webhooks:user:${userId}`;
  const cached = await redis.get<WebhookEndpoint[]>(cacheKey);
  if (cached) return cached;

  // Cache miss: query Postgres
  const endpoints = await queryActiveEndpoints(connectionString, userId);
  await redis.set(cacheKey, JSON.stringify(endpoints), { ex: 300 });
  return endpoints;
}
```

When an endpoint is created, updated, or deleted via the dashboard API,
invalidate the cache:

```typescript
await redis.del(`webhooks:user:${userId}`);
```

---

## Integration into Existing Proxy Flow

### In LLM route handlers (openai.ts, anthropic.ts)

Add webhook dispatch to the existing `waitUntil()` block, after cost event
logging:

```typescript
waitUntil(
  resultPromise.then(async (result) => {
    // ... existing cost calculation and logging ...

    await logCostEvent(connectionString, { ...costEvent, ...enrichment });

    // NEW: dispatch webhook
    if (webhookDispatcher) {
      const endpoints = await getWebhookEndpoints(redis, connectionString, ctx.auth.userId);
      if (endpoints.length > 0) {
        const event = buildCostEventWebhook(costEvent, enrichment);
        for (const endpoint of endpoints) {
          await webhookDispatcher.dispatch(endpoint, event);
        }
      }
    }

    // Budget threshold check — fire threshold events
    if (budgetEntities.length > 0) {
      const thresholdEvents = checkBudgetThresholds(budgetEntities, costEvent);
      for (const thresholdEvent of thresholdEvents) {
        for (const endpoint of endpoints) {
          await webhookDispatcher.dispatch(endpoint, thresholdEvent);
        }
      }
    }

    // ... existing reconciliation ...
  }),
);
```

### In budget denial responses (openai.ts, anthropic.ts)

When a request is blocked by budget enforcement, dispatch a
`budget.exceeded` webhook before returning the 429:

```typescript
if (checkResult.status === "denied") {
  // Fire webhook for budget exceeded (in waitUntil, non-blocking)
  waitUntil(async () => {
    if (webhookDispatcher) {
      const endpoints = await getWebhookEndpoints(...);
      const event = buildBudgetExceededWebhook(checkResult, requestModel, ...);
      for (const endpoint of endpoints) {
        await webhookDispatcher.dispatch(endpoint, event);
      }
    }
  });

  return errorResponse("budget_exceeded", "...", 429);
}
```

### In MCP events handler (mcp.ts)

Same pattern — after batch inserting cost events, dispatch webhooks for
each event.

---

## Budget Threshold Detection

Track threshold crossings to avoid duplicate alerts. Use Redis to store
the last threshold level that was alerted:

```typescript
// Redis key: budget:threshold:{entityKey}
// Value: last threshold percent that triggered an alert (e.g., 80)
// TTL: same as budget cache TTL

const THRESHOLDS = [50, 80, 90, 95];

async function checkBudgetThresholds(
  redis: Redis,
  budgetEntities: BudgetEntity[],
  costEvent: CostEventInsert,
): Promise<WebhookEvent[]> {
  const events: WebhookEvent[] = [];

  for (const entity of budgetEntities) {
    const usedPercent = Math.floor(
      ((entity.spend + costEvent.costMicrodollars) / entity.maxBudget) * 100
    );

    const thresholdKey = `budget:threshold:${entity.entityKey}`;
    const lastAlerted = await redis.get<number>(thresholdKey) ?? 0;

    // Find the highest threshold we've crossed that hasn't been alerted
    const newThreshold = THRESHOLDS
      .filter((t) => usedPercent >= t && t > lastAlerted)
      .at(-1);

    if (newThreshold) {
      await redis.set(thresholdKey, newThreshold, { ex: 86400 }); // 24h TTL

      events.push({
        id: `evt_${crypto.randomUUID()}`,
        type: newThreshold >= 90
          ? "budget.threshold.critical"
          : "budget.threshold.warning",
        created_at: new Date().toISOString(),
        data: {
          budget_entity_type: entity.entityType,
          budget_entity_id: entity.entityId,
          budget_limit_microdollars: entity.maxBudget,
          budget_spend_microdollars: entity.spend + costEvent.costMicrodollars,
          threshold_percent: newThreshold,
          budget_remaining_microdollars:
            entity.maxBudget - entity.spend - costEvent.costMicrodollars,
          triggered_by_request_id: costEvent.requestId,
        },
      });
    }
  }

  return events;
}
```

Threshold state resets when the budget period resets (daily/monthly). The
Redis TTL of 24h handles daily budgets. For monthly budgets, set TTL to
match the budget period.

---

## Dashboard API

### `POST /api/webhooks` — Create endpoint

```typescript
// Request
{
  "url": "https://hooks.slack.com/services/xxx",
  "description": "Slack cost alerts",
  "event_types": ["budget.threshold.warning", "budget.exceeded"]
}

// Response
{
  "id": "wh_abc123",
  "url": "https://hooks.slack.com/services/xxx",
  "signing_secret": "whsec_a1b2c3d4e5f6...",  // shown ONCE
  "event_types": ["budget.threshold.warning", "budget.exceeded"],
  "enabled": true,
  "created_at": "2026-03-16T00:00:00Z"
}
```

### `GET /api/webhooks` — List endpoints

Returns all endpoints for the authenticated user. Signing secret is NOT
returned (it's shown only on creation).

### `PATCH /api/webhooks/:id` — Update endpoint

Update URL, description, event_types, or enabled status. Invalidate Redis
cache on update.

### `DELETE /api/webhooks/:id` — Delete endpoint

Soft-delete or hard-delete. Invalidate Redis cache.

### `GET /api/webhooks/:id/deliveries` — Delivery log

Returns recent delivery attempts for an endpoint, ordered by newest first.
Includes status, attempt count, response status, and response body
preview. Paginated.

### `POST /api/webhooks/:id/test` — Send test event

Generates a synthetic `cost_event.created` event with fake data and sends
it to the endpoint. Useful for customers to verify their endpoint is
working before enabling it for real events.

### `POST /api/webhooks/:id/rotate-secret` — Rotate signing secret

Generates a new signing secret. Returns the new secret (shown once). The
old secret remains valid for 24 hours (transition period — Stripe/Svix
pattern). During the transition, both secrets generate valid signatures.

---

## Dashboard UI

### Settings → Webhooks page

- List of configured endpoints with URL, description, event types, and
  enabled/disabled toggle
- "Create endpoint" button → modal with URL, description, event type
  checkboxes
- Signing secret shown once on creation with copy button
- Per-endpoint delivery log (last 50 deliveries with status indicators)
- "Send test event" button per endpoint
- "Rotate secret" button with confirmation dialog

### Activity page enhancement

Add a small webhook indicator on cost events that triggered webhooks.
"Webhook sent ✓" or "Webhook failed ✗" with link to delivery details.

---

## Environment Variables

```
# Upstash QStash (add to CF Workers env / wrangler.toml)
QSTASH_TOKEN=           # from Upstash Console → QStash
QSTASH_CURRENT_SIGNING_KEY=  # for verifying QStash callback signatures
QSTASH_NEXT_SIGNING_KEY=     # for key rotation
```

---

## Implementation Order

1. **Schema migration** (0017) + Drizzle types — 1 hour
2. **Dashboard CRUD API** (create, list, update, delete endpoints) — 3 hours
3. **Webhook signing** (HMAC-SHA256, Web Crypto API) — 1 hour
4. **Webhook dispatcher** (QStash integration) — 2 hours
5. **Integration into proxy** (waitUntil dispatch in openai/anthropic/mcp) — 2 hours
6. **Budget threshold detection** (Redis state, threshold events) — 2 hours
7. **Callback endpoints** (delivery status tracking from QStash) — 1 hour
8. **Dashboard UI** (endpoints list, delivery log, test button) — 3 hours
9. **Test endpoint** (send synthetic event) — 30 min
10. **Secret rotation** (24h transition period) — 1 hour

**Total estimated effort: ~2 days**

---

## What We're NOT Building

- **Slack integration** — customers point their webhook at Slack's incoming
  webhook URL directly, or build a small adapter
- **Email notifications** — separate feature, not part of webhook system
- **Event replay/recovery UI** — QStash DLQ handles failed messages; we
  add a dashboard view for it later if customers ask
- **Webhook transformation/filtering beyond event types** — keep it simple;
  customers filter in their handler
- **Batching multiple events into one webhook call** — each event is one
  webhook; simpler for customers to handle
- **WebSocket/SSE streaming alternative** — webhooks are the right
  primitive for server-to-server; the dashboard uses polling for real-time

---

## Testing Strategy

### Unit tests
- Webhook signing: verify HMAC output matches expected signature
- Event type filtering: verify endpoints only receive subscribed events
- Budget threshold detection: verify threshold crossing logic, no duplicate
  alerts, reset behavior
- Payload schema: verify all event types produce valid payloads

### Integration tests
- Create endpoint → send test event → verify delivery logged
- Budget enforcement denial → verify `budget.exceeded` webhook fired
- Threshold crossing → verify `budget.threshold.warning` fired once (not
  on every subsequent request)
- Secret rotation → verify both old and new secrets produce valid
  signatures during transition

### Manual testing
- Create a webhook endpoint pointing to https://webhook.site (free testing
  tool)
- Send real requests through the proxy
- Verify events appear on webhook.site with correct signatures
- Verify budget threshold alerts fire at correct percentages

---

## Security Considerations

- **Never include prompt or response content** in webhook payloads
- **Signing secrets are stored encrypted** in Postgres (or at minimum,
  treated as sensitive — never returned in list/get responses after
  creation)
- **Validate endpoint URLs**: reject private IPs (10.x, 172.16-31.x,
  192.168.x, 127.x, 169.254.x), localhost, and non-HTTPS URLs
- **Rate limit webhook creation**: max 10 endpoints per user (prevents
  abuse)
- **QStash callback verification**: verify QStash's own signature on
  callback/failure endpoints to prevent spoofed delivery status updates
- **24-hour secret rotation window**: during rotation, sign with both
  old and new secrets; customer verifies against either

---

## Future Extensions (not in this build)

- **Email digest**: daily/weekly summary email built on top of webhook
  events (subscribe an internal endpoint that aggregates and sends email)
- **Slack bot**: NullSpend Slack app with slash commands and formatted
  alert messages (built on top of webhooks)
- **Event replay**: re-send all events from a time window to an endpoint
  (useful for customers who had endpoint downtime)
- **Webhook logs retention policy**: auto-delete delivery logs older than
  30 days (currently unbounded)
- **Cost event batching**: group multiple cost events into a single
  webhook for high-volume customers (reduce webhook volume)
