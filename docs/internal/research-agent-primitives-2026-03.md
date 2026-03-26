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

Key stats:
- Non-human identities outnumber humans ~50:1 in the average enterprise
- 80% of IT leaders report agents acting outside expected behavior
- 93% of agent projects use unscoped API keys — the governance gap everyone is racing to close
- Only 28% of orgs can trace agent actions back to a human sponsor
- Only 21% maintain a real-time inventory of active agents

### Agent Auth Startups

| Company | Focus | Funding |
|---|---|---|
| Stytch (acquired by Twilio) | Connected Apps, agent OAuth, MCP auth, IsAgent detection | Acquired Nov 2025 |
| Scalekit | MCP server OAuth 2.1, token vault, agent-as-first-class-identity | $5.5M seed (Sep 2025) |
| Arcade.dev | Auth-first tool execution — agents act *as the user* via OAuth | $12M seed |
| Composio | Auth-to-action middleware, 500+ app integrations, MCP gateway | SOC 2 compliant |
| StackOne | Agent-first unified API, Unified Permissions API, prompt injection defense | $20M Series A (GV) |
| Nango | Code-first integration infra, 700+ APIs, managed OAuth | Used by Replit, Ramp |
| Keycard | Agent identity primitives (certificates), acquired Anchor.dev | Feb 2026 |

### Six Authorization Primitives (Emerging Industry Consensus)

| Authorization Primitive | NullSpend Equivalent |
|---|---|
| Scoped permissions | Budgets |
| Per-agent identity | API keys |
| User consent | HITL approval |
| Token/credential revocation | Key management |
| Audit trails | Cost events |
| Delegation control | Org-scoped access |

### Protocols

- **MCP** (Model Context Protocol) — de facto standard for agent-to-tool connections. 10,000+ public servers, 97M+ monthly SDK downloads. Donated to AAIF/Linux Foundation (Dec 2025).
- **A2A** (Agent2Agent) — Google-led, Linux Foundation governed. Agent-to-agent communication. 150+ supporting orgs.
- **XAA** (Cross App Access) — Okta's open protocol extending OAuth for agent-to-app access at scale.
- **Microsoft Entra Agent ID** — unique agent identities distinct from users and service principals. Public preview March 2026.

---

## 3. Agent-First Vertical Platforms

| Company | Primitive | Why Essential |
|---|---|---|
| AgentMail | Email inboxes for agents | $6M seed (General Catalyst). Email = identity on the internet. Agents need it for signup, 2FA, communication. 100M+ emails delivered. |
| Stripe | Commerce primitives | SPTs, product catalogs, payment links — all agent-accessible |
| Coinbase | Onchain wallet primitives | Trade, earn, deploy contracts — all via AgentKit |
| Toolhouse | Pre-built tool library + execution | 40+ tools, deploy agents as APIs, framework-agnostic tool definitions |
| Letta | Agent memory (tiered: core/recall/archival) | Agents self-edit their own memory. 74% accuracy on LoCoMo benchmark. Stateful agents = massive switching costs |
| E2B | Sandboxed code execution | Open-source Linux VMs, 150ms cold start. Used by Manus |

### Additional Payment Players

| Company | Focus | Funding |
|---|---|---|
| Natural | B2B agentic payments, traditional rails | $9.8M seed |
| Kite | Cryptographic agent identity + programmable permissions + stablecoin payments | $18M Series A (PayPal Ventures) |

### What Makes Agent Infra "Painkiller" (Not Vitamin)

1. **Solves something agents literally cannot do without** — AgentMail (email identity), Skyfire (payments), Arcade (authenticated actions). Without these, the workflow is blocked.
2. **Eliminates the hardest repeated engineering work** — Composio (tool plumbing), E2B (sandboxing), LangSmith (observability). Every team rebuilds this.
3. **Creates compounding data assets** — Letta (memory), LangSmith (eval datasets), Braintrust (scored traces). More usage = more value = harder to leave.
4. **Sits on the critical path of every request** — NullSpend (cost/budget), auth layers, observability. Processing every action = load-bearing infrastructure.

### Defensibility Hierarchy (Strongest → Weakest)

1. Stateful data that compounds (memory, eval datasets, audit trails)
2. Critical-path infrastructure with switching costs (auth, payments, identity)
3. Network effects (tool marketplaces, community integrations)
4. Compliance/trust credentials (SOC 2, deliverability reputation, bank partnerships)
5. Developer ecosystem/mindshare (weakest — can be disrupted by better DX)

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
- Stytch Agent Ready: https://stytch.com/ai-agent-ready
- Stytch Agent-to-Agent OAuth: https://stytch.com/blog/agent-to-agent-oauth-guide/
- Twilio Acquired Stytch: https://www.twilio.com/en-us/blog/company/news/twilio-to-acquire-stytch
- Auth0 for AI Agents: https://auth0.com/blog/announcing-auth0-for-ai-agents-powering-the-future-of-ai-securely/
- Okta for AI Agents: https://www.okta.com/blog/ai/okta-ai-agents-early-access-announcement/
- Microsoft Entra Agent ID: https://learn.microsoft.com/en-us/entra/agent-id/identity-platform/what-is-agent-id
- Google A2A Protocol: https://developers.googleblog.com/en/a2a-a-new-era-of-agent-interoperability/
- AAIF / MCP Donation: https://www.anthropic.com/news/donating-the-model-context-protocol-and-establishing-of-the-agentic-ai-foundation
- Arcade.dev: https://finance.yahoo.com/news/arcade-dev-scores-12m-solve-160600987.html
- Kite / PayPal Ventures: https://newsroom.paypal-corp.com/2025-09-02-Kite-Raises-18M-in-Series-A-Funding-To-Enforce-Trust-in-the-Agentic-Web
- OpenID Agent Identity Whitepaper: https://openid.net/new-whitepaper-tackles-ai-agent-identity-challenges/
- YC W26 Agent Infrastructure: https://www.buildmvpfast.com/blog/yc-w26-batch-agent-infrastructure-boom
- Agent Security State 2026: https://grantex.dev/report/state-of-agent-security-2026
- Nango Agent Auth Guide: https://nango.dev/blog/guide-to-secure-ai-agent-api-authentication
- AI Agent Payments Landscape: https://www.useproxy.ai/blog/ai-agent-payments-landscape-2026
