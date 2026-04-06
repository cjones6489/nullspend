# Open Source Landscape: AI Cost Tracking, Budget Enforcement & Agent Governance

**Date:** April 2, 2026
**Purpose:** Complete map of open source projects in the AI FinOps / agent governance space

---

## Executive Summary

The open source landscape has exploded since late 2025. There are now **30+ active projects** across five distinct categories: AI Gateways, Observability Platforms, Budget Enforcement Libraries, Billing/Metering Infrastructure, and Agent Governance Frameworks. The space is fragmenting into layers, with no single project covering NullSpend's full stack (proxy + SDK + MCP + dashboard + budget enforcement + HITL approval).

**Key takeaways:**
- LiteLLM (42k stars) dominates the gateway layer but has sloppy budget enforcement (multiple bypass bugs in issue tracker)
- Langfuse (24.3k stars, acquired by ClickHouse) owns observability but has no enforcement
- Microsoft entered with Agent Governance Toolkit (MIT, 437 stars) — governance/policy focus, no cost tracking
- AgentBudget (97 stars) is the closest direct competitor in "agent budget enforcement" but Python-only, no dashboard, no proxy
- Billing infra (Lago, OpenMeter, Flexprice) serves the "charge your customers" use case, not "control your agents"
- New 2026 entrants are mostly tiny (< 10 stars) hobby projects or narrow single-purpose libraries
- The "agent wallet" / crypto spending control space is growing but orthogonal (on-chain payments, not API cost)

---

## Category 1: AI Gateways (Proxy Layer)

These sit between your app and LLM providers. Most relevant to NullSpend's proxy.

### LiteLLM — The 800-lb Gorilla
| Field | Value |
|---|---|
| **URL** | https://github.com/BerriAI/litellm |
| **Stars / Forks** | 42,000 / 7,000 |
| **Language** | Python |
| **License** | MIT (core), Enterprise features gated |
| **Last Active** | April 3, 2026 (daily commits) |
| **Commercial** | Yes — BerriAI sells enterprise proxy |
| **Cost Tracking** | Yes — per-key, per-team, per-tag spend |
| **Budget Enforcement** | Yes — but buggy. Multiple open issues: budget bypass via AzureOpenAI lib (#12977), max_end_user_budget ignores reset (#24675), pass-through endpoint bypass (#15805) |
| **Per-Customer Attribution** | Yes — virtual keys, teams, orgs |
| **Dashboard** | Yes — admin UI included |

**Assessment:** Dominant market position by stars. Budget enforcement exists but quality is poor — bugs around bypass, reset, and precedence. Python-only proxy means higher latency than Go/Rust alternatives. Enterprise features (SSO, audit logs) behind paywall. Tag-based budgets recently added (#15433). Email alerts for soft budgets being built.

---

### Portkey AI Gateway
| Field | Value |
|---|---|
| **URL** | https://github.com/Portkey-AI/gateway |
| **Stars / Forks** | 11,200 / 974 |
| **Language** | TypeScript |
| **License** | MIT |
| **Last Active** | Active (2026) |
| **Commercial** | Yes — Portkey.ai (enterprise SaaS) |
| **Cost Tracking** | Yes — per-model, per-key cost attribution |
| **Budget Enforcement** | Yes — token-based budgets via platform |
| **Per-Customer Attribution** | Yes — metadata-based logging |
| **Dashboard** | Yes (SaaS only, not in OSS gateway) |

**Assessment:** Strong TypeScript gateway, 1,600+ model support. The open source gateway is a routing layer only — cost tracking, budgets, and dashboard are in the commercial SaaS product. OSS is essentially a smart router with guardrails. Powers 400B+ tokens/day for 200+ enterprises. Separate `Portkey-AI/models` repo with pricing data for cost attribution.

---

### Helicone (Observability + Gateway)
| Field | Value |
|---|---|
| **URL** | https://github.com/Helicone/helicone (platform), https://github.com/Helicone/ai-gateway (gateway) |
| **Stars / Forks** | 5,400 / 503 (platform), 558 / 48 (gateway) |
| **Language** | TypeScript (platform), Rust (gateway) |
| **License** | Apache 2.0 |
| **Last Active** | March 2026 |
| **Commercial** | Yes — helicone.ai SaaS |
| **Cost Tracking** | Yes — Model Registry v2, 300+ models |
| **Budget Enforcement** | Partial — cost alerts at thresholds (50%, 80%, 95%), not hard enforcement |
| **Per-Customer Attribution** | Yes |
| **Dashboard** | Yes |

**Assessment:** Rust gateway is fast and lightweight. Primarily an observability play (like Datadog for LLMs). Cost tracking is strong, budget enforcement is soft (alerts, not blocks). YC W23 company. The gateway and platform are separate repos.

---

### AgentGateway (solo.io)
| Field | Value |
|---|---|
| **URL** | https://github.com/agentgateway/agentgateway |
| **Stars / Forks** | 2,300 / 379 |
| **Language** | Rust (58.5%) |
| **License** | Apache 2.0 |
| **Last Active** | March 20, 2026 (v1.0.1) |
| **Commercial** | Yes — solo.io (enterprise service mesh company) |
| **Cost Tracking** | Budget + spend controls in LLM gateway |
| **Budget Enforcement** | Yes — in LLM gateway mode |
| **MCP Support** | Yes — native MCP gateway with tool federation |
| **A2A Support** | Yes — agent-to-agent protocol support |

**Assessment:** Most architecturally interesting gateway. Three modes: LLM Gateway, MCP Gateway, A2A Gateway. Backed by solo.io (major service mesh company). Rust core, 1M+ Docker pulls. Production-grade. The MCP + A2A support makes this the most "agentic" gateway. Budget controls exist but secondary to traffic management.

---

### AxonHub
| Field | Value |
|---|---|
| **URL** | https://github.com/looplj/axonhub |
| **Stars / Forks** | 2,900 / 326 |
| **Language** | Go |
| **License** | Not specified |
| **Last Active** | 2026 |
| **Commercial** | Unknown |
| **Cost Tracking** | Yes — per-model cost ceilings |
| **Budget Enforcement** | Yes — quota guardrails combining rate limits + cost ceilings |
| **RBAC** | Yes — fine-grained role-based access |
| **Dashboard** | Unknown |

**Assessment:** Go-based gateway with RBAC and quota guardrails. Relatively new, growing fast. Chinese origin (bilingual README). Feature set overlaps heavily with LiteLLM but in Go.

---

### Ferro Labs AI Gateway
| Field | Value |
|---|---|
| **URL** | https://github.com/ferro-labs/ai-gateway |
| **Stars / Forks** | 50 / 7 |
| **Language** | Go |
| **License** | Apache 2.0 |
| **Last Active** | 2026 |
| **Cost Tracking** | Yes — cost-optimized routing |
| **Budget Enforcement** | Planned (v0.5.0 roadmap) |

**Assessment:** Small but performant Go gateway. 13,925 RPS benchmark. Focus is on routing optimization and cost-minimizing model selection, not hard budget enforcement. Early stage.

---

### Smaller Gateway Projects

| Project | URL | Stars | Lang | Notes |
|---|---|---|---|---|
| Instawork llm-proxy | https://github.com/Instawork/llm-proxy | 21 | Go | Simple proxy, rate limiting, 1 contributor |
| VoidLLM | https://github.com/voidmind-io/voidllm | 23 | Go | Privacy-first (zero knowledge of prompts), BSL 1.1 license |
| OngoingAI Gateway | https://github.com/ongoingai/gateway | 11 | Go | Multi-tenant, audit-ready, cost tracking |
| RelayPlane Proxy | https://github.com/RelayPlane/proxy | 113 | TS | "80% cost savings" via smart model routing, MIT |
| MMedia Gateway | https://github.com/mmediasoftwarelab/mmedia-ai-request-gateway | 0 | Python | Multi-tenant, monthly budget limits |

---

## Category 2: Observability & Cost Tracking Platforms

### Langfuse — The Observability Leader
| Field | Value |
|---|---|
| **URL** | https://github.com/langfuse/langfuse |
| **Stars / Forks** | 24,300 / 2,500 |
| **Language** | TypeScript |
| **License** | MIT (core), enterprise `ee/` excluded |
| **Last Active** | Active (6,672 commits) |
| **Commercial** | Yes — acquired by ClickHouse (Jan 2026) |
| **Cost Tracking** | Yes — automatic per-generation cost |
| **Budget Enforcement** | No |
| **Per-Customer Attribution** | Yes — via traces/sessions |
| **Dashboard** | Yes |

**Assessment:** De facto standard for LLM observability. Acquired by ClickHouse gives them infinite scale for analytics. Strong OTel integration, prompt management, evaluations. But: **zero budget enforcement**. It tells you what you spent, it doesn't stop you from spending. This is NullSpend's clearest competitive gap vs. Langfuse.

---

### OpenLIT
| Field | Value |
|---|---|
| **URL** | https://github.com/openlit/openlit |
| **Stars / Forks** | 2,300 / 266 |
| **Language** | Python (SDKs: Python, TypeScript, Go) |
| **License** | Apache 2.0 |
| **Last Active** | April 3, 2026 |
| **Cost Tracking** | Yes — custom pricing files for fine-tuned models |
| **Budget Enforcement** | No |
| **GPU Monitoring** | Yes |
| **Dashboard** | Yes |

**Assessment:** OTel-native, broader than just LLM (GPU monitoring, guardrails, evals). Cost tracking with custom pricing support. No budget enforcement. Smaller community than Langfuse.

---

### MLflow
| Field | Value |
|---|---|
| **URL** | https://github.com/mlflow/mlflow |
| **Stars / Forks** | 25,100 / 5,500 |
| **Language** | Python |
| **License** | Apache 2.0 |
| **Last Active** | Active |
| **Commercial** | Yes — Databricks |
| **Cost Tracking** | Yes — via tracing |
| **Budget Enforcement** | Limited — rate limits, fallbacks |
| **AI Gateway** | Yes — added 2025-2026 |

**Assessment:** Massive platform (ML lifecycle + LLM tracing + AI gateway). Cost tracking via OTel traces. Gateway has rate limits and credential management but budget enforcement is basic. Backed by Databricks. Not a direct competitor — too broad.

---

### Token Cost Libraries

| Project | URL | Stars | Lang | License | Notes |
|---|---|---|---|---|---|
| TokenCost (AgentOps) | https://github.com/AgentOps-AI/tokencost | 2,000 | Python | MIT | 400+ LLM price estimates, AgentOps commercial behind it |
| TokenX | https://github.com/dvlshah/tokenx | 20 | Python | MIT | Decorator-based cost/latency monitoring |
| TokenMeter (.NET) | https://github.com/iyulab/TokenMeter | 2 | C# | MIT | 12 providers, thread-safe |
| tokenmeter (Python) | https://github.com/rehan-ai/tokenmeter | - | Python | - | Uses LiteLLM pricing data |
| Otellix | https://github.com/oluwajubelo1/otellix | 4 | Go | MIT | OTel-native, per-user spend ceilings |
| llm-cost (Node) | https://github.com/rogeriochaves/llm-cost | - | JS | - | Token counting + cost estimation |
| llm-token-tracker | https://github.com/wn01011/llm-token-tracker | 3 | TS | MIT | MCP support, session tracking |
| llm-cost-tracker | https://github.com/danieleschmidt/llm-cost-tracker | 1 | Python | MIT | Self-hostable OTel collector for cost |
| openai-cost-tracker | https://github.com/sebastianschramm/openai-cost-tracker | - | Python | - | OTel-based OpenAI request logger |
| llm-cost (Zig) | https://github.com/Rul1an/llm-cost | 1 | Zig | MIT | Static analysis, FOCUS-compliant, "Infracost for AI" |

---

## Category 3: Budget Enforcement Libraries

The most directly competitive category to NullSpend's core.

### AgentBudget — Closest Direct Competitor
| Field | Value |
|---|---|
| **URL** | https://github.com/sahiljagtap08/agentbudget |
| **Stars / Forks** | 97 / 19 |
| **Language** | Python (Go, TS/JS also mentioned) |
| **License** | MIT |
| **Last Active** | 2026 |
| **Commercial** | Yes — agentbudget.dev, Sahil Jagtap is CTO @ Airstitch |
| **Cost Tracking** | Yes — per-session, per-call |
| **Budget Enforcement** | Yes — hard limits, soft limits, loop detection |
| **Per-Customer Attribution** | Per-session only |
| **Dashboard** | No |
| **Proxy** | No — SDK-only (patches OpenAI/Anthropic clients) |
| **HITL** | No |

**Assessment:** The most directly comparable project. "ulimit for AI agents." SDK-only approach — patches provider SDKs to intercept calls. No proxy, no dashboard, no HITL, no MCP. Soft limit callbacks + hard limit exceptions. Loop detection is interesting. 97 stars suggests modest traction. HN launch thread exists. The "one line to set a budget" pitch is clean.

**NullSpend advantages over AgentBudget:** Proxy architecture (works with any client), dashboard, HITL approval, MCP integration, webhook notifications, tag-based budgets, velocity limits, per-customer attribution, Slack integration.

---

### VERONICA-core
| Field | Value |
|---|---|
| **URL** | https://github.com/amabito/veronica-core |
| **Stars / Forks** | 4 / 0 |
| **Language** | Python |
| **License** | Apache 2.0 |
| **Last Active** | February 16, 2026 |
| **Budget Enforcement** | Yes — org/team/user/service level, WindowLimit policies |
| **Cost Tracking** | Implied (tracks for enforcement) |
| **Zero Dependencies** | Yes |

**Assessment:** Tiny project (4 stars) but interesting design. Context manager wrapping with per-minute/per-hour USD limits at multiple levels (org, team, user, service). BudgetExceeded raised before call reaches provider. No dashboard, no proxy, Python-only.

---

### llm-budget (Rust)
| Field | Value |
|---|---|
| **URL** | https://github.com/Mattbusel/llm-budget |
| **Stars / Forks** | 3 / 0 |
| **Language** | Rust |
| **License** | MIT |
| **Last Active** | March 7, 2026 |
| **Budget Enforcement** | Yes — FleetGovernor, daily/per-request/per-agent/rolling-window |

**Assessment:** Rust governance primitives. Interesting "FleetGovernor" concept for aggregate budget across agent fleets. Used inside tokio-prompt-orchestrator. 3 stars, likely a single developer's library.

---

### Cascadeflow (Cost Optimization)
| Field | Value |
|---|---|
| **URL** | https://github.com/lemony-ai/cascadeflow |
| **Stars / Forks** | 306 / 98 |
| **Language** | Python |
| **License** | MIT |
| **Last Active** | 2026 |
| **Commercial** | Yes — lemony.ai |
| **Cost Tracking** | Yes |
| **Budget Enforcement** | Yes — per-tool-call budget gating |
| **Cost Optimization** | Yes — 40-85% savings via model cascading |

**Assessment:** Different angle — cost optimization through smart model selection. Routes cheaper queries to cheaper models automatically. Per-tool-call budget gating means it also enforces. Sub-5ms overhead claim. Works with LangChain, OpenAI Agents SDK, CrewAI, etc. Not a proxy — in-process library. Interesting complement to a proxy-based approach.

---

### RelayPlane Proxy
| Field | Value |
|---|---|
| **URL** | https://github.com/RelayPlane/proxy |
| **Stars / Forks** | 113 / 14 |
| **Language** | TypeScript |
| **License** | MIT |
| **Cost Tracking** | Yes — across 11 providers |
| **Budget Enforcement** | Yes |
| **Dashboard** | Yes |
| **Cost Optimization** | Yes — smart model routing |

**Assessment:** Node.js proxy running locally. Tracks costs across 11 providers, enforces budgets, and optimizes via smart model routing. Dashboard included. 113 stars. Closest architectural match to NullSpend but local-only, no cloud, no HITL, no MCP.

---

## Category 4: Billing & Metering Infrastructure

These are "charge your customers for usage" tools, not "control your agent spending" tools.

### Lago
| Field | Value |
|---|---|
| **URL** | https://github.com/getlago/lago |
| **Stars / Forks** | 9,500 / 571 |
| **Language** | Ruby (API), TypeScript (frontend) |
| **License** | AGPLv3 |
| **Commercial** | Yes — Lago SaaS |
| **Use Case** | Metering + usage-based billing for SaaS |

**Assessment:** Strong open source billing platform. Event-driven consumption tracking, subscription management, invoice generation. The "charge your customers" side of LLM monetization. Not a competitor to NullSpend — complementary. AGPLv3 limits commercial embedding.

---

### OpenMeter
| Field | Value |
|---|---|
| **URL** | https://github.com/openmeterio/openmeter |
| **Stars / Forks** | 1,900 / 161 |
| **Language** | Go (76.6%) |
| **License** | Apache 2.0 |
| **Last Active** | February 2026 (v1.0.0-beta.227) |
| **Commercial** | Yes — openmeter.io SaaS |
| **AI-Specific** | Yes — first-class AI token metering |

**Assessment:** Real-time usage metering focused on AI/API workloads. Can meter LLM tokens by model and prompt type. Apache 2.0 is friendlier than Lago's AGPL. Same "charge your customers" use case, not "control your agents."

---

### Flexprice
| Field | Value |
|---|---|
| **URL** | https://github.com/flexprice/flexprice |
| **Stars / Forks** | 3,600 / 148 |
| **Language** | Go (95.9%) |
| **License** | AGPL-3.0 (open core) |
| **Last Active** | April 1, 2026 (v2.0.15) |
| **Commercial** | Yes — flexprice.io, $500K raised (TDV Partners) |
| **AI-Specific** | Yes — inference tokens, GPU, agentic workload metering |

**Assessment:** Newest and most AI-native billing platform. Per-model-call, per-agent-action, per-pipeline-step metering. Growing fast (3.6k stars). Open core model. Direct competitor to Lago/OpenMeter specifically for AI companies. No budget enforcement or governance.

---

## Category 5: Agent Governance Frameworks

### Microsoft Agent Governance Toolkit
| Field | Value |
|---|---|
| **URL** | https://github.com/microsoft/agent-governance-toolkit |
| **Stars / Forks** | 437 / 83 |
| **Language** | Python (SDKs: Python, Rust, TypeScript, Go, .NET) |
| **License** | MIT |
| **Last Active** | April 2, 2026 (literally just launched) |
| **Commercial** | Microsoft-backed open source |
| **Policy Enforcement** | Yes — deterministic, sub-millisecond (<0.1ms) |
| **Zero-Trust Identity** | Yes — Ed25519, SPIFFE/SVID |
| **Cost Tracking** | No |
| **Budget Enforcement** | No — policy focused, not cost focused |
| **OWASP Coverage** | 10/10 Agentic Top 10 |

**Assessment:** JUST LAUNCHED (April 2, 2026). Microsoft's entry into agent governance. Strong on policy, identity, sandboxing, reliability. 339+ adversarial tests. But: **no cost tracking, no budget enforcement**. This is security governance, not financial governance. Covers a completely different layer than NullSpend. Could be complementary — NullSpend for the financial layer, MS toolkit for the security layer.

---

### Agentic Contract
| Field | Value |
|---|---|
| **URL** | https://github.com/agentralabs/agentic-contract |
| **Stars / Forks** | 4 / 2 |
| **Language** | Rust (core) + MCP server |
| **License** | MIT |
| **Features** | Policy engine, risk limits, approval gates, obligation tracking |
| **Storage** | Portable .acon binary file |

**Assessment:** Tiny but architecturally interesting. Rust core with MCP server. Policies stored in a binary .acon file. 38 tools. Sub-millisecond policy evaluation. No cloud, no telemetry. Too small to matter today.

---

### Agent Contracts (flyersworder)
| Field | Value |
|---|---|
| **URL** | https://github.com/flyersworder/agent-contracts |
| **Stars / Forks** | 1 / 0 |
| **Language** | Python |
| **License** | Apache 2.0 |
| **Features** | Formal resource contracts, budgets, deadlines, success criteria |

**Assessment:** Academic/research project. 167 commits but 1 star. Formal framework for governing autonomous agents through resource constraints.

---

### Agent Identity Protocol (AIP)
| Field | Value |
|---|---|
| **URL** | https://github.com/openagentidentityprotocol/agentidentityprotocol |
| **Stars / Forks** | 22 / 4 |
| **Language** | Go |
| **License** | Apache 2.0 |
| **Features** | Zero-trust identity for MCP, policy-based auth, audit logging |

**Assessment:** Security-focused. Policy enforcement proxy for MCP with HITL approval. More about identity and authorization than cost control. Small but interesting MCP integration.

---

### SAFi, ASQAV-SDK, agent-audit
Governance-adjacent projects focused on compliance, audit trails, and security scanning rather than cost control. Too niche and small to detail.

---

## Category 6: Agent Payment / Wallet (Crypto-Adjacent)

Not direct competitors but watching the "agent spending" framing.

| Project | URL | Stars | Notes |
|---|---|---|---|
| OmniAgentPay | https://github.com/omniagentpay/omniagentpay | - | Payment infra for agents, Safety Kernel with guards, x402 protocol |
| Agent Spending Controls (L1AD) | (repo may be removed/404) | - | Non-custodial policy layer for agent wallets, per-tx + daily limits |
| LIT Protocol Agent Wallet | https://github.com/LIT-Protocol/agent-wallet | - | Policy enforcement for agent wallet operations |
| Crossmint Agent Wallets | https://github.com/Crossmint | - | Stablecoin wallets for agents, on-chain spending rules |

**Assessment:** This space is about agents making payments (buying things), not about controlling API costs. Different market. But the "spending controls" language overlaps with NullSpend's positioning. Worth watching for terminology/brand confusion.

---

## Category 7: AI Coding Agent Analytics

Emerging niche focused on developer tool cost tracking.

| Project | URL | Stars | Notes |
|---|---|---|---|
| Agentlytics | https://github.com/f/agentlytics | 383 | Dashboard for 16 AI coding editors, local SQLite |
| BurnRate | (not found on GitHub) | - | Tracks Claude Code, Cursor, Codex costs, 23 optimization rules |
| CodexBar | https://github.com/steipete/codexbar | - | macOS menu bar app, usage limits for coding agents |
| ClawWatch | https://github.com/GENWAY-AI/clawatch | - | Open source observability for OpenClaw agents |

**Assessment:** Growing niche as AI coding agents become expensive. Focused on individual developer cost awareness, not organizational budget enforcement.

---

## Competitive Positioning Matrix

| Capability | NullSpend | LiteLLM | Langfuse | Portkey | Helicone | AgentBudget | Cascadeflow | MS Governance |
|---|---|---|---|---|---|---|---|---|
| **Cost Tracking** | Yes | Yes | Yes | Yes (SaaS) | Yes | Yes | Yes | No |
| **Hard Budget Enforcement** | Yes | Buggy | No | SaaS only | No (alerts) | Yes | Yes | No |
| **HITL Approval** | Yes | No | No | No | No | No | No | No |
| **MCP Support** | Yes | No | No | No | No | No | No | No |
| **SDK** | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| **Proxy** | Yes | Yes | No | Yes | Yes | No | No | No |
| **Dashboard** | Yes | Yes | Yes | Yes (SaaS) | Yes | No | No | No |
| **Webhook Notifications** | Yes | Partial | No | No | Alerts | No | No | No |
| **Velocity Limits** | Yes | No | No | No | No | No | No | No |
| **Tag-Based Budgets** | Yes | Recent | No | No | No | No | No | No |
| **Session Limits** | Yes | No | No | No | No | Per-session | No | No |
| **Policy Enforcement** | Yes (mandates) | No | No | No | No | No | No | Yes |
| **Agent Identity** | No | No | No | No | No | No | No | Yes |
| **Slack Integration** | Yes | No | No | No | No | No | No | No |
| **Multi-Provider Routing** | No | Yes | N/A | Yes | Yes | N/A | Yes | N/A |

---

## Threat Assessment

### Serious Threats (Watch Closely)

1. **LiteLLM adding better budget enforcement.** 42k stars, huge community. If they fix their budget bugs and add HITL, they could absorb NullSpend's value prop into their gateway. Current budget quality is poor but they have the resources to fix it.

2. **Portkey moving cost controls into OSS.** Currently cost tracking is SaaS-only. If they open source it, 11k stars community is formidable.

3. **AgentBudget growing and adding a proxy/dashboard.** Closest direct competitor in positioning. If they raise funding and expand beyond SDK-only, they become a real threat.

4. **Cascadeflow adding budget enforcement to cost optimization.** 306 stars, active, MIT. If they add hard enforcement alongside their model cascading, the "save money AND enforce budgets" pitch is compelling.

### Moderate Threats (Monitor)

5. **Microsoft Agent Governance Toolkit expanding to financial governance.** Just launched today. If Microsoft adds cost tracking to their governance toolkit, the brand weight alone is dangerous.

6. **AgentGateway (solo.io) deepening budget controls.** Already has MCP + A2A + LLM gateway with budget controls. Backed by major infrastructure company.

7. **Helicone adding hard enforcement.** Already has cost tracking and alerts. Moving from alerts to hard blocks is a small step.

### Low Threats (Noise)

8. **Tiny projects** (llm-budget, veronica-core, agentic-contract, etc.) — all < 10 stars, single developers, no commercial backing.

9. **Billing infra** (Lago, OpenMeter, Flexprice) — different use case entirely.

10. **Agent wallet/crypto** — different market.

---

## NullSpend's Unique Position

No open source project combines ALL of:
1. Transparent proxy (works with any client, no SDK lock-in)
2. Hard budget enforcement (not just alerts)
3. Human-in-the-loop approval flow
4. MCP integration (budget negotiation)
5. Dashboard with analytics
6. Webhook notifications with threshold detection
7. Velocity limits (rate of spend, not just total)
8. Tag-based and session-based budgets
9. Slack integration for approvals
10. SDK for client-side enforcement parity

The closest project covering multiple of these is LiteLLM, but it lacks HITL, MCP, velocity limits, session limits, and its budget enforcement has known bypass bugs.

---

## Recommendations

1. **Differentiate on enforcement quality.** LiteLLM's budget bugs are NullSpend's opportunity. Market message: "Budget enforcement that actually works."

2. **Emphasize HITL as a moat.** Nobody else has human-in-the-loop approval. This is a genuine differentiator for high-stakes agent deployments.

3. **Double down on MCP.** Only AgentGateway has MCP support, and theirs is for tool routing, not budget negotiation. NullSpend's MCP budget negotiation is unique.

4. **Watch Microsoft closely.** Agent Governance Toolkit is MIT, just launched, and has Microsoft's brand. If they add cost tracking, respond immediately with integration (not competition).

5. **Consider Langfuse integration.** Send NullSpend cost events to Langfuse for visualization. Complementary, not competitive. Increases NullSpend's surface area.

6. **The "agent wallet" framing is coming.** Crypto projects are using "spending controls" language. Own the term in the API cost space before it gets confused with on-chain payments.
