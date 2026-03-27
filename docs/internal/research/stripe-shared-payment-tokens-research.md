# Stripe Shared Payment Tokens (SPT) & Agentic Commerce Research

**Date:** 2026-03-26
**Status:** Research complete
**Sources:** Stripe docs, blog posts, ACP website, third-party analysis

---

## 1. API Surface

### Core Objects

**SharedPaymentToken** has two perspectives:
- **`shared_payment.granted_token`** -- the seller's view (what a merchant receives)
- **`shared_payment.issued_token`** -- the agent's view (what the AI platform issued)

### Endpoints

#### Create SPT (Test Helper)
```
POST /v1/test_helpers/shared_payment/granted_tokens
```

In production, SPTs are created by the AI platform (e.g., ChatGPT), not by the seller. The test helper endpoint lets sellers simulate receiving an SPT during development.

**Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `payment_method` | string | Payment method ID (e.g., `pm_card_visa`) |
| `usage_limits[currency]` | string | ISO currency code (e.g., `usd`) |
| `usage_limits[max_amount]` | integer | Maximum amount in smallest currency unit (cents) |
| `usage_limits[expires_at]` | integer | Unix timestamp for token expiry |

**Example:**
```bash
curl https://api.stripe.com/v1/test_helpers/shared_payment/granted_tokens \
  -u "sk_test_...:" \
  -d payment_method=pm_card_visa \
  -d "usage_limits[currency]"=usd \
  -d "usage_limits[max_amount]"=10000 \
  -d "usage_limits[expires_at]"=1777158213
```

#### Retrieve SPT
```
GET /v1/shared_payment/granted_tokens/{id}
```

**Response object includes:**
- `id` -- token identifier (prefix: `spt_`)
- `created` -- Unix timestamp
- `deactivated_at` -- null if active, timestamp if revoked/expired
- `deactivated_reason` -- reason for deactivation
- `usage_limits` -- embedded object with currency, max_amount, expires_at
- Limited payment method details (card brand, last four digits)

#### Use SPT to Create PaymentIntent
```
POST /v1/payment_intents
```

Pass the SPT as `shared_payment_granted_token` when creating a PaymentIntent:

```bash
curl https://api.stripe.com/v1/payment_intents \
  -u "sk_test_...:" \
  -d amount=10000 \
  -d currency=usd \
  -d shared_payment_granted_token=spt_123 \
  -d confirm=true
```

**Key behavior:** When confirming a PaymentIntent with an SPT, Stripe sets `payment_method` to a new PaymentMethod **cloned** from the customer's original method. Subsequent operations (refunds, reporting, disputes) behave identically to a direct PaymentMethod.

### Constraints
- SPTs are **single-use** -- one token, one transaction
- **Time-limited** -- expires at the `expires_at` timestamp
- **Amount-bounded** -- cannot exceed `max_amount`
- **Seller-scoped** -- locked to a specific merchant
- **Irrevocable by seller** -- only the issuing agent can revoke
- Raw card data (PANs) are **never exposed** to the agent or merchant

---

## 2. Agentic Commerce Protocol (ACP)

### Overview
- **Open-source** specification under **Apache 2.0** license
- **Co-developed** by Stripe and OpenAI
- Website: https://agenticcommerce.dev
- Contact for contribution: acp@stripe.com
- Implementable as **REST** endpoints or **MCP server**

### Endpoints

#### 1. Create Checkout Session
```
POST /checkouts
```

**Request:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `items` | array of `Item` | Yes | Products to purchase |
| `buyer` | `Buyer` hash | No | Customer information |
| `fulfillment_address` | `Address` hash | No | Shipping destination |

**Response:** Full checkout object (see below)

#### 2. Retrieve Checkout Session
```
GET /checkouts/:id
```

Returns current checkout state.

#### 3. Update Checkout Session
```
PUT /checkouts/:id
```

**Request:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `buyer` | `Buyer` hash | No | Updated customer info |
| `items` | array of `Item` | No | Updated product list |
| `fulfillment_address` | `Address` hash | No | Updated shipping address |
| `fulfillment_option_id` | string | No | Selected shipping method |

#### 4. Complete Checkout
```
POST /checkouts/:id/complete
```

**Request:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `payment_data` | `PaymentData` hash | Yes | SPT token + provider + billing address |
| `buyer` | `Buyer` hash | No | Final buyer details |

This is where the SPT gets passed. The seller creates a PaymentIntent with the SPT during this request.

#### 5. Cancel Checkout
```
POST /checkouts/:id/cancel
```

Empty body. Returns checkout with status `canceled`.

### Checkout Status Values
- `not_ready_for_payment` -- cart created, not yet complete
- `ready_for_payment` -- all required info collected
- `in_progress` -- payment being processed
- `completed` -- payment successful
- `canceled` -- checkout canceled

### Data Structures

**Buyer:**
```json
{
  "first_name": "string (required)",
  "last_name": "string (required)",
  "email": "string (required)",
  "phone_number": "string (optional)"
}
```

**Item:**
```json
{
  "id": "string (required) -- SKU/product ID",
  "quantity": "integer (required)"
}
```

**PaymentData (in CompleteCheckout):**
```json
{
  "token": "spt_123 (required) -- the SharedPaymentToken",
  "provider": "stripe (required)",
  "billing_address": { ... } // optional Address
}
```

**PaymentProvider (in response):**
```json
{
  "provider": "stripe",
  "supported_payment_methods": ["card"]
}
```

**LineItem (response):**
```json
{
  "id": "string",
  "item": { "id": "...", "quantity": 1 },
  "base_amount": 5000,
  "discount": 0,
  "subtotal": 5000,
  "tax": 450,
  "total": 5450
}
```

**Totals (response):** Array of `{ type, display_text, amount }` where type is one of:
`items_base_amount`, `items_discount`, `subtotal`, `discount`, `fulfillment`, `tax`, `fee`, `total`

**FulfillmentOption:** Supports `shipping` type (with carrier, delivery times) and `digital` type.

**Message types:** `info` (markdown/plain content) and `error` (with codes: `missing`, `invalid`, `out_of_stock`, `payment_declined`, `requires_sign_in`, `requires_3ds`)

**Link types:** `terms_of_use`, `privacy_policy`, `seller_shop_policies`

**Order (post-completion):**
```json
{
  "id": "order_123",
  "checkout_session_id": "cs_123",
  "permalink_url": "https://merchant.com/orders/123"
}
```

### Post-Checkout Events (OrderEventData)
Status values: `created`, `manual_review`, `confirmed`, `canceled`, `shipped`, `fulfilled`

### Security
- All requests require HTTPS + `Authorization: Bearer {token}`
- Webhook events signed with HMAC
- Agent provides auth and signing keys during onboarding

### End-to-End Flow
1. Customer tells agent "buy this"
2. Agent sends `POST /checkouts` with items to seller
3. Seller returns cart with totals, fulfillment options
4. Agent renders UI to customer, collects shipping selection
5. Agent sends `PUT /checkouts/:id` with customer choices
6. Customer approves payment
7. Agent provisions SPT (scoped to seller + amount + expiry)
8. Agent sends `POST /checkouts/:id/complete` with `payment_data.token = spt_123`
9. Seller creates `PaymentIntent` with `shared_payment_granted_token=spt_123` and `confirm=true`
10. Seller responds with order confirmation
11. Agent notifies customer of successful purchase

---

## 3. Agentic Commerce Suite Components

The suite announced December 11, 2025 includes three pillars:

### A. Product Discovery
- Hosted ACP endpoint for near-real-time product/price/availability sharing
- Merchants upload product catalogs via CSV (Dashboard or Files API, max 200 MB)
- Stripe syndicates catalog to AI agents automatically
- Daily full uploads + frequent incremental updates recommended
- Supports physical goods, digital products, subscriptions

### B. Checkout Management
- Built on Stripe Checkout Sessions API
- Handles shipping calculations, tax processing (Stripe Tax), order management
- Optional advanced features:
  - **Manual Payment Capture** -- deferred payment confirmation
  - **Order Approval Hook** -- pre-purchase validation (4-second timeout)
  - **Checkout Customization Hook** -- dynamic tax/shipping calculation
  - **Custom Receipt URL** -- replace Stripe's default with merchant-hosted page

### C. Payment Processing (SPTs)
- The SharedPaymentToken primitive (detailed in Section 1)
- Integrates with Stripe Radar for fraud detection
- Risk signals include: fraudulent dispute likelihood, card testing, stolen card, issuer decline probability

### Merchant Onboarding
1. Active Stripe account with completed verification
2. Accept agentic seller terms in Dashboard
3. Authorize connection to AI platform (e.g., OpenAI)
4. Copy Network ID (merchant identifier for ACP)
5. Add legal/support links (refund policy, ToS, privacy policy)
6. Configure Stripe Tax
7. Upload product catalog
8. Test in sandbox via Dashboard Workbench

### Platform Support
E-commerce: Wix, WooCommerce, BigCommerce, Squarespace, commercetools
Omnichannel: Akeneo, Cymbio, Logicbroker, Mirakl, Pipe17, Rithum

---

## 4. Webhook Events

### SPT Lifecycle Events

| Event | Recipient | Trigger |
|-------|-----------|---------|
| `shared_payment.granted_token.used` | Seller | SPT consumed in a PaymentIntent |
| `shared_payment.granted_token.deactivated` | Seller | Token revoked by agent or expired |
| `shared_payment.issued_token.used` | Agent platform | Seller used the SPT |
| `shared_payment.issued_token.deactivated` | Agent platform | Token revoked or expired |

### Order Events
- `checkout.session.completed` -- purchase finalized (standard Stripe event)
- Post-checkout order status updates via ACP event push (webhook to agent)
- Order statuses: `created`, `manual_review`, `confirmed`, `canceled`, `shipped`, `fulfilled`

### Important Notes
- The `shared_payment.*` events are **NOT** listed in the standard `/v1/events/types` API reference as of March 2026. They appear to be delivered through a separate mechanism or are in a pre-GA namespace.
- Standard PaymentIntent events (`payment_intent.succeeded`, `payment_intent.payment_failed`, etc.) still fire normally when an SPT is used to create a PaymentIntent.

---

## 5. Limitations & Status

### GA/Beta Status
- **ACP specification**: Open source, Apache 2.0, considered stable
- **SPTs**: Actively rolling out; available to waitlist participants
- **Agentic Commerce Suite**: Announced Dec 2025, waitlist-based access ("join the waitlist")
- **ChatGPT integration**: Live for US users purchasing from Etsy sellers as of early 2026
- Expansion to 1M+ Shopify merchants announced

### Known Limitations
- **Waitlist-gated**: Not self-serve GA yet; merchants must join waitlist
- **Single-use tokens only**: No recurring/subscription SPTs documented
- **SPTs handle payment only**: No built-in support for returns, exchanges, customer support
- **Agent context gaps**: Agents lack business context (return policies, shipping details, sales knowledge)
- **Customer support fragmentation**: Unclear escalation path between agent and merchant for issues
- **Post-purchase limited**: SPT lifecycle ends at payment; order management is separate
- **AI platform dependency**: Currently live only on ChatGPT; other platforms (Copilot, Anthropic, Perplexity) in development
- **No geographic restrictions documented**: But ChatGPT integration noted as "US users" initially
- **No currency restrictions documented**: But examples consistently show USD
- **4-second timeout on approval hooks**: Tight constraint for custom validation
- **Product catalog**: CSV-based upload, max 200 MB per file
- **SPT events not in standard event types list**: May indicate pre-GA API surface

### What SPTs Cannot Do
- Recurring charges / subscriptions (single-use only)
- Multi-merchant split payments
- Delayed capture across multiple sessions
- Customer-initiated modifications post-issuance
- Seller-side revocation (only the issuing agent can revoke)

---

## 6. Developer Experience

### Integration Complexity

**For sellers already on Stripe:** Minimal -- "updating as little as one line of code" per Stripe's claim. The key change is accepting `shared_payment_granted_token` in PaymentIntent creation.

**For new ACP implementations:** Significant -- must build 4 REST endpoints (Create/Update/Complete/Cancel checkout) or equivalent MCP tools, product catalog sync, and order management.

### SDK Support

**Stripe Agent Toolkit** (`@stripe/agent-toolkit`):
- TypeScript: `@stripe/agent-toolkit/ai-sdk` (Vercel AI SDK), `@stripe/agent-toolkit/langchain`
- Python: `stripe_agent_toolkit` (LangChain, Strands)
- These are for building agents that USE Stripe, not for sellers accepting SPTs

**Seller-side code (Node.js MCP example):**
```javascript
server.registerTool("complete_checkout", {
  description: "Complete the checkout and process the payment",
  inputSchema: {
    checkout_session_id: z.string(),
    buyer: z.object({
      name: z.string().nullable(),
      email: z.string().nullable(),
      phone_number: z.string().nullable(),
    }).nullable(),
    payment_data: z.object({
      token: z.string(),        // <-- the SPT
      provider: z.string(),
      billing_address: z.object({ ... }).nullable(),
    }),
  },
  async ({ checkout_session_id, buyer, payment_data }) => {
    const price = await stripe.prices.retrieve(retrievePriceID(checkout_session_id));
    const tax = getTax();

    // This is the key line -- pass SPT as shared_payment_granted_token
    stripe.paymentIntents.create({
      amount: price.unit_amount + tax,
      currency: price.currency,
      shared_payment_granted_token: payment_data.token,
      confirm: true,
    });

    return {
      content: [],
      structuredContent: {
        id: checkout_session_id,
        status: "completed",
        currency: price.currency,
        buyer,
        line_items: [],
        order: {
          id: "123",
          checkout_session_id,
          permalink_url: "",
        },
      },
    };
  }
});
```

**Client-side (ChatGPT app requesting checkout):**
```javascript
window.openai.requestCheckout({
  id: createCheckoutSession(priceID),
  payment_mode: "test",  // remove for production
  payment_provider: {
    provider: "stripe",
    merchant_id: networkID,  // from Stripe Dashboard
    supported_payment_methods: ["card"],
  },
  status: "ready_for_payment",
  currency: "USD",
  line_items: [ ... ],
  totals: [ ... ],
  fulfillment_options: [],
  messages: [],
  links: [{ type: "terms_of_service", url: "https://..." }],
});
```

### Testing
- Use `payment_mode: "test"` in client-side checkout requests
- Use `sk_test_...` API keys
- Test helper: `POST /v1/test_helpers/shared_payment/granted_tokens` to simulate SPT creation
- Sandbox mode available in Dashboard Workbench

### Production Checklist
1. Remove `payment_mode: "test"` from checkout requests
2. Switch to `sk_live_...` API key
3. Submit ChatGPT app for review (if applicable)

---

## 7. Existing Integrations & Case Studies

### Live Integrations
- **Etsy** -- Live on ChatGPT for US users; CPTO publicly quoted
- **URBN** (Anthropologie, Free People, Urban Outfitters) -- Early adopter

### Announced Partners
- **Retailers:** Coach, Kate Spade, Revolve, Ashley Furniture, Halara, Abt Electronics, Nectar, Glossier, Vuori, Spanx, SKIMS
- **Platforms:** Shopify (1M+ merchants), Squarespace, Wix, WooCommerce, BigCommerce, commercetools

### AI Platform Partnerships
- **OpenAI/ChatGPT** -- Live integration, co-developed ACP
- **In development:** Microsoft Copilot, Anthropic, Perplexity, Vercel, Lovable, Replit, Bolt, Manus

### Payment Network Partnerships
- **Mastercard Agent Pay** -- network-led agentic tokens, rolling out
- **Visa Intelligent Commerce** -- network-led agentic tokens, rolling out
- **Affirm** -- BNPL via SPTs
- **Klarna** -- BNPL via SPTs

Stripe claims to be "the first and only provider that supports both agentic network tokens and BNPL tokens in agentic commerce through a single primitive."

---

## 8. Relevance to NullSpend

### Potential Integration Points
1. **Cost tracking for SPT transactions**: If NullSpend proxies API calls that trigger agentic purchases, we could intercept and track the cost of those transactions.
2. **Budget enforcement for agent spending**: SPTs have built-in `max_amount` limits, but NullSpend could provide higher-level budget aggregation across multiple SPT transactions.
3. **Human-in-the-loop for purchases**: NullSpend's HITL approval flow could gate SPT creation -- requiring human approval before an agent can provision a payment token.
4. **Audit trail**: SPT lifecycle events could feed into NullSpend's cost event log for complete agent spending visibility.

### Key Consideration
SPTs are fundamentally about **commerce** (buying goods/services), while NullSpend currently tracks **API compute costs**. These are different budget categories but could converge as agents increasingly make purchases on behalf of users.
