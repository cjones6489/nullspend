# Agent Wallet & Financial Primitives: Technical Deep Dive (March 2026)

Companion to `agent-financial-infrastructure-landscape-2026.md`. This document focuses on actual APIs, code patterns, and architectural details rather than market positioning.

---

## 1. Existing Agent Wallet Implementations

### 1.1 Skyfire

**Architecture:** Buyer/seller marketplace with JWT-based payment tokens. Not a traditional wallet --- more like a scoped prepaid debit token system.

**Developer workflow:**
1. Sign up at Skyfire Dashboard --- buyer agent account + wallet created automatically
2. Wallet is pre-funded (USDC or fiat)
3. Generate API key (shown once, copy and store)
4. Create PAY tokens scoped to specific sellers, amounts, and timeframes

**Token model (KYAPay):**
Three token types as JWTs:
- `kya` --- identity only (Know Your Agent)
- `pay` --- payment only
- `kya-pay` --- combined identity + payment

Token parameters at creation:
| Parameter | Purpose |
|-----------|---------|
| `tokenAmount` | Maximum seller charge (decimal string) |
| `sellerServiceId` | Target seller service |
| `buyerTag` | Internal tracking ID (optional) |
| `expiresAt` | Expiration (10 seconds to 24 hours) |

Tokens function as "a prepaid debit card, scoped to a specific seller, amount, and timeframe." Sellers verify via standard JWKS. Sellers can charge partial amounts --- tokens do not require full consumption.

**Agent interaction pattern:**
1. Agent calls Skyfire's Create PAY Token endpoint (seller service ID, max charge amount, expiration)
2. Skyfire returns a JWT
3. Agent passes JWT to seller via HTTP header or request body
4. Seller verifies JWT, calls their API, then calls Skyfire's Charge Token API with their seller key
5. Partial charges allowed --- seller can charge less than token amount

**Balance checking:** Agent retrieves buyer wallet balance before initiating transactions. Token listing endpoint supports date/status filters. Charge details endpoint shows authorized vs. actually-charged amounts.

**What the API does NOT expose:** No direct ledger access. No real-time balance push notifications. No webhook system documented for balance changes. Settlement is handled by Skyfire internally.

**DX verdict:** Medium complexity. Token-scoped model is good for agent-to-agent commerce but overly complex for simple "agent calls an API" scenarios. Every payment requires creating a scoped JWT first.

---

### 1.2 Payman AI

**Architecture:** Traditional banking integration with natural-language SDK wrapper. Three wallet types: USD (ACH), USDC (on-chain stablecoin), TSD (test funds).

**SDK installation and init:**
```typescript
import { PaymanClient } from "@paymanai/payman-ts";

const payman = PaymanClient.withClientCredentials({
  clientId: process.env.PAYMAN_CLIENT_ID!,
  clientSecret: process.env.PAYMAN_CLIENT_SECRET!,
});
```

**Natural language interface (the unique feature):**
```typescript
// Check balance via natural language
const raw = await payman.ask("How much money do I have in my wallet?");

// Send payment via natural language
const result = await payman.ask("Send $10 to Jane for lunch");
```

Behind `payman.ask()`: parsing, balance checks, policy evaluation, and actual transfer all happen server-side. The LLM is involved in intent parsing.

**Programmatic API (alongside natural language):**
```typescript
// Direct balance check
const balance = await payman.balances.getSpendableBalance("USD");

// List wallets
const wallets = await payman.ask("List all wallets and their balances");
```

**Policy system (the spending controls):**
- Configured in Dashboard > Policies tab
- Each wallet is protected by a Policy
- Policy parameters: daily/monthly spend limits, per-transaction limits, approval thresholds
- Threshold = point requiring human approval (e.g., threshold of $1,000 means any payment above triggers manual approval)
- Policies can be "as simple as max $100/day or as complex as multi-tier approval chains with role-based access"
- No app or agent can access a wallet without an assigned policy

**Framework integrations:** Works with Vercel AI SDK, LangChain, and other LLM frameworks. PayKit toolkit provides the bridge.

**Compliance:** SOC 2 and PCI compliant.

**DX verdict:** Very low barrier to entry. The `payman.ask()` natural-language interface is genuinely novel --- agents can interact with wallets using the same natural language they already use. But the natural-language layer adds latency and non-determinism. The programmatic API exists but is less documented.

---

### 1.3 Coinbase AgentKit / Agentic Wallets

**Architecture:** Open-source toolkit wrapping Coinbase Developer Platform (CDP) for crypto wallets. Agentic Wallets (launched February 2026) add spending controls.

**Quickstart:**
```bash
npm create onchain-agent@latest
cd onchain-agent
mv .env.local .env
npm install
npm run dev
```

**SDK structure (TypeScript):**
- Core `agentkit` package with 50+ action providers
- Wallet providers: CDP, Privy, Viem
- Framework extensions: LangChain, Vercel AI SDK, MCP
- Prerequisites: Node.js 22+, CDP Secret API Key, OpenAI API Key

**Agentic Wallet spending controls (February 2026):**
- Programmable spending limits (enforced at infrastructure layer, before execution)
- Session caps (maximum spend per agent session)
- Per-transaction size limits
- Local session keys --- contain damage if prompt/model behaves badly
- KYT (Know Your Transaction) screening blocks high-risk interactions automatically

**Security model:** Private keys never leave Coinbase infrastructure. Agents operate without touching credentials. Smart wallet API handles gasless transactions.

**Key limitation:** Crypto-native only. EVM, Solana, Bitcoin networks. No fiat wallet. If your agent needs to pay for an OpenAI API call (billed to a credit card), AgentKit does not help directly.

**DX verdict:** Excellent for crypto use cases. `npm create onchain-agent@latest` is a 5-minute path to a working agent with a wallet. But the crypto-only limitation means it is irrelevant for the primary NullSpend use case (controlling fiat-denominated LLM API spend).

---

### 1.4 Crossmint Virtual Cards

**Architecture:** Full-stack payments platform bridging crypto wallets to traditional card networks. Virtual Visa/Mastercard cards issued to agents.

**Capabilities:**
- Agent wallets (stablecoin-based: USDC, USDT)
- Virtual card issuance (Visa, Mastercard)
- Stablecoin balance management
- Purchase orchestration (any credit-card-enabled guest checkout)

**Protocol support (single API surface):**
- x402 for stablecoin payments (production-ready)
- MPP, ACP, AP2 support "as they mature"
- Visa Intelligent Commerce tokens
- Mastercard Agent Pay (private beta)

**Spending controls:**
- Programmable guardrails per card/agent
- Spending limits
- Merchant whitelisting
- Human approval above thresholds

**Coverage:** Amazon (US), Shopify merchants, flight bookings, and "any credit card-enabled guest checkout accessible via browser."

**Key technical detail:** Crossmint separates payment *delegation* from payment *execution*. You delegate a payment method to the agent, then the agent creates purchase orders against that delegation. The agent never has the raw card number.

**DX verdict:** Powerful for agent commerce (buying things). The single-API-surface claim for multiple protocols is attractive. But like AgentKit, this is about agents buying goods/services, not about controlling LLM API costs.

---

### 1.5 Stripe Issuing (for Agent Cards)

**Architecture:** Full card-issuing platform with programmatic spending controls. Not built specifically for agents but increasingly used that way.

**Creating a virtual card:**
```bash
curl https://api.stripe.com/v1/issuing/cards \
  -u sk_test_...: \
  -d type=virtual \
  -d cardholder=ich_... \
  -d currency=usd \
  -d "spending_controls[spending_limits][0][amount]=8000" \
  -d "spending_controls[spending_limits][0][interval]=per_authorization" \
  -d "spending_controls[allowed_categories][0]=car_rental_agencies"
```

**Spending controls (the critical details):**

Configurable on both Card and Cardholder level:

| Parameter | What it controls |
|-----------|-----------------|
| `spending_limits[].amount` | Max spend in smallest currency unit (cents) |
| `spending_limits[].interval` | `per_authorization`, `daily`, `weekly`, `monthly`, `yearly`, `all_time` |
| `spending_limits[].categories` | Optional MCC restriction (omit = applies to all) |
| `allowed_categories` / `blocked_categories` | Merchant category whitelist/blacklist |
| `allowed_merchant_countries` / `blocked_merchant_countries` | Geographic restrictions |

**Default limits:**
- New cards: 500 USD daily default unless explicitly configured
- Hard system limit: 10,000 USD per authorization (unconfigurable)
- Spending aggregation latency: up to 30 seconds

**Real-time authorization:** Spending controls run *before* real-time authorization webhooks fire. Can decline before `issuing_authorization.request` webhook.

**Agent-specific wrapper: CardForAgent (cardforagent.com)**

Built on Stripe Issuing, exposes 5 MCP tools:
1. `list_cards` --- enumerate active cards with balances
2. `get_card_details` --- retrieve card number, CVV, expiration
3. `check_balance` --- query account balance
4. `create_card` --- generate new card with spending parameters
5. `close_card` --- deactivate immediately

MCP configuration:
```json
{
  "mcpServers": {
    "cardforagent": {
      "type": "streamable-http",
      "url": "https://mcp.cardforagent.com/mcp",
      "headers": { "Authorization": "Bearer YOUR_TOKEN" }
    }
  }
}
```

Works with Claude, GPT, and any MCP-compatible agent. Free tier. AES-256-GCM encryption for stored card details.

**DX verdict:** Stripe Issuing is production-grade infrastructure. The spending controls API is rich and well-documented. CardForAgent wraps it nicely for agents. But: virtual cards solve "agent buys things from merchants" not "agent calls LLM APIs." You cannot make an OpenAI API call with a virtual card swipe.

---

## 2. Agent Framework Financial Patterns

### 2.1 LangChain / LangGraph

**Built-in cost tracking:**
```python
from langchain.callbacks import get_openai_callback

with get_openai_callback() as cb:
    result = agent.invoke({"input": "..."})
    print(f"Total cost: ${cb.total_cost}")
    print(f"Total tokens: {cb.total_tokens}")
```

`OpenAICallbackHandler` tracks: `total_tokens`, `prompt_tokens`, `completion_tokens`, `successful_requests`, `total_cost`.

**What is missing:** No built-in `max_cost` or `max_budget` parameter. No way to say "abort this agent run if it exceeds $5." The callback handler is *observability*, not *enforcement*. LangChain's own documentation does not provide a budget-enforcement primitive.

**LangSmith (hosted platform):** Added "unified cost tracking for LLMs, tools, retrieval" --- full-stack cost visibility. But again, tracking, not enforcement.

**Community pattern:** The DEV Community article on "How to Add Budget Control to a LangChain Agent" uses the Cycles SDK (runcycles.io) with a reserve-commit-release pattern wrapped around `AgentExecutor.invoke()`. This is a third-party solution, not LangChain-native.

### 2.2 CrewAI

**Documented controls:**
- "Hard caps and circuit breakers" to limit rounds per task
- Maximum token budgets per task
- Stop conditions
- Lightweight evaluator agent as governor (gates expensive steps)

**What this means:** CrewAI has the concept of token budgets but enforcement is cooperative (the framework respects the limit, but nothing prevents an LLM provider from being called if the framework has a bug). No real-time cross-provider budget enforcement. No reserve-commit pattern.

### 2.3 Claude Agent SDK (Anthropic)

**Cost tracking (well-documented):**

TypeScript:
```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({ prompt: "Summarize this project" })) {
  if (message.type === "result") {
    console.log(`Total cost: $${message.total_cost_usd}`);
  }
}
```

Python:
```python
from claude_agent_sdk import query, ResultMessage
import asyncio

async def main():
    async for message in query(prompt="Summarize this project"):
        if isinstance(message, ResultMessage):
            print(f"Total cost: ${message.total_cost_usd or 0}")
```

**Per-model breakdown (TypeScript only):**
```typescript
for (const [modelName, usage] of Object.entries(message.modelUsage)) {
  console.log(`${modelName}: $${usage.costUSD.toFixed(4)}`);
  console.log(`  Input tokens: ${usage.inputTokens}`);
  console.log(`  Output tokens: ${usage.outputTokens}`);
  console.log(`  Cache read: ${usage.cacheReadInputTokens}`);
  console.log(`  Cache creation: ${usage.cacheCreationInputTokens}`);
}
```

**Cumulative tracking across calls:**
```typescript
let totalSpend = 0;
for (const prompt of prompts) {
  for await (const message of query({ prompt })) {
    if (message.type === "result") {
      totalSpend += message.total_cost_usd ?? 0;
    }
  }
}
```

**What is NOT built-in:** No `max_budget_usd` enforcement at the SDK level (despite community requests). No way to say "abort if total cost exceeds X." Cost tracking is excellent; budget enforcement is absent. The SDK does not provide session-level totals --- you accumulate yourself.

**Extended thinking budget:** `budget_tokens` parameter sets a thinking token target (minimum 1,024). But this is about reasoning quality, not cost control. It is a target, not a strict limit.

### 2.4 OpenAI Assistants API / Responses API / Agents SDK

**Platform-level controls:**
- Usage Limits page: monthly budget limit (blocks requests when exceeded)
- BUT: Community reports show charges exceeding hard limits. The "Organization budget" option shows alerts, not an actual stop.
- Rate limits (TPM, RPM): throttle, do not hard-cap spend.

**Agents SDK guardrails:**
```python
from agents_sdk import Agent, InputGuardrail

@input_guardrail
async def budget_check(context, agent, input):
    # Custom budget logic here
    if over_budget:
        return GuardrailFunctionOutput(
            output_info={"message": "Budget exceeded"},
            tripwire_triggered=True  # Prevents expensive model from running
        )
```

The guardrail system can prevent expensive operations, but it is application-level logic, not infrastructure. You write the budget check yourself. There is no built-in `max_cost` parameter.

**What OpenAI actually provides:** Usage dashboards with project-level filtering. No per-agent, per-session, or per-task budgets. No reserve-commit pattern. No real-time enforcement beyond rate limits.

### 2.5 Devin (Cognition)

**Per-task budget control:** Users can set a hard spend limit per ticket (e.g., $5.00). This prevents runaway costs on individual tasks.

**Currency:** Agent Compute Units (ACUs). ~1 ACU = 15 minutes of active work. Additional ACUs at $2.25 each.

**Limitation:** No pre-execution cost estimate. Users report single moderately complex tasks consuming 900+ credits unexpectedly.

### 2.6 Manus

**Credit system:** No pre-execution cost estimate. Users report a single request consuming 1,000 free credits. Credits do not roll over. Enterprise adoption is challenged by cost unpredictability.

### 2.7 Replit Agent

**Budget controls:** Settings > Account > Billing provides alert settings and budget limits. Credits cover all usage. Once depleted, automatic pay-as-you-go kicks in.

**Key limitation:** No cost estimate before running a prompt. No hard cap to prevent runaway spending on individual tasks.

---

## 3. The Developer Experience Question

### 3.1 What Developers Do Today

**Tier 1 --- Provider Dashboard Limits:**
Set monthly cap on OpenAI/Anthropic dashboards. Coarse. Per-organization, not per-agent. Reports of being exceeded.

**Tier 2 --- Client-Side SDK Wrappers:**
```python
# AgentBudget pattern (Python, 1,300+ PyPI installs in 4 days)
from agentbudget import BudgetManager

budget = BudgetManager(max_budget=5.00)
# Monkey-patches OpenAI/Anthropic SDK clients
# In-process only, no persistence, race conditions under concurrency
```

**Tier 3 --- LLM Gateways:**
LiteLLM, Portkey, Helicone. Virtual keys with budget tracking. Some budget limits. But no per-session enforcement, no HITL, no reserve-commit.

**Tier 4 --- Custom Reserve-Commit Pattern:**
The Cycles SDK (runcycles.io) is the most architecturally sophisticated option:

```python
@cycles(estimate=5000, action_kind="llm.completion", action_name="openai:gpt-4o")
def ask(prompt: str) -> str:
    return openai.chat.completions.create(...)
```

Or the full reserve-commit-release:

```python
from runcycles import CyclesClient, ReservationCreateRequest, Subject, Action, Amount, Unit

client = CyclesClient(CyclesConfig.from_env())

# Reserve budget
res = client.create_reservation(ReservationCreateRequest(
    idempotency_key=str(uuid.uuid4()),
    subject=Subject(tenant="acme", workflow="research"),
    action=Action(kind="agent.run", name="research-task"),
    estimate=Amount(unit=Unit.USD_MICROCENTS, amount=5_000_000_000),  # $50
    ttl_ms=120_000,
))

# Execute if allowed, with graceful degradation
if res.get_body_attribute("decision") == "ALLOW_WITH_CAPS":
    llm = ChatOpenAI(model="gpt-4o-mini")  # Downgrade model
else:
    llm = ChatOpenAI(model="gpt-4o")

# Commit actual usage after
client.commit_reservation(reservation_id, CommitRequest(
    idempotency_key=f"commit-{key}",
    actual=Amount(unit=Unit.USD_MICROCENTS, amount=actual_cost),
))
```

Supports: LangChain, Vercel AI SDK, OpenAI, Anthropic, AWS Bedrock, MCP.

### 3.2 Existing SDKs/Libraries for Agent Financial Management

| Library | Language | What It Does | Limitations |
|---------|----------|-------------|-------------|
| `@paymanai/payman-ts` | TypeScript | Wallet ops, payments, natural-language interface | Banking/payments focus, not LLM cost control |
| `coinbase-agentkit` | Python/TS | Crypto wallet + onchain actions | Crypto only |
| `@open-wallet-standard/core` | Node.js/Python | Universal agent wallet standard | Crypto wallet focus |
| `runcycles` | Python/TS/Java | Reserve-commit budget enforcement | Not a wallet; pure budget authority |
| `agentbudget` | Python | Client-side budget wrapper | In-process only, race conditions |
| `litellm` | Python | LLM gateway with budget tracking | Tracking, not enforcement |

### 3.3 The Ideal Developer Experience

The 3-line aspiration:

```typescript
// Payman comes closest for payments:
const payman = PaymanClient.withCredentials({ clientId, clientSecret });
const result = await payman.ask("Send $10 to Jane for lunch");
```

```typescript
// Cycles comes closest for budget enforcement:
@cycles(estimate=5000, action_kind="llm.completion", action_name="openai:gpt-4o")
def ask(prompt): ...
```

```typescript
// NullSpend's proxy model is arguably simpler:
// Change one env var: OPENAI_BASE_URL=https://proxy.nullspend.com/v1
// Zero code changes. Budget enforcement happens at the infrastructure layer.
```

The proxy pattern (NullSpend, LiteLLM, Helicone) requires zero SDK integration. Change one URL. This is the lowest-friction DX for cost governance.

---

## 4. Standards and Protocols

### 4.1 Protocol Comparison (Technical Detail)

**x402 (Coinbase + Cloudflare, production since May 2025)**

HTTP flow:
1. Client sends `GET /resource`
2. Server responds `402 Payment Required` with `PAYMENT-REQUIRED` header (base64 JSON with payment options)
3. Client signs payment with crypto wallet, sends `PAYMENT-SIGNATURE` header
4. Server verifies via facilitator's `/verify` endpoint
5. Server settles via facilitator's `/settle` endpoint
6. Server responds `200 OK` with `PAYMENT-RESPONSE` header

Server integration (1 line):
```typescript
app.use(paymentMiddleware({
  "GET /weather": {
    accepts: [...],  // supported networks/schemes
    description: "Weather data"
  }
}));
```

Client pays with: `npm install @x402/core @x402/evm @x402/svm @x402/express`

75M+ transactions settled on Base and Solana as of March 2026. Free tier: 1,000 tx/month via CDP facilitator.

**MPP (Stripe + Tempo, launched March 18, 2026)**

HTTP flow (same 402 pattern as x402, but supports both crypto and fiat):
1. Client sends request
2. Server responds `402` with payment challenge
3. Client authorizes via Tempo wallet (crypto) or Stripe SPT (card/wallet)
4. Client retries with `Authorization` header containing payment credential
5. Server validates, returns resource + receipt

Server integration (Node.js):
```typescript
const mppx = Mppx.create({
  methods: [
    stripe.charge({
      networkId: 'internal',
      paymentMethodTypes: ['card', 'link'],
      secretKey: process.env.STRIPE_SECRET_KEY!,
    }),
  ],
  secretKey: mppSecretKey
});

const result = await mppx.charge({
  amount: '1', currency: 'usd', decimals: 2,
  description: 'Premium API access',
})(request);
```

Session-based: agent authorizes once, then makes many payments without separate on-chain tx for each.

CLI testing: `npx mppx http://localhost:4242/paid`

**ACP (Stripe + OpenAI, production via ChatGPT Instant Checkout)**

Not HTTP 402. RESTful or MCP transport. Four endpoints: CreateCheckout, UpdateCheckout, CompleteCheckout, GetCheckout.

Key primitive: Shared Payment Token (SPT)

Creating an SPT:
```bash
curl https://api.stripe.com/v1/test_helpers/shared_payment/granted_tokens \
  -d payment_method=pm_card_visa \
  -d "usage_limits[currency]"=usd \
  -d "usage_limits[max_amount]"=10000 \
  -d "usage_limits[expires_at]"=1777167868
```

Using an SPT to pay:
```bash
curl https://api.stripe.com/v1/payment_intents \
  -d amount=10000 -d currency=usd \
  -d shared_payment_granted_token=spt_123 \
  -d confirm=true
```

SPTs are scoped: specific seller, bounded by time and amount. Webhook events for lifecycle (used, deactivated). Agent never sees raw card data.

**Visa TAP (Trusted Agent Protocol)**

Agents register public keys in Visa-managed directory. Agent cryptographically signs HTTP messages. Merchant verifies signature against directory. Establishes agent identity, not just payment.

**Mastercard Agent Pay**

"Agentic Tokens" --- dynamic digital credentials from mobile payment tokenization. "Verifiable Intent" (open-source) links consumer identity + instructions + outcome into a tamper-resistant record.

**Google UCP (Universal Commerce Protocol)**

Open-source. REST + JSON-RPC transports. Interoperable with A2A, MCP, AP2. Composable capabilities (Checkout, Identity Linking). Separates payment instruments from payment handlers. On GitHub.

### 4.2 MCP and Financial Operations

MCP itself is a tool-communication protocol, not a payment protocol. But financial tools are being exposed as MCP servers:

**Worldpay MCP:** Publicly available server for payment integration. Agents can initiate payment workflows via MCP tool calls.

**CardForAgent MCP:** 5 tools (list_cards, get_card_details, check_balance, create_card, close_card).

**AgentWallet MCP (WAIaaS):** 45 tools for wallet operations, DeFi, and multi-chain transactions.

**Stripe MCP:** Official server at https://mcp.stripe.com (OAuth) or local via `npx -y @stripe/mcp --api-key=...`. 20+ financial operations.

**MoonPay Open Wallet Standard:** MCP server for wallet operations:
```javascript
import { createWallet, signMessage } from "@open-wallet-standard/core";

const wallet = createWallet("agent-treasury");
const sig = signMessage("agent-treasury", "evm", "hello");
```

**Could an agent wallet be exposed as an MCP tool?** Yes, and multiple implementations already do this. The pattern is: MCP server wraps wallet/payment API, exposes tools like `check_balance`, `send_payment`, `create_card`. Agent calls tools through standard MCP protocol. This is already happening in production.

**Could NullSpend be exposed as MCP tools?** Absolutely. Tools like `check_budget`, `get_remaining_spend`, `request_budget_increase` would let agents be financially self-aware. The agent could check its own budget before deciding whether to use an expensive model or a cheap one.

---

## 5. Technical Architecture Patterns

### 5.1 Real-Time Balance Updates

**Approaches seen in the wild:**

1. **Synchronous query (most common):** Agent calls `check_balance()` before each operation. Simple but adds latency. Used by: Payman, Crossmint, CardForAgent, most MCP wallet tools.

2. **Webhook-driven (Stripe Issuing):** Real-time authorization webhooks fire on every spend. Balance calculated server-side from ledger entries. 30-second aggregation latency for spending control enforcement.

3. **Session-based pre-authorization (MPP, Skyfire):** Agent pre-funds a session or creates a scoped token. Balance decrements within the session. No per-operation balance check needed. MPP aggregates thousands of micro-payments into single settlement transactions.

4. **Event-sourced ledger (Modern Treasury pattern):** Every transaction is an immutable event. Balance is a derived view. Optimistic locking via `lock_version` column prevents concurrent modification. Posted balance (settled) vs. pending balance (authorized but not settled).

### 5.2 Concurrent Spend Handling

This is the critical problem. Multiple agents, same wallet/budget.

**The race condition (well-documented):**
```
Agent A: check balance -> $100 remaining -> make $80 call
Agent B: check balance -> $100 remaining -> make $80 call
Result: $160 spent against $100 budget
```

**Solutions seen:**

1. **Optimistic locking (Modern Treasury):** `lock_version` column on ledger accounts. Concurrent writers get `StaleObjectError`. Retry with updated version. Simple but retry storms under high concurrency.

2. **Atomic reservation (NullSpend, Cycles):** Reserve-execute-commit. Reservation atomically decrements available balance. If two agents try to reserve from the same pool, one wins and the other gets a budget-exceeded error. This is the correct pattern.

3. **Serializable isolation (CockroachDB recommendation for agentic payments):** Database enforces serial ordering. "Agents collide on shared state such as budgets and risk flags. Under weak isolation, these collisions result in budget drift and limit violations."

4. **Durable Object single-writer (NullSpend architecture):** Each budget entity is a Cloudflare Durable Object with single-writer guarantee. All spend checks for a given budget route to the same DO instance. Zero contention by design.

5. **Smart contract enforcement (AxonFi treasury pattern):** On-chain `maxPerTxAmount` is immutable. Even if agent key is compromised, attacker is capped by on-chain limits. But: on-chain latency (seconds, not milliseconds).

### 5.3 Authorization Holds (Reserve-Execute-Commit)

**The pattern:**
1. **Reserve:** Pre-execution, atomically decrement available balance by estimated cost. If insufficient, reject.
2. **Execute:** Make the actual API call / purchase.
3. **Commit:** Post-execution, adjust reservation to actual cost. Release unused amount.
4. **Release (on failure):** If execution fails, release entire reservation back to pool.

**Implementations:**

NullSpend: `estimateMaxCost()` -> reserve in Durable Object -> proxy request to LLM provider -> `calculateActualCost()` -> reconcile. TTL on reservations for crash safety.

Cycles SDK:
```python
res = client.create_reservation(ReservationCreateRequest(
    estimate=Amount(unit=Unit.USD_MICROCENTS, amount=5_000_000_000),
    ttl_ms=120_000,  # Auto-release after 2 minutes
))
# Execute...
client.commit_reservation(reservation_id, CommitRequest(
    actual=Amount(unit=Unit.USD_MICROCENTS, amount=actual_cost),
))
# On failure:
client.release_reservation(reservation_id, ReleaseRequest(...))
```

Stripe Issuing: Authorization hold -> capture (partial or full) -> release (if declined/reversed). 30-second aggregation latency.

**Key properties:**
- Idempotency keys prevent double-charging on retries
- TTL on reservations provides crash safety (auto-release)
- `ALLOW_WITH_CAPS` decision enables graceful degradation (downgrade model instead of hard fail)

### 5.4 Ledger Architecture

**Double-entry, event-sourced (the gold standard for wallets):**

Every movement recorded as debit + credit:
```
| Entry ID | Tx ID | Account       | Debit  | Credit |
|----------|-------|---------------|--------|--------|
| 1        | tx-1  | Agent Wallet  |        | $50.00 |  (funding)
| 2        | tx-1  | Treasury      | $50.00 |        |
| 3        | tx-2  | Agent Wallet  | $5.00  |        |  (API call)
| 4        | tx-2  | Provider AR   |        | $5.00  |
```

Properties:
- Reversals as offsetting entries (never delete)
- Idempotent operations (idempotency key per entry)
- Timestamped audit trail
- Balance = SUM(credits) - SUM(debits) for each account

**NullSpend's approach (simpler):**

Not a full double-entry ledger. Cost events are append-only records. Budget enforcement via atomic counters (Durable Objects). Reconciliation queue handles eventual consistency. This is appropriate because NullSpend tracks *costs* (observational), not *money movements* (transactional). No money actually moves through NullSpend --- it just controls access to LLM APIs.

**When you need full double-entry:** When actual money moves through your system (Payman, Crossmint, Skyfire). When you need to handle refunds, chargebacks, settlements, and regulatory reporting.

**When atomic counters suffice:** When you are tracking spend against a budget and the actual money flows through the LLM provider's billing system, not yours. This is NullSpend's position.

---

## 6. Key Architectural Insight: Treasury vs. Wallet

AxonFi articulates an important distinction:

**Wallet:** Agent holds private keys, has direct fund access. If compromised, all funds at risk.

**Treasury:** Agent signs payment *intents*, but a vault holds the funds. Agent cannot withdraw. Even compromised keys are limited by immutable on-chain caps.

```javascript
// Treasury pattern --- agent signs, never holds
const result = await axon.pay({
  to: '0xvendor...',
  token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  amount: '5.00',
  memo: 'API subscription renewal',
});
```

The agent's key proves authorization eligibility. The vault verifies signature + checks policies (per-tx cap, daily limit, destination whitelist) before executing.

**NullSpend analogy:** NullSpend is the treasury pattern applied to API access instead of fund transfers. The agent does not have direct access to the LLM API. The proxy (treasury) verifies the agent's identity, checks budget policies, and only then forwards the request. The agent cannot bypass the proxy.

---

## 7. Implications for NullSpend

### 7.1 What the Market Validates

1. **Reserve-commit is the right pattern.** Cycles, Stripe auth holds, NullSpend all converge on the same architecture. The market is validating this approach.

2. **MCP is the integration surface for agent-aware tools.** Financial operations are being exposed as MCP tools (Stripe, CardForAgent, WAIaaS, MoonPay OWS). NullSpend should expose budget tools via MCP.

3. **Zero-code proxy DX wins.** The most successful observability tools (Helicone, LiteLLM) use the proxy pattern. NullSpend already does this. It is the right call.

4. **No one does cross-provider budget enforcement.** Skyfire, Payman, Crossmint, AgentKit --- all solve "agent pays for things." None solve "agent is constrained to $X across OpenAI + Anthropic + Google." This is still white space.

5. **The treasury pattern is the correct security model.** Agents should not have direct access to resources. A policy-enforcing intermediary (proxy/treasury/vault) should gate every operation.

### 7.2 Potential NullSpend MCP Tools

```json
{
  "tools": [
    { "name": "check_budget", "description": "Check remaining budget for current agent/session" },
    { "name": "get_spend_history", "description": "Get recent cost events for this session" },
    { "name": "estimate_cost", "description": "Estimate cost of a proposed operation" },
    { "name": "request_approval", "description": "Request human approval for an expensive operation" },
    { "name": "downgrade_model", "description": "Suggest cheaper model when budget is tight" }
  ]
}
```

This would make agents financially self-aware without changing their LLM calls.

### 7.3 Protocol Integration Opportunities

- **MPP/x402 as payment for NullSpend itself:** Agents could pay for NullSpend's proxy service via MPP micropayments.
- **NullSpend as enforcement layer in MPP sessions:** MPP sessions have spending limits. NullSpend could enforce more granular sub-session limits (per-tool, per-model).
- **SPT-style scoped tokens for budget delegation:** A parent agent could create a scoped "budget token" for a child agent, similar to Stripe's Shared Payment Tokens.

---

## Sources

### Skyfire
- [Skyfire Developer Documentation](https://docs.skyfire.xyz/docs/developer-documentation)
- [Skyfire Getting Started](https://docs.skyfire.xyz/docs/getting-started)
- [Skyfire Buyer Onboarding](https://docs.skyfire.xyz/docs/buyer-onboarding)
- [Skyfire Product Page](https://skyfire.xyz/product/)
- [Apify + Skyfire Integration](https://docs.apify.com/platform/integrations/skyfire)

### Payman AI
- [Payman AI Documentation](https://docs.paymanai.com/)
- [Payman TypeScript SDK](https://docs.paymanai.com/development/typescript-sdk)
- [Payman Policies](https://docs.paymanai.com/dashboard-guide/policies)
- [Payman Check Balances](https://docs.paymanai.com/sdks/check-balances)
- [Payman AI Prompt](https://docs.paymanai.com/resources/prompt)
- [PaymanAI LangChain Integration](https://python.langchain.com/docs/integrations/providers/payman-tool/)

### Coinbase AgentKit
- [AgentKit GitHub](https://github.com/coinbase/agentkit)
- [Agentic Wallets Launch (Coinbase)](https://www.coinbase.com/developer-platform/discover/launches/agentic-wallets)
- [AgentKit Welcome Docs](https://docs.cdp.coinbase.com/agent-kit/welcome)
- [Agentic Wallets (Genfinity)](https://genfinity.io/2026/02/11/coinbase-agentic-wallets-ai-agents/)
- [Agentic Wallets (BanklessTimes)](https://www.banklesstimes.com/articles/2026/02/12/coinbase-unveils-agentic-wallets-for-ai-bots-with-built-in-guardrails/)

### Crossmint
- [Crossmint AI Agent Payments Overview](https://docs.crossmint.com/solutions/ai-agents/introduction)
- [Crossmint Agentic Payments](https://www.crossmint.com/solutions/agentic-payments)
- [Crossmint Agentic Finance](https://www.crossmint.com/solutions/agentic-finance)
- [Crossmint Agent Virtual Cards (BlockEden)](https://blockeden.xyz/blog/2026/03/16/crossmint-ai-agent-virtual-cards-autonomous-payments-kya-stripe-for-agents/)
- [Agentic Payment Protocols Compared (Crossmint)](https://www.crossmint.com/learn/agentic-payments-protocols-compared)

### Stripe
- [Stripe Issuing Spending Controls](https://docs.stripe.com/issuing/controls/spending-controls)
- [Stripe Issuing Virtual Cards](https://docs.stripe.com/issuing/cards/virtual)
- [CardForAgent](https://cardforagent.com/)
- [Stripe Agent Toolkit GitHub](https://github.com/stripe/agent-toolkit)
- [Stripe MCP](https://docs.stripe.com/mcp)
- [Stripe Agentic Commerce Protocol](https://docs.stripe.com/agentic-commerce/protocol)
- [Stripe Shared Payment Tokens](https://docs.stripe.com/agentic-commerce/concepts/shared-payment-tokens)
- [Stripe ACP Specification](https://docs.stripe.com/agentic-commerce/protocol/specification)
- [Stripe MPP Docs](https://docs.stripe.com/payments/machine/mpp)
- [Stripe Agentic Commerce Suite Blog](https://stripe.com/blog/agentic-commerce-suite)
- [Stripe + OpenAI ACP Blog](https://stripe.com/blog/introducing-our-agentic-commerce-solutions)
- [Stripe MPP Blog](https://stripe.com/blog/machine-payments-protocol)

### Protocols
- [x402 GitHub](https://github.com/coinbase/x402)
- [x402 Docs (Coinbase)](https://docs.cdp.coinbase.com/x402/welcome)
- [x402 Whitepaper](https://www.x402.org/x402-whitepaper.pdf)
- [x402 Cloudflare Partnership](https://blog.cloudflare.com/x402/)
- [MPP Overview](https://mpp.dev/overview)
- [Tempo Mainnet](https://tempo.xyz/blog/mainnet/)
- [Google UCP Docs](https://developers.google.com/merchant/ucp)
- [UCP GitHub](https://github.com/Universal-Commerce-Protocol/ucp)
- [Visa TAP + Intelligent Commerce](https://corporate.visa.com/en/sites/visa-perspectives/newsroom/visa-partners-complete-secure-agentic-transactions.html)
- [Visa Developer Intelligent Commerce](https://developer.visa.com/capabilities/visa-intelligent-commerce)
- [Mastercard Agent Pay](https://www.pymnts.com/mastercard/2026/mastercard-unveils-open-standard-to-verify-ai-agent-transactions/)

### Agent Framework Cost Controls
- [Claude Agent SDK Cost Tracking](https://platform.claude.com/docs/en/agent-sdk/cost-tracking)
- [OpenAI Agents SDK Guardrails](https://openai.github.io/openai-agents-python/guardrails/)
- [LangChain OpenAICallbackHandler](https://python.langchain.com/api_reference/community/callbacks/langchain_community.callbacks.openai_info.OpenAICallbackHandler.html)
- [LangSmith Cost Tracking (Changelog)](https://changelog.langchain.com/announcements/unified-cost-tracking-for-llms-tools-retrieval)
- [Budget Control for LangChain Agents (DEV)](https://dev.to/amavashev/how-to-add-budget-control-to-a-langchain-agent-2l56)
- [CrewAI Agents Docs](https://docs.crewai.com/en/concepts/agents)

### Budget Enforcement & Ledger Architecture
- [Cycles (runcycles.io)](https://runcycles.io/)
- [AxonFi Treasury Pattern (DEV)](https://dev.to/axonfi/your-ai-agent-doesnt-need-a-wallet-it-needs-a-treasury-1dg3)
- [Agentic Wallets Architecture (Open Elements)](https://open-elements.com/posts/2026/03/12/agentic-wallets-when-ai-agents-need-to-pay/)
- [Agentic Payments Infrastructure Readiness (CockroachDB)](https://www.cockroachlabs.com/blog/agentic-payments-infrastructure-readiness/)
- [Modern Treasury Ledger Design with Optimistic Locking](https://www.moderntreasury.com/journal/designing-ledgers-with-optimistic-locking)
- [Scalable Wallet-as-a-Service (FinLego)](https://finlego.com/blog/how-to-build-a-scalable-wallet-as-a-service-platform)

### MCP Financial Tools
- [Worldpay MCP](https://financialit.net/news/payments/worldpay-accelerates-future-agentic-commerce-model-context-protocol-mcp-publicly)
- [WAIaaS Agent Wallet (DEV)](https://dev.to/walletguy/i-built-an-open-source-wallet-for-ai-agents-heres-why-2hjk)
- [MoonPay Open Wallet Standard](https://www.moonpay.com/newsroom/open-wallet-standard)
- [MoonPay OWS Press Release](https://www.prnewswire.com/news-releases/moonpay-open-sources-the-wallet-layer-for-the-agent-economy-302722116.html)
- [AgentWallet MCP Server](https://mcpservers.org/en/servers/hifriendbot/agentwallet-mcp)
- [MCP in Financial Services (Wikipedia)](https://en.wikipedia.org/wiki/Model_Context_Protocol)

### Market Landscape
- [Agent Payments Stack Map (88 projects)](https://agentpaymentsstack.com)
- [AI Agent Payments Landscape 2026 (Proxy Blog)](https://www.useproxy.ai/blog/ai-agent-payments-landscape-2026)
- [Top Agentic Payments Providers 2026 (TokenMinds)](https://tokenminds.co/blog/best-agentic-payments-solution-providers)
- [MCP and Agentic Payments (Fintechnize)](https://fintechnize.substack.com/p/mcp-new-era-for-agent-paymentsic)
- [Agentic Payments Rewriting Spend Management (Apideck)](https://www.apideck.com/blog/agentic-payments-spend-management-ai-agents)

### Agent Platforms (Cost Controls)
- [Devin Pricing (TechCrunch)](https://techcrunch.com/2025/04/03/devin-the-viral-coding-ai-agent-gets-a-new-pay-as-you-go-plan/)
- [Devin 2.0 (VentureBeat)](https://venturebeat.com/programming-development/devin-2-0-is-here-cognition-slashes-price-of-ai-software-engineer-to-20-per-month-from-500/)
- [Manus AI Pricing](https://www.eesel.ai/blog/manus-ai-pricing)
- [Replit Billing Docs](https://docs.replit.com/category/billing)
- [5 Open-Source AI Cost Control Tools (Finout)](https://www.finout.io/blog/5-open-source-tools-to-control-your-ai-api-costs-at-the-code-level)
