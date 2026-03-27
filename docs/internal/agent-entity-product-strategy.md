# Agent Entity: The Product Surface for Financial Infrastructure

**Date:** 2026-03-26
**Status:** Strategic direction — ready for deep research and architecture planning
**Related:**
- `vision-agent-financial-infrastructure.md` — long-term vision (7 primitives)
- `agent-wallet-strategy.md` — wallet research (to be updated after this direction)
- `stripe-spt-integration-strategy.md` — Stripe SPT integration (plugs into agent wallets)

---

## The Core Idea

NullSpend's financial infrastructure play needs a product surface — a thing users actually sign up to use. That thing is: **create and manage agents.**

A user comes to NullSpend and creates an agent. The agent gets a name, a wallet, a budget, approval rules, and a spending history. The user thinks they're managing agents. They're actually building on NullSpend's ledger, authorization engine, and settlement system.

This is the Stripe pattern. You don't go to Stripe and "set up payment infrastructure." You create a customer, a product, a subscription. The primitives feel like business objects. The infrastructure is underneath.

---

## What It Looks Like

### Creating an Agent

```
POST /api/agents
{
  "name": "Research Bot",
  "description": "Finds and analyzes datasets",
  "team": "ML Engineering"
}

→ Returns:
{
  "id": "agt_xxx",
  "name": "Research Bot",
  "apiKey": "ns_key_xxx",
  "wallet": {
    "balance": 0,
    "currency": "usd"
  },
  "createdAt": "2026-03-26T15:30:00Z"
}
```

The agent gets:
- A unique identity (`agt_xxx`)
- An auto-generated API key (scoped to this agent)
- A wallet (starts at $0, company funds it)
- A profile page in the dashboard

### The Dashboard Shift

**Today:** "Here are your API keys and their spend."

**After:** "Here are your agents. Here's what they're doing. Here's what they're spending."

```
Your Agents                                    Total spend: $4,230/mo

  Research Bot          ML Engineering         $2,100/mo
    Wallet: $2,900 remaining
    Status: Active, 847 requests today
    Models: GPT-4o (60%), Claude Sonnet (40%)
    [View] [Settings] [Fund wallet]

  Code Reviewer         Engineering            $890/mo
    Wallet: $1,110 remaining
    Status: Active, 234 requests today
    Models: Claude Haiku (95%), GPT-4o-mini (5%)
    [View] [Settings] [Fund wallet]

  Support Bot           Customer Success       $420/mo
    Wallet: $580 remaining
    Status: Active, 1,203 requests today
    Models: GPT-4o-mini (100%)
    [View] [Settings] [Fund wallet]
```

### Agent Profile Page

```
Research Bot                                   agt_xxx
Team: ML Engineering
Created: 2026-01-15 (71 days ago)

Wallet                          Budget
  Balance: $2,900                 $5,000/month
  Burn rate: $70/day              Spent: $2,100 (42%)
  Runway: 41 days                 Resets: April 1

Spending Breakdown (March)
  OpenAI GPT-4o:        $1,260   (60%)
  Anthropic Sonnet:     $840     (40%)

  Purchases:            $0       (wallet funded, no purchases yet)

Recent Activity
  Today 14:23  GPT-4o       $0.12   "Analyze dataset schema"
  Today 14:21  Claude       $0.08   "Summarize findings"
  Today 14:19  GPT-4o       $0.15   "Extract key metrics"
  ...

Approvals
  Pending: 0
  Approved this month: 3
  Denied this month: 0
```

---

## The Agent Entity IS the Account Primitive

The agent entity maps directly to the four atomic primitives from the vision doc:

| What the user sees | What it actually is |
|---|---|
| "Create agent" | Account primitive — funded wallet, identity, governance |
| "Set budget" | Authorization primitive — spending limits, velocity, approval thresholds |
| "Approve purchase" | HITL primitive — human oversight on financial decisions |
| "View agent spend" | Transaction primitive — unified ledger entries |
| "Agent pays Agent B" | Settlement primitive — cross-org ledger transfer |
| "Agent profile" | Identity primitive — reputation, history, trust tier |

The user never thinks about "financial infrastructure." They think about agents. The infrastructure is what makes the agents manageable.

---

## How Every Existing Primitive Snaps Into Place

| Existing Primitive | Today (key-centric) | After (agent-centric) |
|---|---|---|
| API keys | User creates keys manually | Agent gets an auto-generated key |
| Budgets | Attached to key/user/tag | Attached to agent |
| Cost events | Attributed to key ID | Attributed to named agent |
| HITL approvals | "key_7f0521bb requests approval" | "Research Bot requests approval" |
| Velocity limits | Per key | Per agent |
| Session limits | Per session ID | Per agent session |
| Tags | Manual per request | Agent has default tags (team, project) |
| Webhooks | "Budget exceeded for key_xxx" | "Research Bot exceeded its budget" |
| Dashboard | Key-centric spend tables | Agent profiles with spend, activity, approvals |

Everything becomes more meaningful when it's attached to a named agent instead of an opaque key ID.

---

## The Wallet: Funded Accounts for Agents

Each agent has a wallet. The wallet starts at $0. The company funds it.

### How money gets in

Company goes to dashboard → clicks "Fund wallet" on an agent → Stripe checkout → money lands in the agent's wallet.

Or: company funds the org treasury → allocates portions to agents. (Hierarchical: Org → Team → Agent.)

### How money goes out

**Phase 1 (API calls):** Agent makes LLM calls through the proxy. Cost is deducted from wallet in real-time. When wallet hits $0, agent stops. This is the "real money" version of budgets — no more arbitrary limits, actual funded allocations.

**Phase 2 (Purchases via Stripe SPTs):** Agent requests a purchase. NullSpend checks wallet balance + approval rules. If approved, creates a Stripe SPT funded from the wallet. Agent uses SPT to buy from merchant.

**Phase 3 (Agent-to-agent):** Agent A pays Agent B for a service. Ledger transfer — debit A's wallet, credit B's wallet. Instant. No payment rail needed.

### The key question: Where does the money actually live?

Options:
- **Stripe Treasury** — NullSpend uses Stripe Treasury to hold customer funds. Real money in a real account. Regulated but Stripe handles compliance.
- **Stripe balance / Connect** — Funds held as Stripe balance. Simpler but more limited.
- **Accounting-only** — The wallet is an accounting layer. Money flows through Stripe at transaction time (checkout to fund, SPT to spend). NullSpend never "holds" money, avoiding money transmitter regulation.

This is a key decision that needs deep research — regulatory, technical, and business model implications.

---

## Why This Is the Right Product Framing

### 1. It's what users actually want

Nobody says "I need agent financial infrastructure." They say "I'm running 10 agents and I need to manage them." The agent entity is the natural product surface.

### 2. It makes NullSpend sticky

Once agents are defined in NullSpend — with names, teams, wallets, budgets, spending history — ripping it out means losing all that context. It's not just removing a proxy from the request path. It's deleting the agent management layer.

### 3. It's the natural evolution

NullSpend already tracks spend per API key. Promoting "API key with a budget" to "named agent with a wallet" is a product upgrade, not an architecture rewrite. The primitives are the same. The framing changes everything.

### 4. It enables the long-term vision without requiring it

You can ship "create agents, fund wallets, track spend" without Stripe SPTs, without agent-to-agent settlement, without financial reputation. Each of those plugs in later. The agent entity is the stable core that everything attaches to.

### 5. It's the Trojan horse for infrastructure

The user creates an agent. Underneath, they've created: a financial account (wallet), a governance policy (budget + approval rules), an audit trail (cost events attributed to the agent), and a financial identity (agent profile with history). That's four of the seven primitives from the vision doc, delivered through a single product action.

---

## Sequencing

### Phase 1: Agent Entity + Dashboard (buildable now)
- Agent CRUD (create, read, update, delete)
- Auto-generated API key per agent
- Agent profile page (spend history, model usage, activity)
- Agent-centric dashboard (list agents, compare spend)
- Budgets attached to agents
- Cost events attributed to agents
- Webhooks reference agents by name

### Phase 2: Agent Wallets (buildable now, needs Stripe for funding)
- Wallet per agent (balance, transactions)
- Org treasury with allocation to agents
- Fund wallet via Stripe checkout
- API call costs deducted from wallet balance
- Wallet balance enforcement (empty wallet = agent stops)
- Burn rate and runway projections

### Phase 3: Agent Commerce (needs Stripe SPT access)
- Purchase authorization from wallet
- Stripe SPT creation
- Purchase events in unified ledger
- Merchant transaction history

### Phase 4: Agent-to-Agent (future)
- Cross-org agent identity
- Ledger transfers between agents
- Financial reputation / trust tiers
- Batched settlement between orgs

---

## Key Decisions (To Be Made)

1. **Agent ↔ API key relationship:** One key per agent (simplest, clearest)? Or can an agent have multiple keys (for different environments)? Or can a key be shared across agents (breaks the model)?

2. **Migration path:** Existing users have API keys with budgets. How do they transition to the agent model? Auto-create agents from existing keys? Parallel systems during migration?

3. **Wallet funding model:** Stripe checkout (one-time)? Auto-replenish? Org treasury with allocation? All three?

4. **Where money lives:** Stripe Treasury? Stripe balance? Accounting-only layer? Needs regulatory research.

5. **Team hierarchy:** Org → Team → Agent? Or flat (just Org → Agent)? Hierarchy is more powerful but more complex.

6. **Agent creation flow:** Dashboard only? API only? Both? SDK auto-creation (agent framework creates its own NullSpend agent on first run)?

---

## The Positioning

**What we say:** "Create an agent. Give it a wallet. Let it work."

**What it means:** NullSpend is where you go to deploy agents with financial controls. Not just monitoring — management. Your agents have identities, budgets, wallets, and a complete financial history. You control what they spend. They can participate in the economy.

**The Stripe analogy:** Stripe says "start accepting payments in minutes." NullSpend says "start managing agent finances in minutes." The simplicity of the product hides the depth of the infrastructure.
