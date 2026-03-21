# Thin Webhook Events — Deep Research

**Created:** 2026-03-21
**Purpose:** Research industry patterns for thin vs fat webhook events to inform NullSpend's 2.2 implementation.
**Sources:** Stripe v2 API, Plaid, Brex, Lithic, Ramp, LiteLLM, Helicone, Portkey, Svix, Hookdeck, Convoy, CloudEvents, Standard Webhooks spec.

---

## Executive Summary

The industry is converging on **thin events for high-volume data, fat events for actionable alerts**. Stripe's v2 migration is the strongest signal — they operated fat webhooks at massive scale and concluded the versioning costs are unsustainable. However, every financial API (Brex, Lithic, Ramp) still uses fat/medium payloads for spend alerts because consumers need immediate context to act.

**Recommendation for NullSpend:** Implement per-endpoint `payload_mode` following Stripe's pattern. Apply thin mode only to `cost_event.*` events (high volume). Keep fat payloads for budget/velocity/session alerts (low volume, actionable). Include `related_object.url` in thin payloads so consumers know exactly where to fetch.

---

## Platform Comparison

| Platform | Pattern | Payload Size | Fetch-back? | Signing | Retries |
|----------|---------|-------------|------------|---------|---------|
| **Stripe v2** | Thin (notification-only) | ~200B | Yes — `GET /v2/core/events/{id}` or `related_object.url` | HMAC-SHA256 | 3 days exponential |
| **Stripe v1** | Fat (snapshot) | 2-10KB | No — full resource embedded | HMAC-SHA256 | 3 days exponential |
| **Plaid** | Thin | ~100B | Yes — `GET /transfer/event/sync` | JWK verification | 24h exponential (4x, starts 30s) |
| **Brex** | Fat (partial) | ~500B | No | Standard Webhooks HMAC-SHA256 (via Svix) | Via Svix (~42h) |
| **Lithic** | Fat | Full resource | No | HMAC-SHA256 (`id.timestamp.payload`) | 8 retries over ~42h |
| **Ramp** | Medium | ID + amount | Optional | HMAC-SHA256 | Unknown |
| **LiteLLM** | Fat (logging callback) | Full req+resp | No | None | None |
| **Helicone** | Hybrid (truncated + S3 URL) | 10KB cap + S3 link | Yes — signed S3 URL (30min expiry) | HMAC-SHA256 | None |
| **Portkey** | Budget alerts only | Undocumented | N/A | Undocumented | None |
| **NullSpend (current)** | Fat | ~1-2KB | No | HMAC-SHA256 + dual-signing rotation | QStash retry |

---

## Stripe v2 Thin Events — Detailed Analysis

### Thin event payload structure

```json
{
  "id": "evt_test_65UIRNU7G1XbhCfOim...",
  "object": "v2.core.event",
  "type": "v2.core.account.updated",
  "created": "2026-03-09T13:00:28.435Z",
  "reason": {
    "type": "request",
    "request": { "id": "req_v2y9y15XqG3Futmjg" }
  },
  "related_object": {
    "id": "acct_1T93Q4Pmpb34Vto6",
    "type": "v2.core.account",
    "url": "/v2/core/accounts/acct_1T93Q4Pmpb34Vto6"
  }
}
```

### Fat/snapshot event payload (v1, being phased out)

```json
{
  "id": "evt_1NG8Du2eZvKYlo2CUI79vXWy",
  "object": "event",
  "api_version": "2019-02-19",
  "created": 1686089970,
  "data": {
    "object": { /* FULL resource snapshot — every field */ }
  },
  "type": "setup_intent.created"
}
```

### Why Stripe moved to thin events

1. **Stale data** — snapshot payloads embed state at creation time. By the time consumers process (seconds to minutes, longer on retries), the object may have changed. Acting on stale financial data causes bugs.
2. **API versioning nightmare** — `api_version` on the account determines the shape of `data.object`. Upgrading API version changes future webhook shapes. Thin events are **unversioned** — the notification shape never changes.
3. **Type safety** — v1 `data.object` is untyped (generic dict). v2 thin events have typed SDK classes per event type.

### Per-destination configuration

Stripe configures thin vs snapshot at the **endpoint level** via `event_payload` enum:

```json
{
  "name": "My Event Destination",
  "type": "webhook_endpoint",
  "event_payload": "thin",
  "enabled_events": ["v1.billing.meter.error_report_triggered"],
  "webhook_endpoint": { "url": "https://example.com/webhook" }
}
```

All events to a thin endpoint are thin. No mixed formats.

### Three consumer processing tiers

| Tier | Action | When to use |
|------|--------|-------------|
| **Immediate** | Act on event type + ID alone | "Budget X was exceeded" — just need the fact |
| **Fetch event** | `GET /v2/core/events/{id}` → historical state | Need to know what changed and when |
| **Fetch object** | `event.fetchRelatedObject()` → current state | Need the latest data for processing |

### Rollout status

Thin events are **not yet available for all event types**. Available for `v2.core.account.*`, `v1.billing.meter.*`, and a growing subset. The vast majority of Stripe's ~200+ v1 event types are still snapshot-only. Stripe is migrating incrementally.

---

## Financial API Patterns — Split by Use Case

The research reveals a clear split across financial APIs:

| Use Case | Volume | Pattern | Examples |
|----------|--------|---------|----------|
| **Latency-critical decisions** (card auth, real-time blocking) | Variable | **Fat** | Lithic embeds full transaction because the card network is waiting |
| **Informational/accounting events** (transaction sync, balance updates) | High | **Thin** | Plaid sends just IDs — you should always fetch current financial data |
| **Spend management alerts** (budget exceeded, threshold crossed) | Low | **Fat/Medium** | Brex/Ramp include amount + status for immediate alerting |

**Implication for NullSpend:** Cost events are informational/accounting (high volume, thin is appropriate). Budget/velocity alerts are spend management alerts (low volume, fat is appropriate).

---

## Webhook Best Practices — Industry Consensus

### From Hookdeck, Svix, Convoy, Standard Webhooks

**Thin vs fat — the emerging consensus is hybrid:**
- Include fields consumers need for **immediate routing and decision-making** in the payload
- Leave the full resource fetchable via API
- Keep payloads under 20KB (Standard Webhooks recommendation)

**Thin events pros:**
- Always-current data (consumer fetches latest state)
- Naturally handles out-of-order delivery
- Simplifies idempotency (duplicate events are harmless — same fetch result)
- Stable webhook payload shape (unversioned)
- Smaller payloads, reduced data exposure

**Thin events cons:**
- Requires additional API call per event (rate limit risk)
- Consumer complexity (fetch-before-process pattern)
- Doesn't work for deletion events (resource is gone)
- Requires provider API to be available at processing time

**Key Hookdeck warning:** "fetching the resource for each event can quickly exceed the provider's API rate limits" at scale. Recommendation: use a queue between webhook receipt and fetch-back with throttling.

### Payload envelope best practices

From Hookdeck and Standard Webhooks:

```json
{
  "id": "unique-event-id",
  "type": "resource.action",
  "timestamp": "2026-03-21T...",
  "data": { /* event-specific payload */ }
}
```

- **Separate infrastructure metadata (id, type, timestamp) from business data (nested in `data`)**
- **Dot-notation event naming** (`resource.action`) — lets consumers predict event names
- **Deterministic event IDs** derived from content (not random UUIDs) for natural deduplication
- **Additive-only versioning** — never remove or rename fields, only add

### Standard Webhooks spec (authored by Svix)

Required headers:
- `webhook-id` — unique message identifier
- `webhook-timestamp` — Unix timestamp (seconds)
- `webhook-signature` — `v1,<base64-hmac-sha256>`

Signed content: `msg_id.timestamp.payload`

NullSpend already uses HMAC-SHA256 with custom headers — consider aligning with Standard Webhooks headers for ecosystem compatibility.

---

## CloudEvents Specification

CNCF graduated project (Jan 2024). Mandates:

| Field | Type | Required? |
|-------|------|-----------|
| `id` | string | Yes |
| `source` | URI-reference | Yes |
| `specversion` | string (`"1.0"`) | Yes |
| `type` | string | Yes |
| `time` | RFC 3339 | Optional |
| `data` | any | Optional |

CloudEvents explicitly recommends thin events: *"publishers should keep events compact by avoiding embedding large data items into event payloads and rather use the event payload to link to such data items."*

**Adoption:** Azure Event Grid, Knative, SAP Kyma, Intuit (mandating by May 2026). But most B2B SaaS (Stripe, Brex, Plaid) use custom envelopes. **Not recommended for NullSpend now** — stick with the Stripe-compatible envelope that developers already know.

---

## AI/FinOps Competitor Gap Analysis

| Capability | NullSpend (current) | LiteLLM | Helicone | Portkey |
|-----------|---------------------|---------|----------|---------|
| Event types | 14 types (cost, budget, velocity, session, threshold, blocked, test) | 2 (success/failure) + budget alerts to Slack | 1 (request complete) | Budget alerts only |
| Thin mode | Not yet | No | Hybrid (truncated + S3 URL) | N/A |
| HMAC signing | Yes (dual-signing with rotation) | No | Yes | Undocumented |
| Retries | Yes (QStash) | No | No | No |
| Event type filtering | Yes (per-endpoint) | No | Property-based | N/A |
| Batching | No | Yes (configurable batch_size) | No | N/A |

**NullSpend already has the most comprehensive webhook system in the AI proxy space.** Adding thin mode extends the lead further. No competitor offers thin events.

---

## Design Recommendations for NullSpend 2.2

### Architecture

1. **Per-endpoint `payload_mode`** — follow Stripe. Add `payload_mode text DEFAULT 'full'` to `webhook_endpoints`. All events to a thin endpoint use thin format. No mixed formats per endpoint.

2. **Thin mode applies only to `cost_event.*` events.** Budget/velocity/session/threshold/blocked events deliver full payloads regardless of endpoint mode. These are low-volume, actionable alerts where consumers need immediate context.

3. **Thin payload structure:**

```json
{
  "id": "ns_whevt_<uuid>",
  "type": "cost_event.created",
  "api_version": "2025-03-20",
  "created_at": "2026-03-21T...",
  "related_object": {
    "id": "ns_evt_<uuid>",
    "type": "cost_event",
    "url": "/api/cost-events/ns_evt_<uuid>"
  }
}
```

4. **Build `GET /api/cost-events/{id}` fetch-back endpoint.** Without it, thin mode is unusable. Auth check: verify the requesting user owns the cost event (via api_key_id).

5. **Don't build the delta/changes pattern.** Mostly "created" events, not updates. Not worth the complexity now.

### What NOT to do

- Don't adopt CloudEvents envelope — low adoption in B2B SaaS, developers expect Stripe-style
- Don't make thin mode per-event-type — per-endpoint is simpler and matches Stripe
- Don't batch webhooks — individual delivery is the industry standard for webhooks (batching is for logging callbacks like LiteLLM)
- Don't build thin mode for budget alerts — low volume, consumers need the data inline

### Effort estimate

~4-6 hours:

| Step | Effort |
|------|--------|
| Migration + schema (`payload_mode` column) | 25min |
| Validation schemas | 15min |
| Webhook CRUD API update | 30min |
| Thin payload builder + dispatch logic (both dispatchers) | 75min |
| `GET /api/cost-events/{id}` endpoint | 45min |
| Tests (schema, dispatch, payload, endpoint) | 90min |

---

## Sources

- [Stripe: Event Destinations (v2)](https://docs.stripe.com/event-destinations)
- [Stripe: v2 Events API](https://docs.stripe.com/api/v2/core/events)
- [Stripe: Migrate Snapshot to Thin Events](https://docs.stripe.com/webhooks/migrate-snapshot-to-thin-events)
- [Plaid: Webhooks API](https://plaid.com/docs/api/webhooks/)
- [Brex: Webhooks](https://developer.brex.com/docs/webhooks/)
- [Brex: Webhook Examples](https://developer.brex.com/docs/webhook_examples/)
- [Lithic: Events API](https://docs.lithic.com/docs/events-api)
- [Ramp: Webhooks](https://docs.ramp.com/developer-api/v1/webhooks)
- [LiteLLM: Generic API Callback](https://docs.litellm.ai/docs/observability/generic_api)
- [LiteLLM: Alerting](https://docs.litellm.ai/docs/proxy/alerting)
- [Helicone: Webhooks](https://docs.helicone.ai/features/webhooks)
- [Portkey: Budget Limits](https://portkey.ai/docs/product/administration/enforce-workspace-budget-limts-and-rate-limits)
- [Svix: Overview](https://docs.svix.com/overview)
- [Svix: Webhook Versioning](https://www.svix.com/blog/webhook-versioning/)
- [Svix: Best Practices - Sending](https://www.svix.com/resources/webhook-best-practices/sending/)
- [Svix + Brex Case Study](https://www.svix.com/customers/brex/)
- [Standard Webhooks Spec](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md)
- [Hookdeck: What Are Thin Events?](https://hookdeck.com/webhooks/guides/what-are-thin-events)
- [Hookdeck: Webhook Payload Best Practices](https://hookdeck.com/outpost/guides/webhook-payload-best-practices)
- [Hookdeck: Webhooks at Scale](https://hookdeck.com/blog/webhooks-at-scale)
- [Convoy: Best Practices for Generating Webhook Events](https://docs.getconvoy.io/guides/best-practices-for-generating-webhook-events)
- [CloudEvents Specification](https://github.com/cloudevents/spec/blob/main/cloudevents/spec.md)
