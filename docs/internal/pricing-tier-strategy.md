# Pricing & Tier Strategy

**Created:** 2026-03-24
**Status:** Active (implemented in `lib/stripe/tiers.ts` + `components/marketing/pricing-table.tsx`)
**Related:** [`org-team-implementation-plan.md`](technical-outlines/org-team-implementation-plan.md) — team/org features are tier-gated

---

## Philosophy

**Give away features, gate on scale.** Features hook people. Scale makes them pay.

Inspired by PostHog (1M events free, unlimited features), Stripe (everything free until you process payments), and Supabase (full product on free, gated by project count and pausing).

Free users should experience the full value proposition — cost tracking, budget enforcement, velocity limits, webhooks — on a small scale. The upgrade trigger is needing more organizational units (budgets, endpoints), not being locked out of features.

---

## Tier Definitions (source of truth: `lib/stripe/tiers.ts`)

### Free — $0/mo

**Positioning:** Full cost tracking and budget enforcement for individuals.

| Limit | Value | Rationale |
|---|---|---|
| Proxied spend | $5K/mo (soft cap) | Generous enough for prototyping + small production. Warn at 80%, don't block. |
| Budgets | 3 | Enough to try per-agent or per-model budgets. Upgrade trigger when you need 4+. |
| API keys | 10 | Near-zero cost. More integration = more stickiness. |
| Webhook endpoints | 2 | Industry gives webhooks on free. 2 covers Slack + one custom endpoint. |
| Data retention | 30 days | Sentry/Helicone standard. Enough to see a full billing cycle. |
| Velocity limits | Included | Core value prop — must be experienceable on free. |
| Session limits | Included | Same — part of budget enforcement. |
| Tag budgets | Included | Same. |
| Team members | 1 (personal org only) | Team features are the Team plan upgrade trigger. |

### Pro — $49/mo

**Positioning:** Unlimited budgets and deeper analytics for production.

| Limit | Value | Rationale |
|---|---|---|
| Proxied spend | $50K/mo (soft cap) | Covers most production workloads. |
| Budgets | Unlimited | This is the primary upgrade trigger from free. |
| API keys | Unlimited | Don't gate plumbing. |
| Webhook endpoints | 25 | Enough for complex integrations. |
| Data retention | 90 days | Quarterly review capability. Clear daylight from free. |
| Velocity limits | Unlimited | Included in all budgets. |
| Session limits | Unlimited | Included. |
| Tag budgets | Unlimited | Included. |
| Team members | 1 (personal org) | Multi-user is Team plan. |
| Priority support | Yes | Email support with faster response. |

### Team — $199/mo

**Positioning:** Multi-user access and advanced controls for teams.

| Limit | Value | Rationale |
|---|---|---|
| Proxied spend | $250K/mo (soft cap) | Enterprise-scale. |
| Budgets | Unlimited | |
| API keys | Unlimited | |
| Webhook endpoints | 50 | |
| Data retention | 1 year (365 days) | Annual review, compliance needs. |
| Team members | Unlimited | Primary Team plan feature. |
| Roles | Owner, Admin, Member | Org management. |
| Team budgets | Yes | Shared budgets across team members. |
| Advanced analytics | Yes | Cross-agent comparison, team spend dashboards. |

### Enterprise — Custom

**Positioning:** Deferred. Build when an enterprise customer asks.

- Unlimited everything
- SSO/SAML
- Custom roles + permissions
- Dedicated support
- Custom data retention
- SLA

---

## Upgrade Triggers (the "aha" moments)

| Trigger | From → To | When it happens |
|---|---|---|
| Need 4+ budgets | Free → Pro | User wants per-model, per-project, or per-team-member budgets |
| Want 90-day history | Free → Pro | User wants to compare month-over-month spend trends |
| Need team access | Pro → Team | User wants to invite teammates to view/manage cost data |
| Need 25+ webhook endpoints | Pro → Team | Complex integration with multiple monitoring systems |
| Need 1-year retention | Pro → Team | Compliance, annual planning |

---

## What's NOT Gated (available on all tiers)

- Cost tracking (the core product)
- All budget types (velocity, session, tag)
- Full API access
- SSE streaming support
- Cost event persistence
- Budget enforcement (check + reserve + reconcile)
- Webhook events (within endpoint limit)
- `_ns_` telemetry tags

---

## Spend Cap Enforcement Strategy

The spend cap is **soft, not hard.** NullSpend sits in the critical path of AI agent requests. Hard-blocking means the customer's AI agent stops working — a reputation-destroying event.

| Threshold | Action |
|---|---|
| 80% of cap | Dashboard warning banner + email notification |
| 100% of cap | Email + webhook notification. Cost tracking continues. Budget enforcement degrades (velocity limits stop enforcing). |
| 150% of cap | Final warning. Daily email nudge to upgrade. Dashboard banner persists. |
| Never | Hard block on the proxy. Let it pass through. |

**Not yet implemented.** The spend cap is defined in `tiers.ts` and checked at budget creation time, but there's no runtime enforcement on the proxy. This is acceptable for launch — implement the warning/degradation system when a user actually approaches the cap.

---

## Enforcement Status (what's actually checked today)

| Limit | Enforced? | Where |
|---|---|---|
| maxBudgets | **Yes** | `app/api/budgets/route.ts` — tier-aware |
| maxApiKeys | **Yes** | `app/api/keys/route.ts` — tier-aware |
| maxWebhookEndpoints | **Yes** | `app/api/webhooks/route.ts` — tier-aware |
| spendCapMicrodollars | **Partially** | Checked at budget creation, not at proxy runtime |
| retentionDays | **No** | No retention job exists. All data kept indefinitely. |
| Team members | **No** | Org/team system not built yet (Phase 1-4 of org plan) |

### Not Yet Built (tracked in implementation plans)

- Data retention cleanup job — needs a cron that deletes cost_events older than `retentionDays`
- Spend cap runtime enforcement — soft warning system described above
- Team member limits — blocked on org/team implementation
- `<FeatureGate>` component for frontend tier gating — Phase 2 of org plan

---

## Research Sources

- [PostHog Pricing](https://posthog.com/pricing) — 1M events free, 1 year retention, unlimited team
- [Helicone Pricing](https://www.helicone.ai/pricing) — 10K requests free, 1 month retention
- [Sentry Pricing](https://sentry.io/pricing/) — 5K errors free, 30 day retention
- [Supabase Pricing](https://supabase.com/pricing) — 2 projects free, 500MB database
- [Portkey Pricing](https://portkey.ai/pricing) — 10K requests free, budget limits are enterprise
- [Braintrust Pricing](https://www.braintrust.dev/pricing) — 1M spans free, 14 day retention
- [Stripe Pricing](https://stripe.com/pricing) — everything free until payment processing
