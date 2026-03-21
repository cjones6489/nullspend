# AI agent FinOps: the competitive landscape in March 2026

**No single tool today gives developers a unified view of LLM token costs and external tool call costs, enforces budgets in a hosted product, or generates human-readable post-mortems when an agent is killed for exceeding spend.** This is the central whitespace in a market that barely existed 18 months ago but is now validated by $47K horror stories, $13.5M seed rounds, and Gartner dedicating sessions to "FinOps of AI Cost and Value Creation." The competitive landscape consists of roughly 20 tools across three tiers — purpose-built cost platforms, LLM gateways with cost features, and observability tools where cost is an afterthought — none of which fully solves the problem. Enterprise LLM API spend doubled to **$8.4B in the first half of 2025** alone, and 98% of FinOps practitioners now manage AI spend (up from 31% in 2024), creating urgent demand for tooling that does not yet exist at the quality enterprises require.

---

## The direct competitors: purpose-built cost and budget tools

The tools whose primary value proposition is AI/LLM cost tracking and budget enforcement span a wide maturity spectrum — from LiteLLM's 38,400-star proxy to TokenMeter's 2-commit repo. The landscape shifted dramatically in early 2026 with Helicone's acquisition and Revenium's emergence.

**Helicone** (helicone.ai) was the early leader in LLM observability with cost tracking. A YC W23 company with ~5,200 GitHub stars and ~$1.5–2M in total funding, it processed 14.2 trillion tokens before being **acquired by Mintlify on March 3, 2026**. The product is now in maintenance mode — security patches ship, but no new features. Pricing ran from free (10K requests/month) to $79/month Pro to $799/month Team. Helicone's fatal limitation: it tracked costs but never enforced budgets. Setup was a one-line base URL change, making it the easiest tool to adopt, but it only tracked LLM token costs with no tool call attribution.

**LiteLLM** (BerriAI/litellm) dominates the open-source proxy space with **~38,400 GitHub stars**, 1,005+ contributors, 240M+ Docker pulls, and daily releases (v1.82 shipped March 9, 2026). The MIT-licensed core is free; enterprise tiers run $250/month (basic) to ~$30,000/year (premium). LiteLLM offers the most comprehensive budget enforcement in open source: per-key, per-user, per-team, and per-org budgets with configurable reset intervals. When a budget is exceeded, it returns HTTP 400 and blocks the request. **However, budget enforcement has critical, well-documented bugs.** Issue #11083 shows users continuing past budget limits when using specific headers. Issue #12977 documents a $764.78 spend against a $50 budget when using AzureOpenAI's library instead of the direct API. Issue #12905 reveals team membership bypassing individual user budgets. Issue #13882 shows budgets not enforced for AWS Bedrock passthrough requests. These bugs cluster around edge cases — pass-through endpoints, team hierarchies, and alternative client libraries — but they are precisely the cases enterprises encounter. LiteLLM tracks only LLM token costs; it recently added basic MCP cost configuration (`mcp_server_cost_info`) but this requires manually setting per-tool costs rather than measuring them. Setup requires Docker + PostgreSQL + Redis, with an estimated 2–4 weeks for production deployment.

**Portkey** (portkey.ai) raised a **$15M Series A in February 2026** led by Elevation Capital with Lightspeed participation, bringing total funding to ~$18M. It processes 500B+ tokens across 125M requests/day, managing **$180M in annualized LLM spend**. With ~10,200 GitHub stars for its open-source gateway, Portkey is the best-funded pure-play in this space. Pricing starts at $49/month Pro (100K recorded logs) after a free tier of 10K logs/month. Budget enforcement exists via virtual keys with independent budgets and rate limits — but only at the Enterprise tier. Portkey maintains an open-source model pricing database that tracks "additional units" (web search at $1/query, file search at $0.25), making it more comprehensive than competitors on cost data. Its MCP Gateway product launched for governance and security of tool connections, but does not yet provide per-tool-call cost tracking. User complaints center on confusing "recorded logs" pricing, incomplete price tracking for air-gapped deployments, and 20–40ms latency overhead.

**Maxim AI / Bifrost** (getmaxim.ai) offers an open-source LLM gateway built in Go that claims **11μs overhead** (50x faster than LiteLLM). Backed by $3M in seed funding from Elevation Capital (the same firm that led Portkey's Series A), Bifrost provides virtual keys with independent budgets and access controls. Pricing for the full Maxim platform starts at $29/seat/month. Setup is a one-command `npx -y @maximhq/bifrost` install. The product is young — launched on Product Hunt in August 2025 with 572 upvotes — and lacks the production track record of Portkey or LiteLLM. It supports MCP natively but does not offer per-tool cost attribution.

**Revenium** (revenium.ai) is the most strategically differentiated entrant. It closed a **$13.5M seed round in November 2025** led by Two Bear Capital, with team backgrounds from RightScale (acquired by Flexera) and MuleSoft (acquired by Salesforce). Revenium's core thesis is that **the real AI cost problem is not token pricing — it is agent-driven spend on external tools**. Their flagship Tool Registry (GA as of March 3, 2026) tracks costs for external REST APIs, MCP servers, SaaS platforms, internal compute, and even human review time. Their example: a loan origination workflow where LLM tokens cost $0.30 but the agent pulls a credit report ($35–75), runs identity verification ($2–5), checks fraud scores ($1–3), and verifies bank accounts ($0.25–1) — making total per-application cost $50–85 with tokens under 1%. Revenium bills itself as "the world's first AI economics system of record" and offers spend attribution linking every transaction to customer, feature, agent, and workflow. Pricing includes a free developer tier but specifics for paid tiers are not public.

**AgentBudget** (agentbudget.dev) is a brand-new Python library (launched ~March 7, 2026) with 13 GitHub stars and 1,300+ PyPI installs in its first four days. Despite its infancy, it is the only open-source tool that tracks LLM calls, tool calls, and external API costs in a unified ledger via `session.track(cost=0.01)` and `@track_tool` decorators. It enforces hard dollar limits per session, runs pre-call cost estimates, detects infinite loops via sliding-window analysis, and supports parent/child budget sessions for multi-agent workflows. Setup is two lines of Python with zero infrastructure. The critical limitations: single developer, in-memory only (budgets don't survive process restarts), no dashboard, and days old with zero production validation.

Three other tools round out the direct competitor set but with minimal traction:

- **AgentCost** (agentcostin/agentcost): 5 GitHub stars, 19 commits, full-stack platform with React dashboard, cost forecasting, and model optimizer. MIT core with BSL 1.1 enterprise features. Too early to evaluate meaningfully.
- **RelayPlane** (RelayPlane/proxy): 0 GitHub stars, 31 commits. Local proxy for coding tools (Claude Code, Cursor, Aider) with budget enforcement, auto-downgrade to cheaper models when budgets are hit, and anomaly detection. MIT licensed, claims 835+ developer installs.
- **TokenMeter** (ATMAECHO/TOKEN-METER): 2 GitHub stars, 2 total commits. The README lists 20+ features, but this is almost certainly vaporware. Disregard.
- **AI Cost Board** (aicostboard.com): Hosted-only LLM cost dashboard starting at $9.99/month for 10K requests. Budget alerts but no enforcement. Cheapest paid option, but limited scope.

---

## Adjacent competitors where cost is secondary

Seven major observability and gateway platforms track costs as part of broader functionality. None were designed for cost management, but several are extending aggressively into the space.

**Langfuse** (~23,000 GitHub stars, MIT) was **acquired by ClickHouse in January 2026** as part of ClickHouse's $400M Series D at a $15B valuation. Previously YC W23 with backing from Lightspeed and General Catalyst, Langfuse had 2,000+ paying customers and 19 of the Fortune 50. Its cost tracking is solid — automatic per-trace cost calculation with dashboards and recently added cost alerts — but it offers no budget enforcement and tracks only LLM token costs. The acquisition means Langfuse's strategic direction will increasingly align with ClickHouse's data platform ambitions. Cloud pricing runs from free (50K units/month) to $29/month Core to $199/month Pro to $2,499/month Enterprise. Self-hosted is free for the MIT core; enterprise self-hosted features cost $500/month for the license key plus ~$3,000–4,000/month infrastructure.

**LangSmith** (LangChain's observability platform, $25M+ raised via LangChain's Sequoia-led Series A) recently added **"unified cost tracking for LLMs, tools, and retrieval"** — making it one of the few platforms that explicitly tracks tool costs alongside LLM costs. Pricing is $39/seat/month (Plus tier) with 5K free traces/month on Developer. Limitations: per-seat pricing scales linearly, deep LangChain ecosystem tie-in, self-hosting only at Enterprise tier, and model pricing changes are not retroactive. No budget enforcement.

**Braintrust** raised an **$80M Series B in February 2026** at an $800M valuation led by ICONIQ Capital, bringing total funding to ~$124.3M. Customers include Notion, Stripe, Cloudflare, Ramp, and Dropbox. It offers cost per trace with production monitoring dashboards. Free tier includes 1M spans/month. No budget enforcement. Focused primarily on evaluation, not cost management.

**Datadog LLM Observability** brings enterprise APM credibility but with enterprise-level pricing complexity. Billing is per LLM span (exact pricing requires contacting sales). It offers a dedicated Cost view with breakdowns by provider/model and tracks "Most Expensive LLM Calls." Its unique strength is integration with Datadog's Cloud Cost Management for real (not estimated) OpenAI spend. But it's cloud-only, no self-hosting, and tracks only LLM token costs. One competitor claims Datadog auto-activates $120/day premium when detecting LLM spans.

**TrueFoundry** ($21M raised, Series A from Intel Capital in February 2025) stands out among adjacent competitors because it **actually enforces budgets and tracks tool calls via its native MCP Gateway**. At $499/month Pro (2M requests, 5 API keys), it is the most expensive entry point but offers budget controls per user, team, or application that block requests when exceeded. Named in the 2025 Gartner Market Guide for AI Gateways. Customers include Siemens Healthineers and NVIDIA.

**Arize AI / Phoenix** ($131M total funding including a $70M Series C in February 2025) added token-based cost tracking in June 2025. Phoenix has ~7,800 GitHub stars under Elastic License 2.0 (not MIT — commercial restrictions apply). Cost tracking covers 63 default model configurations but is not retroactive. Free SaaS tier at 25K spans/month, Pro at $50/month. No budget enforcement.

**LangWatch** (~5,000 GitHub stars, €1M pre-seed from Passion Capital) offers real-time cost dashboards and DSPy-based optimizers to reduce costs by finding cheaper models. Pricing starts at ~€59/core-seat/month. No budget enforcement. Very early stage.

---

## Feature comparison across all tools

| Tool | Primary Focus | Budget Enforcement | Tool Call Costs | GitHub Stars | Funding | Hosted/Self-hosted | Starting Price |
|------|-------------|-------------------|----------------|-------------|---------|-------------------|---------------|
| **LiteLLM** | LLM proxy | ✅ (buggy) | ❌ LLM only | 38,400 | OSS (MIT) | Self-hosted | Free / $250/mo enterprise |
| **Portkey** | AI gateway | ✅ Enterprise only | ⚠️ Partial pricing DB | 10,200 | $18M | Both | $49/mo |
| **Revenium** | AI economics | ✅ Guardrails | ✅ Tool Registry | N/A | $13.5M | Hosted | Free dev tier |
| **Bifrost/Maxim** | LLM gateway | ✅ Virtual keys | ⚠️ MCP support | ~low thousands | $3M | Primarily self-hosted | $29/seat/mo |
| **TrueFoundry** | AI gateway | ✅ Full enforcement | ✅ MCP Gateway | N/A | $21M | Both | $499/mo |
| **Helicone** | Observability | ❌ Alerts only | ❌ LLM only | 5,200 | ~$2M | Both | $79/mo (⚠️ maintenance mode) |
| **AI Cost Board** | Cost dashboard | ❌ Alerts only | ❌ LLM only | N/A | Unknown | Hosted only | $9.99/mo |
| **AgentBudget** | Budget library | ✅ Hard limits | ✅ Unified ledger | 13 | None (OSS) | Library (in-process) | Free |
| **RelayPlane** | Cost proxy | ✅ Block/downgrade | ❌ LLM only | 0 | None (OSS) | Local proxy | Free |
| **Langfuse** | Observability | ❌ | ❌ LLM only | 23,000 | Acquired by ClickHouse | Both | $29/mo |
| **LangSmith** | Observability | ❌ | ✅ Recently added | N/A (closed) | LangChain ($25M+) | Cloud + Enterprise | $39/seat/mo |
| **Braintrust** | Evaluation | ❌ | ❌ LLM only | N/A (closed) | $124.3M | Cloud + hybrid | $249/mo |
| **Datadog LLM** | APM | ❌ | ❌ LLM only | N/A | Public (DDOG) | Cloud only | Contact sales |
| **Arize/Phoenix** | Observability | ❌ | ❌ LLM only | 7,800 | $131M | Both | $50/mo |

---

## The $47K wake-up call and other horror stories

Three incidents have become canonical references for why this market exists. The most cited is the **$47,000 recursive loop disaster**: engineer Teja Kusireddy published how four agents in a LangChain-style research tool slipped into a recursive communication loop, two agents talking to each other for **11 straight days** before anyone noticed. No shared memory, no global state, no cost guardrails. The story went viral across LinkedIn, DZone, and Towards AI, accumulating 11,400+ views on a single Tech Startups article alone.

The **$3,600 single-month OpenClaw bill** hit Federico Viticci, the well-known MacStories founder, who configured an AI assistant named "Navi" managing his calendar, Notion, Todoist, Spotify, and smart home. The system consumed **180 million tokens in one month**. Root causes were structural: every message sent the entire conversation history to the API, system prompts injected 35,600 tokens per message, and heartbeat cron jobs ran 24/7 at full model rates. The OpenClaw ecosystem (145,000+ GitHub stars) has generated a cascade of cost complaints: $200 in 24 hours from an infinite retry loop, $500+ in 2 days from a user "expecting a free AI assistant," and $40 for 12 messages from poor defaults.

The **$4,800/month bill surprise** came from a team running 14 GPT-4 microservices where nobody owned the bill, an intern's "staging-only" prototype was running in production, and OpenAI's dashboard showed only one aggregated number. The engineer's quote captures the core problem: **"The terrifying part is not the spend itself. It is the complete absence of visibility."**

Additional data points paint a consistent picture: a $7,500/month customer support agent with unoptimized prompts, a $180,000 failed custom agent project, and one developer who discovered a simple 30-minute heartbeat cycle was costing $4.20/day with zero task performance. AI agents are also inflating observability bills — Datadog costs reportedly increase 40%+ because agents generate 40–75 spans per user interaction versus 2–3 for traditional endpoints.

---

## Five gaps no tool fills today

**Gap 1: Unified LLM + tool call cost dashboard.** Revenium's Tool Registry is the closest solution, tracking external API costs alongside token spend. AgentBudget offers a unified ledger in a Python library. LangSmith recently added "unified cost tracking for LLMs, tools, retrieval." But no mature, hosted platform provides a single dashboard showing LLM inference costs, MCP tool call costs, and external API costs with proper attribution by agent, task, team, and business outcome. LiteLLM's new `mcp_server_cost_info` requires manually configuring per-tool costs rather than discovering them automatically.

**Gap 2: Budget enforcement in a hosted product accessible to non-infrastructure teams.** LiteLLM enforces budgets but requires self-hosting Docker + PostgreSQL + Redis and has critical enforcement bugs. Portkey enforces at Enterprise tier only (custom pricing). TrueFoundry enforces at $499/month. AgentBudget is a library, not a hosted product. No tool offers budget enforcement in a $50–100/month hosted plan that a startup or small team could adopt with a one-line setup.

**Gap 3: Kill receipts — human-readable post-mortems when an agent is terminated.** No tool generates an executive-readable report explaining why an agent was stopped, what it accomplished before termination, a cost breakdown by step, and recommendations. AgentBudget logs every event in real-time but produces technical logs, not post-mortems. This is complete whitespace.

**Gap 4: Agent-level unit economics (cost per successful task).** One developer manually built cost-per-task tracking showing costs from $0.10 to $11.46 per task. CloudZero offers "cost per customer/feature" for cloud infrastructure. AgentCost claims "agent scorecards" in its enterprise tier. But no tool automates cost-per-successful-task-completion with quality-adjusted metrics and success/failure tracking. The MCP protocol could enable this — each tool call is a measurable unit — but nobody has built the analytics layer.

**Gap 5: Cost forecasting for non-deterministic agent workflows.** Traditional cloud forecasting uses historical usage patterns, but an agent might make 3 LLM calls or 300 depending on task complexity. AWS Cost Explorer forecasts Bedrock costs; CloudZero and Vantage offer cloud-level predictions; AgentCost claims "forecasting" as a feature. But no tool specifically models agent workflow cost patterns for prediction, accounting for branching tool use and variable task complexity.

---

## Market validation signals point to massive demand

The market for AI cost management is validated from multiple angles. The **FinOps Foundation's 2026 survey** found that 98% of respondents now manage AI spend, up from 63% in 2025 and just 31% in 2024. AI cost management is the **#1 most desired skillset** across organizations of all sizes. One practitioner quoted: "Is your AI providing value? No one can answer that question yet."

Comparable company trajectories in cloud FinOps demonstrate the market's economic potential. **CloudZero** raised $56M in its Series C specifically positioning around "FinOps for the AI era," bringing total funding to ~$118M. **Cast AI** reached a $1B+ valuation with $272M raised for Kubernetes cost optimization. **IBM acquired Apptio for $4.6B** in 2023, validating enterprise FinOps at scale. **Vantage** raised $4M seed from a16z then $21M Series A, managing $1B+ in annual cloud costs across 300+ companies. If the cloud FinOps market ($15B in 2025, growing 12.6% CAGR to $27B by 2030) represents roughly 1.5% of managed cloud spend, and enterprise LLM API spend is projected at $15B+ in 2026 growing at over 100% annually, the implied "FinOps for AI" market reaches **$225M+ in 2026 conservatively**, potentially $500M–$1B by 2028 when factoring in agent tool call costs.

The macro numbers are staggering. **Gartner projects $2.52 trillion in worldwide AI spending in 2026**, up 44% year-over-year. The big five hyperscalers committed **$660–690B in AI capex for 2026**, nearly doubling 2025 levels. Anthropic's revenue run rate surpassed $9B in January 2026, up from ~$1B a year prior. The agentic AI market alone is forecast at $7.5B in 2025, growing at 40–50% CAGR to $50–200B by the early 2030s depending on the analyst.

Investor interest is surging. **$238B flowed into AI startups in 2025** — 47% of all VC activity. Infrastructure captured $42B of that. In this specific sub-market, Portkey's $15M Series A (February 2026), Revenium's $13.5M seed (November 2025), and Braintrust's $80M Series B at $800M valuation (February 2026) demonstrate that investors are backing the picks-and-shovels layer of AI agent infrastructure.

---

## Conclusion: an inflection point between grassroots tools and enterprise demand

The AI agent cost management market in March 2026 sits at a telling inflection point. The **grassroots signal is unmistakable**: developers are building their own solutions (AgentBudget, RelayPlane, Agent Budget Guard), sharing horror stories that go viral, and telling the FinOps Foundation they "want commercial tooling to catch up." Yet the **commercial tooling gap is wide**: no hosted product under $500/month offers real budget enforcement, no platform unifies LLM and tool call costs in a production-ready dashboard, and no one generates human-readable post-mortems when agents are killed.

The most important competitive insight is that **Revenium is the only funded startup ($13.5M) built specifically around the thesis that tool call costs matter more than token costs**. If their Tool Registry gains traction, it could redefine how the market thinks about AI agent economics. Meanwhile, the established observability platforms (Langfuse, Braintrust, Arize) continue treating cost as a secondary metric, and the best open-source budget enforcement tool (LiteLLM) has persistent bugs that undermine its core promise.

The five whitespace gaps — unified cost dashboards, hosted budget enforcement, kill receipts, agent unit economics, and workflow-aware forecasting — represent a coherent product surface that no single incumbent is building toward. The company that fills these gaps for the $15B+ and growing enterprise LLM market will likely follow the trajectory of CloudZero and Vantage, where solving the visibility-and-control problem for a new infrastructure layer generated $100M+ valuations within 2–3 years of launch.