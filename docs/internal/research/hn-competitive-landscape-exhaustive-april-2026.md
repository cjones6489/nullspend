# Hacker News Competitive Landscape: AI Cost Tracking, Budget Enforcement & Governance
## Exhaustive Research — April 2, 2026

---

## Summary

48 products identified across 10 HN search queries. Organized into 7 categories:

1. **Direct Competitors** (cost tracking + budget enforcement) — 8 products
2. **Cost Tracking / Observability Only** (no enforcement) — 12 products
3. **Agent Governance / Policy Enforcement** (no cost focus) — 10 products
4. **LLM Gateways / Proxies** (routing, not cost-focused) — 8 products
5. **Billing / Metering Infrastructure** (usage-based pricing) — 6 products
6. **LLM Cost Optimization / Routing** (model selection) — 4 products
7. **Agent Financial Infrastructure** (wallets, payments) — 5 products

The highest-traction HN launches were all observability plays (Laminar 203pts, OpenMeter 174pts, Langfuse 143pts, LiteLLM 140pts). No budget enforcement product has broken 10 points on HN. The space is crowded with weekend projects that never got traction.

---

## Category 1: Direct Competitors (Cost Tracking + Budget Enforcement)

These are the closest to NullSpend — they attempt both tracking AND enforcement.

### 1. MarginDash
- **URL:** margindash.com
- **HN:** https://news.ycombinator.com/item?id=47351609
- **Launch:** ~April 2026 | 2 points, 2 comments
- **Founder:** gdhaliwal23
- **What:** SDK-based AI API spending limits. Set budgets at company, customer, and feature level. Blocks requests exceeding limits before they hit providers. No proxy — only receives usage metadata (token counts).
- **Architecture:** TypeScript + Python SDKs, Dashboard. No proxy.
- **Pricing:** Not disclosed
- **Cost tracking:** Yes (usage metadata) | **Budget enforcement:** Yes (per-company/customer/feature) | **Per-customer attribution:** Yes | **Stripe:** Not mentioned | **Margin table:** Not mentioned on HN (but known from direct research to have Stripe revenue sync)

### 2. AI Spend (by Lava)
- **URL:** lava.so/products/ai-spend
- **HN:** https://news.ycombinator.com/item?id=46991656
- **Launch:** Feb 2026 | 2 points, 2 comments
- **Founder:** mej2020
- **What:** OpenAI-compatible proxy creating isolated API keys with individual spend limits (daily/weekly/monthly/total), model restrictions, real-time usage tracking. Translates across 38+ providers.
- **Architecture:** Transparent proxy. Tools point to single OpenAI-compatible endpoint.
- **Pricing:** Not disclosed
- **Cost tracking:** Yes (per-key per-cycle) | **Budget enforcement:** Yes (daily/weekly/monthly/total) | **Per-customer attribution:** Yes (isolated keys) | **Stripe:** No | **Margin table:** No
- **Origin story:** "I lost $200 from an agent loop"

### 3. TensorWall
- **URL:** github.com/datallmhub/TensorWall
- **HN:** https://news.ycombinator.com/item?id=46421124
- **Launch:** Dec 2025 | 1 point, 0 comments
- **Founder:** asekka1
- **What:** Open-source LLM gateway with budget controls, rate limiting, prompt injection detection, and audit logs. Docker-compose deployment.
- **Architecture:** Proxy-based gateway + dashboard. Supports OpenAI, Anthropic, Ollama, LM Studio.
- **Pricing:** Open source
- **Cost tracking:** Yes | **Budget enforcement:** Yes (hard spending limits) | **Per-customer attribution:** Per-application | **Stripe:** No | **Margin table:** No
- **Status:** Security-first positioning. "Security and financial infrastructure shouldn't be a black box."

### 4. AgentCost
- **URL:** github.com/agentcostin/agentcost
- **HN:** https://news.ycombinator.com/item?id=47235683
- **Launch:** Mar 2026 | 3 points, 1 comment
- **Founder:** agentcostin
- **What:** SDK wrapping OpenAI/Anthropic clients to track costs, provide forecasting, identify model optimization opportunities. Enterprise version adds budgets and policies.
- **Architecture:** Python + TypeScript SDKs, React dashboard, FastAPI backend. SQLite (community) / PostgreSQL (enterprise).
- **Pricing:** MIT (community), BSL 1.1 (enterprise)
- **Cost tracking:** Yes | **Budget enforcement:** Yes (enterprise only) | **Per-customer attribution:** Not detailed | **Stripe:** No | **Margin table:** No
- **Integrations:** LangChain, CrewAI, AutoGen, LlamaIndex. OTel + Prometheus export.

### 5. AgentBudget
- **URL:** github.com/sahiljagtap08/agentbudget
- **HN:** https://news.ycombinator.com/item?id=47133305
- **Launch:** Feb 2026 | 7 points, 8 comments
- **Founder:** sahiljagtapyc (Sahil Jagtap)
- **What:** Python SDK enforcing hard dollar budgets on AI agent sessions. Monkey-patches OpenAI and Anthropic SDKs. Two-phase enforcement: pre-call estimation + post-call reconciliation.
- **Architecture:** Python SDK only. No dashboard. No proxy. 2 lines of code.
- **Pricing:** Open source (Apache 2.0)
- **Cost tracking:** Yes (unified ledger) | **Budget enforcement:** Yes (hard limits, raises exception) | **Per-customer attribution:** No | **Stripe:** No | **Margin table:** No
- **Origin story:** "An AI agent loop cost me $187 in 10 minutes"
- **Notable:** Highest-traction budget enforcement product on HN (7 points). Loop detection via sliding window.

### 6. SpendGuard
- **URL:** github.com/cynsta/spendguard-sdk + spendguard-sidecar
- **HN:** https://news.ycombinator.com/item?id=47136571
- **Launch:** Feb 2026 | 1 point
- **Founder:** miridar
- **What:** Per-agent spending limits in cents with optional automatic top-ups. SDK + sidecar architecture. Everything runs locally except model pricing list.
- **Architecture:** SDK + Docker sidecar. Local-first.
- **Pricing:** MIT open source
- **Cost tracking:** Yes | **Budget enforcement:** Yes (hard limits in cents) | **Per-customer attribution:** No (agent-level) | **Stripe:** No | **Margin table:** No

### 7. SpendScope
- **URL:** spendscope.ai
- **HN:** https://news.ycombinator.com/item?id=45901290
- **Launch:** Nov 2025 | 1 point
- **Founder:** zvivier
- **What:** Aggregates AI API costs from OpenAI, Anthropic, Google AI with budget alerts and model-level breakdowns.
- **Architecture:** Built with Lovable (no-code), Supabase backend, Stripe integration.
- **Pricing:** $49 lifetime, 7-day free trial
- **Cost tracking:** Yes | **Budget enforcement:** Budget alerts only (not hard enforcement) | **Per-customer attribution:** No | **Stripe:** Yes (for payment) | **Margin table:** No
- **Origin story:** "Unpredictable bills — $200 one month, $400 the next"

### 8. AI Cost Board
- **URL:** aicostboard.com
- **HN:** https://news.ycombinator.com/item?id=46937191
- **Launch:** Feb 2026 | 1 point, 1 comment
- **Founder:** tkrenn06
- **What:** Unified dashboard for total spend, token usage, request volume, latency, error rates across providers. Request logging, budgets/alerts, workspace structure.
- **Architecture:** Proxy layer + dashboard.
- **Pricing:** Free + Pro subscription tiers
- **Cost tracking:** Yes | **Budget enforcement:** Budgets + alerts | **Per-customer attribution:** Workspace/project structure | **Stripe:** No | **Margin table:** No

---

## Category 2: Cost Tracking / Observability Only (No Enforcement)

### 9. Helicone (YC W23)
- **URL:** helicone.ai
- **HN:** https://news.ycombinator.com/item?id=42806254 (29pts/7c), https://news.ycombinator.com/item?id=35279155 (Launch HN)
- **Launch:** Mar 2023, relaunched Jan 2025
- **Founders:** Justin, Cole
- **What:** Open-source LLM observability platform. Proxy-based single-line integration. Log, evaluate, experiment, review, release workflow.
- **Architecture:** Proxy via Cloudflare Workers (zero latency impact). Kafka for log ingestion. S3 + Kafka + ClickHouse storage.
- **Pricing:** Freemium + managed cloud
- **Stats:** 2.1B+ requests, 2.6T+ tokens processed
- **Cost tracking:** Yes | **Budget enforcement:** No | **Per-customer attribution:** Yes (user tracking) | **Stripe:** No | **Margin table:** No
- **Acquired by ClickHouse:** Jan 2026 (Langfuse was acquired, not Helicone -- Helicone still independent as of research date)

### 10. Langfuse (YC W23)
- **URL:** langfuse.com | github.com/langfuse/langfuse
- **HN:** https://news.ycombinator.com/item?id=37310070 (143pts/35c)
- **Launch:** Aug 2023
- **Founders:** Marc Klingen, Max Deichmann (2-person team at launch)
- **What:** Open-source observability and analytics for LLM apps. Captures execution traces, analyzes quality/cost/latency.
- **Architecture:** T3 stack (Next.js, Prisma, tRPC, Tailwind). PostgreSQL via Supabase. Async background SDKs.
- **Pricing:** Open source (MIT) + managed cloud. Storage-based pricing.
- **Cost tracking:** Yes (token usage analytics) | **Budget enforcement:** No | **Per-customer attribution:** Yes (user-level analytics) | **Stripe:** No | **Margin table:** No
- **ACQUIRED by ClickHouse:** Jan 2026

### 11. Laminar
- **URL:** lmnr.ai | github.com/lmnr-ai/lmnr
- **HN:** https://news.ycombinator.com/item?id=41451698 (203pts/45c)
- **Launch:** Sep 2024
- **Founders:** Robert, Din, Temirlan
- **What:** "DataDog + PostHog for LLM Apps." Full execution trace handling, semantic event analytics, searchable traces, pipeline builder.
- **Architecture:** Rust ingestor, RabbitMQ, PostgreSQL, ClickHouse, Qdrant. OTel-native.
- **Pricing:** Free tier, $50+ tiers, custom
- **Cost tracking:** Implied (trace data) | **Budget enforcement:** No | **Per-customer attribution:** No | **Stripe:** No | **Margin table:** No

### 12. LiteLLM
- **URL:** github.com/BerriAI/litellm
- **HN:** https://news.ycombinator.com/item?id=37095542 (140pts/34c)
- **Launch:** Aug 2023
- **Founder:** Krrish (detente18)
- **What:** Unified proxy for 50+ LLM models via `/chat/completions` endpoint. Error handling, fallbacks, logging, caching, streaming.
- **Architecture:** Python proxy. Deploys to Railway/GCP/AWS/Azure. Virtual keys with daily/weekly limits.
- **Pricing:** Open source
- **Cost tracking:** Yes (stores cost per query) | **Budget enforcement:** Yes (virtual keys with limits) | **Per-customer attribution:** Via virtual keys | **Stripe:** No | **Margin table:** No
- **SECURITY INCIDENT:** PyPI packages 1.82.7/1.82.8 compromised (April 2026)
- **Note:** LiteLLM actually straddles categories -- it has virtual key budgets but is primarily used as a routing proxy.

### 13. TokenMeter
- **URL:** github.com/ATMAECHO/TOKEN-METER
- **HN:** https://news.ycombinator.com/item?id=47057746 (1pt/3c)
- **Launch:** Feb 2026
- **Founder:** Mohit8880 (solo)
- **What:** Open-source observability layer for LLM token costs.
- **Architecture:** Not specified
- **Cost tracking:** Yes | **Budget enforcement:** No | All others: No
- **Status:** HN community questioned whether submission was bot-generated.

### 14. llm.report
- **URL:** github.com/dillionverma/llm.report
- **HN:** https://news.ycombinator.com/item?id=37148410 (6pts/3c)
- **Launch:** Aug 2023
- **Founder:** Dillion Verma
- **What:** Open-source logging and analytics for OpenAI. Dashboard, request logging, per-user cost analysis.
- **Architecture:** Dashboard + logging. No proxy.
- **Cost tracking:** Yes | **Per-customer attribution:** Yes (cost per user) | **Budget enforcement:** No | **Stripe:** No | **Margin table:** No
- **Status:** Early stage. Missing self-hosting docs at launch.

### 15. Props AI
- **URL:** getprops.ai
- **HN:** https://news.ycombinator.com/item?id=39267010 (4pts/3c)
- **Launch:** Feb 2024
- **Founder:** k11kirky
- **What:** Cost-per-user visibility for OpenAI apps. Uses the "user" field in API requests.
- **Architecture:** Lightweight proxy + data pipeline + dashboard.
- **Pricing:** Free
- **Cost tracking:** Yes | **Per-customer attribution:** Yes (core feature) | **Budget enforcement:** No | **Stripe:** Planned | **Margin table:** No
- **Key insight from founder:** "disparity between how we pay for LLMs (Tokens) and how we charge for them (Per month)"

### 16. AffordAI
- **URL:** affordai.io
- **HN:** https://news.ycombinator.com/item?id=43157186 (1pt)
- **Launch:** Mar 2025
- **Founder:** Kyrylo Alokhin
- **What:** Analytics platform for monitoring LLM usage and expenses. Tracks top users.
- **Architecture:** API-based event submission + dashboard.
- **Pricing:** Pay-as-you-go, free tier
- **Cost tracking:** Yes | **Per-customer attribution:** Yes (top users) | **Budget enforcement:** No | **Stripe:** No | **Margin table:** No

### 17. AgentLens
- **URL:** github.com/amitpaz1/agentlens
- **HN:** https://news.ycombinator.com/item?id=46932636 (1pt)
- **Launch:** Feb 2026
- **Founder:** amit_paz
- **What:** Open-source observability for AI agents. Captures tool calls, LLM interactions. MCP-native.
- **Architecture:** TypeScript, Hono, React, Drizzle ORM, SQLite. 5 npm packages. SSE streaming dashboard.
- **Pricing:** MIT open source
- **Cost tracking:** Yes | **Budget enforcement:** No | **Audit trail:** Yes (SHA-256 hash chains) | **Stripe:** No | **Margin table:** No

### 18. Lumina
- **URL:** github.com/use-lumina/Lumina
- **HN:** https://news.ycombinator.com/item?id=46781731 (1pt)
- **Launch:** Jan 2026
- **Founder:** Evanson
- **What:** OpenTelemetry-native observability for AI/LLM apps. Cost & quality monitoring, replay testing.
- **Architecture:** Bun, Postgres, Redis, NATS. TypeScript SDK. Docker Compose.
- **Pricing:** Free self-hosted (50k traces/day) + managed cloud
- **Cost tracking:** Yes (cost spike alerts) | **Budget enforcement:** No | **Stripe:** No | **Margin table:** No

### 19. ClawSight
- **URL:** clawsight.org | github.com/ClawSight/platform
- **HN:** https://news.ycombinator.com/item?id=47210012 (1pt)
- **Launch:** Mar 2026
- **Founder:** upsidepotential
- **What:** Lightweight monitoring for autonomous AI agents. Live log streaming, cost/token tracking, remote kill switch.
- **Architecture:** Node SDK + hosted/self-hosted dashboard.
- **Origin story:** "Telegram agent ran up a $100 Claude bill with no way to see its progress"
- **Cost tracking:** Yes | **Budget enforcement:** No (kill switch only) | **Stripe:** No | **Margin table:** No

### 20. Cursor Usage Tracker
- **URL:** github.com/ofershap/cursor-usage-tracker
- **HN:** https://news.ycombinator.com/item?id=47109888 (1pt)
- **Launch:** Feb 2026
- **Founder:** ofershap
- **What:** Monitors Cursor AI spending per developer. Three-layer anomaly detection. Slack/email alerts.
- **Architecture:** Self-hosted, SQLite, Docker. Connects to Cursor Enterprise APIs.
- **Origin story:** "Developer accidentally spending $1,200 in one day on expensive model selection"
- **Cost tracking:** Yes (per-developer/model) | **Budget enforcement:** No (alerts only) | **Stripe:** No | **Margin table:** No

---

## Category 3: Agent Governance / Policy Enforcement (No Cost Focus)

### 21. AgentBouncr
- **URL:** github.com/agentbouncr/agentbouncr
- **HN:** https://news.ycombinator.com/item?id=47087311 (1pt/3c)
- **Launch:** Feb 2026
- **Founder:** Soenke_Cramme
- **What:** Governance layer with JSON-based policy engine, hash-chained audit trail, kill switch, human oversight.
- **Architecture:** Policy engine + runtime enforcement
- **Cost tracking:** No | **Budget enforcement:** No | **Stripe:** No | **Margin table:** No
- **Notable comment:** "agent X can use tool Y breaks down fast when agents chain tools in unexpected ways. The sequence matters more than individual permissions."

### 22. Cordum
- **URL:** github.com/cordum-io/cordum
- **HN:** https://news.ycombinator.com/item?id=46667812 (2pts/2c)
- **Launch:** Jan 2026
- **Founder:** Yaron (yaront111), DevOps engineer
- **What:** "Sudo mechanism for AI agents." Safety enforcement layer between agents and production systems. State machine for action validation.
- **Architecture:** Go, NATS JetStream, Redis. Proxy/gateway approach.
- **Cost tracking:** No | **Budget enforcement:** No | **Stripe:** No | **Margin table:** No
- **Insight:** Commenter noted enforcement needs to "explain why an action was blocked"

### 23. Limits
- **URL:** limits.dev
- **HN:** https://news.ycombinator.com/item?id=47146354 (9pts/2c)
- **Launch:** Feb 2026
- **Founder:** thesvp (processed 30k+ policy checks across 16 teams)
- **What:** Intercepts AI agent actions before execution. Three modes: Conditions (structured rules), Guidance (LLM output validation), Guardrails (PII/toxicity/injection).
- **Architecture:** SDK-based (npm install @limits/js)
- **Pricing:** Not disclosed
- **Cost tracking:** No | **Budget enforcement:** No | **Stripe:** No | **Margin table:** No

### 24. Edictum
- **URL:** github.com/acartag7/edictum
- **HN:** https://news.ycombinator.com/item?id=47159542 (2pts)
- **Launch:** Feb 2026
- **Founder:** acartag7
- **What:** Runtime governance for LLM agent tool calls. YAML-based rules with preconditions, postconditions, PII redaction. 55us per evaluation.
- **Architecture:** SDK supports LangChain, CrewAI, OpenAI Agents SDK, Claude Agent SDK, Agno, Semantic Kernel.
- **Cost tracking:** No | **Budget enforcement:** No | **Stripe:** No | **Margin table:** No
- **Academic backing:** arxiv.org/abs/2602.16943

### 25. Mandate
- **URL:** github.com/kashaf12/mandate
- **HN:** https://news.ycombinator.com/item?id=46383650 (2pts)
- **Launch:** Dec 2025
- **Founder:** kashaf12
- **What:** Runtime enforcement treating agents as economic actors. Identity-based policy, spending caps, tool restrictions.
- **Architecture:** Agent = identity, Policy = authority template, Mandate = short-lived per-invocation authority
- **Cost tracking:** Yes (spending caps) | **Budget enforcement:** Yes | **Stripe:** No | **Margin table:** No
- **Status:** Very early MVP

### 26. AI Authority Gateway
- **URL:** github.com/malukutty/ai_authority_gateway
- **HN:** https://news.ycombinator.com/item?id=46347631 (1pt)
- **Launch:** Dec 2025
- **Founder:** bhaviav100
- **What:** Gateway between apps, LLMs, and actions. Cost ceilings, human approvals, kill switch, policy allowlists, append-only audit logs.
- **Architecture:** Gateway-based. Stubbed executors (early prototype).
- **Cost tracking:** No | **Budget enforcement:** Yes (cost ceilings) | **Stripe:** No | **Margin table:** No
- **Quote:** "AI needs a control plane, not just better prompts"

### 27. LLMSafe
- **URL:** llmsafe.cloud
- **HN:** https://news.ycombinator.com/item?id=46484037 (2pts)
- **Launch:** Jan 2026
- **Founder:** matheusdelgado
- **What:** Zero-Trust Security & Governance Gateway. Prompt injection detection, PII masking, policy enforcement, audit trail.
- **Architecture:** Docker self-hosted gateway.
- **Cost tracking:** No | **Budget enforcement:** No | **Stripe:** No | **Margin table:** No

### 28. ScopeGate
- **URL:** scopegate.dev
- **HN:** https://news.ycombinator.com/item?id=47233663 (1pt)
- **Launch:** Mar 2026
- **Founder:** jetbootsmaker
- **What:** Permission proxy for AI agents. Granular OAuth scope control per agent. Unique MCP endpoints per agent.
- **Architecture:** Permission proxy, open-core.
- **Cost tracking:** No | **Budget enforcement:** No | **Stripe:** No | **Margin table:** No
- **Stat:** "88% of orgs have had AI agent security incidents"

### 29. SentinelGate
- **URL:** (Go-based firewall for AI agents)
- **HN:** https://news.ycombinator.com/item?id=47061113
- **Launch:** Feb 2026
- **What:** Universal firewall between agents and systems. Enforces control between intent and execution.
- **Architecture:** Open source, Go.
- **Cost tracking:** No | **Budget enforcement:** No | **Stripe:** No | **Margin table:** No

### 30. OneCLI (Vault for AI Agents)
- **URL:** (Rust-based gateway)
- **HN:** https://news.ycombinator.com/item?id=47353558
- **Launch:** April 2026
- **What:** Stores real credentials in encrypted vault while agents use placeholder keys. Swaps placeholders for real credentials when forwarding requests.
- **Architecture:** Rust binary, gateway proxy.
- **Cost tracking:** No | **Budget enforcement:** No | **Stripe:** No | **Margin table:** No

---

## Category 4: LLM Gateways / Proxies (Routing Focus)

### 31. Portkey
- **URL:** github.com/Portkey-AI/gateway
- **HN:** https://news.ycombinator.com/item?id=38911677 (37pts/13c)
- **Launch:** Jan 2024, updated Aug 2024
- **Founders:** Rohit & Ayush
- **What:** TypeScript AI gateway to 100+ models. Load balancing, fallbacks, retries, caching, guardrails.
- **Architecture:** TypeScript SDK (~45kb). 9.9x faster than alternatives.
- **Stats:** 3B+ tokens daily at launch, 100B+ historically
- **Cost tracking:** Implied | **Budget enforcement:** Not mentioned | **Stripe:** No | **Margin table:** No

### 32. LLM-Gateway (OpenZiti)
- **URL:** github.com/openziti/llm-gateway
- **HN:** https://news.ycombinator.com/item?id=47542999 (7pts/1c)
- **Launch:** April 2026
- **Founder:** michaelquigley (NetFoundry)
- **What:** Zero-trust LLM gateway with semantic routing and zero-trust networking via OpenZiti overlay.
- **Architecture:** Single Go binary, one YAML config.
- **Cost tracking:** No | **Budget enforcement:** No | **Stripe:** No | **Margin table:** No

### 33. LLM Gateway (OngoingAI)
- **URL:** github.com/ongoingai/gateway
- **HN:** https://news.ycombinator.com/item?id=47067077 (4pts/2c)
- **Launch:** Feb 2026
- **Founder:** Nathan (15+ yrs engineering, built Shopify subscriptions)
- **What:** Open-source LLM proxy in Go. Observability focus.
- **Architecture:** Go proxy. No dashboard.
- **Cost tracking:** No | **Budget enforcement:** No | **Stripe:** No | **Margin table:** No

### 34. Bifrost
- **URL:** github.com/maximhq/bifrost
- **HN:** https://news.ycombinator.com/item?id=46822660 (2pts)
- **Launch:** Jan 2026
- **Founder:** aanthonymax
- **What:** "50x faster than LiteLLM." High-performance gateway to 15+ providers.
- **Architecture:** Gateway proxy.
- **Cost tracking:** No | **Budget enforcement:** No | **Stripe:** No | **Margin table:** No

### 35. Arch (ArchGW)
- **URL:** (Envoy-based)
- **HN:** https://news.ycombinator.com/item?id=44546265
- **Launch:** Jul 2025
- **What:** Intelligent proxy for agents built on Envoy. Handles prompts natively.
- **Architecture:** Envoy-based edge proxy.
- **Cost tracking:** No | **Budget enforcement:** No | **Stripe:** No | **Margin table:** No

### 36. AI Cost Firewall
- **URL:** github.com/vcal-project/ai-firewall
- **HN:** https://news.ycombinator.com/item?id=47558028 (1pt/1c)
- **Launch:** April 2026
- **Founder:** vcaluser
- **What:** OpenAI-compatible gateway with semantic caching (0.92 similarity threshold).
- **Architecture:** Gateway proxy.
- **Cost tracking:** No | **Budget enforcement:** No | **Stripe:** No | **Margin table:** No

### 37. Tokenomics (Personal AI Gateway)
- **URL:** github.com/rickcrawford/tokenomics
- **HN:** https://news.ycombinator.com/item?id=47227802 (2pts)
- **Launch:** Mar 2026
- **Founder:** Rick Crawford (crawdog)
- **What:** Local proxy with guardrails, prompt injection/PII filtering, session token tracking, web UI for stats.
- **Architecture:** Local binary proxy on localhost:8443.
- **Cost tracking:** Yes (session token usage) | **Budget enforcement:** No | **Stripe:** No | **Margin table:** No

### 38. Gateway (BYOK)
- **URL:** (open-source proxy for Bring-Your-Own-Key security)
- **HN:** https://news.ycombinator.com/item?id=46882534
- **Launch:** Feb 2026
- **What:** Self-hosted middleware to keep API keys secure in BYOK apps.
- **Architecture:** Self-hosted proxy.
- **Cost tracking:** No | **Budget enforcement:** No | **Stripe:** No | **Margin table:** No

---

## Category 5: Billing / Metering Infrastructure

### 39. OpenMeter (YC W23)
- **URL:** openmeter.io | github.com/openmeterio/openmeter
- **HN:** https://news.ycombinator.com/item?id=36431004 (174pts/42c)
- **Launch:** Jun 2023
- **Founder:** Peter (YC W23)
- **What:** Open-source usage metering platform. Real-time collection/aggregation from cloud/third-party. CloudEvents standard.
- **Architecture:** Go, Kafka, ksqlDB, Postgres. Stream processing (not per-event DB writes).
- **Pricing:** Apache 2.0 + managed cloud
- **Relevant:** Upstream metering layer. Ingests OpenAI usage data. Not billing itself.
- **Cost tracking:** Yes (metering) | **Budget enforcement:** No | **Per-customer attribution:** Yes | **Stripe:** No (positions as upstream) | **Margin table:** No

### 40. Commet
- **URL:** commet.co
- **HN:** https://news.ycombinator.com/item?id=46732932 (1pt/1c)
- **Launch:** Jan 2026
- **Founder:** TeamCommet1
- **What:** Billing engine + Merchant of Record for usage-based SaaS/AI. Metered usage, credits, seat-based pricing. VAT/GST compliance.
- **Architecture:** Next.js, Go, PostgreSQL. Sub-100ms event ingestion.
- **Cost tracking:** Yes (usage tracking) | **Per-customer attribution:** Yes | **Stripe:** Not mentioned | **Margin table:** No

### 41. Flexprice
- **URL:** flexprice.io
- **HN:** https://news.ycombinator.com/item?id=44422663 (7pts/14c)
- **Launch:** Jun 2025
- **Founders:** Koshima, Nikhil (CTO)
- **What:** Open-source monetization platform for AI companies. Usage-based, credit-based, hybrid pricing.
- **Architecture:** SDKs (Python, JS, Go). Time-series DB. Webhook automation.
- **Cost tracking:** Yes | **Per-customer attribution:** Yes | **Budget enforcement:** Yes (credit system) | **Stripe:** No | **Margin table:** No
- **Note:** Includes entitlements management.

### 42. Agent Bazaar
- **URL:** noui.bot/docs/bazaar
- **HN:** https://news.ycombinator.com/item?id=47174397 (1pt)
- **Launch:** Feb 2026
- **Founder:** hudtaylor ("one human and one AI in San Diego")
- **What:** Billing/metering proxy for MCP tool servers. Monetize tools with per-call pricing via Stripe Connect.
- **Architecture:** TypeScript SDK. Billing proxy.
- **Pricing:** 18% platform fee, sub-cent metering
- **Cost tracking:** Yes | **Per-customer attribution:** Yes | **Stripe:** Yes (Stripe Connect) | **Margin table:** No

### 43. Lago
- **URL:** (open-source billing)
- **HN:** https://news.ycombinator.com/item?id=33505229
- **Launch:** Nov 2022
- **What:** Open-source metering and usage-based billing. Hybrid, usage-based, per-seat pricing.
- **Note:** General billing infra, not AI-specific. But widely used for AI token billing.

### 44. Lotus
- **URL:** (open-source pricing infrastructure)
- **HN:** https://news.ycombinator.com/item?id=33494284
- **Launch:** Nov 2022
- **What:** Central repository for pricing plans. Usage-based, per-seat, and custom enterprise pricing.
- **Note:** General billing infra, not AI-specific.

---

## Category 6: LLM Cost Optimization / Routing

### 45. Genosis
- **URL:** usegenosis.ai
- **HN:** https://news.ycombinator.com/item?id=47516438 (2pts)
- **Launch:** April 2026
- **Founder:** samherder (solo)
- **What:** Analyzes traffic patterns to identify cacheable content blocks. Captures provider discounts on cached tokens. Non-proxy approach (manifest + local SDK).
- **Architecture:** Python + TypeScript SDKs. Content-blind (hashes only).
- **Pricing:** Free tier, pay-only-if-savings
- **Cost tracking:** Savings identification | **Budget enforcement:** No | **Stripe:** No | **Margin table:** No

### 46. NadirClaw
- **URL:** github.com/doramirdor/NadirClaw
- **HN:** https://news.ycombinator.com/item?id=47054977 (1pt/1c)
- **Launch:** Feb 2026
- **Founder:** amirdor
- **What:** LLM router classifying prompts to route simple tasks to cheaper models. 60% cost reduction claimed.
- **Architecture:** Python proxy. pip install. OpenAI-compatible.
- **Cost tracking:** No (cost savings implied) | **Budget enforcement:** No | **Stripe:** No | **Margin table:** No

### 47. LLMRouter
- **URL:** github.com/ulab-uiuc/LLMRouter
- **HN:** https://news.ycombinator.com/item?id=46431558 (2pts/1c)
- **Launch:** Dec 2025
- **Founder:** tao2024 (UIUC PhD student)
- **What:** 16+ routing strategies for directing queries to appropriate LLMs. 30-50% cost reduction.
- **Architecture:** CLI + Gradio UI + SDK library. Academic project.
- **Cost tracking:** No | **Budget enforcement:** No | **Stripe:** No | **Margin table:** No

### 48. APICrusher
- **URL:** (AI API cost optimization via routing)
- **HN:** https://news.ycombinator.com/item?id=45255061
- **Launch:** Sep 2025
- **What:** Routes requests by complexity — basic tasks to cheap models, complex to premium. 90% cost reduction claimed.
- **Architecture:** Proxy router.
- **Cost tracking:** No | **Budget enforcement:** No | **Stripe:** No | **Margin table:** No

---

## Category 7: Agent Financial Infrastructure (Wallets, Payments)

### 49. AgentWallet
- **URL:** github.com/JackD720/agentwallet
- **HN:** https://news.ycombinator.com/item?id=46566892 (3pts), https://news.ycombinator.com/item?id=47147291 (1pt)
- **Launch:** Jan 2026, relaunched Feb 2026
- **Founder:** JackDavis720
- **What:** Open-source SDK for AI agent financial transactions. Wallets with spend controls, audit trails, human oversight. Dead man's switch. Heartbeat monitoring.
- **Architecture:** Node.js, PostgreSQL, Prisma, React dashboard, REST API.
- **Pricing:** Open source + per-transaction managed service
- **Cost tracking:** Yes (balance tracking) | **Budget enforcement:** Yes (daily limits, per-tx caps) | **Per-customer attribution:** No | **Stripe:** Yes (deposits/withdrawals) | **Margin table:** No

### 50. PolicyLayer
- **URL:** policylayer.com
- **HN:** https://news.ycombinator.com/item?id=46808648 (1pt)
- **Launch:** Jan 2026
- **Founder:** liad
- **What:** Non-custodial spending limits for AI agent wallets. SHA-256 fingerprinting. Fail-closed design.
- **Architecture:** Drop-in SDK wrapper for wallet libraries (Ethers, Viem, Coinbase CDP, Privy, Solana).
- **Cost tracking:** Yes (tx metadata) | **Budget enforcement:** Yes (daily caps, per-tx limits) | **Stripe:** No | **Margin table:** No
- **Crypto-native:** Supports X402 HTTP payment protocol.

### 51. Ledge
- **URL:** github.com/Devendra116/ledge
- **HN:** https://news.ycombinator.com/item?id=47219966 (4pts)
- **Launch:** Mar 2026
- **Founder:** devendra116
- **What:** Policy layer for AI agent payments. 4 validation checks: technical, policy limits, context coherence, behavioral patterns.
- **Architecture:** Python SDK. KMS/Turnkey for production. Built for x402.
- **Cost tracking:** No | **Budget enforcement:** Yes ($10 budget examples) | **Stripe:** No | **Margin table:** No

### 52. Lexiso
- **URL:** lexiso.app
- **HN:** https://news.ycombinator.com/item?id=46804225 (1pt)
- **Launch:** Jan 2026
- **Founder:** Deonnroberts
- **What:** Authorization API for AI agents making financial transactions. Pre-purchase policy validation. RSA-2048 signed authorization decisions. <300ms response.
- **Architecture:** Go + PostgreSQL backend. npm SDK.
- **Cost tracking:** No | **Budget enforcement:** Yes (amount limits, merchant restrictions) | **Stripe:** No | **Margin table:** No
- **Positioning:** "No custody, no money movement — authorization only." AP2 compliance.

### 53. Kybera
- **URL:** (agentic smart wallet)
- **HN:** https://news.ycombinator.com/item?id=46958433
- **Launch:** Feb 2026
- **What:** Agentic smart wallet with AI OSINT and reputation tracking. Crypto-native.
- **Cost tracking:** No | **Budget enforcement:** No | **Stripe:** No | **Margin table:** No

---

## Additional Products (Mentioned in Comments/Adjacent)

### Misc Tools
- **Codesession-CLI** (github.com/brian-mwirigi/codesession-cli) — CLI for per-task token cost tracking in AI coding agents. 1pt. Feb 2026.
- **Token Cost Guard** (github.com/alexcalderado/token-cost-guard) — Python CLI for local AI API cost tracking. 1pt. Feb 2026.
- **Claude Skill for cost tracking** (HN #47299439) — Claude Code skill for session cost tracking.
- **Price Per Token** (pricepertoken.com) — LLM API pricing data website. Aug 2025.
- **Open-source LLM price comparison** (HN #41244648) — GitHub tool for comparing provider prices. Aug 2024.
- **GPT Calculator** (HN #35352247) — Token count and cost calculator for GPT prompts. Mar 2023.
- **Token price calculator for 400+ LLMs** (HN #40710154) — tokencost library. Jun 2024.
- **Narev** (github.com/narevai/narev) — Open-source FinOps for AI + cloud spend. FOCUS 1.2 normalization. 3pts. Jul 2025.
- **GenOps AI** (github.com/KoshiHQ/GenOps-AI) — OSS OTel-based runtime governance for AI workloads. 3pts. Oct 2025.
- **Orchagent** (orchagent.io) — Cloud infra for AI agents with LLM cost tracking per agent per run. $29/mo Pro. 2pts. Feb 2026.
- **Origin** (getorigin.io) — Git blame for AI agents (tracks which AI wrote every line + what it cost). 3pts. April 2026.
- **Progress Agent Observability** (telerik.com/agent-observability-early-access) — LLM observability from Progress/Telerik. 1pt. Nov 2025.
- **Caliper** (usecaliper) — Auto-instrumented LLM observability with custom metadata. Python SDK. 2pts. April 2026.

---

## Traction Analysis

### Top 10 by HN Points (all time)

| Rank | Product | Points | Comments | Category | Launch Date |
|------|---------|--------|----------|----------|------------|
| 1 | Laminar | 203 | 45 | Observability | Sep 2024 |
| 2 | OpenMeter | 174 | 42 | Metering | Jun 2023 |
| 3 | Langfuse | 143 | 35 | Observability | Aug 2023 |
| 4 | LiteLLM | 140 | 34 | Proxy + Cost | Aug 2023 |
| 5 | Portkey | 37 | 13 | Gateway | Jan 2024 |
| 6 | Helicone | 29 | 7 | Observability | Jan 2025 |
| 7 | Limits | 9 | 2 | Governance | Feb 2026 |
| 8 | AgentBudget | 7 | 8 | Budget enforcement | Feb 2026 |
| 9 | Flexprice | 7 | 14 | Billing | Jun 2025 |
| 10 | LLM-Gateway | 7 | 1 | Gateway | Apr 2026 |

**Key observation:** No pure cost-tracking or budget-enforcement product has ever broken 10 points on HN. The top performers are all observability or infrastructure plays. This suggests HN rewards developer tools with broad utility over narrow financial controls.

### Budget Enforcement Products by Traction

| Product | Points | Architecture | Hard Limits? | Per-Customer? |
|---------|--------|-------------|-------------|---------------|
| AgentBudget | 7 | SDK (Python) | Yes | No |
| MarginDash | 2 | SDK + Dashboard | Yes | Yes |
| AI Spend (Lava) | 2 | Proxy | Yes | Yes (via keys) |
| AgentCost | 3 | SDK + Dashboard | Enterprise only | No |
| TensorWall | 1 | Proxy + Dashboard | Yes | Per-app |
| SpendGuard | 1 | SDK + Sidecar | Yes | No |
| SpendScope | 1 | Dashboard | Alerts only | No |
| AI Cost Board | 1 | Proxy + Dashboard | Alerts only | Workspace-level |

---

## Dead/Inactive Projects

Based on GitHub activity, last commit dates, and HN launch traction:

1. **TokenMeter** — Accused of being bot-generated. 1pt. Likely abandoned.
2. **AI Authority Gateway** — Stubbed executors, prototype stage. 1pt. Likely abandoned.
3. **llm.report** — Last meaningful update unclear. Missing docs at launch. 6pts but old (Aug 2023).
4. **Props AI** — Free tool, 4pts. Feb 2024. Stripe integration was "planned" — unknown if delivered.
5. **AffordAI** — 1pt. Mar 2025. Minimal HN engagement.
6. **Mandate** — "Very early MVP." 2pts. Dec 2025. Seeking production feedback.
7. **Constitutional AI Agent OS** (HN #46055028) — Nov 2025. Cryptographic oath system. Likely academic/experimental.
8. **GPT Calculator** — Mar 2023. Predates current landscape. Likely superseded.
9. **Lotus** — Nov 2022. General billing. Competed with Lago. Status unclear.

---

## Patterns & Strategic Insights

### 1. Origin Story Convergence
At least 4 products launched with "I lost $X to an agent loop" narratives:
- AgentBudget: "$187 in 10 minutes"
- AI Spend (Lava): "$200 from an agent loop"
- ClawSight: "$100 Claude bill from Telegram agent"
- Cursor Usage Tracker: "$1,200 in one day"

This is the dominant emotional hook in the space. NullSpend should weaponize this narrative.

### 2. Architecture Split: Proxy vs SDK
- **Proxy approach:** AI Spend (Lava), TensorWall, AI Cost Board, Portkey, LiteLLM
- **SDK approach:** AgentBudget, AgentCost, MarginDash, SpendGuard, Codesession-CLI
- **Both:** NullSpend (proxy + SDK)

Most new entrants are SDK-only because proxies are harder to build. The SDK-only products have a fundamental enforcement gap: client-side checks can be bypassed or fail open.

### 3. No One Has Stripe Margin Tables on HN
Props AI planned Stripe integration. SpendScope uses Stripe for payments. AgentWallet uses Stripe for deposits. But ZERO products on HN have shipped a per-customer margin table with Stripe revenue sync. This is NullSpend's clearest wedge.

### 4. Agent Wallet Space is Crypto-Native
PolicyLayer, Ledge, Lexiso, Kybera — all crypto-first (Solana, x402, Ethers/Viem). This is a different market from API cost management. The overlap is "spending limits" but the customer base is completely different.

### 5. Governance is Crowded but Shallow
AgentBouncr, Cordum, Limits, Edictum, Mandate, SentinelGate, ScopeGate, LLMSafe, OneCLI — 9+ governance products launched in 3 months (Dec 2025 - Feb 2026). Most are weekend projects with 1-2 HN points. None have meaningful traction. The space is supply-saturated with no clear winner.

### 6. Langfuse Acquisition Signal
ClickHouse acquiring Langfuse (Jan 2026) validated the LLM observability category and set a price anchor. This could accelerate funding into adjacent spaces (cost enforcement being a logical extension of observability).

### 7. MCP is the New Distribution Vector
Multiple products (AgentLens, Agent Bazaar, ScopeGate, Edictum) are positioning around MCP. NullSpend's MCP server is ahead of most competitors here.

### 8. No Product Has All Five
No single HN-launched product has: cost tracking + hard budget enforcement + per-customer attribution + Stripe integration + margin table. Most have 1-2 of these. NullSpend targets all 5.
