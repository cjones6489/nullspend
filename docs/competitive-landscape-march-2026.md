# Competitive Landscape & Market Research — March 2026

> **Date:** March 9, 2026
> **Status:** Current intelligence snapshot. Update quarterly or when major events occur.
>
> **Key takeaway:** Helicone (our closest comp) was acquired by Mintlify on March 3,
> 2026 and is entering maintenance mode. 16,000 orphaned organizations. This is a
> once-in-a-category window.

---

## Competitive Map

### Tier 1: Direct Competitors (LLM cost proxy / gateway)

| Company | Stage | Funding | Pricing | Budget Enforcement | MCP Support | Status |
|---|---|---|---|---|---|---|
| **Helicone** | Acquired | ~$2M (YC W23) | $0–$799/mo | Rate limiting via headers (weak) | Read-only MCP server | **Dead.** Acquired by Mintlify Mar 3, 2026. Maintenance mode. |
| **Portkey** | Series A | $18M (Feb 2026) | $0–$49/mo + enterprise | Enterprise-only, immutable limits | Full MCP Gateway | **Primary competitor.** Strong but budget enforcement gated. |
| **LiteLLM** | Seed | $1.6M (YC W23) | Open source / enterprise | Per-user/team/key (OSS) | Config-based MCP cost tracking | **Anti-pattern competitor.** Docker+PG+Redis+YAML. $7M ARR. |

### Tier 2: Adjacent — Agent Observability

| Company | What They Do | Overlap | Status |
|---|---|---|---|
| **Langfuse** | Open-source LLM observability | Cost tracking, traces | Acquired by ClickHouse |
| **LangSmith** | LangChain tracing & evals | Agent workflow observability | Part of LangChain ($130M+) |
| **Spanora** | OpenTelemetry-native cost tracking | Cost tracking across 100+ models | Early startup |

### Tier 3: Adjacent — Agent Financial Infrastructure

| Company | What They Do | Funding | Relationship |
|---|---|---|---|
| **Sapiom** | "Money as the universal API key" — agent payments | $15.75M seed (Accel, Anthropic) | Complementary (payments, not enforcement) |
| **Locus** | Payment infrastructure with agent spending limits | YC F25 | Potentially complementary |
| **Invoica** | "Financial OS for AI Agents" — invoicing, settlement | Unknown | Different layer (settlement vs metering) |

---

## Detailed Competitor Analysis

### Helicone (ACQUIRED — March 3, 2026)

**Pre-acquisition scale:** 14T+ tokens processed, 30,000+ signups, 16,000 organizations,
$1M+ ARR, 5.2K GitHub stars.

**What they had:**
- Cost tracking via proxy ("AI Gateway") or async SDK logging
- Rate limiting with cost units (their version of "budget enforcement")
- Edge caching on Cloudflare
- Request logging, session tracing, custom properties, prompt management
- SOC 2, HIPAA compliance (Team tier)

**Why they failed to sustain independently:**
- Budget enforcement was just rate limiting repurposed — header-driven, client-controlled
- No real identity-based budget management
- No kill switch, no receipts, no enforcement UX
- Small team (~5 people), modest funding (~$2M)
- Couldn't differentiate enough from Portkey's growing feature set

**Our opportunity:**
- 16,000 organizations need an alternative NOW
- Write a "Migrating from Helicone" guide
- Their proxy integration model (change base URL) is identical to ours — easy migration
- Their pricing gaps (enforcement features gated or missing) are our core value prop

**Architecture notes:**
- AI Gateway: Rust on Cloudflare (open-source, NGINX-inspired)
- Rate limiting: Cloudflare KV
- Dashboard: Web app
- Self-hosting available via Docker/K8s

### Portkey (PRIMARY COMPETITOR)

**Scale:** 24,000+ organizations, 3,000+ active teams, 10B+ requests/month,
$180M+ AI spend under management.

**Strengths:**
- Open-source TypeScript gateway (MIT, 10.8K stars, sub-1ms overhead)
- 250+ LLMs across 60+ providers
- Full MCP Gateway with per-tool access control and observability
- SOC 2 Type 2, ISO 27001, GDPR, HIPAA, VPC/airgapped deployments
- Gartner Cool Vendor (Oct 2025)
- Strong enterprise traction (Booking.com, Sony, BCG, Unilever)

**Weaknesses we can exploit:**
1. **Budget enforcement is enterprise-only** — free/pro users can only watch costs
2. **Budget limits are immutable** — cannot be edited after creation
3. **Budgets are per-virtual-key, not per-agent-identity**
4. **Enterprise-heavy design** — over-engineered for solo devs and small teams
5. **Control plane lock-in** — config sync dependency on Portkey-hosted control plane

**Pricing:**
- Developer (Free): 10K logs/mo, 3-day retention
- Production ($49/mo): 100K logs + $9/100K overage, 30-day retention
- Enterprise (custom): Budget limits, VPC, compliance

**Our positioning against Portkey:**
"Budget enforcement shouldn't require an enterprise contract."

### LiteLLM (ANTI-PATTERN COMPETITOR)

**Scale:** 35.3K GitHub stars, 240M+ Docker pulls, $7M ARR, 1,005+ contributors.

**What validates our thesis:**
- $7M ARR proves demand for LLM proxy/gateway
- Budget enforcement exists and is used (per-user, team, key)
- MCP cost tracking exists (config-based fixed costs or Python hooks)

**What validates our DX position:**
- Docker + Postgres + Redis + YAML config required
- 800+ open GitHub issues
- Performance degrades after 2-3 hours (resource leaks)
- Self-reported 80% uptime
- DB bottleneck at 100K+ requests/day
- SDK bundles 12MB of proxy code even for library-only use

**Named customers:** NASA, Adobe, Netflix, Stripe, Nvidia (per hiring page)

---

## Agent Infrastructure Ecosystem Map

### Identity / Auth
| Company | Approach | Stage |
|---|---|---|
| WorkOS | MCP Registry architecture, OAuth 2.1 for agents | Series B ($80M+) |
| Stytch | M2M auth API, OAuth 2.0 client credentials | Series B ($145M) |
| Vouched | "Know Your Agent" (KYA) — identity verification for agents | Established |
| Teleport | Cryptographic agent identity, delegated identities | Established |

**Emerging standard:** OAuth 2.0 has won for agent auth. Agent Cards
(`/.well-known/agent-card.json`), W3C DIDs v1.1, Verifiable Credentials are
the complementary standards.

### Agent Memory / State
| Company | Approach |
|---|---|
| MemLayer | Persistent memory via bitemporal knowledge graphs |
| Cortex | 4-layer memory (ACID + vector + facts + graph) |
| StateBase | Durable state with version snapshots and rollback |
| Tacnode | Shared decision-time memory for multi-agent systems |

### Agent Compute / Runtime
| Company | Pricing | Cold Start |
|---|---|---|
| E2B | $29/mo for 100 GB-hours | 400ms |
| Fly.io Sprites | $0.07/CPU-hr, scales to zero | 1-2s |
| Modal | $0.30/hr CPU, $1/hr GPU | 1-2s |
| Blaxel | Unknown | ~25ms |

### MCP Infrastructure
| Company | What |
|---|---|
| Kong MCP Registry | Enterprise governance for MCP servers |
| MCP Hive | Monetization marketplace (launching May 2026) |
| MCP Exchange | Registry + rental marketplace with semantic search |

### Orchestration / Communication
| Standard | Adoption |
|---|---|
| Google A2A Protocol | 150+ organizations (Salesforce, ServiceNow, PayPal) |
| Anthropic MCP | De facto standard for agent-tool interaction |
| LangGraph | ~400 companies in production, 90M monthly downloads |
| Temporal | Durable execution for long-running agents (a16z Series D) |

### Agent Payments / Settlement
| Company | Funding | What |
|---|---|---|
| Sapiom | $15.75M seed (Accel) | Agent-to-service payments, "money as API key" |
| Locus | YC F25 | Spending limits, escrow for agent-to-freelancer hiring |
| PayOS | Unknown | Card-native agentic tokens, Mastercard integration |
| Nevermined | Unknown | x402 protocol facilitator — fiat, crypto, credits |

**Emerging protocol:** x402 — HTTP-native agent payments. 100M+ payment flows since
May 2025.

---

## Developer Infrastructure Pricing Research

### Historical Models at Early Stage

| Company | Early Pricing | Key Insight |
|---|---|---|
| **Stripe** | 2.9% + 30c per transaction. No monthly fee, no minimums. | Simple usage-based. Same rate at any scale. Set the standard. |
| **Segment** | Free open-source → freemium SaaS. Volume-based (events/mo). | Open-source funnel → hosted upsell. |
| **Datadog** | Per-host/month subscription. Self-serve signup. | Module expansion (APM, logs, SIEM) = natural upsell. |
| **Vercel** | Free (Hobby) → $20/user/mo (Pro) → Enterprise. | Generous free tier. Per-seat + usage overage. |
| **Supabase** | Free → $25/mo (Pro) → $599/mo (Team) → Enterprise. | Very generous free tier. Usage-based overages. |
| **Neon** | Free (100 compute-hours) → $19/mo (Scale Launch). | Most aggressive free tier. Scale-to-zero is the killer feature. |
| **PlanetScale** | Had free tier → killed it Apr 2024 → $39/mo minimum. | **Cautionary tale.** Removing free tier caused developer exodus. |

### Pricing Patterns for AgentSeam

1. **Generous free tier is non-negotiable.** PlanetScale proved the cost of removing one.
2. **Price by the unit developers naturally grow** — proxied spend is our natural unit.
3. **Stripe model is the ideal:** percentage of value flowing through, simple rate.
4. **10-20x jump from free to paid is normal** ($0 → $19-49/mo).
5. **Module expansion is the growth engine** — add cost dimensions (MCP, tools, agents).

**Decided pricing model (see `docs/finops-pivot-roadmap.md` Pricing section):**

| Tier | Monthly Price | Proxied Spend Cap | Budgets | Retention |
|---|---|---|---|---|
| Free | $0 | $1,000/mo | 1 | 7 days |
| Pro | $49/mo | $50,000/mo | Unlimited | 30 days |
| Team | $199/mo | $250,000/mo | Unlimited | 90 days |
| Enterprise | Custom | Unlimited | Unlimited | Custom |

Rationale: Flat tiers with proxied-spend caps. Not percentage-based (avoids
"tax on AI costs" perception). Free tier at $1K/mo covers solo devs. Pro at
$49 matches Portkey but includes budget enforcement. Zero markup on tokens.

---

## Market Size & Signals

### Market Data
- AI agent market: **$7.84B (2025) → $52.6B by 2030** (46% CAGR)
- AI orchestration market: **$30B+ by 2027** (3x growth)
- Total AI funding: **$238B deployed globally in 2025** (47% of all VC)
- Agent infrastructure: Only **9% of VC capital** despite growing deal volume — underfunded

### Enterprise Budgeting
- **35%+ of enterprises** will have agent budgets of **$5M+ in 2026**
- ~10% will allocate **$10M+**
- **40% of enterprise apps** will embed agents by end of 2026 (Gartner)
- **100% of 500 senior executives** plan to expand agentic AI deployments in 2026
- **171% average ROI** on enterprise agent deployments

### Risk Signal
- **40% of agentic AI projects** face cancellation by 2027 due to reliability gaps
- This actually *helps* our thesis — cost controls and receipts reduce cancellation risk

### VC Sentiment
- Sequoia declared 2026 "the year of AGI" (long-horizon agents)
- a16z invested in Temporal specifically as agent infrastructure
- VCs identify **trust, evaluation, governance, composability** as the real opportunity
- $4.4B raised across 101 agentic AI deals (2022-2025), deal volume grew 9x

---

## Strategic Implications for AgentSeam

### Immediate Actions (This Week)

1. **Helicone migration guide** — already in Phase 5 scope. Elevate priority. Time-sensitive.
2. **Position against Portkey's enterprise gate** — "Budget enforcement at $49, not enterprise-only"
3. **Consider Stripe-inspired pricing** — percentage of proxied spend, not flat rate

### Validated Thesis Points

1. "Change your base URL" integration model is validated by Helicone's adoption (30K signups)
2. Budget enforcement demand is proven by LiteLLM's $7M ARR and Portkey's enterprise tier
3. Nobody owns "FinOps for agents" as a clean, simple product — it's greenfield
4. Agent infrastructure is underfunded relative to demand (9% of capital)
5. The "agent-native infrastructure" play (AgentMail pattern) is backed by real VC interest

### Key Differentiators (Confirmed)

1. **Budget enforcement at startup pricing** — Portkey gates it behind enterprise
2. **Kill Receipts** — complete whitespace. No competitor has cryptographic cost receipts.
3. **Zero-infrastructure setup** — LiteLLM requires Docker+PG+Redis+YAML
4. **Identity-based enforcement** — not header-driven (Helicone) or per-key-only (Portkey)
5. **Unified LLM + MCP cost tracking** — nobody else offers this at any price point

### Open Questions

1. Should pricing be flat ($49/mo) or usage-based (% of proxied spend)?
2. Helicone migration: how aggressive to be? Blog post? Direct outreach?
3. When to start customer discovery calls? Pre-launch or post-launch?
4. Sapiom — partner, competitor, or ignore?
5. x402 protocol — relevant for Phase 20 (agent marketplace), or premature?
