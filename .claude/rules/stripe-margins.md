---
paths:
  - "lib/stripe/**"
  - "lib/margins/**"
  - "app/api/stripe/**"
  - "app/api/margins/**"
  - "app/api/customer-mappings/**"
  - "app/(dashboard)/app/customers/**"
  - "app/(dashboard)/app/margins/**"
  - "components/customers/**"
  - "components/margins/**"
---

# Stripe and Margins

Conventions for Stripe integration, customer attribution, and margin tracking.

## Two Stripe integrations

- **Own billing** — `lib/stripe/`, `STRIPE_SECRET_KEY`
- **Customer revenue sync** — `lib/margins/`, per-org encrypted keys via `STRIPE_ENCRYPTION_KEY`
- Stripe API version pinned in `lib/stripe/client.ts` (`STRIPE_API_VERSION`) — single source of truth

## Customer attribution

- Header: `X-NullSpend-Customer` (preferred) or `tags["customer"]` fallback
- Dedicated `customer_id` column on cost events with B-tree index
- Header takes precedence over tag
- Auto-injected into tags for tag-budget compat

## Pages

- Customers page (`/app/customers`) replaces Margins page
- `/app/margins` redirects
- Detail at `/app/margins/[customer]` unchanged

## Margin health

- Tiers: `healthy` (>=50%), `moderate` (20-49%), `at_risk` (0-19%), `critical` (<0%)
- Revenue sync uses DELETE+re-INSERT replace strategy per customer per period (idempotent)
- Margin threshold crossings dispatch both webhooks and Slack alerts independently (per-crossing error isolation)
