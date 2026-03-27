# Funded Wallet System: Technical & Regulatory Deep Dive

**Date:** 2026-03-27
**Purpose:** Inform build-vs-partner decision for NullSpend's funded wallet system where companies deposit real money and AI agents spend from it.

---

## Table of Contents

1. [How Money Gets IN — Funding Mechanisms](#1-how-money-gets-in--funding-mechanisms)
2. [How Money Goes OUT — Spending Mechanisms](#2-how-money-goes-out--spending-mechanisms)
3. [Where Money Lives — Custody & Regulatory](#3-where-money-lives--custody--regulatory)
4. [The Prepaid Credit Model (Avoiding Regulation)](#4-the-prepaid-credit-model-avoiding-regulation)
5. [Technical Architecture for a Wallet/Ledger](#5-technical-architecture-for-a-walletledger)
6. [Real-World Platform Models](#6-real-world-platform-models)
7. [Recommended Architecture for NullSpend](#7-recommended-architecture-for-nullspend)

---

## 1. How Money Gets IN — Funding Mechanisms

### 1.1 Stripe Checkout for One-Time Deposits

**Flow:**
1. User clicks "Add Funds" in NullSpend dashboard
2. Server creates a Stripe Checkout Session in `payment` mode with a dynamic price (the deposit amount)
3. User is redirected to Stripe's hosted checkout page
4. User pays via card, ACH, etc.
5. Stripe fires `checkout.session.completed` webhook
6. Server credits the user's internal wallet ledger

**Key API details:**
- Create a Checkout Session with `mode: 'payment'` and `line_items` containing a price_data with the deposit amount
- Set `payment_intent_data.setup_future_usage: 'off_session'` to save the payment method for auto-replenish
- Use `success_url` and `cancel_url` for redirects
- The webhook `checkout.session.completed` is the source of truth, not the redirect

**Important:** Stripe's Customer Balance (invoice credit balance) is NOT suitable as a wallet. It can only be applied to invoices, cannot be directly charged, and cannot be topped up via Checkout. It is a billing reconciliation tool, not a wallet.

**Stripe's Customer Cash Balance** is closer but still limited --- it only accepts bank transfers (not card payments), is designed as a reconciliation layer, and businesses cannot programmatically add funds to it. It is NOT a wallet system.

**Verdict:** Use Checkout to collect money, but track the balance in your own ledger.

### 1.2 Stripe Payment Links for Quick Funding

Payment Links are pre-built, shareable URLs for accepting payments. Useful for:
- Sending a "top up your account" email with a direct link
- Embedding in Slack notifications when balance is low
- Sharing with finance teams who don't use the dashboard

Limitations: Less flexible than Checkout Sessions (fixed amounts or limited quantity selection). Better for predefined tiers ($50, $100, $500).

### 1.3 ACH / Bank Transfer for Larger Amounts

Two approaches:

**A. Stripe Checkout with ACH:** Set `payment_method_types: ['us_bank_account']` in the Checkout Session. Settlement takes 1-5 business days. Lower fees (0.8% capped at $5 vs 2.9% + $0.30 for cards).

**B. Stripe Customer Cash Balance (bank transfer):** Stripe provides each customer with unique bank account details (virtual bank account numbers). Customer initiates a wire/ACH from their bank. Stripe reconciles and credits the cash balance. This is the "pull from bank" approach. However, it requires manual customer action and is not programmable.

For NullSpend, Checkout with ACH support is the cleaner option.

### 1.4 Auto-Replenish (Charge Card When Balance Drops Below Threshold)

This is the most critical funding mechanism for agent-spend platforms. Here is how to implement it:

**Architecture:**
1. During initial deposit (Checkout), save the payment method by setting `setup_future_usage: 'off_session'`
2. Store the customer's auto-replenish preferences:
   - `enabled: boolean`
   - `threshold_cents: number` (e.g., $10.00 = 1000)
   - `replenish_amount_cents: number` (e.g., $50.00 = 5000)
3. After every spend event (agent API call), check if balance < threshold
4. If triggered, create an off-session PaymentIntent:
   ```
   stripe.paymentIntents.create({
     amount: replenish_amount_cents,
     currency: 'usd',
     customer: stripeCustomerId,
     payment_method: savedPaymentMethodId,
     off_session: true,
     confirm: true,
   })
   ```
5. On success (`payment_intent.succeeded` webhook), credit the ledger
6. On failure, notify the user and optionally pause agent activity

**Edge cases to handle:**
- SCA/3DS challenges on off-session payments (PaymentIntent enters `requires_action` --- must notify user to complete authentication)
- Rate limiting auto-replenish attempts (don't charge 100 times per minute if agents are burning through funds)
- Debouncing: use a lock or cooldown period to prevent concurrent replenish triggers
- Failed payment retry strategy (exponential backoff, max 3 attempts, then pause agents)

**How Twilio does it:** Twilio uses an "auto-recharge" system where users set a threshold (e.g., $10) and a recharge amount (e.g., $50). When the prepaid balance drops below the threshold, Twilio automatically charges the card on file. This is exactly the model NullSpend should follow.

**How Together AI does it:** Users configure a "purchase amount" (default $25) and a "trigger threshold." When balance drops below the threshold, the system automatically purchases credits. If the threshold exceeds the current balance at configuration time, multiple purchases fire immediately.

### 1.5 Stripe Treasury / Financial Accounts

**What it is:** Stripe Treasury (now called "Financial Accounts for platforms") is a Banking-as-a-Service (BaaS) product that lets platforms offer bank-account-like functionality to their connected accounts. It is built on Stripe Connect.

**How it works:**
- Each connected account gets a FinancialAccount with a real routing number and account number
- Funds are held by partner banks (Fifth Third Bank, N.A.) and are eligible for FDIC pass-through insurance up to $250K
- Money movement via InboundTransfer (pull from external bank), OutboundTransfer (push to own bank), OutboundPayment (push to third-party bank)
- Platform can issue physical/virtual cards via Stripe Issuing, funded from the FinancialAccount

**Regulatory position:** Stripe operates as a licensed money transmitter. The partner bank (Fifth Third) holds the actual banking license. Platforms using Treasury must:
- Use approved terminology ("financial account" not "bank account", "funds" not "deposits")
- Include specific FDIC disclosures
- Submit marketing materials for Stripe/bank review
- Collect KYC and present legal agreements

**Does it solve the regulatory problem?** Partially. Stripe holds the money transmitter licenses, so the platform does not need its own. But Treasury is designed for platforms where connected accounts hold their own funds (e.g., a marketplace where sellers receive payments). It is NOT designed for a simple prepaid credit system.

**Verdict for NullSpend:** Treasury is massive overkill. It requires Stripe Connect with connected accounts, bank-grade compliance, and is designed for multi-party money movement. NullSpend just needs "customer pays us, we track a credit balance, agents spend against it." Use the prepaid credit model instead.

### 1.6 Stripe Connect Balance for Holding Funds

**How it works:** In Connect, platforms can hold funds in connected account balances before paying out. Funds flow through charges and transfers.

**Holding limits:**
- US: 2 years
- Thailand: 10 days
- All other countries: 90 days

**Verdict for NullSpend:** Also overkill. Requires connected accounts, which means NullSpend's customers would each need a Stripe connected account. This is the right model if you're building a marketplace, not a credit system.

---

## 2. How Money Goes OUT — Spending Mechanisms

### 2.1 Paying Providers on Behalf of Users (API Reselling)

This is NullSpend's core model: agents make API calls through the NullSpend proxy, NullSpend pays the actual provider (OpenAI, Anthropic), and deducts from the customer's wallet.

**How platforms like OpenRouter, Together AI, and Fireworks do it:**

**OpenRouter:**
- Acts as a unified API gateway routing requests across multiple providers
- Uses their own provider API keys (customers never touch OpenAI/Anthropic keys directly)
- Credit-based system: users purchase credits, requests deduct from balance
- Pricing is per-token with a markup over provider costs
- Supports crypto payments via Coinbase
- Offers "zero completion insurance" --- no charge if provider returns empty response
- Automatic failover between providers when one is down

**Together AI:**
- Minimum $5 credit purchase to start
- Credits don't expire
- Hybrid model: pay-as-you-go up to -$100 balance (for higher tiers), then must prepay
- Auto-recharge with configurable trigger threshold and purchase amount
- Uses their own infrastructure (custom inference stack), not just proxying to OpenAI

**Replicate:**
- Two modes: prepaid credit or pay-as-you-go (monthly arrears)
- For prepaid: purchase credits, usage deducts from balance
- Early charges triggered when usage crosses fraud-detection thresholds
- Free trial for select models before requiring billing setup

**Key insight for NullSpend:** NullSpend is already doing the proxy model (Cloudflare Worker proxying to OpenAI/Anthropic using the customer's own API keys). The wallet system is an evolution: instead of customers providing their own API keys, NullSpend would use its own master keys and bill against the customer's wallet balance. This is a fundamental business model shift from "tracking tool" to "reseller."

**Alternative: Keep BYOK (Bring Your Own Key), add wallet for cost tracking only.** The wallet tracks spend against the customer's budget without NullSpend actually paying the provider. This avoids the regulatory complexity of handling customer funds for third-party payments.

### 2.2 Ledger Transfers for Internal Accounting

Agent-to-agent transfers (e.g., one budget entity paying another) are purely internal ledger operations:
- Debit source wallet, credit destination wallet
- Both sides must be in the same organization
- No real money moves, just ledger entries
- Useful for inter-team cost allocation

### 2.3 Refunds / Credits

Two types:
1. **Service credits:** NullSpend issues credit to a customer's wallet (e.g., for downtime, errors). This is a simple ledger credit --- no money actually moves back to the customer.
2. **Actual refunds:** Money returns to the customer's payment method. Use Stripe's Refund API against the original PaymentIntent, then debit the ledger.

For the prepaid credit model, service credits are vastly simpler and more common. Actual refunds should be rare (account closure, disputed charges).

---

## 3. Where Money Lives — Custody & Regulatory

### 3.1 Money Transmitter Laws — The Core Question

**Federal (FinCEN):** A money transmitter is anyone who "accepts currency, funds, or other value that substitutes for currency from one person and transmits it to another location or person." There is NO minimum threshold --- any amount of transmission activity triggers MSB (Money Services Business) status.

**Key exemptions from federal money transmitter registration:**
1. **Payment processor exemption:** A person who "acts as a payment processor to facilitate the purchase of, or payment of a bill for, a good or service through a clearance and settlement system by agreement with the creditor or seller" is NOT a money transmitter. This is the critical exemption.
2. **Prepaid access exemption:** Entities that only "provide prepaid access" are excluded, provided the prepaid program meets specific parameters regarding transaction limits and fund transfer restrictions.

**State licensing:** Even with federal exemptions, 49 US states (all except Montana) require separate money transmitter licenses. Each state has its own rules, fees ($5K-$500K+ surety bonds), and timelines (6-18 months to obtain). State exemptions vary significantly.

**The question for NullSpend:** Does NullSpend "transmit" customer funds to a third party (OpenAI/Anthropic), or does NullSpend "sell a service" (API access) and handle provider payments as an internal cost?

### 3.2 The Critical Legal Distinction

| Model | Regulatory Treatment |
|-------|---------------------|
| **Customer deposits $100, NullSpend forwards $95 to OpenAI on customer's behalf** | Likely money transmission. You're accepting funds and transmitting them to a third party. |
| **Customer buys $100 of "NullSpend Credits", NullSpend uses credits to meter access to its own service** | Likely NOT money transmission. You're selling prepaid access to your own service. The payment to OpenAI is YOUR cost of goods sold, not a transmission of customer funds. |
| **Customer provides own API key, NullSpend tracks spending against a budget** | Definitely NOT money transmission. No customer funds are involved. |

### 3.3 How Cloud Platforms Avoid Being Money Transmitters

**AWS, Google Cloud, Azure, DigitalOcean, Twilio, Vercel, etc.** all accept prepaid credits or charge postpaid for service consumption. None are licensed as money transmitters. They avoid regulation by:

1. **Selling their own service, not transmitting funds.** When you buy AWS credits, you're purchasing compute/storage/etc. from Amazon. Amazon's payments to its own infrastructure costs are not money transmission.

2. **The prepaid credit is for the platform's own goods/services.** Credits can only be redeemed on the platform, not withdrawn as cash or sent to third parties.

3. **No fungibility.** Credits cannot be converted back to dollars, transferred to other users (outside the same org), or used to purchase non-platform services.

4. **Revenue recognition.** The platform recognizes the deposit as deferred revenue (a liability), then recognizes revenue as credits are consumed. This is standard SaaS accounting.

**Twilio's model (closest analog to NullSpend):**
- Customer loads a prepaid balance (USD, not "Twilio credits")
- Auto-recharge charges card when balance drops below threshold
- Balance deducts as APIs are called (messaging, voice, etc.)
- Twilio pays its own infrastructure costs (telecom carriers, etc.) from its own revenue
- NOT a money transmitter because Twilio is selling its own communication services

### 3.4 Stripe Treasury's Regulatory Position

Stripe Treasury does solve the regulatory problem if you truly need to hold customer funds and move them to third parties. Stripe holds money transmitter licenses in all 50 states. Partner banks (Fifth Third) hold the banking charter. FDIC insurance up to $250K per depositor.

But Treasury requires:
- Stripe Connect integration with connected accounts
- Approved terminology (cannot say "bank account" or "deposits")
- Marketing material review by Stripe/bank
- KYC/KYB on all connected accounts
- Significant compliance overhead

**Verdict:** Unnecessary for NullSpend if using the prepaid credit model.

### 3.5 PCI DSS Implications

NullSpend never touches raw card numbers (Stripe handles this). As long as you:
- Use Stripe Checkout or Stripe Elements for card collection
- Never log or store card details
- Use HTTPS everywhere
- Follow Stripe's integration security guide

You qualify for **SAQ A** (the simplest PCI self-assessment questionnaire). No PCI audit needed.

### 3.6 International Considerations

**EU (PSD2/EMD2):** Issuing e-money (stored value that can be used broadly) requires an E-Money Institution license. However, "limited network" exemptions exist for closed-loop prepaid instruments usable only for specific goods/services from a specific provider. NullSpend credits, redeemable only for NullSpend-proxied API calls, would likely qualify for the limited network exemption.

**UK (FCA):** Similar to EU. Electronic money requires authorization unless the "limited network exclusion" applies.

**General principle across jurisdictions:** If the credit can only buy YOUR service and cannot be cashed out, transferred to third parties, or used broadly, it is typically exempt from payment/e-money regulation.

---

## 4. The Prepaid Credit Model (Avoiding Regulation)

### 4.1 The Model

NullSpend sells "NullSpend Credits" denominated in USD. Credits can ONLY be used to pay for AI API calls proxied through NullSpend. Credits cannot be:
- Withdrawn as cash
- Transferred to other NullSpend users (outside same org)
- Used to purchase non-NullSpend services
- Converted to cryptocurrency or other value

This is identical to how AWS sells compute credits, Twilio sells messaging credits, and Vercel sells serverless credits.

### 4.2 Legal Structure

1. **Customer pays NullSpend** for credits (via Stripe Checkout, card, ACH)
2. **NullSpend recognizes deferred revenue** (balance sheet liability)
3. **As agents consume credits**, NullSpend recognizes revenue and deducts from the credit balance
4. **NullSpend pays OpenAI/Anthropic** from its own operating funds as a cost of goods sold
5. **Customer never "sends money" to OpenAI** through NullSpend. Customer buys NullSpend's service; NullSpend independently contracts with and pays its suppliers.

**Key legal distinctions:**
- NullSpend is the merchant of record, not a payment intermediary
- The payment to providers is NullSpend's business expense, not a transmission of customer funds
- Credits are a prepaid right to consume services, not stored monetary value
- No refundability requirement (though offering voluntary refunds is good practice)

### 4.3 Terms of Service Requirements

The ToS should explicitly state:
- Credits are non-refundable (except at NullSpend's discretion or as required by law)
- Credits have no cash value and cannot be redeemed for cash
- Credits are not transferable outside the organization
- NullSpend may adjust pricing for future credit consumption
- Credits may expire after a defined inactivity period (e.g., 12 months of no use)
- NullSpend is the service provider, not a payment processor or money transmitter

### 4.4 Accounting Treatment

- **On deposit:** Debit Cash, Credit Deferred Revenue (liability)
- **On consumption:** Debit Deferred Revenue, Credit Revenue
- **On expiry (if applicable):** Debit Deferred Revenue, Credit Revenue (breakage)
- **On refund:** Debit Deferred Revenue, Credit Cash

This is standard ASC 606 revenue recognition for prepaid services.

### 4.5 Pricing Model Options

| Model | Description | Example Platforms |
|-------|-------------|-------------------|
| **Pass-through + margin** | Provider cost + fixed % markup | OpenRouter (charges provider price + small fee) |
| **Opaque credit pricing** | Fixed credit price, provider cost is hidden | AWS, Google Cloud |
| **Tiered markup** | Lower markup at higher volumes | Together AI |
| **Subscription + credits** | Monthly fee includes credit allocation, overage at per-unit rate | Vercel (Pro plan includes credit allocation) |

**Recommendation for NullSpend:** Start with pass-through + transparent margin (e.g., provider cost + 20%). Customers already know OpenAI/Anthropic pricing. Opaque pricing creates trust issues for a FinOps product.

---

## 5. Technical Architecture for a Wallet/Ledger

### 5.1 Double-Entry Bookkeeping

Every financial system should use double-entry bookkeeping where every transaction has equal debits and credits across at least two accounts.

**Core entities:**
```
accounts:
  id, org_id, type (asset|liability|revenue|expense), name, currency, created_at

ledger_entries:
  id, transaction_id, account_id, amount_cents, direction (debit|credit), created_at

ledger_transactions:
  id, org_id, description, idempotency_key, metadata, created_at
```

**Account types for NullSpend:**

| Account | Type | Normal Balance | Purpose |
|---------|------|---------------|---------|
| `cash` | Asset | Debit | NullSpend's Stripe balance |
| `customer:{orgId}:credits` | Liability | Credit | What NullSpend owes the customer in service |
| `revenue:api-usage` | Revenue | Credit | Revenue from consumed credits |
| `expense:provider:openai` | Expense | Debit | Cost of OpenAI API calls |
| `expense:provider:anthropic` | Expense | Debit | Cost of Anthropic API calls |

**Transaction examples:**

**Customer deposits $100:**
```
Debit   cash                          $100.00
Credit  customer:org_123:credits      $100.00
```

**Agent makes API call costing $0.05 (NullSpend charges $0.06 with 20% markup):**
```
Debit   customer:org_123:credits      $0.06
Credit  revenue:api-usage             $0.06

Debit   expense:provider:openai       $0.05
Credit  cash                          $0.05
```

**Refund $20 of unused credits:**
```
Debit   customer:org_123:credits      $20.00
Credit  cash                          $20.00
```

### 5.2 Event-Sourced Ledger vs. Balance Table + Transaction Log

**Option A: Event-sourced (append-only ledger, compute balances)**
- Ledger entries are immutable, never deleted or modified
- Balance = SUM(credits) - SUM(debits) for each account
- Full audit trail by construction
- Balance queries can be slow at scale without materialized views

**Option B: Balance table + transaction log (pragmatic approach)**
- Maintain a `wallet_balances` table with `balance_cents` column
- Also maintain a `wallet_transactions` log for audit
- Update balance atomically in the same transaction as the log entry
- Faster reads, but balance and log can theoretically diverge

**Option C: Hybrid (recommended)**
- Append-only transaction log as source of truth
- Materialized balance column updated transactionally with each entry
- Periodic reconciliation job verifies balance = SUM(transactions)
- Best of both worlds: fast reads + full audit trail

**Recommendation:** Option C (hybrid). This is what Stripe, Square, and most fintech companies use internally.

### 5.3 Handling Concurrent Balance Updates

Two agents spending simultaneously from the same wallet is the classic concurrency problem.

**Approach 1: Pessimistic locking (SELECT FOR UPDATE)**
```sql
BEGIN;
SELECT balance_cents FROM wallet_balances
  WHERE org_id = $1 FOR UPDATE;
-- Check if balance >= spend_amount
-- If yes:
UPDATE wallet_balances SET balance_cents = balance_cents - $2
  WHERE org_id = $1;
INSERT INTO wallet_transactions (...) VALUES (...);
COMMIT;
```
- Simple, correct, but serializes all updates to a wallet
- Fine for moderate concurrency (< 100 concurrent agents per wallet)
- NullSpend's Durable Objects already serialize budget checks per entity

**Approach 2: Optimistic locking (CAS with version)**
```sql
UPDATE wallet_balances
SET balance_cents = balance_cents - $2, version = version + 1
WHERE org_id = $1 AND version = $3 AND balance_cents >= $2;
-- Check rows affected. If 0, retry with fresh read.
```
- Higher throughput under contention
- Requires retry logic
- Good for high-concurrency scenarios

**Approach 3: Atomic decrement (best for NullSpend)**
```sql
UPDATE wallet_balances
SET balance_cents = balance_cents - $1
WHERE org_id = $2 AND balance_cents >= $1
RETURNING balance_cents;
```
- Single atomic operation, no explicit locking needed
- The `WHERE balance_cents >= $1` prevents overdraft
- If rows_affected = 0, insufficient balance
- This is how most prepaid systems work in practice

**NullSpend-specific consideration:** The proxy already has Durable Objects serializing budget checks. The wallet balance check can happen at the same layer. The Postgres write (deducting from wallet) can happen asynchronously after the request completes, similar to how cost events are currently written.

### 5.4 Authorization Holds (Reserve / Capture Pattern)

For API calls, you don't know the final cost until the response completes (especially with streaming). The hold pattern:

1. **Pre-request: Estimate and reserve.** Calculate max possible cost (e.g., max_tokens * price_per_token). Atomically decrement balance by estimated amount.
2. **Post-request: Reconcile.** Calculate actual cost from response usage. Release the difference (estimated - actual) back to the balance.

```sql
-- Reserve (pre-request)
UPDATE wallet_balances
SET balance_cents = balance_cents - $estimated,
    reserved_cents = reserved_cents + $estimated
WHERE org_id = $1 AND balance_cents >= $estimated;

-- Reconcile (post-request)
UPDATE wallet_balances
SET reserved_cents = reserved_cents - $estimated,
    balance_cents = balance_cents + ($estimated - $actual)
WHERE org_id = $1;
```

NullSpend already implements this pattern with budget reservations in Durable Objects. The wallet layer would mirror it.

### 5.5 Idempotency for Financial Transactions

Every financial operation must be idempotent. If a deposit webhook fires twice, the balance should only increase once.

**Implementation:**
- Every transaction gets a unique `idempotency_key` (e.g., Stripe PaymentIntent ID for deposits, cost event ID for spend)
- The `ledger_transactions` table has a UNIQUE constraint on `idempotency_key`
- Duplicate inserts fail silently (ON CONFLICT DO NOTHING) or return the existing transaction
- Stripe webhooks include the PaymentIntent ID which is a natural idempotency key

### 5.6 Open-Source Ledger Systems Worth Evaluating

**TigerBeetle:**
- Purpose-built financial transaction database
- 100K-500K transactions per second
- Strict double-entry enforcement at the database level
- Pending/void/post (2PC) built in
- 128-bit checksums, Jepsen-tested
- Open source (Apache 2.0)
- **Verdict:** Extremely impressive but introduces operational complexity (separate database to manage). Overkill for NullSpend's current scale. Worth revisiting if transaction volume exceeds what Postgres can handle.

**Formance (formerly Numary):**
- Open-source financial infrastructure (MIT license, YC-backed)
- Programmable double-entry, immutable ledger
- Numscript DSL for monetary computations
- Built on PostgreSQL + Kafka/NATS
- Kubernetes deployment
- **Verdict:** Interesting for learning patterns, but deploying a full Formance stack is heavyweight. Better to implement the core ledger patterns directly in NullSpend's existing Postgres.

**Recommendation:** Build a simple double-entry ledger directly in Postgres. NullSpend's transaction volume (thousands to low millions per day) is well within Postgres's capabilities. Extract to a dedicated system only if scale demands it.

---

## 6. Real-World Platform Models

### 6.1 Twilio (Closest Analog)

**Model:** Prepaid USD balance, auto-recharge
- Customer loads balance via credit card
- Auto-recharge: configurable threshold and amount (e.g., recharge $50 when balance hits $10)
- Usage deducts from balance in real-time as APIs are called
- Twilio pays its telecom carrier costs from its own revenue
- NOT a money transmitter --- sells its own communication services
- Balance is denominated in USD, not "Twilio credits"

**Key insight:** Twilio calls it a "balance" denominated in USD, not "credits." This is a branding choice. Legally, it functions the same as credits --- prepaid access to Twilio's services.

### 6.2 OpenRouter (AI API Reseller)

**Model:** Credit-based, pay-per-token
- Users purchase credits (supports crypto via Coinbase)
- Uses their own provider API keys for all upstream calls
- Per-token pricing with markup over provider costs
- Automatic failover between providers
- "Zero completion insurance" --- no charge for failed/empty responses
- Credit balance visible in dashboard and via API

**Key insight:** OpenRouter is the closest business model to what NullSpend would become with a funded wallet. They are the merchant of record, reselling API access with markup.

### 6.3 Together AI

**Model:** Hybrid prepaid + negative balance
- Minimum $5 credit purchase
- Credits don't expire
- Higher-tier users can go up to -$100 before being cut off
- Auto-recharge with configurable threshold and purchase amount
- Monthly invoicing for negative balances
- API access suspended if balance falls below -$100

**Key insight:** The negative balance allowance is clever --- it avoids blocking agents for minor balance fluctuations while still protecting against abuse.

### 6.4 Replicate

**Model:** Dual mode (prepaid or arrears)
- Prepaid: buy credits, usage deducts
- Arrears: monthly invoice for previous month's usage
- Early fraud-detection charges when usage crosses unusual thresholds
- Free trial for select models

### 6.5 DigitalOcean

**Model:** Consumption-based with balance accrual
- Charges accrue throughout the month
- Auto-billed on the 1st for previous month
- Mid-month billing triggered if usage exceeds threshold
- Promo codes can add credits
- Accepts cards, PayPal, Google Pay, Apple Pay, crypto

### 6.6 Vercel

**Model:** Subscription + metered overage
- Pro plan includes credit allocation for compute/bandwidth
- Usage beyond allocation billed as overage
- Spend Management: configurable spend cap with actions (notify, webhook, pause projects)
- Spend checked every few minutes
- Can auto-pause all production deployments at budget limit
- NOT a credit/deposit system --- subscription + metered billing

**Key insight for NullSpend:** Vercel's Spend Management is conceptually what NullSpend's budget system already does. The wallet system would add the funding/deposit layer on top.

---

## 7. Recommended Architecture for NullSpend

### 7.1 Decision: Prepaid Credits, NOT Money Transmission

**Use the prepaid credit model.** NullSpend sells credits redeemable only for NullSpend-proxied AI API calls. This:
- Avoids money transmitter licensing at federal and state level
- Avoids EU E-Money Institution licensing (limited network exemption)
- Follows the established pattern of every cloud/API platform (AWS, Twilio, DigitalOcean, OpenRouter, Together AI)
- Is well-understood by customers
- Has clear accounting treatment (deferred revenue)

### 7.2 Business Model Decision: BYOK vs. Reseller

Two paths, each with different wallet implications:

**Path A: BYOK + Wallet as Budget (Simpler, Current Model)**
- Customers still provide their own OpenAI/Anthropic API keys
- Wallet balance is a budget ceiling, not real prepaid credits
- No markup on API calls, NullSpend charges a SaaS subscription fee
- No regulatory risk at all (no customer funds held)
- Wallet is purely internal accounting

**Path B: Reseller + Wallet as Prepaid Credits (Full Evolution)**
- NullSpend uses master API keys for all providers
- Customers buy NullSpend credits and agents spend from them
- NullSpend charges provider cost + margin on each call
- Requires the prepaid credit legal structure described in Section 4
- Higher revenue potential but more complexity

**Recommendation:** Start with Path A (BYOK + wallet as budget enforcement). The wallet infrastructure is the same either way --- the only difference is whether real money flows through it. Path B can be enabled later by adding the Stripe payment integration and switching to NullSpend's provider keys.

### 7.3 Technical Implementation Plan

**Phase 1: Wallet Ledger (Internal)**
- Add `wallet_balances` and `wallet_transactions` tables to the schema
- Implement atomic balance checks in Durable Objects (alongside budget checks)
- Wallet balance becomes another budget constraint

**Phase 2: Stripe Funding (Path B only)**
- Stripe Checkout integration for one-time deposits
- Save payment method for future use
- Webhook handler for `payment_intent.succeeded` to credit ledger
- Dashboard UI for balance, transaction history, and funding

**Phase 3: Auto-Replenish (Path B only)**
- Auto-replenish settings (threshold, amount, enabled)
- Off-session PaymentIntent creation when balance is low
- Failure handling, notifications, and retry logic

**Phase 4: Provider Key Management (Path B only)**
- NullSpend master API keys for OpenAI/Anthropic
- Cost tracking against wallet balance instead of budget-only
- Markup configuration
- Provider payment reconciliation

### 7.4 Database Schema (Sketch)

```sql
-- Wallet balance (materialized, updated atomically)
CREATE TABLE wallet_balances (
  org_id TEXT PRIMARY KEY REFERENCES organizations(id),
  balance_cents BIGINT NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
  reserved_cents BIGINT NOT NULL DEFAULT 0 CHECK (reserved_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'usd',
  auto_replenish_enabled BOOLEAN NOT NULL DEFAULT false,
  auto_replenish_threshold_cents BIGINT,
  auto_replenish_amount_cents BIGINT,
  stripe_payment_method_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Immutable transaction log
CREATE TABLE wallet_transactions (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  type TEXT NOT NULL, -- 'deposit', 'spend', 'refund', 'adjustment', 'auto_replenish'
  amount_cents BIGINT NOT NULL, -- positive = credit, negative = debit
  balance_after_cents BIGINT NOT NULL,
  description TEXT,
  idempotency_key TEXT UNIQUE NOT NULL,
  stripe_payment_intent_id TEXT,
  cost_event_id TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_wallet_txn_org ON wallet_transactions(org_id, created_at DESC);
CREATE INDEX idx_wallet_txn_idempotency ON wallet_transactions(idempotency_key);
```

### 7.5 Key Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Regulatory misclassification as money transmitter | Prepaid credit model with clear ToS, legal review |
| Race condition on concurrent spend | Atomic SQL decrement with balance check in WHERE clause |
| Double-crediting from duplicate webhooks | Idempotency keys (Stripe PaymentIntent ID) |
| Auto-replenish charging too frequently | Debounce/cooldown period, rate limit to 1 per minute |
| SCA/3DS failure on off-session auto-replenish | Notify user, pause agents, provide manual re-auth flow |
| Balance drift between ledger and Stripe | Periodic reconciliation job |
| Provider costs exceeding collected credits | Estimate + reserve pattern, conservative max_tokens estimation |
| Customer disputes/chargebacks | Pause wallet on dispute, clear ToS on non-refundability |

---

## Sources

- Stripe Documentation: Treasury/Financial Accounts, Connect charges, Customer balance, Checkout, Save and reuse payment methods
- FinCEN MSB definition: 31 CFR 1010.100(ff)(5)
- Federal payment processor exemption: 31 CFR 1010.100(ff)(5)(ii)(B)
- Modern Treasury: "Accounting for Developers" series (Part I, II, III)
- TigerBeetle documentation (tigerbeetle.com)
- Formance/Numary (github.com/formancehq/stack)
- Platform billing documentation: Together AI, Replicate, DigitalOcean, Vercel, OpenRouter
- Prior NullSpend research: `agent-wallet-implementations-technical-deep-dive.md`, `agent-financial-infrastructure-landscape-2026.md`
