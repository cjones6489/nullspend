# NullSpend: 12-Month Technical Roadmap
## How to Win — Category-Defining AI Financial Infrastructure
### April 2, 2026

---

## The Category We're Defining

**"AI Usage Economics"** — the infrastructure that tells every AI-powered product which customers make money, which customers lose money, and automatically enforces the economics.

Not cost tracking. Not observability. Not governance. Not billing. The financial control plane that sits between all of them.

Stripe owns "how money moves." PostHog owns "how products learn." NullSpend owns "how AI products stay profitable."

---

## The Four Pillars of Category Ownership

### Pillar 1: Perfect-Timing Wedge
The margin table. One screenshot that shows red numbers next to customer names. Arrives at the exact moment AI SaaS companies are discovering they have negative-margin customers. Stripe just launched Token Billing. Cursor just rethought pricing. The market is waking up to AI unit economics RIGHT NOW.

### Pillar 2: Deep Integration Lock-In
Every integration creates a stakeholder who objects to canceling. Stripe (CEO/CFO need margins for board deck). Slack (eng managers need cost alerts). CRM (customer success needs churn signals). Accounting (CFO needs categorized COGS). Compliance (security team needs audit evidence). Each one is a different person in the org who says "we can't remove NullSpend."

### Pillar 3: Platform Expansion
Start as "see which customers lose you money." Expand to "enforce limits automatically." Expand to "power the usage experience your customers see." Expand to "bill your customers for AI usage." Expand to "optimize your AI costs across providers." Each expansion is a natural next question from existing customers, not a new sales motion.

### Pillar 4: Data Network Effects
Aggregate data across hundreds of customers enables benchmarking, model recommendations, and pricing intelligence that no individual company can produce alone. "The average AI SaaS company spends $0.34 per customer interaction. You spend $0.89. Here's why." Every new customer makes the data more valuable for every existing customer.

---

## Phase 0: The Wedge (Weeks 1-4)
*"See which customers are losing you money"*

### What We Ship
- **Stripe revenue sync** — User pastes restricted API key. NullSpend pulls customers and paid invoices. Stores revenue per customer per month.
- **Customer mapping** — Reserve tag key `customer`. User configures which tag maps to which Stripe customer. Auto-suggest from Stripe metadata.
- **Margin table** — Dashboard page showing customer name, revenue, AI cost, margin ($), margin (%), health status (Healthy/At Risk/Critical). Sortable. Drillable.
- **Budget remaining headers** — Every proxied response includes `X-NullSpend-Budget-Remaining`, `X-NullSpend-Request-Cost`, `X-NullSpend-Budget-Used-Percent`.
- **Structured 429 responses** — When budget exceeded, return `{ quotaExceeded: true, tier: "free", limit: "$5.00", used: "$5.01", customerId: "cust_123", upgradeUrl: "..." }`.

### What This Enables
- The homepage hero screenshot (margin table with red negative margins)
- The demo that sells itself ("connect your Stripe, see your margins in 5 minutes")
- The first conversation with real users ("I can see which customers are killing me")

### Success Metric
10 real users with production traffic within 4 weeks of shipping.

---

## Phase 1: First Users + Show HN (Weeks 5-8)
*"Stop the bleeding automatically"*

### What We Ship
- **Customer session wrapper** — `const session = nullspend.customer(customerId, { plan: "pro", tags: { feature: "analysis" } })`. One wrapper, everything handled: attribution, enforcement, upgrade prompts.
- **Plan-tier enforcement** — Configure plan limits in dashboard (Free: $5/mo, Pro: $50/mo, Enterprise: unlimited). SDK and proxy enforce automatically.
- **Usage data API** — Endpoint that returns per-customer usage: credits used, credits remaining, usage history, cost breakdown. SaaS companies query this to render their own usage UIs.
- **Privacy-first SDK documentation** — "The SDK never sees your prompts or responses. Only metadata." Make this as loud as MarginDash.
- **Open source the cost engine** — Extract `@nullspend/cost-engine` (already a separate package, 700 tests, 38+ models). MIT license. npm publish. This becomes the community entry point. Developers find the cost engine, use it for free, discover the platform.

### What We Launch With (Show HN)
- Real production stats ("tracking X requests across Y companies")
- The margin table screenshot
- A cost horror story from a real user
- "3,890 tests, atomic enforcement, 17ms overhead, Cloudflare Durable Objects"
- Open source cost engine with full model pricing database
- Lead with business pain, not technical capability

### Success Metric
Show HN with 50+ points. 50 signups in launch week. 5 converting to active users within 30 days.

---

## Phase 2: Embedded Metering Platform (Months 3-4)
*"Power the usage experience your customers see"*

### What We Ship
- **Embeddable usage components** — React components (or headless data hooks) that SaaS companies drop into their product. Usage bar, credit balance, usage history chart, plan comparison table. NullSpend provides the data and enforcement. The SaaS company owns the UI.
- **Stripe billing pass-through** — NullSpend tracks per-customer AI usage → applies configurable margin multiplier → pushes metered billing events to Stripe via Billing Meter API. Customer invoices include AI usage as a line item, generated automatically.
- **Pre-call cost estimation** — SDK counts input tokens locally, looks up model price, returns estimate before sending. Agents use this to make economic decisions.
- **Automatic request tagging** — SDK inherits customer_id, feature, workflow from session context. Every call is automatically attributed.
- **Webhook enrichment** — Budget alerts include full decision context: customer info, plan tier, cost trajectory, margin status, action links.

### Why This Is the Lock-In Moment
Once a SaaS company's customers see usage bars powered by NullSpend data, and their Stripe invoices include AI line items generated by NullSpend — removing NullSpend means rebuilding:
1. The metering and cost calculation
2. The enforcement and plan-tier logic
3. The customer-facing usage UI data source
4. The Stripe billing integration
5. The webhook-driven alerts

That's 6-8 weeks of engineering to replace. Nobody does that voluntarily.

### Success Metric
3+ customers with embedded metering in their product (their end users see NullSpend-powered usage data). 1+ customer using Stripe billing pass-through.

---

## Phase 3: Intelligence Layer (Months 5-7)
*"Make better decisions about your AI costs"*

### What We Ship
- **Cost simulator** — Pick a feature, swap the model, see projected savings with intelligence benchmarks. "Switching document-analysis from GPT-4o to GPT-4o-mini saves $2,400/month with ~10% quality trade-off." Uses actual historical data.
- **Provider billing reconciliation** — Pull actual charges from OpenAI/Anthropic billing APIs. Compare to NullSpend tracked costs. "NullSpend tracked $4,230. OpenAI billed $4,890. There's $660 in untracked spend." That gap drives more adoption (route more traffic through NullSpend to close the gap).
- **Cost anomaly detection** — Behavioral fingerprint per API key from trailing 30 days. Alert on genuine anomalies, not static thresholds. Eliminates false positive noise.
- **GitHub deploy cost correlation** — Detect cost changes per feature and correlate with merged PRs. "Costs on summarization increased 34% after PR #847 merged. Estimated annual impact: +$18K." Engineering managers use this to understand cost impact of every release.

### Why This Matters Strategically
These features are intelligence, not infrastructure. They require historical data, cross-feature analysis, and domain expertise that can't be replicated by a new entrant in a weekend. Each one makes NullSpend more valuable the longer a customer uses it (more data = better intelligence).

The cost simulator becomes the most shared screenshot from every free trial. The provider reconciliation gap is the scariest number a founder sees. The deploy correlation turns NullSpend into an engineering management tool, not just a finance tool.

### Success Metric
50+ active customers. Net revenue retention >120% (existing customers expanding usage). The cost simulator driving measurable self-serve conversion.

---

## Phase 4: Organizational Lock-In (Months 7-9)
*"Every team in the company depends on NullSpend"*

### What We Ship
- **Slack decision briefs** — Not "budget hit 80%." Full context: "Customer Plexo Health hit 80% AI quota. $49/mo plan. $277 AI cost this month. 3rd most expensive customer. Usage up 4x this week. [View] [Adjust] [Block]." Eng managers look forward to these.
- **HubSpot/Salesforce CRM integration** — Push usage signals to CRM. Usage decline = churn risk. Usage spike = upsell opportunity. Customer success sees: "Acme Corp AI usage dropped 62% this month. Churn risk: high."
- **QuickBooks/Xero integration** — Push categorized AI COGS to accounting. Not one "OpenAI" line item — broken down by feature. CFO opens QuickBooks and AI costs are categorized for board reporting.
- **Vanta/Drata compliance evidence** — Auto-generate governance evidence for SOC 2. Every budget policy = a control. Every enforcement event = evidence. Every kill switch = incident response record.
- **PagerDuty/Opsgenie integration** — Cost spike creates incident with full context: which agent, current vs normal spend, estimated cost if unchecked, one-click kill switch URL.

### The Stakeholder Map After Phase 4

| Integration | Who Depends On It | What Breaks Without It |
|------------|-------------------|----------------------|
| Stripe billing pass-through | Revenue ops | Customer invoicing breaks |
| Margin table | CEO/CFO | Lose per-customer profitability visibility |
| Slack briefs | Engineering managers | Lose real-time cost intelligence |
| CRM signals | Customer success | Lose churn prediction + upsell triggers |
| QuickBooks/Xero | CFO/bookkeeper | AI COGS disappear from financial reports |
| Vanta/Drata | Compliance team | Lose automated SOC 2 evidence |
| PagerDuty | On-call engineers | Lose cost spike incident automation |
| GitHub correlation | VP Engineering | Lose deploy cost impact analysis |
| Provider reconciliation | Finance | Lose untracked spend detection |

Nine integrations. Nine different job functions. Nine reasons nobody can cancel NullSpend.

### Success Metric
100+ active customers. Average customer using 3+ integrations. <2% monthly churn (lock-in working).

---

## Phase 5: The Data Moat (Months 9-12)
*"Gets better with every customer — no new entrant can replicate this"*

### What We Ship
- **Agent Economics Benchmarking Index** — Published quarterly. "The average AI SaaS company spends $0.34 per customer interaction. Top quartile: $0.12. Bottom quartile: $0.89." VCs reference it in due diligence. Founders benchmark against it. Media covers it. Only NullSpend can produce it.
- **Model recommendation engine** — "Your agent fleet costs $0.47/task. Similar workloads across NullSpend average $0.31. Top quartile: $0.18. Switch classification tasks to GPT-4o-mini. Estimated savings: $9,600/month." Gets better with every new customer's data.
- **Pricing simulator** — Retroactively apply proposed pricing models to actual historical usage. "If you charged $0.10/query, 80% of customers pay less, 5% pay $200+. Revenue drops 12% but margin improves from 35% to 62%." Only possible because NullSpend has the per-customer consumption data at token granularity.
- **Predictive cost forecasting** — "Based on trailing 90 days: $127K next quarter. At current 12% WoW growth: $340K by Q4. With recommended optimizations: $89K."
- **Agent P&L statements** — Per-agent, per-workflow profit and loss. The artifact a CEO opens for board meetings. "Per policy: $11.40 cost, $48 revenue, 76% margin."

### Why This Is the Moat
Every feature in Phase 5 requires aggregate data across hundreds of customers. A new entrant starting today with zero customers cannot build any of this. The data advantage compounds — each new customer makes the benchmarks more accurate, the recommendations more precise, and the forecasts more reliable.

This is the PostHog playbook. PostHog's benchmarks and product analytics intelligence are only possible because thousands of companies send them data. NullSpend's economic intelligence is only possible because hundreds of AI SaaS companies send cost and revenue data.

### Success Metric
500+ active customers. The Benchmarking Index cited in 3+ VC due diligence processes or industry publications. Model recommendations driving measurable cost savings across the customer base.

---

## The Open Source Strategy

### What We Open Source (and When)

| Package | When | Why |
|---------|------|-----|
| `@nullspend/cost-engine` | Phase 1 (month 2) | Community entry point. Developers find it, use it for free, discover the platform. 700 tests, 38+ models. MIT. |
| `@nullspend/sdk` | Phase 2 (month 3) | Client SDK is open, enforcement is platform. Same model as PostHog (open client, commercial platform). |
| Model pricing database | Phase 1 (month 2) | Publish `pricing-data.json` as standalone resource. Gets cited, linked, depended on. |
| Enforcement protocol spec | Phase 5 (month 10) | Open specification for how agents communicate spending authority. NullSpend is the reference implementation. |

### What Stays Commercial
- The proxy (Cloudflare Workers deployment, Durable Objects enforcement)
- The dashboard (margin table, analytics, customer management)
- The intelligence layer (benchmarking, recommendations, forecasting)
- The integrations (Stripe, Slack, CRM, accounting, compliance)
- Multi-tenant management and team features

### Why This Works
The open source cost engine becomes the standard way to calculate AI costs in the ecosystem. Framework integrations (Vercel AI SDK, LangChain, CrewAI) depend on it. When companies outgrow "calculate costs locally" and need "enforce budgets atomically + see margins + bill customers," they upgrade to the platform. Same motion as PostHog (open source analytics → commercial platform with collaboration, integrations, and scale).

---

## Framework Integration Priority

The order matters. Each integration unlocks a different customer segment.

| Priority | Integration | Customer Segment | Build Time |
|----------|------------|-----------------|-----------|
| 1 | **Vercel AI SDK** `withNullSpend()` | Next.js AI SaaS (largest cluster) | 1 week |
| 2 | **OpenAI Agents SDK** | Agent builders on OpenAI | 3-5 days |
| 3 | **Claude Agent SDK** | Already built (`@nullspend/claude-agent`) | Done |
| 4 | **LangChain/LangGraph** | Enterprise agent builders | 1 week |
| 5 | **CrewAI** | Multi-agent teams | 3-5 days |
| 6 | **MCP proxy** | Tool governance for Claude/Cursor | Exists |
| 7 | **Cursor/Windsurf/Claude Code proxy guide** | AI coding tool governance (enterprise) | Docs only |

### The Distribution Insight
The Vercel AI SDK integration is the single highest-leverage framework integration. Vercel's AI SDK is the default for Next.js AI applications. Next.js is the default for AI SaaS frontends. A `withNullSpend()` wrapper that adds cost tracking, per-customer attribution, and budget enforcement to any Vercel AI SDK application — with zero infrastructure changes — is the "7 lines of code" moment.

```typescript
import { withNullSpend } from '@nullspend/vercel-ai';

const ai = withNullSpend(openai, {
  customer: getCurrentUser().id,
  feature: 'document-analysis',
  plan: getCurrentUser().plan,
});
```

That's the equivalent of Stripe's `stripe.charges.create()`. Simple enough to add in an afternoon. Deep enough to never remove.

---

## The Fundraise Narrative

### The Deck Beats

**Slide 1: The Problem**
7.5% of AI SaaS customers are responsible for 45% of AI costs. Most founders don't know which ones. They're bleeding and can't see where.

**Slide 2: The Market**
$4.3B in AI API spend in 2025. Growing 3x annually. Every dollar spent needs to be tracked, attributed, enforced, and connected to revenue. 50+ companies attempting partial solutions. Zero winners.

**Slide 3: The Solution**
NullSpend is the financial control plane for AI-powered products. See which customers are profitable (margin table). Stop the unprofitable ones automatically (enforcement). Power the usage experience their customers see (embedded metering). Bill them automatically (Stripe integration).

**Slide 4: How It Works**
Three surfaces: Proxy (can't bypass, ground-truth costs), SDK (zero infrastructure, privacy-first), MCP (agent self-governance). Start with SDK. Upgrade to proxy when you need absolute enforcement.

**Slide 5: The Wedge**
The margin table. Connect Stripe, see per-customer margins in 5 minutes. [Screenshot with red negative margins.] This is the moment every founder has an "oh shit" reaction.

**Slide 6: The Platform**
Margin table → enforcement → embedded metering → billing pass-through → intelligence. Each layer creates a new stakeholder who depends on NullSpend. 9 integrations, 9 job functions, 9 reasons nobody cancels.

**Slide 7: Traction**
[Real numbers from Phase 0-1 users. Even "10 companies, X requests tracked, Y negative-margin customers discovered" is compelling at pre-seed.]

**Slide 8: Technical Moat**
3,890 tests. Atomic Durable Object enforcement (nobody else has this working correctly). 38-model cost engine. Velocity detection with circuit breakers. Human-in-the-loop approval. MCP governance. 6+ months of engineering a funded team would need to replicate.

**Slide 9: Competition**
[The positioning map from competitive intelligence. NullSpend alone in upper-right quadrant.] 50+ entrants, zero winners. Gateways track costs but don't show margins. Observability sees what happened but can't stop it. Margin tools show margins but can't enforce. We're the only product with all three.

**Slide 10: The Data Moat**
Phase 5: Agent Economics Benchmarking Index. Aggregate data across hundreds of customers enables benchmarking, model recommendations, and pricing intelligence. Gets better with every customer. New entrants can't replicate.

**Slide 11: Business Model**
Free: Open source cost engine + SDK. Pro: $79/mo (margin table, enforcement, 3 integrations). Team: $199/mo (embedded metering, Stripe billing, all integrations). Enterprise: Custom (SSO, compliance, dedicated support).

**Slide 12: The Ask**
$X pre-seed to get from 10 users to 100 users. Hire 1 frontend engineer (dashboard + embeddable components) and 1 GTM person (content + community). Founder keeps building the platform.

---

## What Must Be True For This To Work

Let's be honest about the assumptions:

1. **AI SaaS companies will adopt usage-based pricing within 12 months.** If they stay on flat-rate pricing, embedded metering is less urgent. Evidence this is happening: Cursor, Intercom, Replit all switched. Stripe built Token Billing for this market.

2. **The margin table is compelling enough to get first users without a sales team.** If founders see it and don't react, the positioning is wrong. This is the Phase 0 test — 10 users in 4 weeks or we rethink.

3. **Enforcement depth matters more than model coverage.** LiteLLM supports 100+ providers. NullSpend supports 2 (OpenAI, Anthropic) with depth. If customers need 10+ providers before caring about enforcement, we lose. Evidence for us: >90% of AI API spend is OpenAI + Anthropic.

4. **A bootstrapped/small team can move fast enough.** Stripe Token Billing going GA in 2-4 months is real urgency. If we can't ship the margin table + first users in that window, the positioning narrows.

5. **The "build it yourself" impulse can be overcome.** Founders who think they can build metering in a weekend need to be shown the Version 3-4 complexity. The margin table does this — it shows them the data they can't get from their homegrown solution.

---

## The 12-Month Timeline (Summary)

| Month | Phase | Milestone | Key Metric |
|-------|-------|-----------|-----------|
| 1-2 | **0: Wedge** | Stripe sync + margin table + first users | 10 real users |
| 2 | **1: Launch** | Show HN + open source cost engine | 50+ signups, 5 active |
| 3-4 | **2: Platform** | Embedded metering + Stripe billing pass-through | 3 customers with embedded usage |
| 5-7 | **3: Intelligence** | Cost simulator + provider reconciliation + anomaly detection | 50 active, 120% NRR |
| 7-9 | **4: Lock-in** | Slack + CRM + accounting + compliance integrations | 100 active, 3+ integrations avg |
| 9-12 | **5: Data Moat** | Benchmarking index + recommendations + forecasting | 500 active, index cited externally |

---

## The One Thing That Matters Right Now

Ship the margin table. Get 10 users. Get one story.

Everything else follows from that.

---

*Last updated: April 2, 2026*
