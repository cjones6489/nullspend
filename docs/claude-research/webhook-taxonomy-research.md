# Webhook Event Taxonomy & DX Research

> **Date:** 2026-03-18 19:30 UTC
> **Method:** 3 parallel research agents — taxonomy patterns (Stripe, OpenAI, GitHub, Svix, CloudEvents), webhook bugs/DX issues, NullSpend current state analysis.
> **Purpose:** Lock the webhook event taxonomy before launch. Once external consumers parse these events, the shape is permanent.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Industry Patterns](#2-industry-patterns)
3. [NullSpend Current State](#3-nullspend-current-state)
4. [Recommended Event Taxonomy](#4-recommended-event-taxonomy)
5. [Event Envelope Design](#5-event-envelope-design)
6. [Versioning Strategy](#6-versioning-strategy)
7. [DX Pitfalls to Avoid](#7-dx-pitfalls-to-avoid)
8. [Security Considerations](#8-security-considerations)
9. [Delivery Reliability](#9-delivery-reliability)
10. [Implementation Gaps](#10-implementation-gaps)
11. [References](#11-references)

---

## 1. Executive Summary

**NullSpend's webhook infrastructure is already built** at the protocol level (~50+ tests, HMAC-SHA256 signing, QStash delivery, SSRF protection). The gaps are:

1. **`api_version` field missing** from the event envelope
2. **Event taxonomy incomplete** — 6 types exist; need HITL action lifecycle + api_key events
3. **Phase WH-2 not wired** — infrastructure exists but events don't fire from proxy routes
4. **No delivery retries** — current dispatch is fire-and-forget; if consumer is down, event is lost
5. **No dual-signing for secret rotation** — instant swap with no transition window

**Design decision confirmed by research:** Follow Stripe's `resource.action` pattern exactly. NullSpend's existing events already comply. Do NOT adopt CloudEvents (too verbose for developer-facing webhooks).

---

## 2. Industry Patterns

### Event Type Naming — Stripe is the Standard

Every major platform (Stripe ~471 types, OpenAI, Svix) uses:

```
resource.action           # budget.exceeded
resource.sub_type.action  # budget.threshold.warning (max 3 levels)
```

| Rule | Correct | Incorrect |
|---|---|---|
| Period-delimited | `budget.exceeded` | `budget-exceeded`, `budget_exceeded` |
| Singular resource | `cost_event.created` | `cost_events.created` |
| Past tense (completed) | `.created`, `.approved`, `.failed` | `.create`, `.approve` |
| Present tense (ongoing) | `.pending`, `.processing` | Only for in-progress states |
| snake_case multi-word | `cost_event`, `api_key` | `costEvent`, `apiKey` |
| Lowercase | `budget.exceeded` | `BUDGET_EXCEEDED`, `Budget.Exceeded` |

### Event Envelope — Stripe + Standard Webhooks Hybrid

**Stripe's envelope:**
```json
{
  "id": "evt_1MqItR",
  "object": "event",
  "api_version": "2023-10-16",
  "created": 1680064028,
  "type": "invoice.payment_succeeded",
  "livemode": false,
  "data": {
    "object": { /* resource snapshot */ },
    "previous_attributes": { "status": "open" }
  }
}
```

**OpenAI's envelope (lighter):**
```json
{
  "object": "event",
  "id": "evt_685343a1",
  "type": "response.completed",
  "created_at": 1750287018,
  "data": { "id": "resp_abc123" }
}
```

**Standard Webhooks headers** (used by OpenAI, Svix):
```
webhook-id: msg_abc123
webhook-timestamp: 1710720000
webhook-signature: v1,K5oZfzN95Z9UVu1EsfQ...
```

### Key Design Decisions from Research

| Decision | Stripe | OpenAI | GitHub | NullSpend Should |
|---|---|---|---|---|
| Event type in body | `type` field | `type` field | `action` field in body | `type` field |
| Type in header | No | No | `X-GitHub-Event` | No (body only) |
| `api_version` | Yes (frozen at endpoint creation) | No | No | **Yes** |
| Fat vs thin events | Migrating to thin | Already thin | Fat | Fat for v1, thin later |
| `previous_attributes` | Yes on `.updated` | No | No | Defer (adds complexity) |
| Wildcard subscriptions | `customer.*` | Unknown | Per-event selection | Support in v2 |

---

## 3. NullSpend Current State

### Existing Event Types (6)

| Type | Status | Trigger |
|---|---|---|
| `cost_event.created` | Defined, not firing | Every proxied request |
| `budget.threshold.warning` | Defined, not firing | Spend crosses 50% or 80% |
| `budget.threshold.critical` | Defined, not firing | Spend crosses 90% or 95% |
| `budget.exceeded` | Defined, not firing | Budget limit reached |
| `request.blocked` | Defined, not firing | Blocked request (reason in data.object.reason) |
| `budget.reset` | Defined, not firing | Budget period reset |
| `action.created` | Defined, not firing | HITL action created |
| `action.approved` | Defined, not firing | HITL action approved |
| `action.rejected` | Defined, not firing | HITL action rejected |
| `action.expired` | Defined, not firing | HITL action expired |
| `test.ping` | Defined, not firing | Test webhook event |

### Current Envelope

```json
{
  "id": "evt_{uuid}",
  "type": "cost_event.created",
  "created_at": "2026-03-18T12:00:00Z",
  "data": { /* event-specific payload */ }
}
```

**Missing:** `api_version` field.

### Infrastructure Status

| Component | Status |
|---|---|
| HMAC-SHA256 signing | Done (Stripe-compatible `t=,v1=` format) |
| Headers | Done (`X-NullSpend-Signature`, `X-NullSpend-Webhook-Id`, `X-NullSpend-Webhook-Timestamp`) |
| URL validation (SSRF) | Done (blocks private IPs, localhost, IPv6 literals, HTTP) |
| Secret format | Done (`whsec_` + 32 hex bytes) |
| Endpoint CRUD | Done (create, update, delete, list, test, rotate) |
| QStash delivery | Done (5 retries with exponential backoff) |
| Delivery logging | Done (`webhook_deliveries` table) |
| Webhook caching | Done (Redis, metadata only, secrets never cached) |
| Threshold detection | Done (50%, 80%, 90%, 95%) |
| **Route integration** | **Not done** (events don't fire) |
| **Dual-signing rotation** | **Not done** |
| **`api_version` field** | **Not done** |

---

## 4. Recommended Event Taxonomy

### Launch Set (Lock Now)

| Type | Category | Trigger | Payload |
|---|---|---|---|
| `cost_event.created` | Cost | Every proxied request | Full cost event snapshot |
| `budget.threshold.warning` | Budget | Spend crosses 50% or 80% | Budget snapshot + threshold % |
| `budget.threshold.critical` | Budget | Spend crosses 90% or 95% | Budget snapshot + threshold % |
| `budget.exceeded` | Budget | Strict-block budget hit | Budget snapshot + denied request info |
| `budget.reset` | Budget | Period reset (daily/weekly/monthly) | Budget snapshot + new period start |
| `request.blocked` | Request | Any blocked request | Block reason, request metadata |
| `action.created` | HITL | Agent proposes action | Action snapshot |
| `action.approved` | HITL | Human approves | Action snapshot + approver |
| `action.rejected` | HITL | Human rejects | Action snapshot + rejector + reason |
| `action.expired` | HITL | TTL elapsed | Action snapshot |
| `test.ping` | System | Manual test from dashboard | `{ "message": "Test event" }` |

### Post-Launch Additions (Backward-Compatible)

| Type | When to Add |
|---|---|
| `api_key.created` | When key lifecycle monitoring is requested |
| `api_key.revoked` | When key lifecycle monitoring is requested |
| `budget.created` | When budget lifecycle monitoring is requested |
| `budget.updated` | When budget lifecycle monitoring is requested |
| `budget.deleted` | When budget lifecycle monitoring is requested |
| `spend.anomaly.detected` | After Phase 6 (EWMA anomaly detection) |
| `agent.loop.detected` | After Phase 6 (session circuit breakers) |

### Naming Rules (Locked)

1. `resource.action` format — 2-3 segments, period-delimited
2. Past tense for completed states: `.created`, `.approved`, `.rejected`, `.expired`, `.exceeded`
3. Present tense ONLY for in-progress: `.pending`, `.processing`
4. Singular resources: `budget`, `action`, `cost_event`, `api_key`
5. snake_case for multi-word: `cost_event`, `api_key`
6. New event types are backward-compatible additions
7. Event types are NEVER renamed — add new, deprecate old
8. Consumers MUST handle unknown event types gracefully

---

## 5. Event Envelope Design

### Final Envelope

```json
{
  "id": "evt_a1b2c3d4e5f6",
  "type": "budget.exceeded",
  "api_version": "2026-04-01",
  "created_at": 1710720000,
  "data": {
    "object": {
      "id": "ns_bgt_abc123",
      "entity_type": "user",
      "entity_id": "ns_usr_xyz",
      "max_budget_microdollars": 5000000,
      "spend_microdollars": 5000000,
      "policy": "strict_block"
    }
  }
}
```

### Field Definitions

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | Yes | Unique event ID, prefixed `evt_`. Used for idempotency. |
| `type` | string | Yes | Event type from the locked taxonomy |
| `api_version` | string | Yes | Date-based version (e.g., `"2026-04-01"`). Frozen at endpoint creation. |
| `created_at` | integer | Yes | Unix timestamp (seconds) |
| `data` | object | Yes | Event-specific payload |
| `data.object` | object | Yes | Snapshot of the relevant resource |

### Changes from Current

| Field | Current | Change |
|---|---|---|
| `api_version` | Missing | **Add** — date string, frozen at endpoint creation |
| `created_at` | ISO 8601 string | **Change to Unix timestamp** (integer, Stripe convention) |
| `data` | Flat object | **Wrap in `data.object`** (Stripe convention, enables `previous_attributes` later) |

---

## 6. Versioning Strategy

### Rules

1. **`api_version` frozen at endpoint creation.** When a user creates a webhook endpoint, the current API version is recorded. All events to that endpoint use that version's payload shape.
2. **Adding new event types is backward-compatible.** No version bump needed.
3. **Adding new fields to `data.object` is backward-compatible.** Consumers must ignore unknown fields.
4. **Removing or renaming fields requires a new `api_version`.** Existing endpoints continue receiving the old shape.
5. **Version format:** Date-based (`"2026-04-01"`), matching the API key version field.

### Implementation

Store `api_version` on the `webhook_endpoints` table. When dispatching, include the endpoint's version in the event envelope. For v1, there's only one version — the complexity of multi-version payload shaping is deferred until the first breaking change.

---

## 7. DX Pitfalls to Avoid

### From Research (Specific Bugs and Complaints)

| Pitfall | Source | How NullSpend Avoids |
|---|---|---|
| Events arrive out of order | Stripe #418, Laravel Cashier #1201 | Include `created_at` timestamp, document no ordering guarantee |
| Duplicate events processed | Stripe #981, WooCommerce #2331 | Stable `evt_` IDs, document idempotency requirement |
| No way to replay missed events | HN "Give me /events" thread | Plan complementary `/api/events` polling endpoint (post-launch) |
| Generic `.updated` forces payload diffing | Svix naming guide | Use specific state transitions: `.approved`, `.rejected`, `.expired` |
| Consumer can't debug failures | Common complaint | Delivery log with HTTP status + response body (already built) |
| Secret rotation breaks consumers | Standard Webhooks spec | Dual-signing during transition (implement before launch) |
| DNS rebinding bypasses SSRF checks | CVE-2026-30242, CVE-2026-32096 | Resolve DNS at delivery time, not just registration |
| LiteLLM duplicate alerts with replicas | LiteLLM #14809 | Threshold dedup via Redis (TODO already in code) |

### Consumer Documentation Requirements

The following must be documented before GA:

1. **Events may be delivered more than once.** Use `event.id` for deduplication.
2. **Events may arrive out of order.** Use `created_at` for ordering.
3. **Unknown event types must be ignored.** Return 200 for unrecognized types.
4. **Unknown fields must be ignored.** Don't fail on new fields.
5. **Respond with 2xx within 5 seconds.** Process asynchronously if needed.
6. **Verify signatures.** Reject events where timestamp > 5 minutes old.
7. **Use timing-safe comparison** for signature verification.

---

## 8. Security Considerations

### What's Already Done

- HMAC-SHA256 signing with timestamp in material
- HTTPS-only URL validation
- Private IP / localhost / link-local blocking
- Secrets never cached in Redis
- `whsec_` prefixed secrets

### What Needs to Be Added

| Item | Priority | Effort |
|---|---|---|
| Dual-signing for secret rotation | High | ~1h |
| DNS resolution check at delivery time | Medium | ~30min |
| Replay window documentation (5 min) | High | ~15min |
| SDK verification helper with timing-safe compare | Medium | ~1h |

---

## 9. Delivery Reliability

### Current State: Fire-and-Forget (Critical Gap)

The current `dispatchToEndpoints` sends via QStash (which has 5 built-in retries) but does not update `webhook_deliveries` status based on QStash callbacks. Events that exhaust retries are silently lost.

### Recommended Retry Strategy

| Attempt | Delay | Cumulative |
|---|---|---|
| 1 | Immediate | 0 |
| 2 | 1 min | 1 min |
| 3 | 5 min | 6 min |
| 4 | 30 min | 36 min |
| 5 | 2 hours | 2h 36min |

QStash handles this natively with its retry configuration. The gap is recording delivery outcomes back in `webhook_deliveries` — requires a QStash callback route.

### Endpoint Disabling

After 5 consecutive failures (all retries exhausted), disable the endpoint and send a dashboard notification. Do NOT delete — the user may fix their server and re-enable.

---

## 10. Implementation Gaps

### For Taxonomy Lock (This Task)

| Item | Effort | Description |
|---|---|---|
| Add `api_version` to event envelope | ~30min | Add field to `buildWebhookEvent()` in `webhook-events.ts` |
| Add `api_version` column to `webhook_endpoints` | ~15min | Migration + default value |
| Add `budget.reset` event type | ~30min | Payload builder + add to enum |
| Add HITL action events (4 types) | ~1h | Payload builders + add to enum |
| Add `test.ping` event type | ~15min | Payload builder for test endpoint |
| Wrap `data` in `data.object` | ~30min | Update all payload builders |
| Change `created_at` to Unix timestamp | ~15min | Update `buildWebhookEvent()` |
| Update validation schema | ~15min | Add new types to Zod enum |
| Update tests | ~1h | Update all webhook event test assertions |

**Total: ~4-5 hours** (slightly more than the audit's ~1h estimate due to envelope changes and HITL events).

### For Wiring (WH-2, Separate Task)

| Item | Effort |
|---|---|
| Fire `cost_event.created` from proxy routes | ~2h |
| Fire `budget.exceeded` from budget orchestrator | ~1h |
| Fire `budget.threshold.*` from threshold detector | ~1h |
| Fire `action.*` events from action lifecycle | ~2h |
| Fire `budget.reset` from DO period reset | ~30min |
| Threshold dedup via Redis | ~1h |

### For Reliability (WH-2.5, Separate Task)

| Item | Effort |
|---|---|
| QStash callback route for delivery status | ~2h |
| Dual-signing for secret rotation | ~1h |
| DNS resolution at delivery time | ~30min |

---

## 11. References

### Platform Documentation
- [Stripe Event Types](https://docs.stripe.com/api/events/types) | [Event Object](https://docs.stripe.com/api/events/object) | [Webhook Versioning](https://docs.stripe.com/webhooks/versioning) | [Thin Events](https://docs.stripe.com/webhooks/migrate-snapshot-to-thin-events)
- [OpenAI Webhook Events](https://platform.openai.com/docs/api-reference/webhook-events) | [Webhooks Guide](https://developers.openai.com/api/docs/guides/webhooks)
- [GitHub Webhook Events](https://docs.github.com/en/webhooks/webhook-events-and-payloads)
- [SendGrid Event Webhook](https://www.twilio.com/docs/sendgrid/for-developers/tracking-events/event)
- [CloudEvents Spec](https://github.com/cloudevents/spec/blob/main/cloudevents/spec.md)
- [Standard Webhooks Spec](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md)

### Best Practices
- [Svix Event Type Naming](https://www.svix.com/resources/webhook-university/implementation/webhook-event-naming-conventions/) | [Versioning](https://www.svix.com/blog/webhook-versioning/) | [Secret Rotation](https://www.svix.com/blog/zero-downtime-secret-rotation-webhooks/)
- [Hookdeck Payload Best Practices](https://hookdeck.com/outpost/guides/webhook-payload-best-practices) | [Retry Best Practices](https://hookdeck.com/outpost/guides/outbound-webhook-retry-best-practices)
- [Convoy Best Practices](https://docs.getconvoy.io/guides/best-practices-for-generating-webhook-events)

### Bug Reports
- [Stripe CLI #418 (ordering)](https://github.com/stripe/stripe-cli/issues/418) | [#981 (duplicates)](https://github.com/stripe/stripe-cli/issues/981)
- [Laravel Cashier #1201 (out-of-order)](https://github.com/laravel/cashier-stripe/issues/1201)
- [LiteLLM #14809 (duplicate alerts)](https://github.com/BerriAI/litellm/issues/14809)
- [CVE-2026-30242 (Plane SSRF)](https://advisories.gitlab.com/pkg/pypi/plane/CVE-2026-30242/) | [CVE-2026-32096 (Plunk SSRF)](https://www.thehackerwire.com/plunk-critical-ssrf-in-sns-webhook-handler-cve-2026-32096/)

### Security
- [Webhook Security Fundamentals 2026](https://www.hooklistener.com/learn/webhook-security-fundamentals)
- [Webhook Security Vulnerabilities Guide](https://hookdeck.com/webhooks/guides/webhook-security-vulnerabilities-guide)
- [Common Signature Failure Modes](https://www.svix.com/blog/common-failure-modes-for-webhook-signatures/)

### Discussions
- [Give me /events, not webhooks (HN)](https://news.ycombinator.com/item?id=27823109)
- [Webhooks Are Harder Than They Seem (HN)](https://news.ycombinator.com/item?id=42309742)
