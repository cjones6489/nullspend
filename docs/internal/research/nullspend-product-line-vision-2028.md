# NullSpend: The Full Product Line
## 2-Year Vision (April 2026 → April 2028)
## "The Financial Operating System for AI-Powered Products"

---

## How Platform Companies Expand

Every infrastructure company follows the same pattern:

1. **Wedge** — One tool dramatically easier than alternatives
2. **Adjacent data** — Products using data already flowing through the wedge
3. **Workflow expansion** — Extend the user's workflow before and after the wedge
4. **Platform lock-in** — Data, integrations, and identity that make switching costly
5. **Platform completeness** — Fill every gap so customers never need another vendor

Stripe started with a payments API. Now they have 28 products spanning billing, treasury, issuing, identity, tax, compliance, and agent commerce. PostHog started with analytics. Now they have 15 products replacing Amplitude, FullStory, LaunchDarkly, Optimizely, Sentry, and Segment. Datadog started with infrastructure monitoring. Now they have ~40 separately billable products.

The proxy position is the strongest expansion base. Every AI API call that flows through NullSpend generates data that feeds every product below.

---

## The NullSpend Product Line

### CORE INFRASTRUCTURE (Already Built / Phase 0)

These are the foundation everything else builds on.

---

#### 1. NullSpend Proxy

**What it is:** Transparent AI proxy deployed on Cloudflare's edge network. Swap your base URL, every request flows through NullSpend. Zero code changes.

**What it does:**
- Ground-truth cost calculation from actual provider responses (not estimates)
- Per-request logging: model, tokens, cost, latency, tags, session, trace
- Request/response body storage (opt-in, R2-backed, 1MB cap)
- Header injection: budget remaining, request cost, budget used %
- Supports OpenAI and Anthropic (Google Vertex, Mistral, Cohere on roadmap)

**Who uses it:** Any developer who wants cost visibility and enforcement without changing code. AI coding tool governance (Cursor, Claude Code, Windsurf — just change the base URL).

**Competitive position:** Cloudflare AI Gateway and LiteLLM offer basic proxying for free. NullSpend differentiates on exact cost calculation (from response, not estimates), enforcement depth, and the platform of products built on top.

**Status:** Shipped. 1,309 tests.

---

#### 2. NullSpend SDK

**What it is:** TypeScript SDK that wraps any `fetch` call. `createTrackedFetch` intercepts AI API calls, tracks costs, enforces budgets, and reports to the NullSpend dashboard — without routing traffic through a proxy.

**What it does:**
- Client-side cost tracking for any HTTP call
- Mandate enforcement (allowed models, max cost, providers)
- Budget enforcement with local policy cache
- Session limit enforcement
- Tag inheritance from session context
- `safeDenied` / `warnSessionDenied` helpers for graceful degradation

**Who uses it:** SaaS companies embedding AI features who want cost tracking without adding a proxy in the critical path. Privacy-sensitive industries (healthcare, legal).

**Competitive position:** MarginDash has an SDK. MarginMeter has an SDK. Neither has the enforcement depth (mandates, velocity, sessions) or the upgrade path to proxy.

**Status:** Shipped. 323 tests. Full enforcement parity with proxy.

---

#### 3. NullSpend MCP Server

**What it is:** Model Context Protocol server that lets AI agents query and negotiate their own budgets. The agent asks "how much can I spend?" and acts accordingly.

**What it does:**
- `check_budget` — agent queries its remaining budget
- `request_budget_increase` — agent requests more budget with justification
- Budget negotiation via Slack threads with human approval
- Full MCP proxy for tool governance

**Who uses it:** Teams deploying autonomous agents (Claude, Cursor, Windsurf) who want agent self-governance.

**Competitive position:** Nobody else has this. Cycles has MCP integration but no budget negotiation. AgentBouncr has tool governance but no cost awareness.

**Status:** Shipped. 62 tests.

---

### ECONOMICS PRODUCTS (Phase 0-2, Months 1-4)

These turn cost data into business intelligence.

---

#### 4. NullSpend Margins

**What it is:** Connect Stripe, see per-customer profitability. The margin table — revenue alongside AI cost, margin dollars, margin percentage, health status.

**What it does:**
- Stripe revenue sync (restricted API key → pull customers + paid invoices)
- Customer mapping (Stripe customer ID ↔ NullSpend customer tag)
- Per-customer margin table: revenue, AI cost, margin, margin %, trend
- Health labels: Healthy (≥50%), At Risk (0-50%), Critical (<0%)
- Drill-down: per-model, per-feature, per-time breakdown per customer
- Period comparison: this month vs last month vs custom range

**Who uses it:** AI SaaS founders/CEOs who need to know which customers are profitable. CFOs preparing board decks. Pricing teams evaluating plan changes.

**Competitive position:** MarginDash and MarginMeter both attempt this. Neither has ground-truth cost data from proxy. Stripe Token Billing can compute markup margins but not actual cost-of-goods margins at the feature level.

**Status:** Phase 0. Weeks 1-2.

---

#### 5. NullSpend Enforce

**What it is:** Real-time budget enforcement at every layer — per-customer, per-key, per-tag, per-session. Atomic, race-condition-free, with graduated responses.

**What it does:**
- Hard budget limits enforced atomically via Durable Objects
- Velocity detection — sliding window rate monitoring with circuit breakers
- Session-level spending limits
- Human-in-the-loop approval workflows
- Budget negotiation via Slack threads
- Graduated policy: strict_block / soft_block / warn
- Structured 429 responses with quota data and upgrade URL
- Monthly/weekly/daily/yearly auto-reset

**Who uses it:** Any AI SaaS company that needs to prevent overspend. Free-tier abuse prevention. Enterprise cost governance.

**Competitive position:** Nobody has this depth. LiteLLM has budget limits with known bypass bugs. Cloudflare has daily spend limits. Bifrost has hierarchical budgets. None have velocity detection, HITL, MCP negotiation, session limits, or graduated policies.

**Status:** Shipped. 500+ enforcement-specific tests.

---

#### 6. NullSpend Meter

**What it is:** Embedded metering infrastructure. SaaS companies use NullSpend to power the usage experience their end customers see — usage bars, credit balances, plan comparisons, upgrade prompts.

**What it does:**
- Customer session wrapper: `nullspend.customer(customerId, { plan: "pro" })`
- Plan-tier configuration in dashboard (Free: $5/mo, Pro: $50/mo, etc.)
- Usage data API: credits used, credits remaining, history, breakdown
- Event hooks: 80% warning, 100% block, upgrade trigger
- Pre-call cost estimation (count tokens locally, look up price, return estimate)
- Automatic request tagging from session context

**Who uses it:** AI SaaS companies shipping usage-based features. Product managers who need usage limits before launch. Anyone who'd otherwise spend 3-4 weeks building metering infrastructure.

**Competitive position:** Orb, Metronome, and Lago do generic metering but don't understand AI costs. Credyt does AI-specific billing but no enforcement or customer-facing usage data. Nobody combines AI cost calculation + enforcement + embeddable usage data.

**Status:** Phase 2. Months 3-4.

---

#### 7. NullSpend Billing

**What it is:** Stripe billing pass-through. NullSpend tracks per-customer AI usage, applies a configurable margin multiplier, and pushes metered billing events to Stripe. Customer invoices include AI usage as an automatically-generated line item.

**What it does:**
- Configurable markup per plan tier (e.g., free: 0% markup, pro: 30%, enterprise: custom)
- Push metered events to Stripe Billing Meter API
- Per-feature line items on invoices ("AI Document Analysis: 2,340 credits — $23.40")
- Reconciliation: NullSpend tracked cost vs Stripe billed amount
- Revenue recognition data for accounting

**Who uses it:** AI SaaS companies that want usage-based billing without building billing infrastructure. Companies already using Stripe who want to add AI usage as a metered line item.

**Competitive position:** Stripe Token Billing does this natively but requires their AI Gateway or manual reporting. NullSpend's proxy provides automatic, ground-truth usage data — better data in, better invoices out. NullSpend becomes the best way to FEED Stripe Token Billing.

**Status:** Phase 2. Month 4.

---

### INTELLIGENCE PRODUCTS (Phase 3, Months 5-7)

These use historical data to generate insights no competitor can replicate.

---

#### 8. NullSpend Simulator

**What it is:** Interactive model swap calculator. Pick a feature, hypothetically switch the underlying model, see projected savings with quality trade-off estimates.

**What it does:**
- "What if you switched document-analysis from GPT-4o to GPT-4o-mini?"
- Projected monthly savings based on actual historical usage
- Quality benchmark comparison (MMLU-Pro, LMSYS, etc.)
- ROI calculator: "NullSpend costs $79/mo. This one swap saves $2,400/mo."
- Batch recommendations: "Here are your top 5 optimization opportunities"

**Who uses it:** Engineering managers evaluating model choices. Prospects calculating ROI during free trial. Sales demos.

**Competitive position:** MarginDash has a basic cost simulator. Nobody else does this with actual customer usage data.

**Status:** Phase 3. Month 5.

---

#### 9. NullSpend Reconcile

**What it is:** Provider billing reconciliation. Pull actual charges from OpenAI/Anthropic billing APIs, compare against NullSpend tracked costs, surface the gap.

**What it does:**
- Connect OpenAI/Anthropic billing API credentials
- Monthly reconciliation: NullSpend tracked $4,230. Provider billed $4,890.
- Gap analysis: "$660 in untracked spend" with breakdown by likely source
- Trend: is the gap growing or shrinking?
- Recommendation: "Route these 3 API keys through NullSpend to close the gap"

**Who uses it:** Finance teams doing monthly close. Engineering managers investigating surprise bills. Anyone who wants to verify NullSpend isn't missing spend.

**Competitive position:** Nobody does this. First-mover advantage. The "untracked spend" number is the scariest metric a founder sees and drives more NullSpend adoption.

**Status:** Phase 3. Month 6.

---

#### 10. NullSpend Anomaly Detection

**What it is:** Behavioral fingerprinting and anomaly detection. Learns normal patterns per API key, per customer, per feature. Alerts on genuine anomalies, not static thresholds.

**What it does:**
- Compute behavioral fingerprint from trailing 30 days (hourly distribution, cost distribution, model mix, session duration)
- Compare current day/hour against fingerprint
- Alert on genuine anomalies with confidence score
- Distinguish "organic growth" from "something is wrong"
- Auto-remediation options: alert, throttle, block, page on-call

**Who uses it:** Engineering teams tired of false-positive alerts. On-call engineers who need signal, not noise.

**Competitive position:** MarginMeter claims anomaly detection. Datadog has generic anomaly detection. Nobody has AI-cost-specific behavioral fingerprinting.

**Status:** Phase 3. Month 7.

---

#### 11. NullSpend Deploy Impact

**What it is:** Correlate cost changes with GitHub deployments. Attribute cost increases or decreases to specific PRs and code changes.

**What it does:**
- Connect GitHub repository
- Detect cost changes per feature/agent/model
- Correlate with merged PRs by timestamp
- "Costs on summarization increased 34% after PR #847 merged March 15. @jane changed system prompt from 200 to 1,400 tokens. Estimated annual impact: +$18K."
- Weekly cost-impact digest per team
- PR comment bot: "This PR is estimated to increase AI costs by $X/month"

**Who uses it:** VP Engineering who needs to understand cost impact of every release. Teams with 50+ engineers using AI features.

**Competitive position:** Codesession-CLI correlates git commits with cost. Origin tracks AI costs per commit. Neither has a dashboard or team-level reporting. Nobody has PR-level cost impact prediction.

**Status:** Phase 3. Month 7.

---

### INTEGRATION PRODUCTS (Phase 4, Months 7-9)

Each integration creates a stakeholder who objects to canceling NullSpend.

---

#### 12. NullSpend Alerts (Slack + Teams + PagerDuty)

**What it is:** Decision-ready alerts, not noise. Every alert includes full context, decision options, and action links.

**What it does:**
- Slack: Threaded budget alerts with customer context, cost trajectory, and action buttons
- Slack: Budget negotiation threads (agent requests → human approves/rejects)
- PagerDuty/Opsgenie: Cost spike incidents with full context and kill switch URL
- Microsoft Teams: Same as Slack
- Configurable channels per alert type and severity
- Decision briefs: "Customer X hit 80%. $49/mo plan. $277 AI cost. 3rd most expensive. Usage up 4x this week."

**Who uses it:** Engineering managers (Slack). On-call engineers (PagerDuty). The person who needs to decide "do I block this customer or not?"

**Competitive position:** NullSpend already has Slack integration with budget negotiation. Most competitors have email-only alerts or basic webhook payloads. The decision brief format is unique.

**Status:** Slack shipped. PagerDuty and enriched briefs in Phase 4.

---

#### 13. NullSpend CRM Sync (HubSpot + Salesforce)

**What it is:** Push AI usage signals to CRM as customer health indicators. Usage decline = churn risk. Usage spike = upsell opportunity.

**What it does:**
- Sync per-customer AI usage, cost, margin to CRM custom properties
- Churn risk alerts: "Acme Corp AI usage dropped 62% this month. Churn risk: high."
- Upsell triggers: "Beta Inc approaching Pro plan limit. Usage up 340%. Recommend Enterprise."
- Customer health score incorporating usage patterns
- Automated playbook triggers (email sequences, CS tasks)

**Who uses it:** Customer success teams. Revenue ops. Account managers.

**Competitive position:** Nobody in the AI cost space does CRM integration. This turns NullSpend from a developer tool into a revenue intelligence platform. Different buyer, different budget, stickier relationship.

**Status:** Phase 4. Month 8.

---

#### 14. NullSpend Ledger (QuickBooks + Xero)

**What it is:** Push categorized AI COGS to accounting software. Automated, correctly categorized, broken down by feature.

**What it does:**
- Monthly sync of AI costs as journal entries
- Categorized by feature/department: "LLM costs, customer support: $4,200. LLM costs, document analysis: $2,800. LLM costs, internal tooling: $600."
- Revenue recognition entries from Stripe billing pass-through
- Gross margin reporting for board decks
- Export: CSV, QBO format, Xero API

**Who uses it:** CFOs. Bookkeepers. Anyone doing financial reporting that includes AI costs.

**Competitive position:** Nobody does this. Finance teams currently export CSVs from provider dashboards and manually categorize. The deepest organizational lock-in on the list — finance teams do not switch tools.

**Status:** Phase 4. Month 9.

---

#### 15. NullSpend Comply

**What it is:** Automated compliance evidence generation for SOC 2, NIST AI RMF, EU AI Act, and OWASP Agentic Top 10.

**What it does:**
- Map NullSpend features to compliance frameworks:
  - Budget policies → SOC 2 controls
  - Enforcement events → control evidence
  - Kill switch activations → incident response records
  - Audit trail → EU AI Act Art. 12 (record-keeping)
  - HITL approvals → EU AI Act Art. 14 (human oversight)
- One-click PDF and JSON export
- Vanta/Drata push integration (auto-populate evidence)
- Continuous compliance monitoring (detect control gaps)

**Who uses it:** Security/compliance teams. Companies pursuing SOC 2. Companies needing EU AI Act compliance (mandatory August 2026 for high-risk AI systems).

**Competitive position:** Microsoft AGT has NIST/EU AI Act mapping but no hosted platform or evidence generation. AgentBouncr has audit trail but no compliance export. The EU AI Act deadline creates urgent first-mover opportunity.

**Status:** Phase 4. Month 9.

---

### NETWORK INTELLIGENCE PRODUCTS (Phase 5, Months 9-12)

These require aggregate cross-customer data. Impossible for new entrants to replicate.

---

#### 16. NullSpend Benchmark

**What it is:** The Agent Economics Benchmarking Index. Quarterly publication of anonymized, aggregate AI cost data across the NullSpend customer base.

**What it does:**
- "The average AI SaaS company spends $0.34 per customer interaction."
- "Top quartile: $0.12. Bottom quartile: $0.89."
- "Most common optimization: model downgrade on classification saves 65% with <5% quality loss."
- Per-industry benchmarks (healthcare, legal, fintech, dev tools)
- Per-model efficiency benchmarks
- Your company's position vs the benchmark (private dashboard)

**Who uses it:** VCs doing due diligence. Founders benchmarking themselves. Media writing about AI economics. Pricing teams setting rates.

**Competitive position:** Nobody can produce this without the cross-customer aggregate data. Gets better with every new customer. The data network effect that creates a compounding moat.

**Status:** Phase 5. Month 10. Requires 200+ customers to be statistically meaningful.

---

#### 17. NullSpend Optimize

**What it is:** AI-powered recommendations engine. Analyzes your usage patterns against the aggregate dataset and recommends optimizations.

**What it does:**
- "Your classification tasks use GPT-4o. Similar workloads across NullSpend achieve 95% accuracy with GPT-4o-mini at 1/30th the cost."
- "Your cache hit rate is 12%. Top quartile achieves 45%. Enable prompt caching on your summarization feature."
- "Your agent's average session cost is $2.30. Similar agents average $0.80. The difference is your system prompt (1,400 tokens vs avg 400 tokens)."
- Weekly optimization digest
- Projected savings per recommendation
- One-click implementation (swap model via NullSpend routing, no code change)

**Who uses it:** Engineering teams who want to reduce costs without sacrificing quality. The "easy wins" dashboard.

**Competitive position:** Requires aggregate data across customers to make meaningful comparisons. New entrants start with zero comparison data. This is the feature that makes NullSpend a fundamentally better product at 1,000 customers than at 10.

**Status:** Phase 5. Month 11.

---

#### 18. NullSpend Forecast

**What it is:** Predictive cost forecasting based on trailing usage patterns, growth rates, and seasonal adjustments.

**What it does:**
- "Based on trailing 90 days: $127K next quarter."
- "At current 12% WoW growth: $340K by Q4."
- "With recommended optimizations applied: $89K."
- Budget vs actual tracking with variance explanation
- Scenario modeling: "If you launch feature X with projected usage, expect +$X/month"
- Board-ready forecast export

**Who uses it:** CFOs doing financial planning. CEOs preparing fundraise projections. Engineering managers requesting budget.

**Competitive position:** Generic FP&A tools (Mosaic, Runway) do financial forecasting but don't understand AI cost dynamics (model mix changes, cache effects, seasonal patterns). NullSpend's forecasts are built on actual token-level usage data.

**Status:** Phase 5. Month 12.

---

### FRONTIER PRODUCTS (Year 2, Months 13-24)

These are the products that make NullSpend the category-defining platform.

---

#### 19. NullSpend Identity

**What it is:** Agent identity and credential management. Create an agent, get a wallet (spending authority), API key, budget, and audit trail.

**What it does:**
- Agent registry: create, suspend, terminate, transfer agents
- Per-agent spending credentials (scoped API keys with embedded mandates)
- Agent reputation scoring based on spending behavior
- Delegation: agent A can authorize agent B to spend up to $X
- Agent lifecycle management (birth → active → suspended → terminated → archived)
- KYA (Know Your Agent) verification for high-value transactions

**Who uses it:** Companies deploying autonomous agent fleets. Multi-agent systems where agents need independent spending authority.

**Competitive position:** Ampersend and Crossmint do agent identity for crypto wallets. Nobody does agent identity for fiat API spending. NullSpend's existing API key + budget + mandate infrastructure is 80% of the way there.

**Status:** Year 2. Month 14.

---

#### 20. NullSpend Route

**What it is:** Intelligent request routing based on cost, quality, and latency optimization. Route requests to the best model for the job.

**What it does:**
- Rule-based routing: "Use GPT-4o for complex tasks, GPT-4o-mini for simple ones"
- Cost-optimized routing: "Stay under $X/month by routing overflow to cheaper models"
- Quality-aware routing: "Maintain >95% quality score while minimizing cost"
- Latency-aware routing: "Route to fastest provider meeting quality threshold"
- A/B testing: "Send 10% to Claude, 90% to GPT-4o, compare cost and quality"
- Fallback chains: "Try Anthropic → OpenAI → Gemini"

**Who uses it:** Companies optimizing cost vs quality trade-offs. Teams managing multiple providers.

**Competitive position:** Unify AI ($8M), Martian, and Not Diamond do smart routing. OpenRouter is a model marketplace. None combine routing with enforcement and margin economics. NullSpend's routing decisions are informed by per-customer budget and margin data.

**Status:** Year 2. Month 15.

---

#### 21. NullSpend Negotiate

**What it is:** Provider contract negotiation intelligence. Generates the report founders bring to the negotiation table with OpenAI/Anthropic sales teams.

**What it does:**
- "Your OpenAI spend last quarter: $127K. Model breakdown: GPT-4o 62%, mini 31%, embeddings 7%."
- "Growth rate: 15%/month. Projected annual: $680K."
- "At this volume, Tier 3 pricing saves $95K/year."
- Comparable spend data from aggregate NullSpend dataset (anonymized)
- Auto-generated negotiation brief with talking points
- Track negotiated rates vs standard rates

**Who uses it:** Founders negotiating enterprise contracts with OpenAI/Anthropic. Finance teams evaluating committed-use discounts.

**Competitive position:** Nobody does this. Requires the combination of per-customer usage data and aggregate benchmarks.

**Status:** Year 2. Month 16.

---

#### 22. NullSpend Treasury

**What it is:** Prepaid credit management and customer wallet infrastructure. SaaS companies give their customers a credit balance that NullSpend tracks and enforces.

**What it does:**
- Customer credit wallets: prepaid balance, auto-top-up via Stripe, low-balance alerts
- Credit grants: "Give this customer $500 in AI credits for signing annual contract"
- Credit expiry: unused credits expire after configurable period
- Credit marketplace: customers buy additional credits on demand
- Credit transfer: enterprise accounts distribute credits across teams
- Real-time balance API for customer-facing UI

**Who uses it:** SaaS companies selling AI credits (like Vercel's AI credits model). Enterprise customers managing team-level AI budgets.

**Competitive position:** Credyt ($4.55M) does prepaid wallets but doesn't calculate AI costs. NullSpend knows what each credit actually costs at the token level.

**Status:** Year 2. Month 17.

---

#### 23. NullSpend Protect

**What it is:** Financial security for AI operations. Detect and prevent financially-motivated attacks on AI systems.

**What it does:**
- Prompt injection cost attacks (crafted inputs designed to maximize token consumption)
- Credential abuse detection (leaked API keys being used by unauthorized parties)
- Free-tier gaming detection (same user, multiple accounts, maximizing free usage)
- Anomalous geographic usage patterns
- Rate-of-spend analysis (distinguish organic growth from attack patterns)
- Automated response: alert, throttle, block, rotate credentials

**Who uses it:** Security teams. Companies with public-facing AI features vulnerable to abuse.

**Competitive position:** Stripe Radar does fraud detection for payments. Nobody does financial fraud detection for AI API calls. Same pattern: sit in the request path, learn normal behavior, detect anomalies.

**Status:** Year 2. Month 19.

---

#### 24. NullSpend Connect

**What it is:** Multi-provider spend aggregation. Single view of total AI spend across every provider, every payment method, every tool.

**What it does:**
- Aggregate: OpenAI + Anthropic + Google + Mistral + Cohere + Replicate
- Aggregate: Direct API spend + Stripe Token Billing + Ramp agent cards + corporate cards
- Single dashboard: total AI spend across all sources
- Budget enforcement across providers (total spend limit spanning all providers)
- Provider comparison: cost, quality, latency side by side for same workload
- Migration planning: "Here's what switching 30% of traffic from OpenAI to Anthropic would save"

**Who uses it:** Companies using multiple AI providers. Finance teams that need a single source of truth for total AI spend.

**Competitive position:** Every provider shows their own slice. NullSpend shows the complete picture. The "Mint.com for AI spend."

**Status:** Year 2. Month 20.

---

#### 25. NullSpend Marketplace

**What it is:** App marketplace where third-party developers build integrations, visualizations, and extensions on the NullSpend platform.

**What it does:**
- Third-party integrations (Monday.com, Linear, Notion, custom CRMs)
- Custom dashboard widgets and visualizations
- Workflow automations (Zapier-like but native to NullSpend)
- Community-contributed cost engine plugins (new providers, custom cost models)
- Revenue share with integration developers

**Who uses it:** Companies with custom toolchains that need NullSpend data in their specific workflow.

**Competitive position:** This is the PostHog "app marketplace" / Stripe "app marketplace" play. Turns NullSpend from a product into a platform.

**Status:** Year 2. Month 22.

---

## The Product Expansion Map

```
                                   YEAR 2
                               FRONTIER PRODUCTS
                    ┌─────────────────────────────────────┐
                    │  Identity  Route  Negotiate          │
                    │  Treasury  Protect  Connect           │
                    │  Marketplace                          │
                    └───────────────┬─────────────────────┘
                                    │
                         MONTHS 9-12 │
                      NETWORK INTELLIGENCE
                    ┌───────────────┴─────────────────────┐
                    │  Benchmark  Optimize  Forecast        │
                    └───────────────┬─────────────────────┘
                                    │
                         MONTHS 7-9 │
                        INTEGRATIONS
                    ┌───────────────┴─────────────────────┐
                    │  Alerts  CRM Sync  Ledger  Comply    │
                    └───────────────┬─────────────────────┘
                                    │
                         MONTHS 5-7 │
                       INTELLIGENCE
                    ┌───────────────┴─────────────────────┐
                    │  Simulator  Reconcile  Anomaly       │
                    │  Deploy Impact                        │
                    └───────────────┬─────────────────────┘
                                    │
                         MONTHS 1-4 │
                         ECONOMICS
                    ┌───────────────┴─────────────────────┐
                    │  Margins  Enforce  Meter  Billing     │
                    └───────────────┬─────────────────────┘
                                    │
                          ALREADY BUILT
                      CORE INFRASTRUCTURE
                    ┌───────────────┴─────────────────────┐
                    │  Proxy    SDK    MCP Server           │
                    │  Cost Engine    Webhooks              │
                    └─────────────────────────────────────┘
```

---

## Revenue Model Per Product

| Product | Pricing Model | Est. Revenue Per Customer |
|---------|--------------|--------------------------|
| **Proxy** | Free (entry point) | $0 |
| **SDK** | Open source client, commercial platform | $0 (conversion funnel) |
| **MCP Server** | Included with Pro | Included |
| **Margins** | Pro ($79/mo) | $79/mo |
| **Enforce** | Included in all paid tiers | Included |
| **Meter** | Team ($199/mo) | $199/mo |
| **Billing** | Team + usage fee (0.5% of billed revenue) | $199/mo + variable |
| **Simulator** | Pro and above | Included |
| **Reconcile** | Team and above | Included |
| **Anomaly** | Team and above | Included |
| **Deploy Impact** | Team and above | Included |
| **Alerts** | Pro (Slack), Team (PagerDuty) | Included |
| **CRM Sync** | Enterprise add-on | +$99/mo |
| **Ledger** | Enterprise add-on | +$99/mo |
| **Comply** | Enterprise add-on | +$149/mo |
| **Benchmark** | All tiers (own data), Enterprise (full index) | Included / +$99 |
| **Optimize** | Team and above | Included |
| **Forecast** | Team and above | Included |
| **Identity** | Enterprise | +$199/mo |
| **Route** | Team and above | Included |
| **Negotiate** | Enterprise | +$99/mo |
| **Treasury** | Enterprise + usage fee | +$199/mo + variable |
| **Protect** | Enterprise add-on | +$149/mo |
| **Connect** | Team and above | Included |
| **Marketplace** | Revenue share with developers | 20% rev share |

### Tier Summary

| Tier | Price | Products Included |
|------|-------|-------------------|
| **Free** | $0 | Proxy, SDK (open source), basic dashboard |
| **Pro** | $79/mo | + Margins, Enforce, Simulator, Slack Alerts, Benchmark (own data) |
| **Team** | $199/mo | + Meter, Billing, Reconcile, Anomaly, Deploy Impact, Optimize, Forecast, Route, Connect, PagerDuty |
| **Enterprise** | Custom ($500+/mo) | + Comply, CRM Sync, Ledger, Identity, Negotiate, Treasury, Protect, SSO, full Benchmark |

---

## The Platform Flywheel

```
More customers
    → More aggregate data
        → Better benchmarks + recommendations
            → More value for each customer
                → Lower churn
                    → More customers
```

This is the same flywheel that makes Stripe, PostHog, and Datadog category-defining.
Stripe's network data enables Radar (fraud detection).
PostHog's aggregate data enables benchmarks.
NullSpend's aggregate data enables the Agent Economics Index and optimization recommendations.

The flywheel doesn't spin until ~200 customers. Everything before that is building the wedge and getting to 200.

---

## What We Kill (Tools NullSpend Replaces)

Following PostHog's playbook of systematically replacing point solutions:

| Tool Category | Current Solutions | NullSpend Product |
|---------------|-------------------|-------------------|
| AI cost tracking | Langfuse, Helicone, CloudZero | **Proxy + SDK** |
| AI budget enforcement | LiteLLM (buggy), Bifrost, homegrown | **Enforce** |
| Per-customer profitability | Spreadsheets, homegrown | **Margins** |
| AI usage metering | Orb, Metronome, homegrown | **Meter** |
| AI usage billing | Stripe Token Billing (manual), homegrown | **Billing** |
| Model optimization | Manual benchmarking | **Simulator + Optimize** |
| AI cost anomaly detection | Static threshold alerts | **Anomaly Detection** |
| Cost-to-deploy correlation | Manual investigation | **Deploy Impact** |
| AI spend forecasting | Spreadsheet extrapolation | **Forecast** |
| AI compliance evidence | Manual evidence collection | **Comply** |
| Provider spend reconciliation | Manual comparison | **Reconcile** |
| Provider contract negotiation | Guesswork | **Negotiate** |
| AI credit/wallet management | Homegrown | **Treasury** |
| Multi-provider cost aggregation | Multiple dashboards | **Connect** |

Every tool NullSpend replaces is one fewer vendor to manage, one fewer integration to maintain, and one more reason not to switch.

---

*Last updated: April 3, 2026*
*Status: Core infrastructure shipped. Building the economics layer.*
