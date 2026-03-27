# YC Agent Infrastructure Landscape: March 2026

**Date:** 2026-03-26
**Purpose:** Map what the smartest investors and founders think is essential agent infrastructure. Identify where NullSpend fits, where the competition is, and where the gaps are.

---

## Executive Summary

Agent infrastructure is the single biggest investment thesis in venture capital right now. YC's W26 batch (196 companies, Demo Day March 24, 2026) is 60% AI-focused, with 41.5% specifically building agent infrastructure. The stack is being reorganized around autonomy, and the venture money is flowing into six clear categories: execution environments, identity/auth, observability, payments/billing, security, and workflow orchestration.

**The critical finding for NullSpend:** Nobody has won the "FinOps for agents" category yet. The space is fragmented between gateway vendors bolting on cost tracking (Portkey, LiteLLM, Cloudflare), observability platforms adding cost views (LangChain, Braintrust), and billing platforms that don't do enforcement (Paid, Flexprice). NullSpend's focused position -- real-time budget enforcement + HITL approval + cost governance -- occupies a gap that no funded company has claimed as their primary identity.

---

## Part 1: YC Batch Analysis

### W26 (Winter 2026) -- 196 companies, Demo Day March 24, 2026

The largest and most AI-dense batch in YC history. 64% B2B. ~60% AI-focused. Rebel Fund reported 35% of W26 startups score in the top 20% of all YC companies ever evaluated -- no previous batch comes close.

**Agent Infrastructure Companies (confirmed):**

| Company | What It Does | Category |
|---------|-------------|----------|
| **Clam** (fka Baseframe) | Semantic firewall for AI agents. Scans every message for PII leaks, prompt injection, malicious code at the network level. | Security |
| **Cascade** | Guardrails and testing frameworks for trusting AI in production. | Testing/Safety |
| **Agentic Fabriq** | "Okta for Agents." Identity, governance, visibility layer. Manages agent-to-agent and agent-to-user identity, token exchange, least-privilege enforcement. | Identity/Auth |
| **Bubble Lab** (Pearl) | Ops super-employee in Slack. Agent tasks that auto-convert to deterministic workflows when repeatable. | Workflow Automation |
| **Syntropy** | Code testing via AI agents -- reads source code and PR diffs to auto-generate Playwright tests. | Testing |
| **Arcline** | Legal document drafting automation. | Vertical Agent |
| **Prox** | Ticket resolution for logistics. | Vertical Agent |
| **Callab AI** | AI voice agent platform for complex telephony environments. | Vertical Agent |
| **Carma** | AI-native fleet management platform. Already fastest-growing in fleet management, Fortune 500 clients. | Vertical Agent |
| **General Legal** | AI-native law firm with same-day turnaround. | Vertical Agent |
| **Veriad** | AI compliance officers. | Vertical Agent |
| **Pollinate** | AI agents for supply chain. | Vertical Agent |
| **o11** | Embeds intelligent automation into existing software applications. | Agent Operations |

**Key pattern:** W26 has a clear split between (a) agent infrastructure companies solving horizontal problems (security, identity, testing) and (b) vertical agent companies that ARE the AI-native version of an entire business. Very few "agent frameworks" -- the framework layer has been commoditized.

### S25 (Summer 2025) -- 169 companies

88% AI-native. Nearly 50% offer AI agents. 14 companies specifically focused on agent infrastructure for deployment.

**Notable Agent Infrastructure Companies:**

| Company | What It Does | Category |
|---------|-------------|----------|
| **AgentHub** | Simulation and evaluation engine for AI agents. Implementation-agnostic sandboxes for testing agents in realistic environments. Founded by former Apple Foundation Model Evaluation team lead. | Evaluation |
| **Fulcrum Research** | Agent debugging platform. | Debugging |
| **Mohi** | Agent monitoring/observability. | Observability |

**Key pattern:** S25 was the "production-ready AI" batch. The thesis shifted from "can we build agents?" to "can we deploy them reliably?" Infrastructure for eval, debugging, and monitoring emerged as critical needs.

### W25 (Winter 2025) -- 160 companies, Demo Day March 12, 2025

**Notable Agent Infrastructure Companies:**

| Company | What It Does | Category | Traction |
|---------|-------------|----------|----------|
| **Browser Use** | Open-source web agent framework. AI agents that navigate websites, fill forms, click menus. | Agent Execution | $17M seed (Felicis led). 50K GitHub stars in 3 months. 20+ W26 companies use it. Went viral via Manus (Chinese AI agent). |
| **Abundant** | Teleoperation for AI agents. When agents fail, human operators step in and take over (inspired by Waymo). | HITL/Reliability | YC W25 standout. Founded by ex-Waymo, ex-YouTube, ex-AWS engineers. |
| **Hyperbrowser** | Web infrastructure for AI agents. Headless browsers with stealth mode, CAPTCHA solving, proxy rotation. | Agent Execution | Backed by YC, Accel, SV Angel. 10M+ sessions processed. |

**Key pattern:** W25 established "agents need infrastructure to act in the real world" as a thesis. Browser Use proved there's massive demand for tools that let agents interact with the web. Abundant proved that human fallback is essential, not optional.

---

## Part 2: Non-YC Funded Companies (2025-2026)

### Tier 1: The Big Infrastructure Plays (>$20M raised)

| Company | Raised | What It Does | Painkiller? |
|---------|--------|-------------|-------------|
| **Keycard** | $38M (a16z seed + Acrew Series A) | Agent identity infrastructure. Ephemeral, task-scoped credentials. Founded by ex-Snyk CTO + Passport.js creator + ex-Auth0 Chief Architect. | YES. Without agent identity, enterprises cannot deploy agents that touch sensitive systems. |
| **Composio** | $29M Series A | Agent integration platform. OAuth for 500+ apps, manages full auth lifecycle. SOC 2 compliant. | YES. Agents need to authenticate to third-party services. Without this, every team rebuilds OAuth flows. |
| **Paid** | $33.3M ($10M pre-seed + $21.6M seed, Lightspeed led) | Results-based billing for AI agents. Tracks agent output, validates ROI, creates pricing models. Founded by Manny Medina (Outreach, $4.4B valuation). Over $100M valuation. | MAYBE. Solves a real problem (how do you charge for agent work?) but the problem is premature -- most agent companies haven't figured out pricing yet. |
| **E2B** | $32M total ($21M Series A, Insight Partners led) | Cloud sandboxes for AI agents. Secure isolated environments for code execution. | YES. 88% of Fortune 100 use it. Without sandboxing, agents running code are a security nightmare. |
| **Daytona** | $31M total ($24M Series A, FirstMark led) | Programmable sandbox environments for agents. CPU/memory/storage/GPU on demand. | YES. $1M ARR in under 3 months, doubled in 6 weeks. LangChain, Turing, Writer as customers. |
| **Braintrust** | $80M Series B (Iconiq led, $800M valuation) | AI observability and evaluation platform. Monitoring for hallucinations, drift, regression. | YES. Without evaluation, you can't know if your agents are working correctly. |
| **LangChain** | $125M Series B ($1.25B valuation) | Agent engineering platform. LangSmith for observability, evaluation, monitoring. | YES. $12-16M+ ARR. LangSmith trace volume 12x'd YoY. 89% of orgs have implemented agent observability. |

### Tier 2: Growing Infrastructure ($5M-$20M raised)

| Company | Raised | What It Does | Painkiller? |
|---------|--------|-------------|-------------|
| **TrueFoundry** | $21M Series A (Intel Capital led) | AI gateway + deploy + fine-tune + RAG + guardrails. "AI Operating System." | VITAMIN for most. Only ~30 customers despite $21M. Too complex for most teams. |
| **Portkey** | $18M total ($15M Series A, Elevation led) | Full-stack LLMOps. Gateway + observability + guardrails + governance. 500B+ tokens, 125M requests/day, $500K daily AI spend managed. | YES for enterprises. Processes massive volume. 24,000 orgs including Postman, Snorkel AI. |
| **Natural** | $9.8M seed (Abstract + Human Capital co-led) | Payments infrastructure for agent economy. Agents that send, receive, manage payments. Focused on B2B: logistics, property mgmt, procurement. | VITAMIN today, PAINKILLER in 18 months. Agents can't transact yet at scale, but when they can, they'll need rails. |
| **Browser Use** | $17M seed (Felicis led) | Open-source web agents. | YES. 50K stars. De facto standard for web-browsing agents. |
| **Manifold** | $8M seed (Costanoa led) | AI Detection and Response (AIDR). Runtime visibility into agent behavior, anomaly detection. Agentless deployment. Founded by creators of LLM Guard. | YES for enterprises deploying agents. Security teams need to see what agents are doing. |
| **Traceloop** | $6.1M seed (Sorenson led) | LLM observability built on OpenTelemetry (OpenLLMetry). Open-source. | VITAMIN. Nice-to-have observability, not differentiated enough from LangSmith/Braintrust. |
| **Scalekit** | $5.5M seed (Together Fund + Z47 led) | Agent authentication stack. OAuth 2.1 for MCP servers, encrypted token vault, tool-calling layer. | YES for MCP-heavy deployments. Purpose-built for the MCP auth gap. |

### Tier 3: Early Stage (<$5M raised)

| Company | Raised | What It Does | Painkiller? |
|---------|--------|-------------|-------------|
| **Flexprice** | $500K pre-seed | Usage-based billing for AI-native companies. Open source. Real-time metering, credits, top-ups. | VITAMIN. Billing infrastructure is generic, not agent-specific. |
| **AgentBudget** | Open source (unfunded) | Python SDK for agent budget limits. One-line hard dollar cap per session. Born from a $187 runaway agent incident. 1,300+ PyPI installs in 4 days. | TOY today, SIGNAL of demand. Solves a real pain (runaway costs) but is a library, not infrastructure. |
| **InfiniteWatch** | $4M pre-seed (Base10 + Sequoia scouts) | AI observability for customer interactions. Session replay + voice agent testing. 2M+ interactions/month. | VITAMIN for agent infra. More of a CX analytics play. |
| **Maxim AI** | $3M seed (Elevation led) | AI evaluation + observability. Bifrost open-source gateway (Go, 11us overhead). | VITAMIN. Good tech (Bifrost is fast) but unfocused positioning. |
| **Laminar** | $3M seed | Agent debugging and observability for AI agents. | VITAMIN. Crowded space. |
| **LiteLLM/BerriAI** | $2.1M (YC + FoundersX) | Open-source LLM proxy. 100+ providers, OpenAI-compatible. Cost tracking, guardrails, load balancing. 1B+ requests processed, 240M Docker pulls. | YES for developers. De facto OSS standard for multi-provider routing. But no business model clarity. |

### The Big Tech Incumbents

| Company | What They're Doing | Threat Level |
|---------|-------------------|-------------|
| **Stripe** | Launched Agentic Commerce Suite (Dec 2025). Machine Payments Protocol (Mar 2026). x402 protocol for agent-to-agent USDC payments. Partnership with OpenAI for ChatGPT checkout. | HIGH for agent payments. Stripe will own agent commerce rails. |
| **Cloudflare** | AI Gateway with cost tracking, caching, rate limiting. New unified billing (2026) -- pay for upstream LLM calls through Cloudflare invoice. Free tier + managed service. | MEDIUM for NullSpend. Good enough for basic cost visibility, but no budget enforcement, no HITL, no velocity detection. |
| **Datadog** | Cloud Cost Management + LLM Observability. Monitor OpenAI spend alongside infrastructure costs. | LOW-MEDIUM. Enterprise play. Bolt-on, not purpose-built. |
| **Auth0 (Okta)** | "Auth0 for AI Agents" launched. Partnership with IBM and Yubico for HITL authorization framework. | HIGH for agent auth startups. Incumbent advantage. |

---

## Part 3: YC's Stated Thesis (What They Want Built)

### Spring 2026 RFS (Request for Startups)

YC's Spring 2026 RFS lists 10 categories. The throughline: **AI that acts, not AI that helps.**

Key categories relevant to agent infrastructure:
1. **Make LLMs Easy to Train** -- APIs that abstract training, databases for large datasets
2. **AI-Native Hedge Funds** -- "swarms of agents" doing financial analysis and trading
3. **AI-Powered Agencies** -- Use AI yourself, sell the output at 100x
4. **AI Guidance for Physical Work** -- Real-time AI coaching for field workers

Every category assumes AI as foundation, not feature. The era of "add AI to your app" is over.

### YC Partner Commentary

**Garry Tan** (Managing Partner): "YC wants founders who treat AI agents not as features but as the core operating system of brand-new companies and industries."

**Jared Friedman** (Managing Director): Building moats in AI requires "a really complicated AI agent that's been finally honed over multiple years to work really well under real-world conditions." A demo version might be built in a weekend hackathon, but the 99% accuracy required for mission-critical infrastructure demands "10 times or even sometimes 100 times the amount of effort."

**Diana Hu** (General Partner): Adapted YC's classic slogan to "Build what AI agents want." Claude is the most popular model among W26 startups -- usage over 52%. The entry point for developer tools is shifting from human search to "what agents recommend."

### The Lightcone Podcast Signal

YC partners emphasized that vertical AI agents will be as transformative as SaaS but on an even greater scale. The real opportunity is "moving back to the application layer." The next wave of AI startups don't build tools for humans -- they replace human workflows entirely.

---

## Part 4: Category Map -- Where the Money Goes

### Category 1: Agent Execution Environments (SATURATING)
**Companies:** E2B ($32M), Daytona ($31M), Browser Use ($17M), Hyperbrowser (YC-backed)
**Thesis:** Agents need secure sandboxes to run code, browse the web, and interact with systems.
**Status:** Two well-funded winners (E2B, Daytona) with real traction. Category is maturing. Fortune 100 adoption.
**NullSpend relevance:** LOW. Different layer. These companies are our CUSTOMERS -- agents running in E2B/Daytona sandboxes need cost governance.

### Category 2: Agent Identity & Auth (HOT, CROWDED)
**Companies:** Keycard ($38M), Composio ($29M), Agentic Fabriq (YC W26), Scalekit ($5.5M), Alter (YC W26), Auth0 for AI Agents (incumbent)
**Thesis:** Agents need identity, authentication, and authorization. Ephemeral credentials, least-privilege access, audit trails.
**Status:** Keycard is the frontrunner with elite founders (ex-Snyk CTO, Passport.js creator, ex-Auth0 Chief Architect). But Auth0/Okta is the 800-lb gorilla.
**NullSpend relevance:** MEDIUM. Auth and cost governance are adjacent. API key management is a shared concern. But NullSpend should NOT try to become an auth platform.

### Category 3: Agent Observability & Evaluation (CROWDED, CONSOLIDATING)
**Companies:** LangChain/LangSmith ($125M, $1.25B), Braintrust ($80M, $800M), Portkey ($18M), Traceloop ($6.1M), Laminar ($3M), Maxim ($3M), Helicone (acquired by Mintlify), Arize AI ($70M)
**Thesis:** You can't deploy what you can't observe. Tracing, monitoring, eval, cost tracking.
**Status:** LangChain and Braintrust are pulling away. Helicone's acquisition by Mintlify signals consolidation. Portkey is the strongest mid-tier player with massive volume (500B tokens, $500K daily spend managed).
**NullSpend relevance:** HIGH. Cost tracking is a feature in every observability platform. But none of them do budget ENFORCEMENT. They show you what you spent -- NullSpend PREVENTS overspend. This is the critical distinction.

### Category 4: Agent Payments & Billing (EMERGING)
**Companies:** Paid ($33.3M), Natural ($9.8M), Flexprice ($500K), Stripe Agentic Commerce Suite (incumbent)
**Thesis:** The old SaaS billing models (per-seat, per-user) don't work for agents. Need usage-based, results-based, outcome-based pricing.
**Status:** Stripe is the elephant in the room. Paid has the most funding and best founder (Manny Medina). Natural is building payment rails for agents. But this category is still mostly future-looking -- agents aren't transacting at scale yet.
**NullSpend relevance:** HIGH but different angle. Paid/Natural/Flexprice help agent BUILDERS charge customers. NullSpend helps agent OPERATORS control their costs. These are complementary, not competitive. Paid helps you bill your customers; NullSpend stops your agents from bankrupting you.

### Category 5: Agent Security (HOT, EARLY)
**Companies:** Clam (YC W26), Cascade (YC W26), Manifold ($8M), Keycard ($38M, overlaps with auth)
**Thesis:** Agents need firewalls, guardrails, anomaly detection, runtime monitoring.
**Status:** Early innings. Manifold just raised $8M (March 2026). Clam is in W26. The "agentic security" category barely existed 6 months ago.
**NullSpend relevance:** MEDIUM. Budget enforcement is a security primitive (prevents financial damage from compromised agents). Velocity detection is anomaly detection. NullSpend could position as "financial security for agents" without becoming a full security platform.

### Category 6: Agent Testing & Reliability (GROWING)
**Companies:** AgentHub (YC S25), Cascade (YC W26), Syntropy (YC W26), Abundant (YC W25)
**Thesis:** Agents fail in production in ways that are hard to predict. Need simulation, evaluation, and human fallback.
**Status:** AgentHub is interesting (sandbox-based eval). Abundant's "teleoperation for agents" model is validated by Waymo's success.
**NullSpend relevance:** LOW-MEDIUM. HITL approval is a form of reliability guarantee. But NullSpend shouldn't become a testing platform.

---

## Part 5: The Painkiller Test

### PAINKILLERS (If they disappeared, things would break)

1. **E2B / Daytona** -- Without sandboxes, agents can't safely execute code. No alternative. Fortune 100 depends on them.
2. **Keycard** -- Without agent identity, enterprises can't deploy agents that touch sensitive systems. Period.
3. **LangChain/LangSmith** -- Without observability, you're flying blind. 89% of orgs already use some form of it.
4. **Browser Use** -- Without web-browsing capability, 50%+ of agent use cases are impossible. 50K stars = de facto standard.
5. **Portkey** (for high-volume users) -- 500B tokens/day through their gateway. That traffic needs to route somewhere.
6. **Stripe Agentic Commerce** -- When agents need to make payments, they'll go through Stripe. No alternative at scale.

### VITAMINS (Nice to have, but alternatives exist)

1. **Braintrust** -- Good eval platform, but LangSmith also does eval. Neither is irreplaceable.
2. **Paid** -- Interesting billing model, but most agent companies are pre-revenue. Solving a future problem.
3. **Natural** -- Agent payments will matter, but not yet at scale.
4. **TrueFoundry** -- 30 customers on $21M in funding. Good tech, bad GTM.
5. **Traceloop/Laminar/Maxim** -- Commoditized observability. Open-source alternatives everywhere.
6. **Flexprice** -- Generic usage-based billing. Not agent-specific enough.

### PATTERNS THE PAINKILLERS SHARE

1. **They solve a blocking problem** -- Without them, the agent literally cannot do the thing it needs to do (execute code, browse web, authenticate, get observed).
2. **They have massive organic adoption** -- E2B (88% Fortune 100), Browser Use (50K stars), Portkey (24K orgs). Bottom-up, not top-down sales.
3. **They're infrastructure, not features** -- They sit in the critical path of every agent request, not alongside it.
4. **They have network effects or data moats** -- More usage = better product (Portkey's routing data, LangSmith's trace corpus, E2B's sandbox optimizations).

---

## Part 6: Implications for NullSpend

### Where NullSpend Sits

NullSpend sits at the intersection of three hot categories (observability, payments/billing, security) but isn't fully captured by any of them. This is both a strength (unique positioning) and a risk (no clear category to own).

**The closest competitors by function:**

| Competitor | Cost Tracking | Budget Enforcement | HITL | Velocity/Anomaly | Session Limits |
|-----------|:---:|:---:|:---:|:---:|:---:|
| Portkey | YES | Partial (per-key limits) | NO | NO | NO |
| LiteLLM | YES | Partial (soft/hard budget per key) | NO | NO | NO |
| TrueFoundry | YES | YES (20-min polling) | Blog posts | Blog posts | Blog posts |
| Cloudflare AI GW | YES | NO (rate limits only) | NO | NO | NO |
| Helicone (acquired) | YES | NO | NO | NO | NO |
| Braintrust | YES | NO | NO | NO | NO |
| AgentBudget (OSS) | YES | YES (SDK-level) | NO | YES (loop detection) | YES |
| **NullSpend** | **YES** | **YES (real-time, pre-request)** | **YES (full lifecycle)** | **YES (shipped)** | **YES (shipped)** |

**The gap NullSpend fills:** Every competitor either (a) tracks costs but doesn't enforce, (b) enforces but at 20-minute intervals, or (c) is a Python SDK without infrastructure. NullSpend is the only product that does real-time pre-request budget enforcement as infrastructure (proxy layer), with HITL approval, velocity detection, and session limits all shipped and working.

### What the Market Signals Say

1. **Cost is a universal pain.** AgentBudget hit HN because someone's agent burned $187 in 10 minutes. Portkey manages $500K in daily AI spend. LLM costs are 40-60% of production agent expenses. This isn't a vitamin -- this is a fire everyone has.

2. **Nobody owns "FinOps for agents."** Portkey and LiteLLM track costs. Cloudflare tracks costs. LangSmith tracks costs. But NONE of them position as "the financial governance layer." They all bolt on cost features to their primary product (gateway, observability, proxy). NullSpend's identity as a FinOps platform is unclaimed.

3. **Enterprise AI spend is exploding.** Global enterprise AI agent spending projected to reach $47B by end of 2026 (up from $18B in 2024). The $3,200-$13,000/month per agent operational cost creates urgent demand for controls.

4. **HITL is validated but underserved.** Abundant (YC W25) proved the thesis that agents need human fallback. Auth0's partnership with IBM on HITL authorization confirms enterprise demand. But NullSpend is the only product that combines HITL with financial governance -- "approve this expensive action before the agent does it."

5. **The billing model is shifting.** Paid ($33.3M) and the YC RFS both point to outcome-based pricing as the future. NullSpend's cost tracking per session/agent/tag is exactly the data needed to power outcome-based billing. Future opportunity: integrate with Paid/Stripe to connect cost tracking to revenue.

### Strategic Risks

1. **Portkey's trajectory.** $15M Series A, 500B tokens/day, $500K daily spend managed, 24K orgs. They already have cost data. If they ship real-time enforcement, they could absorb NullSpend's value prop into their platform. Mitigation: NullSpend's enforcement is already shipped and battle-tested. Portkey would have to build Durable Objects-level atomic reservations, HITL workflows, velocity detection -- years of work.

2. **Cloudflare AI Gateway.** Free tier + managed service + Cloudflare's distribution. Their 2026 unified billing feature gets them closer. Mitigation: Cloudflare does rate limiting, not budget enforcement. No HITL, no velocity detection, no session limits. They're a "good enough" basic cost viewer, not a governance layer.

3. **LiteLLM's open-source momentum.** 240M Docker pulls, 1B+ requests. Has basic budget limits per virtual key. Mitigation: LiteLLM's budgets are soft/hard per key -- no real-time enforcement, no HITL, no velocity, no session limits, no webhook events. Library-level vs. infrastructure-level.

4. **Consolidation risk.** Helicone was acquired by Mintlify. The observability layer is consolidating. If a major player (Datadog, Cloudflare, Stripe) buys a cost-focused startup, NullSpend's independent positioning gets harder. Mitigation: Be the acquisition target, not the victim. Build enough unique value (HITL + enforcement + velocity) that acquirers want to buy rather than build.

### What NullSpend Should Do Next

1. **Claim the "FinOps for Agents" category.** Nobody owns it. Write the manifesto. Be the first search result. Ship the open-source proxy.

2. **Target the E2B/Daytona/Browser Use ecosystem.** These execution environments create massive agent compute costs. Their customers need cost governance. Partnership or integration is the fastest path to organic adoption.

3. **Build the Portkey bridge.** Portkey handles 500B tokens/day. NullSpend as a downstream budget enforcement layer for Portkey-routed traffic is a partnership that makes both products stronger.

4. **Exploit the AgentBudget signal.** A Python SDK with 1,300 installs in 4 days proves developers want budget controls. But they want infrastructure, not a library. NullSpend is the infrastructure version of what AgentBudget proved developers need.

5. **Position HITL as financial governance, not just workflow.** Abundant does HITL for agent reliability. Auth0 does HITL for auth. NullSpend does HITL for money. "This agent wants to spend $500 -- approve?" is the most intuitive HITL use case imaginable.

---

## Part 7: The Competitive Landscape Map

```
                        ENFORCEMENT
                            ^
                            |
                    NullSpend
                    (real-time enforcement +
                     HITL + velocity)
                            |
              TrueFoundry---|---AgentBudget (SDK)
              (20-min poll)     (library-level)
                            |
         LiteLLM ---+-------+-------+--- Portkey
         (soft/hard |       |       |    (per-key limits)
          per key)  |       |       |
                    |  TRACKING     |
     Cloudflare <---+-- ONLY ----->+---> LangSmith
     AI Gateway     |              |     Braintrust
                    |              |     Helicone (acquired)
                    |              |
                    v              v
               OBSERVATION   OBSERVATION
               (basic)       (deep)
```

---

## Sources

- [YC W26 Demo Day -- TechCrunch](https://techcrunch.com/2026/03/26/16-of-the-most-interesting-startups-from-yc-w26-demo-day/)
- [YC W26 Agent Infrastructure Boom](https://www.buildmvpfast.com/blog/yc-w26-batch-agent-infrastructure-boom)
- [YC W26 Complete Database -- The VC Corner](https://www.thevccorner.com/p/yc-w26-batch-complete-company-database)
- [YC W26 Demo Day Full Breakdown -- The VC Corner](https://www.thevccorner.com/p/yc-w26-demo-day-2026-complete-breakdown)
- [YC S25 Batch Profile -- Catalaize](https://catalaize.substack.com/p/y-combinator-s25-batch-profile-and)
- [YC S25 Production-Ready AI -- CB Insights](https://www.cbinsights.com/research/y-combinator-summer2025/)
- [10 Startups from YC W25 Demo Day -- TechCrunch](https://techcrunch.com/2025/03/13/10-startups-to-watch-from-y-combinators-w25-demo-day/)
- [YC Requests for Startups -- Spring 2026](https://www.ycombinator.com/rfs)
- [Where AI Agents Are Heading -- E2B Blog](https://e2b.dev/blog/yc-companies-ai-agents)
- [YC AI Startups 2026 Batch Breakdown -- TLDL](https://www.tldl.io/blog/yc-ai-startups-2026)
- [Portkey $15M Series A](https://portkey.ai/blog/series-a-funding/)
- [Helicone $5M Seed](https://salestools.io/en/report/helicone-5m-seed)
- [Browser Use $17M Seed -- TechCrunch](https://techcrunch.com/2025/03/23/browser-use-the-tool-making-it-easier-for-ai-agents-to-navigate-websites-raises-17m/)
- [Paid $21M Seed -- TechCrunch](https://techcrunch.com/2025/09/28/paid-the-ai-agent-results-based-billing-startup-from-manny-medina-raises-huge-21m-seed/)
- [Natural $9.8M Seed -- BusinessWire](https://www.businesswire.com/news/home/20251023151615/en/Fintech-Natural-Launches-With-$9.8M-Seed-Round-to-Power-Agentic-Payments)
- [Keycard $38M Launch -- GlobeNewsWire](https://www.globenewswire.com/news-release/2025/10/21/3170297/0/en/Keycard-Launches-to-Solve-the-AI-Agent-Identity-and-Access-Problem-With-38-Million-in-Funding.html)
- [Composio $29M Series A](https://composio.dev/blog/series-a)
- [E2B $21M Series A](https://e2b.dev/blog/series-a)
- [Daytona $24M Series A -- AlleyWatch](https://www.alleywatch.com/2026/02/daytona-ai-agent-infrastructure-sandbox-computing-developer-tools-ivan-burazin/)
- [Braintrust $80M Series B -- SiliconANGLE](https://siliconangle.com/2026/02/17/braintrust-lands-80m-series-b-funding-round-become-observability-layer-ai/)
- [LangChain $125M Series B -- Fortune](https://fortune.com/2025/10/20/exclusive-early-ai-darling-langchain-is-now-a-unicorn-with-a-fresh-125-million-in-funding/)
- [TrueFoundry $19M Series A -- BusinessWire](https://www.businesswire.com/news/home/20250206649881/en/TrueFoundry-Secures-19-Million-Series-A-Funding)
- [Manifold $8M Seed -- GlobeNewsWire](https://www.globenewswire.com/news-release/2026/03/18/3258198/0/en/Manifold-Announces-8-Million-Seed-Funding-Round.html)
- [Scalekit $5.5M Seed -- GlobeNewsWire](https://www.globenewswire.com/news-release/2025/09/16/3150871/0/en/Scalekit-gets-5-5m-as-it-launches-authentication-stack-for-AI-agents.html)
- [Traceloop $6.1M Seed -- The New Stack](https://thenewstack.io/traceloop-launches-an-observability-platform-for-llms-based-on-openllmetry/)
- [Flexprice $500K Pre-Seed -- BW Disrupt](https://www.bwdisrupt.com/article/flexprice-bags-500k-from-early-stage-vc-firm-tdv-partners-565414)
- [InfiniteWatch $4M Pre-Seed -- PR Newswire](https://www.prnewswire.com/news-releases/infinitewatch-announces-4m-pre-seed-led-by-base10-partners-302646343.html)
- [Stripe Agentic Commerce Suite](https://stripe.com/newsroom/news/agentic-commerce-suite)
- [Stripe Machine Payments Protocol](https://stripe.com/blog/agentic-commerce-suite)
- [Auth0 for AI Agents](https://auth0.com/blog/announcing-auth0-for-ai-agents-powering-the-future-of-ai-securely/)
- [AgentBudget GitHub](https://github.com/sahiljagtap08/agentbudget)
- [Abundant Launch YC](https://www.ycombinator.com/launches/MHz-abundant-on-demand-human-workforce-for-ai-agents)
- [Agentic Fabriq -- YC](https://www.ycombinator.com/companies/agentic-fabriq)
- [Clam -- YC](https://www.ycombinator.com/companies/clam)
- [AgentHub -- YC](https://www.ycombinator.com/companies/agenthub-2)
- [Garry Tan on RFS -- X](https://x.com/garrytan/status/1920153493492674984)
- [LiteLLM -- GitHub](https://github.com/BerriAI/litellm)
- [Bifrost -- GitHub](https://github.com/maximhq/bifrost)
- [AI Agent Market Data -- PYMNTS](https://www.pymnts.com/artificial-intelligence-2/2025/from-agentic-payments-to-ai-infrastructure-this-weeks-startup-funding/)
- [Linux Foundation AgentGateway](https://www.linuxfoundation.org/press/linux-foundation-welcomes-agentgateway-project)
