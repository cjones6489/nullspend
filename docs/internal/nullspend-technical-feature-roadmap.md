# NullSpend Technical Feature Roadmap
## April 2026 - September 2026

The financial operating system for the agent economy — identity, budgets, enforcement, commerce, and compliance in one platform.

Based on competitive analysis of Respan, Crossmint, Locus, Cordum, Cycles, Portkey, Scira, and the broader agent financial infrastructure landscape.

See also:
- [Vision Document](nullspend-vision.md) — the $1B thesis, seven layers, flywheel, and timeline
- [Domination Playbook](nullspend-domination-playbook.md) — distribution, growth, content, and competitive warfare tactics
- [Competitive Features to Steal](competitive-features-to-steal.md) — concrete features sourced from competitor analysis, prioritized by impact/effort

---

## Strategic Vision

Within 18 months, every company deploying AI agents will need three things they can't build themselves:

1. **Control** — "This agent can spend up to $X on these things"
2. **Accountability** — "Here's exactly what every agent spent, why, and whether it was authorized"
3. **Commerce** — "Agent A (our company) needs to pay Agent B (their company) for a service"

NullSpend already owns #1 better than anyone. This roadmap deepens #1, builds #2, and lays the foundation for #3.

Crossmint is the agent bank. Locus is the agent wallet. Respan is the agent dashboard. **NullSpend is the agent CFO.**

---

## Competitive Landscape (as of March 30, 2026)

| Company | What they are | Relationship to NullSpend |
|---|---|---|
| **Respan** (fka Keywords AI) | Observability + eval platform with AI gateway. $5M seed (Mar 2026). 100+ YC customers. | Direct competitor on cost tracking. No real budget enforcement — marketing only. NullSpend wins on control plane. |
| **Crossmint** | Agent payment infrastructure — wallets, virtual cards, stablecoins. $23.6M Series A. SOC 2, MiCA. Visa/Mastercard partnerships. | Adjacent. Solves "agents spending money in the world." NullSpend solves "agents not overspending on AI services." Complementary. |
| **Locus** | Crypto-native agent payment rails — USDC on Base, wrapped APIs, Visa prepaid. YC F25, $8M. | Adjacent. Similar to Crossmint but crypto-first. Simple 3-knob spending controls vs NullSpend's deep budget model. |
| **Cordum** | Job orchestrator + policy engine. Solo dev, unfunded, 463 GitHub stars. BUSL license. | Blogs about FinOps but product is a job scheduler. No actual cost calculation — uses time-based limits. Strong HITL approvals. Heavy infra (NATS + Redis + 6 services). Threat is narrative, not product. |
| **Cycles** (Runcycles) | Budget authority protocol. Solo dev, unfunded, 18 GitHub stars. Apache 2.0. | Direct competitor on budget enforcement. Well-designed reserve-commit protocol with multi-scope hierarchy. But: sidecar model (bypassable), no proxy, no cost calculation, no UI, no webhooks, no HITL, no managed hosting. |
| **Portkey** | AI gateway with 200+ model support, guardrails, caching. | Competes on gateway. Weaker on budget enforcement and HITL. Stronger on model breadth. |
| **Scira** | AI search API (Perplexity alternative). 11.6K GitHub stars. | Not a competitor. Potential NullSpend customer. |

### NullSpend's Unique Position

Nobody else does real-time atomic budget enforcement for agent spending. Respan watches. Crossmint and Locus handle payment execution. Cordum schedules jobs. Cycles provides a protocol but no product. Payment protocols (AP2, x402, MPP) handle how money moves but not whether the agent is authorized to spend it.

NullSpend is the only product with three enforcement surfaces — proxy (mandatory), SDK (cooperative), and MCP server (agent-initiated) — that can block a request before it burns money AND extend beyond compute to universal spending authorization.

### What NOT to Build

- **Payment rails** — Crossmint, Locus, x402, MPP own execution. We **integrate** as the authorization layer, not compete on rails.
- **Eval / prompt management** — Respan owns this. Stay in our lane.
- **Custom dashboards (80+ graph types)** — Respan territory. Our dashboard should be focused and opinionated, not a BI tool.

### What Creates Defensibility

1. **Three-surface enforcement** — proxy (mandatory, can't bypass), SDK (cooperative, any HTTP call), MCP server (agent-initiated governance). No competitor has more than one.
2. **Automatic cost calculation** — 40+ model pricing catalog, streaming SSE parsing, cached/reasoning token tiers (Cycles and Cordum have zero cost calculation)
3. Budget enforcement primitives nobody else has (negotiation, overdraft policies, per-customer quotas, risk points, velocity, spending envelopes)
4. **Universal spending authority** — SDK `trackedFetch` extends beyond compute to any HTTP call that costs money. Path to authorizing SaaS, commerce, agent-to-agent payments.
5. **Protocol positioning** — ASAP as the authorization standard compatible with AP2/x402/MPP. NullSpend as the decision engine, payment rails as execution.
6. Developer workflow integration (CI/CD cost checks, GitHub Action)
7. Compliance timing (EU AI Act enforcement August 2, 2026)
8. Revenue infrastructure (metered billing pass-through — makes us load-bearing)
9. Network effects (cost intelligence from aggregate data)
10. **Zero-infra managed platform** — competitors require self-hosted NATS/Redis clusters; NullSpend: one URL (proxy) or one import (SDK) or one MCP config (MCP server)

---

## Five Strategic Moves

These are the bets that make NullSpend the category winner, not just a better product.

### Move 1: Own the Protocol — Agent Spending Authorization Protocol (ASAP)

The payment protocol landscape (AP2, x402, MPP, KYAPay) is racing to solve payment **execution** — how money moves. None solve "is this agent authorized to spend $X on Y?" AP2's Mandates express delegation. MPP's Sessions cap spending. But neither is a general-purpose authorization check that works across spending categories, payment rails, and provider types.

**The play:** Define and open-source a lightweight HTTP-based Agent Spending Authorization Protocol that works **across all spending categories**:
- Agent presents a signed token: "I'm authorized to spend up to $50 on compute today, $200 on SaaS, $1000 on commerce"
- Service verifies the signature, executes, calls back to confirm spend
- Works with ANY payment rail — x402 checks ASAP before signing, MPP sessions are opened with ASAP-authorized limits, AP2 mandates carry ASAP signatures
- Think OAuth for money, but rail-agnostic and category-aware

NullSpend is the reference implementation. Others can implement the protocol, but NullSpend is the easiest way to issue and manage the tokens. This is the Stripe playbook — open the standard, own the implementation. If ASAP becomes the default way agents prove spending authority, NullSpend becomes the default issuer.

**Protocol compatibility:** ASAP tokens can be embedded in A2A Agent Cards (spending_authority field), attached to AP2 Mandates, presented before x402 payments, and checked before MPP session creation. AIP's Invocation-Bound Capability Token model (multi-hop delegation with attenuating permissions) informs the delegation chain design.

### Move 2: Agent Identity as a First-Class Primitive

An API key is a credential. An agent is an entity. Right now NullSpend has keys. The future is agents.

"Create Agent" becomes the primary onboarding action. An agent is a first-class entity with:
- **Identity** — name, owner, team
- **Credentials** — API key + vaulted provider keys
- **Financial controls** — budget, velocity limits, mandates, quotas
- **Audit trail** — every cost event, enforcement decision, negotiation
- **Policy** — what it can do, what it can spend, who approves escalations
- **Hierarchy** — org → team → agent → sub-agent, with budget delegation

This reframes NullSpend from "a proxy with budgets" to "the place where agents are born with financial controls built in."

### Move 3: Agent-to-Agent Commerce (The Settlement Layer)

Today: Agent A calls OpenAI, pays with a credit card. Single-player.

Tomorrow: Agent A (Company X) uses a capability from Agent B (Company Y). Agent B charges $0.50/invocation. Crossmint's answer: USDC on Base. Enterprise's answer: invoicing, net settlement, fiat rails.

**The play:**
1. Agent capability registry — Agent B registers "I provide summarization at $0.001/request"
2. Authorization — Agent A presents ASAP token. NullSpend validates budget.
3. Execution — Agent B performs the work.
4. Settlement — NullSpend records the transaction. End of period: invoices, net settlement, Stripe Connect.

Network effect: every agent on NullSpend can transact with every other agent. More agents = more value per membership.

### Move 4: Cost Intelligence Network

NullSpend sees every API call from every customer. Which models, how many tokens, what it cost, whether it was blocked, what the alternative would have cost. Nobody else has this dataset.

**The play:**
- **NullSpend Index** — published monthly: average cost per model, trends, provider reliability, efficiency benchmarks
- **In-product recommendations** — "Companies like yours spend 40% less using Claude Haiku for classification. One-click to apply."
- **Cost forecasting** — "At your growth rate, you'll hit budget in 12 days. Here's how to optimize."
- **Pricing arbitrage alerts** — "Anthropic just dropped Sonnet pricing 20%. You'd save $X/month switching these workloads."

This only works at scale (100+ orgs). But it's the moat that compounds — more customers = better intelligence = harder to leave.

### Move 5: Compliance as Enterprise Wedge

EU AI Act enforcement is August 2, 2026. Fines up to 7% of global revenue. NullSpend already has every primitive required: record-keeping (cost events), human oversight (HITL), logging (audit trail).

**The play:** Build a compliance certification product:
- "NullSpend Governance" tier with continuous compliance monitoring
- Automated evidence collection mapped to EU AI Act, SOC 2, ISO 27001, NIST AI RMF
- Compliance dashboard showing real-time status
- "NullSpend Certified" badge for passing companies
- Pre-formatted evidence packages for third-party auditors

Every EU agent deployment needs this. NullSpend can be the easy button.

---

## What's Already Built (Current State)

**Proxy Enforcement (mandatory — agent can't bypass):**
- Proxy: OpenAI + Anthropic pass-through, SSE streaming, 0ms overhead
- Atomic budget enforcement via Durable Objects (reserve-execute-commit)
- Velocity/spend-rate detection with EWMA + circuit breaker
- Session-level spend caps with materialized sessions table
- Mandates on credentials (allowed_models, allowed_providers on API keys)
- Policy endpoint (GET /v1/policy) with budget state + cheapest model recommendations
- Tag-based budgets (functionally equivalent to usage quotas — UX reframing needed)
- Threshold detection (50/80/90/95% crossings with webhook events)

**SDK Enforcement (cooperative — developer integrates):**
- `createTrackedFetch` wraps any HTTP call with cost tracking + enforcement
- Streaming detection, token extraction, cost calculation for AI calls
- Mandate enforcement (allowed models/providers)
- Pre-request budget checking against cached policy (60s TTL)
- Session limit enforcement with per-instance spend accumulation
- `safeDenied` wrapper ensures `onDenied` callback errors cannot bypass enforcement
- Graceful degradation when policy endpoint unreachable (fail-open)
- **Key unlock for universal spending:** `trackedFetch` already intercepts any HTTP call — extending to non-AI cost events enables universal spending visibility

**MCP Server Enforcement (agent-initiated — agent governs itself):**
- `@nullspend/mcp-server`: propose_action, check_action, get_budgets, get_spend_summary, get_recent_costs
- `@nullspend/mcp-proxy`: MCP tool call interception with budget enforcement
- `@nullspend/docs`: 40 bundled docs, search + fetch tools for AI coding assistants
- Agents can preflight budget checks and negotiate for more budget before acting

**Cost Tracking:**
- Cost engine: standalone package (`packages/cost-engine/`) with 40+ model pricing catalog (OpenAI, Anthropic, Gemini) — ready to open-source as-is
- SDK: `createTrackedFetch` with streaming detection, token extraction, cost calculation, mandate enforcement
- Per-customer cost attribution UI (tag-based GROUP BY, sortable table, CSV export, drill-down)
- Source breakdown (proxy / SDK / tool) across dashboard
- Tool cost registry + MCP proxy interception

**SDKs & Integrations:**
- TypeScript SDK (`@nullspend/sdk`)
- Python SDK (`packages/sdk-python/`, `pip install nullspend`) — full client, actions, budgets, cost events, polling
- Claude Agent SDK adapter (`@nullspend/claude-agent`) with auto-session generation
- MCP server (`@nullspend/mcp-server`): propose_action, check_action, **get_budgets, get_spend_summary, get_recent_costs** (budget governance tools already exist)
- Docs MCP server (`@nullspend/docs`): nullspend_search_docs, nullspend_fetch_doc (40 bundled docs)

**Dashboard:**
- Home metrics, analytics, attribution, sessions, budgets, activity, audit log
- Full audit trail: API route, dashboard page, schema table, cursor-paginated, searchable
- Webhooks: 15 event types, HMAC-SHA256, thin/full payload modes, event filtering, secret rotation

**Infrastructure:**
- Stripe billing integration (free/pro/enterprise)
- llms.txt at `public/llms.txt`
- Gemini pricing data in cost-engine (gemini-2.5-pro, gemini-2.5-flash) — proxy route handler still needed
- agentId field on actions and cost events (entity lifecycle management still needed)
- Budget negotiation: `budget_increase` action type, Slack threaded replies, SDK `requestBudgetIncrease`, approve/reject API
- ~3,780+ tests across ~219 test files

---

## Month 1: Ship the Demo (April 2026)

| Track | Item | Time |
|---|---|---|
| Ship | 1.1 Docs MCP Server — SHIPPED | Done |
| Ship | 1.2 Budget Negotiation — SHIPPED (overdraft policies still TODO) | Done |
| Ship | 1.3 Onboarding Polish | 3-4 days |
| Ship | 1.4 Gemini Provider (pricing exists — proxy route only) | 3-4 days |
| Stolen | 1.S1 Dry Run / Pre-flight mode (from Runcycles) | 1-2 days |
| Stolen | 1.S2 ALLOW_WITH_CAPS graceful degradation (from Runcycles) | 3-4 days |
| Stolen | 1.S3 Justification header for expensive ops (from Locus) | 1-2 days |
| Stolen | 1.S4 Budget exhaustion forecasting (from Cordum/FinOps) | 1-2 days |
| Stolen | 1.S5 Session cost rollup views (from Helicone) | 2-3 days |
| Distribution | 1.D1 LangChain callback handler (`nullspend-langchain`) | 3-4 days |
| Distribution | 1.D2 Vercel AI SDK middleware (`@nullspend/vercel-ai`) | 2-3 days |
| Distribution | 1.D3 Register on all MCP directories (Glama, Smithery, mcp.run) | 1 day |
| Distribution | 1.D4 Comparison pages (vs/cordum, vs/runcycles) | 1 day |
| Killer | 1.K1 Prompt Cost Estimation API (free, public, no auth) | 2-3 days |
| Strategic | ASAP protocol design (RFC draft) | Ongoing |

See [Competitive Features to Steal](competitive-features-to-steal.md) for full details on the "Stolen" items.

### 1.1 Docs MCP Server — SHIPPED
**Package:** `@nullspend/docs` (`npx @nullspend/docs`)
**Tools:** `nullspend_search_docs(query, limit?)` + `nullspend_fetch_doc(path)`
**Content:** 40 docs bundled as static JSON. Keyword + synonym search with substring matching.
**Tests:** 62 tests across 3 files.

### 1.2 Budget Negotiation + Overdraft Policies — NEGOTIATION SHIPPED
**What:** When an agent hits its budget ceiling, it can request more budget instead of getting a hard 429. A human approves or denies. The agent continues or gracefully stops. Also adds soft enforcement modes stolen from Cycles' overdraft model.
**Why now:** The PearX demo feature. Nobody else does this — not Respan, not Crossmint, not Locus, not Cordum, not Cycles. This is the first piece of the ASAP protocol in practice.
**Technical spec:**
- New action type: `request_budget_increase` with fields: `amount_microdollars`, `reason`, `budget_id`, `key_id`
- New API endpoint: `POST /v1/budget-requests` (authenticated via API key)
- New MCP tool: `request_budget({ amount, reason })` in the MCP server
- Approval flow: webhook fires `budget.request.created`, Slack notification via existing integration, dashboard inbox item
- Approval endpoint: `POST /api/budget-requests/{id}/approve` or `/deny` (session auth)
- On approval: budget max increases by approved amount, webhook fires `budget.request.approved`
- On denial: webhook fires `budget.request.denied`, agent receives structured response with denial reason
- SDK support: `createTrackedFetch` returns structured 429 with `budget_request_url` field when budget exceeded
- Timeout: auto-deny after configurable period (default 1 hour)
- **Overdraft policies** (stolen from Cycles): per-budget enforcement mode — `hard` (current: block at ceiling), `soft` (allow up to overdraft_limit, alert via webhook, then block), `negotiate` (trigger budget request flow on exceed). Configurable overdraft_limit_microdollars per budget entity.
**Build time:** 1 week

### 1.3 Onboarding Flow Improvements
**What:** First-run experience: signup to seeing cost data in under 5 minutes.
**Technical spec:**
- Interactive setup wizard: create key → choose integration (proxy OR SDK) → copy snippet → send test request → see cost appear live
- Auto-detect first cost event with celebration state
- "Send test request" button firing a real (cheap) LLM call through the proxy
- Pre-populated code for OpenAI Python, OpenAI JS, Anthropic Python, Anthropic JS
**Build time:** 3-4 days

### 1.4 Gemini Provider Adapter
**What:** Third major provider. Respan supports 500+ models. We need at least the big 3.
**Already exists:** Gemini pricing data in cost-engine (gemini-2.5-pro, gemini-2.5-flash). What's missing is the proxy route handler and SSE parser.
**Technical spec:**
- Route handler for Gemini's `/v1beta/models/{model}:generateContent`
- SSE parser for Gemini streaming format
- Same enforcement pipeline: auth → policy → mandate → budget → forward → cost → commit
- Cost engine already has the pricing — this is proxy integration only
**Build time:** 3-4 days (reduced — cost engine work is done)

### 1.K1 Prompt Cost Estimation API
**What:** Free, public API that estimates cost before you send a single token. No API key. No account. Zero friction top-of-funnel.
**Why now:** Cost engine already exists — this is wrapping it in a public endpoint. Every developer Googling "how much does GPT-4o cost" can hit this API. Every tutorial that mentions cost estimation links to it. This is the "Stripe test mode" equivalent — useful before you're a customer.
**Technical spec:**
- `POST /v1/estimate` (public, no auth)
- Input: `{ model, input_tokens, max_output_tokens, provider? }`
- Output: `{ estimated_cost_usd, alternatives: [{ model, estimated_cost_usd }] }`
- Uses `@nullspend/cost-engine` pricing catalog (40+ models)
- Rate limited (100 req/min per IP) to prevent abuse
- Also serves as the interactive cost calculator backend
**Build time:** 2-3 days (cost engine exists, this is a thin API wrapper)

---

## Month 2: Retention + SDK Parity (May 2026)

| Track | Item | Time |
|---|---|---|
| Ship | 2.1 SDK Enforcement Parity (mandate enforcement exists — add budget pre-check) | 3-4 days |
| Ship | 2.2 Cost Regression Alerts | 3-4 days |
| Ship | 2.3 Cost CI/CD GitHub Action | 1 week |
| Ship | 2.4 MCP Budget Governance — add check_budget + request_budget (3 tools already exist) | 1 day |
| Distribution | 2.D1 OpenAI Agents SDK integration (`@nullspend/openai-agents`) | 2-3 days |
| Distribution | 2.D2 CrewAI integration (`nullspend-crewai`) | 1-2 days |
| Distribution | 2.D3 Open-source `@nullspend/cost-engine` (MIT) — already standalone, just license + README + publish | half day |
| Distribution | 2.D4 Show HN launch | 1 day (+ 2-3 months pre-engagement) |
| Distribution | 2.D5 Submit integration PRs to LangChain + Vercel AI SDK docs | Ongoing |
| Killer | 2.K1 Real-Time Cost Streaming (WebSocket live feed) | 3-4 days |
| Killer | 2.K2 Cost Regression CI Gate (expanded — block merge, not just comment) | Bundled with 2.3 |
| Strategic | Agent identity primitive (create agent → key + budget + policy) | 1.5 weeks |

### 2.1 SDK Enforcement Parity ✅ SHIPPED (2026-03-31)
**What:** Close the remaining gap between proxy and SDK. `createTrackedFetch` now has full cooperative enforcement: cost tracking, mandate enforcement, budget checking, AND session limits.
**Shipped:** Cost tracking, streaming detection, token extraction, cost calculation, mandate enforcement (allowed models/providers), pre-request budget checking against cached policy, session limit enforcement with per-instance spend accumulation.
**Implementation:**
- Policy cache with 60s TTL from `GET /api/policy` endpoint
- Pre-request budget check: estimate cost → compare against cached remaining budget → throw `BudgetExceededError` if over
- Session limit check: accumulate session spend → estimate + spend > limit → throw `SessionLimitExceededError`
- Manual `sessionLimitMicrodollars` option takes precedence over policy-fetched limit
- `safeDenied` wrapper ensures `onDenied` callback errors cannot bypass enforcement
- Graceful degradation when policy endpoint unreachable (fail-open, manual session limits still enforced)
- `warnSessionDenied` observability for all session limit denials
- 80+ tests covering enforcement, edge cases, streaming accumulation, provider parity

### 2.2 Cost Regression Alerts
**What:** Background job detecting gradual cost creep — not spikes (velocity handles those).
**Technical spec:**
- Cloudflare Cron Trigger (hourly)
- Per API key: rolling 7-day avg cost/request vs 30-day baseline
- Alert when 7-day avg exceeds baseline by configurable threshold (default 20%)
- Deliver via webhook + Slack
- Dashboard "Alerts" section with active regressions
**Build time:** 3-4 days

### 2.3 Cost CI/CD GitHub Action
**What:** `nullspend/cost-check@v1` — cost impact on every PR. Nobody does this for costs. Respan does it for eval quality. This is the NullSpend equivalent.
**Technical spec:**
- Inputs: NullSpend API key, test command, budget threshold
- Runs test suite through NullSpend, queries cost summary filtered by trace_id/session
- Posts PR comment: "This PR's agent tests cost $4.23 (+12% vs main). 47 LLM calls."
- Fails check if cost exceeds threshold
- Optional: compare against baseline branch
**Build time:** 1 week

### 2.4 MCP Budget Governance — Add Negotiation Tools
**What:** The MCP server already has `get_budgets`, `get_spend_summary`, and `get_recent_costs`. Add preflight budget check and negotiation tools to neutralize Cycles' MCP budget server.
**Already exists:** `get_budgets` (budget state), `get_spend_summary` (spending data), `get_recent_costs` (cost events). These are already live in `@nullspend/mcp-server`.
**What's new:** Add `check_budget` (preflight — "can I afford this?") and `request_budget` (negotiation — "I need more"). These depend on budget negotiation (1.2) shipping first.
**Technical spec:**
- `nullspend_check_budget(model, estimated_tokens)` → returns allowed/denied + remaining budget
- `nullspend_request_budget(amount, reason)` → triggers negotiation flow from 1.2
- Uses existing SDK under the hood — no new backend endpoints needed
- Critical difference from Cycles: our proxy still enforces even if the agent doesn't call the MCP tools. MCP tools are for awareness + negotiation. Enforcement is mandatory at the proxy layer.
**Build time:** 1 day (reduced — 3 of 5 tools already exist, 2 new tools depend on 1.2)

### 2.K1 Real-Time Cost Streaming
**What:** WebSocket feed showing costs flowing in real-time. The Bloomberg Terminal for AI spend. Not "check the dashboard after the fact" — watch your money move as it moves.
**Why now:** The proxy already emits cost events. A WebSocket endpoint that streams them to the dashboard is a natural extension. This is the dashboard everyone keeps open all day.
**Technical spec:**
- WebSocket endpoint: `GET /api/cost-events/stream` (session auth)
- Events: each cost event as it completes, with model, cost, key, tags, session
- Dashboard widget: live ticker with running total, per-agent spend rate, anomaly highlighting
- Fleet view: grid of active agents with live cost accumulators
- Anomaly flash: agent spending 4x its normal rate → highlighted in red
- Budget countdown: "$142.87 remaining" ticking down in real-time
**Build time:** 3-4 days (backend: 1 day WebSocket endpoint; frontend: 2-3 days live dashboard widgets)

### 2.K2 Cost Regression CI Gate (Expanded)
**What:** Don't just post a PR comment. Block the merge. Make NullSpend a required status check, like Codecov for test coverage but for costs.
**Expands 2.3 with:**
- "This PR increases average cost per agent session by 340%. Merge blocked."
- Dev clicks "show me why" → NullSpend shows the diff: "New prompt in agent.py:47 uses GPT-4o for a task previously handled by GPT-4o-mini"
- Override with approval from budget owner
- Over time, NullSpend builds a "cost profile" for the codebase — knows what normal costs look like
- Once in CI, removing NullSpend requires changing the team's development process. Deep lock-in.
**Build time:** Bundled with 2.3 (same GitHub Action, additional configuration options)

### 2.S Agent Identity Primitive (Strategic)
**What:** `POST /v1/agents` → creates an agent with key + budget + policy in one call. Agents become first-class entities, not just API keys with metadata.
**Technical spec:**
- New table: `agents` (id, org_id, name, team, key_id, budget_id, policy, status, created_at)
- API: `POST /v1/agents`, `GET /v1/agents`, `GET /v1/agents/{id}`, `PATCH /v1/agents/{id}`
- Dashboard: Agents page with per-agent cost, status, enforcement events
- Every cost event, enforcement decision, and negotiation traced to agent_id
- **Deep scope hierarchy** (stolen from Cycles): org → team → agent → toolset, with atomic multi-scope budget enforcement. A single request checks budget at ALL ancestor scopes simultaneously. More granular than Cycles' tenant→workspace→app→workflow→agent→toolset model because we enforce at the proxy, not as a voluntary sidecar check.
- **Risk Points** (stolen from Cycles): non-monetary budget units alongside microdollars. An agent has a $50 budget AND a 100 risk-point budget, where classification=1pt, code_generation=10pts, deployment=50pts. Budgets enforce both dimensions simultaneously.
- Foundation for ASAP tokens and agent commerce
**Build time:** 1.5 weeks

---

## Month 3: Platform Play (June 2026)

| Track | Item | Time |
|---|---|---|
| Ship | 3.1 Usage Quotas for SaaS Tiers (tag budgets already enforce — UX reframing) | 3-4 days |
| Ship | 3.2 Webhook Automations | 1-2 weeks |
| Ship | 3.3 Executive Cost Digest | 2-3 days |
| Distribution | 3.D1 Pydantic AI integration (auto model downgrade!) | 2-3 days |
| Distribution | 3.D2 Mastra integration | 1-2 days |
| Distribution | 3.D3 `npx create-nullspend` CLI wizard | 3-4 days |
| Distribution | 3.D4 SEO content cluster (10+ posts) | Ongoing |
| Distribution | 3.D5 Framework landing pages (/for/langchain, /for/vercel-ai, etc.) | 2-3 days |
| Distribution | 3.D6 Interactive AI cost calculator tool | 2-3 days |
| Killer | 3.K1 Smart Model Router (auto cost optimization) | 1-2 weeks |
| Killer | 3.K2 Multi-Tenant Cost Isolation (white-label per-customer dashboards) | 1 week |
| Strategic | ASAP draft spec published as open RFC | Ongoing |
| Content | 3.C1 "The Sidecar Problem" blog post + bypass demo repo | 1 day |
| Content | 3.C2 "You Don't Need 6 Services to Track AI Costs" | 1 day |

### 3.1 Usage Quotas for SaaS Tiers
**What:** "Free tier = $5/month AI usage. Pro = $50. Enterprise = $500." Enforced automatically.
**Why now:** Turns NullSpend from "developer tool" into "infrastructure the product depends on."
**Already exists:** Tag-based budgets with per-tag spend tracking + enforcement. The proxy already enforces `customer_id tag → budget entity → limit`. This is purely a UX reframing — no new enforcement backend.
**What's new (UI/API only):**
- New page: `/app/quotas` with tier configuration wizard (name, limit, reset interval)
- Bulk tag-to-tier mapping (manual or via API)
- `upgradeUrl` field in the 429 kill receipt: `{ quotaExceeded: true, tier: "free", limit: "$5.00", upgradeUrl: "..." }`
- Quota-specific dashboard widgets
**Build time:** 3-4 days (reduced — backend enforcement already works, this is UI + one new response field)

### 3.2 Webhook Automations (Event-Driven Rules)
**What:** "When X happens, do Y" — cost-based automations. Respan has quality-based automations. NullSpend has cost-based automations. Different lane.
**Technical spec:**
- Table: `automation_rules` (id, org_id, trigger_type, trigger_config, action_type, action_config, enabled)
- Triggers: `budget.threshold_crossed`, `cost_regression.detected`, `velocity.anomaly`, `cost_event.created`
- Actions: `webhook.fire`, `slack.notify`, `budget.freeze`, `key.disable`
- Dashboard rule builder (trigger → condition → action)
- Example: "When any key exceeds $50/day, disable the key and notify Slack"
**Build time:** 1-2 weeks

### 3.3 Executive Cost Digest
**What:** Weekly email for non-technical stakeholders. How the CFO learns about NullSpend.
**Technical spec:**
- Cron Trigger (weekly, Monday 8am UTC)
- Total spend vs last week, per-key summary, enforcement events, top/bottom agents
- HTML email via Resend or SendGrid
- Content: "Your AI fleet spent $4,200 this week (-8%). Most efficient: CustomerSupport ($0.31/resolution). Alert: ResearchBot cost up 23%."
**Build time:** 2-3 days

### 3.K1 Smart Model Router
**What:** Don't just track costs — actively reduce them. Analyze request patterns and automatically route to cheaper models when quality won't suffer. "NullSpend saved us $X this month" is the ultimate retention signal.
**Why it's killer:** Quantifiable, recurring ROI. Nobody cancels a product that saves them more than it costs. Defensible — optimization gets better with more data. Only possible because we sit in the request path.
**Technical spec:**
- Analyze per-key request patterns: if requests to expensive model consistently have small I/O → flag as optimization candidate
- Quality signals: response length, structure, tool call success rate (tracked over time)
- "83% of your classification requests on GPT-4o produce identical outputs on GPT-4o-mini. Auto-routing would save $4,200/month."
- One toggle per key/agent to enable auto-optimization
- Dashboard: optimization recommendations with estimated savings, acceptance tracking, quality impact monitoring
- One-click apply → updates model mandate
- Requires Gemini provider (1.4) to be live for cross-provider routing
**Build time:** 1-2 weeks

### 3.K2 Multi-Tenant Cost Isolation
**What:** For SaaS companies building on AI — give each of THEIR customers a dedicated cost view with white-label capability. Makes NullSpend load-bearing in the customer-facing product.
**Why it's killer:** Company X can't remove NullSpend without rebuilding their entire usage display and billing layer. Stripe-level lock-in.
**Already exists:** Tag-based budgets, per-tag spend tracking, cost attribution drill-down. This extends existing primitives with customer-facing UX.
**Technical spec:**
- Per-customer dashboard views: each `customer:X` tag gets its own cost breakdown, usage history, budget status
- White-label option: embeddable dashboard widget or iframe that SaaS companies show to their end users
- API: `GET /v1/customers/{tag}/usage` returns customer-specific cost data for embedding
- Quota integration: tie to usage quotas (3.1) so each customer sees their tier, usage, and how close they are to the limit
- Overage UX: "You've used $4.50 of your $5.00 AI budget this month. Upgrade to Pro for $50/month."
**Build time:** 1 week (tag budgets + attribution already work — this is embeddable UI + customer-facing API)

### 3.C Content: "Your Agent Budget Check Has a Bypass Problem"
**What:** Blog post + open-source demo showing that sidecar/SDK-only budget enforcement (Cycles' model) fails when agents skip the check. Publish a runnable demo: an agent ignores Cycles' reserve/commit calls and spends unlimited money. Then show the same agent hitting NullSpend's proxy and getting blocked. This is the architectural kill shot against every sidecar-model competitor.
**Why now:** Cycles is the most technically credible competitor. Their protocol is well-designed. But their architecture has a fundamental flaw — enforcement is voluntary. We need to make this obvious to every developer evaluating the space.
**Deliverables:**
- Blog post explaining proxy vs sidecar enforcement models
- Open-source demo repo (`nullspend/budget-bypass-demo`) with two scenarios
- Share on HN, Twitter/X, dev communities
**Build time:** 1 day

---

## Month 4: Compliance + Intelligence (July 2026)

| Track | Item | Time |
|---|---|---|
| Ship | 4.1 Compliance Export MVP (audit data exists — add export packaging) | 1 week |
| Ship | 4.2 OpenTelemetry Export | 3-4 days |
| Ship | 4.3 Model Optimization Recommendations | 1-2 weeks |
| Killer | 4.K1 Cost-Aware Prompt Caching | 1-2 weeks |
| Distribution | 4.D1 n8n community node | 2-3 days |
| Distribution | 4.D2 Launch Week (5 features in 5 days — Supabase playbook) | 1 week |
| Distribution | 4.D3 Submit to AWS / Vercel / Cloudflare marketplaces | 1-2 days |
| Distribution | 4.D4 YC / accelerator portfolio credits program | 1 day |
| Strategic | Compliance certification product MVP | Bundled with 4.1 |

### 4.K1 Cost-Aware Prompt Caching
**What:** Detect duplicate or near-duplicate prompts flowing through the proxy and serve cached responses. Track exactly how much money caching saves. Direct, measurable, automatic savings with zero code changes.
**Why it's killer:** "Caching saved you $2,400 this month by avoiding 12,000 redundant API calls." Combined with smart routing (3.K1), you have two independent savings engines. Portkey has basic caching but doesn't track savings or combine with cost intelligence.
**Technical spec:**
- Hash prompt content → check KV/R2 cache → if hit, return cached response (cost: $0.00)
- Configurable cache TTL per model, per key, per tag
- Near-duplicate detection: semantic similarity threshold for "close enough" prompts
- Dashboard widget: "Caching saved you $X this month" with breakdown by model/key
- Per-key toggle: enable/disable caching
- Cache invalidation: manual flush, TTL expiry, model version change
- Respects streaming: cached responses can be replayed as SSE streams
**Build time:** 1-2 weeks

### 4.1 Compliance Export MVP
**What:** One-click export for EU AI Act + SOC 2. EU AI Act enforcement is August 2, 2026 — ship a month early.
**Already exists:** Full audit trail (actions, cost events, enforcement decisions, budget modifications, key operations, webhook deliveries) in the database with API routes and dashboard page. Threshold detection with webhook events. HITL approval workflows.
**What's new:** Package the existing data into exportable compliance formats.
**Technical spec:**
- Export formats: PDF report + CSV data + JSON evidence package
- EU AI Act mapping: Article 12 (record-keeping → cost events + audit log), Article 14 (human oversight → HITL actions), Article 19 (logs → audit trail)
- SOC 2 mapping: Processing Integrity (enforcement decisions), Availability, Confidentiality
- New API endpoint: `POST /api/compliance/export` with date range + framework selection
- Auto-generate monthly, store in R2
- "NullSpend Governance" tier branding
**Build time:** 1 week (reduced — all source data already exists, this is export packaging + PDF generation)

### 4.2 OpenTelemetry Export
**What:** Cost events as OTLP spans in Datadog/Grafana/Jaeger. Complement the dashboard, don't replace it.
**Technical spec:**
- Webhook event type: `cost_event.otel` formatted as OTLP JSON
- Or: dedicated OTLP export endpoint
- Spans: trace_id, model, cost_microdollars, tokens, provider, tags
**Build time:** 3-4 days

### 4.3 Model Optimization Recommendations
**What:** "NullSpend saved us $X this month" — strongest retention signal possible.
**Technical spec:**
- Analyze per-key patterns: 60%+ requests to expensive model with small I/O → flag
- "Classification on gpt-4o: $0.34/req. On gpt-4o-mini: $0.02/req. Savings: $X/month."
- Surface on analytics page + weekly digest
- One-click: apply → updates model mandate
- Track acceptance rate and actual savings
**Build time:** 1-2 weeks

---

## Month 5: Security + Reliability (August 2026)

| Track | Item | Time |
|---|---|---|
| Ship | 5.1 Key Vaulting | 2 weeks |
| Ship | 5.2 Multi-Provider Routing | 2 weeks |
| Killer | 5.K1 Fleet Mission Control (Kubernetes for agent costs) | 2 weeks |
| Distribution | 5.D1 Stripe-quality interactive docs (auto-populated API keys, language switching) | 1 week |
| Distribution | 5.D2 Contribute AI cost semantic conventions to OpenTelemetry | Ongoing |
| Strategic | Agent capability registry (beta) | 1 week |
| Strategic | ASAP reference implementation | 1 week |

### 5.K1 Fleet Mission Control
**What:** A single operational view of every agent in your organization. The dashboard that ops teams keep open all day. Think Kubernetes dashboard but for AI agent costs.
**Why it's killer:** This becomes the single pane of glass for AI operations. Nobody has this — Respan shows traces, Langfuse shows logs, NullSpend shows the financial operating picture of your entire agent fleet. Requires agent identity (2.S) as foundation.
**Technical spec:**
- Grid view: all agents showing name, status (active/idle/blocked/negotiating), spend rate ($/hour), budget utilization (%), efficiency score
- Click any agent: full cost timeline, request log, enforcement events, budget negotiations, session history
- Bulk actions: pause all agents over $X/hour, freeze agents in a team, set fleet-wide budget ceiling
- Anomaly detection: "Agent #12 is spending 4x its normal rate. Auto-paused." (ties into regression alerts from 2.2)
- Shift-change view: "Night shift agents spent $1,200 while you were asleep. Here's what happened."
- Real-time cost streaming (2.K1) integrated into fleet view — live cost accumulators per agent
**Build time:** 2 weeks (requires agent identity from Month 2)

### 5.1 Key Vaulting (Encrypted Credential Storage)
**What:** Store provider API keys encrypted. Developers use virtual NullSpend keys. Foundation for "one key for everything."
**Technical spec:**
- Table: `provider_credentials` (id, org_id, provider, encrypted_key, key_alias, created_at)
- Encryption: AES-256-GCM via Web Crypto API in Workers
- Per-org derived encryption key from org-level master secret
- Dashboard: Settings > Integrations for add/rotate/revoke
- Proxy: look up vaulted credential when no inline provider key
**Build time:** 2 weeks

### 5.2 Multi-Provider Routing
**What:** Automatic failover and cost-aware routing. Once configured, removing NullSpend means re-implementing failover. Deep lock-in.
**Technical spec:**
- Model groups: `"fast-chat"` → gpt-4o-mini (70%) or claude-haiku (30%)
- Failover on 5xx/rate-limit → retry on fallback
- Cost-aware: route to cheapest for equal capability
- Latency tracking: P50 per provider
- Dashboard routing config with health indicators
**Build time:** 2 weeks

### 5.S Agent Capability Registry (Strategic)
**What:** Agents can register capabilities with pricing: "I provide summarization at $0.001/request." Other agents can discover and consume these capabilities via NullSpend. First piece of the commerce layer.
**Build time:** 1 week

### 5.S ASAP Reference Implementation (Strategic)
**What:** Open-source reference implementation of the Agent Spending Authorization Protocol. Publish alongside the spec. NullSpend is the canonical issuer, but anyone can verify tokens.
**Build time:** 1 week

---

## Month 6: Revenue Infrastructure (September 2026)

| Track | Item | Time |
|---|---|---|
| Ship | 6.1 Metered Billing Pass-Through | 2 weeks |
| Ship | 6.2 Public API v2 | 2-3 weeks |
| Killer | 6.K1 Cross-Provider Unified Invoice | 1-2 weeks |
| Killer | 6.K2 Agent Insurance (spend guarantee SLA) | Design + legal |
| Distribution | 6.D1 SDK auto-generation from OpenAPI spec (TypeScript + Python) | Bundled with 6.2 |
| Distribution | 6.D2 Second Launch Week | 1 week |
| Strategic | Agent commerce settlement (beta) | 2 weeks |
| Strategic | NullSpend Index v1 | 1 week |

### 6.K1 Cross-Provider Unified Invoice
**What:** One invoice for all AI spend across all providers. Companies hate managing 4 different billing relationships. NullSpend consolidates everything.
**Why it's killer:** This is the financial relationship play. Once the CFO pays one bill instead of four, NullSpend IS the vendor relationship. Switching means re-establishing 4 separate billing relationships. This is how Stripe won — they became the payment relationship, not just the payment processor.
**Requires:** Key vaulting (5.1) so NullSpend manages provider credentials.
**Technical spec:**
- Company routes all AI traffic through NullSpend proxy with vaulted provider keys
- End of month: one NullSpend invoice covering all providers
- Breakdown by provider, model, team, project, customer — however they want to slice it
- Cost allocation tags map to internal cost centers for chargeback
- PDF + CSV + API export for finance teams
**Build time:** 1-2 weeks (builds on key vaulting + metered billing)

### 6.K2 Agent Insurance — Spend Guarantee SLA
**What:** "We guarantee your agent fleet won't exceed $X this month. If enforcement fails, we cover the overage." A financial product, not a software feature.
**Why it's killer:** Genuinely novel. No AI infrastructure company offers financial guarantees on spend. Turns NullSpend from "software that tries to enforce budgets" into "a financial institution that guarantees budgets." Forces us to make enforcement bulletproof. Massive enterprise sales differentiator.
**Technical spec:**
- Guarantee tiers: customer selects max monthly spend guarantee
- Pricing: percentage of guaranteed amount (e.g., 2% of $10K = $200/month)
- SLA: binding commitment — if NullSpend enforcement fails and spend exceeds guarantee, NullSpend covers the overage
- Dashboard: guarantee status, enforcement confidence score, coverage details
- Legal: requires terms of service update, liability framework, possibly insurance backing
**Build time:** Product design + legal framework (Month 6). Build in Month 7+. This is a long-term bet.

### 6.1 Metered Billing Pass-Through
**What:** NullSpend calculates per-customer costs, creates Stripe usage records. Fiat-native version of what Locus does with USDC — without requiring crypto wallets.
**Technical spec:**
- Map customer tag → Stripe customer → subscription item
- Aggregate cost per period, apply margin, create Stripe UsageRecord
- Margin config: "charge 2x cost" or "cost + $0.05/request" or custom
- Dashboard: billing page with pending amounts, history, margin analysis
- Stripe webhooks for payment confirmation/failure
**Build time:** 2 weeks

### 6.2 Public API v2 (Platform API)
**What:** Complete REST API for third-party integrations.
**Technical spec:**
- `/v2/` prefix, versioned
- Full CRUD: budgets, keys, agents, cost events, quotas, automations, provider credentials
- OpenAPI 3.1 from Zod schemas
- Cursor-based pagination, filtering by date/tags/source/model
- Rate limiting by plan
- SDK auto-generation (TypeScript + Python)
**Build time:** 2-3 weeks (incremental)

### 6.S Agent Commerce Settlement (Strategic)
**What:** Agent A uses Agent B's capability. NullSpend validates authorization (ASAP), records the transaction, and settles via Stripe Connect at end of billing period. Invoicing + net settlement in fiat.
**Build time:** 2 weeks

### 6.S NullSpend Index v1 (Strategic)
**What:** First published cost intelligence report. Anonymous, aggregated data: average cost per model, trends, provider reliability, efficiency benchmarks. Published monthly. Starts building the data moat.
**Build time:** 1 week

---

## Features Explicitly Deferred (Build When Customers Ask)

| Feature | Why defer |
|---|---|
| Agent wallets / payment rails | Crossmint ($23.6M) and Locus (YC, $8M) own this — integrate, don't compete |
| Crossmint / Locus integration | Need customer overlap first |
| Cost benchmarks (in-product) | Cold-start — need 100+ orgs. NullSpend Index is the public-facing precursor. |
| Eval / prompt management | Respan's territory |
| Custom dashboards (80+ graphs) | Respan territory — stay opinionated |
| Self-hosted deployment (Docker/Helm) | Need enterprise demand signal |
| Agent reputation scoring | Need 6+ months spending data |
| Agent credit/overdraft system | Need legal review |
| Budget delegation / sub-agent credential vending | Ships naturally with agent identity hierarchy |
| Real-time model arbitrage | Need routing infrastructure stable first |
| x402/AP2/MPP protocol support | Standards still forming — ASAP is our protocol bet |

---

## Revenue Model Evolution

| Phase | Model |
|---|---|
| Month 1-3 | Subscription: Free ($0, 3 budgets, 10 keys, 30-day retention) / Pro ($49/mo, unlimited) / Enterprise (custom) |
| Month 3-4 | Add usage-based: per-governed-dollar above tier threshold |
| Month 3+ | Add NullSpend Optimize tier: smart model routing + prompt caching (% of savings delivered) |
| Month 4+ | Add NullSpend Governance tier (compliance, audit, certification) |
| Month 5-6 | Add metered billing pass-through (margin on customer billing) |
| Month 6+ | Add unified invoice (consolidation fee per provider managed) |
| Month 6+ | Add agent insurance (% of guaranteed spend amount) |
| Month 6+ | Add agent commerce settlement fee (% of agent-to-agent transactions) |

---

## Competitive Positioning at Each Stage

| Stage | Message |
|---|---|
| Month 1-2 | "The only product that does atomic budget enforcement at a price startups can afford. Free cost estimation API. Budget negotiation. Real-time cost streaming." |
| Month 3-4 | "NullSpend saved us $X this month. Smart model routing. Per-customer cost isolation. Cost-aware caching. Your AI SaaS pricing infrastructure." |
| Month 5-6 | "The financial operating system for the agent economy. Fleet mission control. One invoice for all providers. Spend guarantee SLA. Track. Enforce. Optimize. Bill. Comply." |

---

## How This Kills the Competition

| Competitor | Why they lose |
|---|---|
| **Respan** | They watch. We enforce. They can't add enforcement without rebuilding their gateway as a control plane. They'll never own the protocol or settlement layer — they're an observability company. |
| **Crossmint** | They require crypto wallets. Enterprise runs on fiat. We offer the same agent financial controls without blockchain friction. Our commerce layer does invoicing + net settlement, not USDC transfers. |
| **Locus** | Same crypto problem as Crossmint, plus they're 2 people. Deeper budget enforcement, hierarchical policies, and a compliance story. Their 3-knob controls can't compete with our full governance stack. |
| **Cordum** | A job scheduler cosplaying as FinOps. No cost calculation, no pricing catalog, no spending dashboards. Uses time-based limits instead of dollar budgets. Requires NATS + Redis + 6 microservices to run. We stole their best idea (policy expressiveness) and ship it in a managed platform that deploys in 2 minutes. Solo dev, unfunded, zero customers. |
| **Cycles** | Well-designed protocol, wrong architecture. Their sidecar model is voluntary — agents can skip the budget check and spend unlimited money. Our proxy makes enforcement mandatory. They have no dashboard, no cost calculation, no webhooks, no HITL, no managed hosting. We stole their best ideas (risk points, scope hierarchy, overdraft policies, MCP budget server) and integrated them into a complete product with automatic cost calculation and a full analytics UI. Solo dev, unfunded, 18 GitHub stars. |
| **Portkey** | Gateway without a financial layer. Once we have routing + vaulting + settlement, there's no reason to use Portkey over NullSpend. |

### Stolen Ideas Tracker

| Idea | Source | Where we put it | Why ours is better |
|---|---|---|---|
| Risk Points (non-monetary budget units) | Cycles | Agent identity (Month 2) | We enforce at the proxy; they rely on voluntary SDK calls |
| Deep scope hierarchy (tenant→workspace→agent→toolset) | Cycles | Agent identity (Month 2) | Atomic multi-scope enforcement via Durable Objects, not Redis Lua scripts |
| Overdraft/debt policies (soft enforcement modes) | Cycles | Budget negotiation (Month 1) | Combined with negotiation — agent can request more budget, not just overdraw silently |
| MCP budget governance tools | Cycles | MCP budget server (Month 2) | Backed by full enforcement stack + dashboard + webhooks; theirs is a standalone sidecar |
| Policy-as-code expressiveness | Cordum | Mandates v2 (Month 3 automations) | Integrated with cost-aware enforcement; Cordum's policies don't know what anything costs |
