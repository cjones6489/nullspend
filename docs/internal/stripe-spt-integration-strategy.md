# Stripe SPT Integration Strategy: NullSpend as Agent Commerce Controller

**Date:** 2026-03-26
**Status:** Strategy — blocked on Stripe partnership/waitlist access
**Prerequisite:** Accepted as "AI platform" partner by Stripe
**Raw API research:** `nullspend-knowledge` repo → `research/stripe-shared-payment-tokens-research.md`

---

## The Thesis

Agents are moving from "call APIs" to "spend real money." Stripe SPTs, Mastercard Agent Pay, and Visa Intelligent Commerce are the payment rails. The missing piece: **who decides whether the agent should be allowed to spend, and who tracks what it spent across all rails?**

NullSpend already has the governance primitives (budgets, HITL, velocity limits, audit trail). The integration is: become the layer that creates, governs, and audits SPTs on behalf of any agent framework.

---

## Why This Is "Can't Function Without"

Without a governance layer, an agent that wants to buy something has three options:

1. **Full credit card** — unacceptable blast radius
2. **Bespoke approval flow per use case** — every team reinvents this
3. **Don't buy things** — limits what agents can do

NullSpend + Stripe SPTs creates option 4: agent requests purchase, governance check runs, scoped token issued, purchase happens, spend tracked. That's the complete trust loop for agent commerce.

---

## The Flow

```
Agent (any framework) wants to buy something
  │
  ▼
NullSpend API: POST /v1/purchases/authorize
  Body: { amount: 4700, currency: "usd", merchant: "acct_xxx", description: "..." }
  │
  ├─ Budget check: does this agent have $47 remaining?     ← ALREADY BUILT
  ├─ Velocity check: spending too fast?                     ← ALREADY BUILT
  ├─ HITL check: does this need human approval?             ← ALREADY BUILT
  │    └─ If yes → dashboard/Slack → human approves         ← ALREADY BUILT
  │
  ▼
NullSpend creates Stripe SPT:
  POST /v1/shared_payment/issued_tokens (platform API)
  → max_amount: $47.00
  → expires_at: 1 hour from now
  → seller: acct_xxx
  │
  ▼
Returns to agent: { token: "spt_xxx", expiresAt: "...", maxAmount: 4700 }
  │
  ▼
Agent completes purchase with seller via ACP:
  POST /checkouts/:id/complete { payment_data: { token: "spt_xxx" } }
  │
  ▼
Stripe webhook → NullSpend:
  shared_payment.issued_token.used
  │
  ├─ Log financial event in unified ledger                  ← EXTEND cost_events
  ├─ Reconcile against budget                               ← ALREADY BUILT
  ├─ Webhook to user: "Agent #3 spent $47 at Merchant X"   ← ALREADY BUILT
  └─ Update dashboard spend charts                          ← ALREADY BUILT
```

---

## What's New to Build vs. What's Reused

### Reused (already in production)

| Primitive | How It's Reused |
|---|---|
| Budget enforcement (DO) | Check agent has remaining budget before issuing SPT |
| HITL approvals | Require human sign-off for purchases above threshold |
| Velocity limits | Detect runaway purchasing loops |
| Webhook dispatch | Notify on purchase events |
| Cost event ledger | Store financial events (new `eventType: "purchase"`) |
| Dashboard UI | Show purchase spend in analytics alongside API costs |
| Tag attribution | Tag purchases by agent, team, project, environment |
| Session tracking | Group multi-step purchase flows |
| Org/key scoping | Purchases scoped by org, attributed to API key |

### New to Build

| Component | Effort | Description |
|---|---|---|
| **Purchase authorization endpoint** | Medium | `POST /v1/purchases/authorize` — runs budget/HITL/velocity checks, creates SPT via Stripe API, returns token |
| **Stripe SPT webhook handler** | Small | Handle `shared_payment.issued_token.used` and `.deactivated` — log financial event, reconcile budget |
| **Financial event type** | Small | Extend `cost_events` table with `eventType: "purchase"` (alongside existing `"llm"` and `"mcp"`) — or new `financial_events` table |
| **SPT lifecycle management** | Small | Revoke unexpired tokens on budget exhaustion, token expiry tracking |
| **Stripe Connect setup** | Config | Register as AI platform partner, configure webhook endpoints, store Stripe platform credentials per org |
| **Dashboard: purchase view** | Medium | Purchase history, spend breakdown by merchant/agent, combined API+purchase analytics |
| **Payment method management** | Medium | Users link payment methods (cards) that NullSpend can use to create SPTs on their behalf |

### Estimated total: ~2-3 weeks of implementation (after Stripe access granted)

---

## Data Model Extension

### Option A: Extend cost_events (recommended)

Add `eventType: "purchase"` to the existing enum. Purchases become first-class financial events in the same ledger as API costs. The `tags` JSONB column carries merchant info, order details, etc.

New fields needed:
```
eventType: "llm" | "mcp" | "purchase"    ← add "purchase"
merchantId: text (nullable)               ← Stripe merchant account ID
orderId: text (nullable)                  ← ACP order ID
sptId: text (nullable)                    ← SPT token ID for audit trail
```

**Why this option:** Unified ledger. Budget enforcement already operates on cost_events. Dashboard analytics already aggregate cost_events. Adding a new event type reuses all existing infrastructure.

### Option B: Separate financial_events table

Cleaner separation but requires duplicating budget reconciliation, analytics queries, webhook dispatch, and dashboard UI. Not recommended unless the schema diverges significantly.

---

## Stripe Partnership Requirements

To create SPTs, NullSpend must be registered as an **AI platform** with Stripe. This requires:

1. **Join the Stripe Agentic Commerce waitlist** — https://stripe.com/agentic-commerce
2. **Stripe Connect account** — NullSpend as platform, user orgs as connected accounts (or direct charges)
3. **Platform credentials** — Stripe gives NullSpend the ability to create `shared_payment.issued_token` objects on behalf of users
4. **Webhook configuration** — Receive `shared_payment.issued_token.*` events
5. **Compliance** — PCI DSS considerations (SPTs handle this by never exposing card data, but Stripe may require attestation)

### Questions for Stripe Partnership Team

- Can a FinOps/governance platform register as an AI platform, or must we be an "AI agent" directly?
- Can we create SPTs on behalf of our users' Stripe accounts (Connect model)?
- What's the timeline for SPT API GA (beyond waitlist)?
- Is there a sandbox/test mode that doesn't require waitlist access?
- Can SPTs be created programmatically without the ChatGPT client-side flow?

---

## Competitive Landscape

| Player | What They Do | What They Don't Do |
|---|---|---|
| **Stripe** | Payment rails (SPTs) | No governance, no budget enforcement, no HITL |
| **Skyfire** | Agent wallets + micropayments | No human approval, no unified ledger across rails |
| **Payman** | Agent → human payments | Simple threshold approval, no cost tracking, no velocity |
| **Coinbase AgentKit** | Onchain wallets | Crypto only, no traditional commerce |
| **Crossmint** | Virtual cards for agents | Basic per-tx limits, no approval flows |
| **LiteLLM/Portkey/Helicone** | API cost tracking | No commerce, no payments, no HITL |
| **NullSpend (with SPT integration)** | Governance + audit across API costs AND commerce | Dependent on Stripe partnership |

**NullSpend's unique position:** The only platform that combines budget enforcement + human-in-the-loop approval + real-time cost tracking + webhook alerting AND applies it to agent commerce, not just API calls.

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Stripe waitlist takes months | Medium | Blocks integration | Build everything else first; mock SPT creation in tests |
| SPTs stay ChatGPT-only | Low | Limits market | ACP is open standard; other platforms announced |
| API changes during pre-GA | Medium | Rework needed | Keep integration surface small; abstract behind NullSpend API |
| Low adoption of agent commerce | Medium | Feature unused | SPT integration is small investment; core product unaffected |
| Competitor builds this first | Low | Lose first-mover | None of the FinOps tools are positioned for commerce |

---

## Implementation Sequence

### Phase 0: Stripe Access (NOW)
- [ ] Apply to Stripe Agentic Commerce waitlist
- [ ] Reach out to Stripe partnerships (leverage existing Stripe billing integration)
- [ ] Set up Stripe Connect test environment

### Phase 1: Foundation (while waiting for Stripe access)
- [ ] Extend `cost_events.eventType` enum with `"purchase"`
- [ ] Add `merchantId`, `orderId`, `sptId` nullable columns
- [ ] Build `POST /v1/purchases/authorize` endpoint (mock SPT creation)
- [ ] Wire budget check + HITL check into purchase authorization
- [ ] Dashboard: show purchase events in cost event list

### Phase 2: Stripe Integration (after access granted)
- [ ] Implement real SPT creation via Stripe API
- [ ] Implement SPT webhook handlers (used, deactivated)
- [ ] Budget reconciliation on SPT settlement
- [ ] Token revocation on budget exhaustion
- [ ] Payment method linking (user connects card)

### Phase 3: Polish
- [ ] Dashboard: combined API + commerce analytics
- [ ] Webhook events for purchase lifecycle
- [ ] Smoke tests against Stripe test mode
- [ ] Documentation

---

## Key Decisions (To Be Made)

1. **Stripe Connect model:** Platform charges (NullSpend takes payment, pays merchant) vs. direct charges (merchant's Stripe account, NullSpend creates SPT)? Direct charges are simpler but require per-merchant Stripe Connect.

2. **Payment method storage:** Does NullSpend store payment methods (via Stripe Customer objects), or does the user provide a payment method per purchase? Stored methods enable automated purchasing; per-request methods are simpler but require more user interaction.

3. **Budget unification:** Should API costs and purchases share the same budget, or separate budgets? Unified is simpler for users ("Agent #3 has $500/month total"). Separate gives more control ("$400 for API, $100 for purchases").

4. **HITL threshold:** Should there be a default "require approval for purchases" policy, or opt-in? Given the novelty of agent commerce, default-require-approval seems safer and builds trust.

---

## The Positioning Shift

**Before:** "NullSpend — cost tracking and budget enforcement for AI API calls"
**After:** "NullSpend — financial controls for autonomous agents"

The Stripe SPT integration is the concrete, shippable feature that makes this positioning real. It's not a vision deck — it's a working product that lets agents buy things safely, with the same governance that already protects API spending.
