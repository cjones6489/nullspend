# Agent-First Platform Research: Landscape & NullSpend Opportunity

**Date:** March 2026
**Status:** Research Complete — Ready for Review

## Executive Summary

The agent economy is transitioning from "agents that call APIs" to "agents that spend real money." Payment rails are being built by Stripe, Visa, Mastercard, Skyfire, and Coinbase. The gap in the market is **who governs the financial behavior of agents across all these rails**. NullSpend is uniquely positioned to become the **financial controller for autonomous agents** — the CFO layer sitting above every payment surface.

---

## 1. Agent Payment Infrastructure Landscape

### Key Players

| Company           | What They Do                                             | Funding                             | Key Primitive                                                             |
| ----------------- | -------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------- |
| Skyfire           | Agent payment network — wallets, identity, micropayments | $9.5M seed (a16z CSX, Coinbase)     | Digital wallet per agent with spending limits, KYAPay identity protocol   |
| Payman AI         | Agent → human payments (payroll, tipping, bounties)      | Undisclosed                         | Isolated agent wallets, mandatory human approver, policy engine           |
| Coinbase AgentKit | Onchain wallets for agents (DeFi, trading, payments)     | Part of Coinbase                    | Agentic Wallets with spending limits, whitelisted contracts, TEE security |
| Stripe            | Agentic Commerce Suite — agents buying from merchants    | Public company                      | Shared Payment Tokens (SPTs) — scoped, revocable, amount-limited          |
| Crossmint         | Virtual Visa/Mastercard for agents                       | $23.6M (Ribbit, Franklin Templeton) | Virtual cards with per-tx and daily spending caps                         |
| MoonPay           | Open Wallet Standard for agents                          | Well-funded                         | Open-source OWS — universal wallet holding, signing, paying               |

### Card Networks

- **Mastercard Agent Pay** — "Agentic Tokens" with agent registration/verification, launching Q2 2026
- **Visa Intelligent Commerce** — VisaNet APIs for identity checks, spending controls, tokenized credentials, 100+ partners

### Open Standards

- **Agentic Commerce Protocol (ACP)** — jointly governed by OpenAI and Stripe, Apache 2.0, defines Create/Update/Complete Checkout endpoints
- **Stripe Shared Payment Tokens (SPTs)** — scoped to seller, amount-limited, time-limited, revocable, no PAN exposure
- **MoonPay Open Wallet Standard (OWS)** — open-source universal agent wallet layer

### Market Size

- Projected $46B AI-to-AI commerce in 3 years
- McKinsey estimates $3-5T agentic commerce by 2030
- Agent market: $8.8-10.9B in 2026, growing to $52.62B by 2030 (CAGR 46.3%)
- 250,000+ daily active on-chain AI agents in Q1 2026

---

## 2. Agent Identity & Trust

| Entity                  | What They're Building                                                           |
| ----------------------- | ------------------------------------------------------------------------------- |
| NIST                    | AI Agent Standards Initiative — identity, authorization, interop (Feb 2026)     |
| Cloud Security Alliance | Agentic Trust Framework (ATF) — maturity model: Intern → Junior → Senior agents |
| World Economic Forum    | Know Your Agent (KYA) framework — extending KYC to agents                       |
| Strata Identity         | Agent as first-class identity (not just "non-human identity")                   |
| IETF (draft)            | Agent Name Service (ANS) — DNS for agents                                       |
| Agentic AI Foundation   | Co-founded by Anthropic, Block, OpenAI — December 2025                          |

Key stat: Non-human identities outnumber humans ~50:1 in the average enterprise. 80% of IT leaders report agents acting outside expected behavior.

---

## 3. Agent-First Vertical Platforms

| Company   | Primitive                 | Why Essential                                                                                                                         |
| --------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| AgentMail | Email inboxes for agents  | $6M seed (General Catalyst). Email = identity on the internet. Agents need it for signup, 2FA, communication. 100M+ emails delivered. |
| Stripe    | Commerce primitives       | SPTs, product catalogs, payment links — all agent-accessible                                                                          |
| Coinbase  | Onchain wallet primitives | Trade, earn, deploy contracts — all via AgentKit                                                                                      |

---

## 4. The FinOps Reckoning

Key findings from industry reports:

- AI spend management adoption: 98% in 2026, up from 31% two years ago
- IDC warns G1000 orgs face 30% rise in underestimated AI infra costs by 2027
- 37% of AI companies plan to change pricing models — agentic costs higher than assumed
- "A single AI agent in an infinite loop can rack up thousands of dollars in a single afternoon"
- Gartner: by 2030, orgs embedding FinOps in agent design improve ROI by 40%

**The fundamental shift:** Traditional FinOps governs capacity. AI FinOps must govern behavior — users' behavior, models' behavior, and increasingly, agents' behavior.

---

## 5. NullSpend Opportunity Analysis

### Current Position

NullSpend is a cost tracking + budget enforcement proxy for AI API calls. Valuable, but it's the "vitamin" version — monitoring and guardrails on API spend only.

### The Gap

The gap isn't another payment rail. The gap is: **who governs the financial behavior of agents across all payment rails?**

- Stripe SPTs = the credit card
- Skyfire wallets = the bank account
- **NullSpend = the CFO / financial controller**

### Existing Assets That Transfer

NullSpend already has financial control primitives that generalize beyond API calls:

- Budget enforcement infrastructure (Durable Objects)
- Human-in-the-loop approval flows
- Real-time cost tracking and ledger
- Velocity limits and circuit breakers
- Webhook-based alerting and notifications
- Policy-driven spending controls

---

## 6. Recommended Feature Tiers

### Tier 1: Core Primitives (Build Now)

#### 1.1 Agent Wallet / Budget Account

Not a payment rail — a control plane for agent spending. Agents get a NullSpend "budget account" with hard limits (per-tx, daily, monthly, lifetime). Works across ALL spending surfaces: API calls (already built), Stripe SPTs, Skyfire wallets, direct purchases.

**Primitive:** `POST /v1/agents/{id}/wallet` → returns wallet with balance, limits, policies

#### 1.2 Policy Engine (Declarative Spending Governance)

Rules like: "Agent X can spend up to $500/day on API calls, $100/tx on purchases, requires approval above $1000." Payman has this for human payments only. Nobody has it across API + commerce + procurement.

**Primitive:** `POST /v1/policies` with rules, scopes, escalation paths

#### 1.3 Human-in-the-Loop for Financial Decisions

Extend existing HITL actions to any financial decision. Agent wants to buy a SaaS license? HITL approval. Agent wants to send a payment? HITL above threshold. CSA's ATF mandates this.

**Primitive:** `POST /v1/approvals` — agent submits intent, human approves/rejects, agent proceeds

#### 1.4 Unified Spend Ledger

Single source of truth for ALL agent financial activity: API costs, purchases, payments, subscriptions. Real-time balance, accruals, commitments (reserved but not yet spent). Required for audit/compliance per NIST standards.

**Primitive:** `GET /v1/agents/{id}/ledger` — complete financial history

### Tier 2: Differentiation Features (Build Next)

#### 2.1 Agent Identity Registry

Verifiable NullSpend identity per agent. Tied to org, with capabilities, trust level (Intern/Junior/Senior), spending history. Becomes the "credit score" for agents. Integrates with KYA, ANS, NIST framework.

#### 2.2 Cross-Platform Spending Orchestration

NullSpend as middleware between agents and payment rails. Agent says "buy this" → NullSpend checks policy → routes to Stripe SPT / Skyfire / Coinbase. Single integration point. Positioning: **Plaid for agent payments.**

#### 2.3 Anomaly Detection & Circuit Breakers

Extend velocity limits to financial anomaly detection. Detect: infinite loop spending, unusual purchase patterns, budget exhaustion trajectories. Auto-pause agents exhibiting "Agentic Resource Exhaustion."

#### 2.4 Compliance & Audit Trail

SOX-ready audit logs for all agent financial decisions. Full decision trace ("why did the agent spend this?"). Required for regulated industries.

### Tier 3: Platform Play (Future)

#### 3.1 Agent Marketplace / Procurement

Agents buying services from other agents, with NullSpend as settlement layer. Micropayment clearing.

#### 3.2 Financial Intelligence

Cross-org benchmarking, ROI attribution per agent.

---

## 7. Positioning Shift

**From:** "NullSpend — FinOps for AI API costs"
**To:** "NullSpend — Financial controls for autonomous agents"

The market is moving from "how much did my API calls cost?" to "my agents are making financial decisions autonomously and I need governance." NullSpend already has the infrastructure — it needs to be generalized beyond API calls to any agent financial activity.

---

## Sources

- Skyfire: https://skyfire.xyz/, https://techcrunch.com/2024/08/21/skyfire-lets-ai-agents-spend-your-money/
- Payman AI: https://paymanai.com/, https://docs.paymanai.com/overview/introduction
- Coinbase AgentKit: https://docs.cdp.coinbase.com/agent-kit/welcome, https://www.coinbase.com/developer-platform/discover/launches/agentic-wallets
- Stripe Agentic Commerce: https://stripe.com/blog/agentic-commerce-suite, https://docs.stripe.com/agentic-commerce/concepts/shared-payment-tokens
- AgentMail: https://www.agentmail.to/, https://techcrunch.com/2026/03/10/agentmail-raises-6m-to-build-an-email-service-for-ai-agents/
- Crossmint: https://blockeden.xyz/blog/2026/03/16/crossmint-ai-agent-virtual-cards-autonomous-payments-kya-stripe-for-agents/
- MoonPay OWS: https://cryptobriefing.com/moonpay-open-wallet-standard-ai-agents/
- NIST AI Agent Standards: https://www.nist.gov/news-events/news/2026/02/announcing-ai-agent-standards-initiative-interoperable-and-secure
- CSA Agentic Trust Framework: https://cloudsecurityalliance.org/blog/2026/02/02/the-agentic-trust-framework-zero-trust-governance-for-ai-agents
- WEF KYA: https://www.weforum.org/stories/2026/01/ai-agents-trust/
- Strata Identity: https://www.strata.io/blog/agentic-identity/new-identity-playbook-ai-agents-not-nhi-8b/
- AI FinOps Reckoning: https://analyticsweek.com/finops-for-agentic-ai-cloud-cost-2026/
- IDC FinOps Mandate: https://www.idc.com/resource-center/blog/balancing-ai-innovation-and-cost-the-new-finops-mandate/
- Blueprint FinOps Layer: https://bpcs.com/blog/why-ai-agents-need-a-finops-layer-for-roi
- Revenium State of FinOps: https://www.revenium.ai/post/the-2026-state-of-finops-report
- Agent Tools Landscape: https://www.stackone.com/blog/ai-agent-tools-landscape-2026/
- Agentic Commerce Protocol: https://docs.stripe.com/agentic-commerce/protocol
- a16z Agent Payments: https://a16z.com/newsletter/agent-payments-stack/
