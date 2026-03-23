# NullSpend FinOps Pivot: Build Roadmap

> **Status: Active.** This is the master roadmap for NullSpend — the FinOps
> layer for AI agents.
>
> **How to use this document:** Each phase has scope, acceptance criteria, and
> references. When we start a phase, we create a detailed implementation plan
> for that phase. We do not build ahead of the current phase.
>
> **Reference documents:**
> - `docs/competitive-landscape-march-2026.md` — Current competitive intelligence (updated Mar 2026)
> - `docs/claude-research/compass_artifact_wf-4db73083-*` — Original competitive landscape
> - `docs/claude-research/compass_artifact_wf-40b71591-*` — Technical build spec
> - `docs/frontend-gap-analysis.md` — Dashboard feature status
> - `docs/archive/finops-pivot-tech-audit.md` — Technology sanity check (archived)

---

## The #1 Rule: Developer simplicity above everything

The developer experience is ONE thing: **change your base URL.**

```bash
# Before
OPENAI_BASE_URL=https://api.openai.com/v1

# After
OPENAI_BASE_URL=https://proxy.nullspend.com/v1
```

That's it. Their existing code, existing SDK, existing streaming — all works
identically. No package to install, no client to wrap, no decorators, no
config files. One environment variable and they have cost tracking + budget
enforcement.

For MCP, same idea — one config line change to point at our proxy instead of
the real server.

**All complexity is OUR complexity, not the developer's.**

**The complexity trap to avoid:** LiteLLM requires Docker + PostgreSQL + Redis +
YAML config. That's why developers complain about it despite 38K stars. If
setting up NullSpend ever requires more than an API key and a base URL change,
we've gone wrong.

## Core principles

These principles don't change. How they are *expressed* evolves as the
product matures, but the principles themselves are non-negotiable.

1. **Trust.** The proxy is transparent by default — it never modifies
   requests or responses unless the developer explicitly opts in.
2. **Transparency.** Every capability that touches payloads is clearly
   documented, toggled off by default, and explained in plain language.
3. **Security.** Identity-based enforcement. No bypass paths. Provider
   keys are never stored (BYOK).
4. **Developer-first.** Setup is one environment variable change. No
   packages, no wrappers, no config files.

### The opt-in principle

As the product grows, some features will modify payloads (model routing,
budget injection, context compression). These features are powerful but
break the "transparent proxy" default. The rule:

- **Layer 0 (always on):** Transparent proxy. Cost tracking, budget
  enforcement, analytics. Never touches the request or response content.
- **Layer 1+ (opt-in):** Capabilities the developer explicitly enables
  via dashboard toggles or API flags. Each is documented with exactly
  what it modifies and why.

The default experience is always Layer 0. A developer who never touches
a toggle gets a proxy that is indistinguishable from hitting the provider
directly (plus cost data and budget enforcement). Features that modify
payloads require affirmative action to enable.

---

## Product vision (one sentence)

NullSpend is the FinOps layer for AI agents — a proxy that tracks every dollar
your agents spend on LLM tokens and tool calls, enforces hard budget ceilings,
and gives you the receipts to prove it.

## Positioning

| What we are | What we are not |
|---|---|
| One env var change, instant cost visibility | Install a package, wrap your client, add decorators |
| Hard budget enforcement at startup pricing | Enforcement gated behind enterprise contracts (Portkey) |
| Zero infrastructure — hosted proxy | Docker + Postgres + Redis + YAML config (LiteLLM) |
| Transparent proxy (zero code changes) | SDK that requires rewriting your agent |
| Identity-based enforcement (no bypass bugs) | Header-driven enforcement the client can skip (Helicone) |
| Agent-native financial infrastructure | General observability tools adapted for agents |

## Pricing model

> **Decision: Usage-based tiers, metered by proxied LLM spend.**

| Tier | Monthly Price | Proxied Spend Cap | Budgets | Retention | Key Features |
|---|---|---|---|---|---|
| **Free** | $0 | $1,000/mo | 1 | 7 days | Cost tracking, budget enforcement, dashboard |
| **Pro** | $49/mo | $50,000/mo | Unlimited | 30 days | Kill receipts, webhooks, API access |
| **Team** | $199/mo | $250,000/mo | Unlimited | 90 days | Multi-user, team budgets, advanced analytics |
| **Enterprise** | Custom | Unlimited | Unlimited | Custom | VPC, SSO/SCIM, compliance, SLA |

**Why this model:**

1. **The natural unit is proxied spend.** That's what developers care about and
   what our enforcement protects. A developer spending $800/mo on LLM calls
   uses the free tier indefinitely. When their agent spend grows past $1K/mo,
   they're getting enough value to pay $49.
2. **Free tier at $1K/mo spend is genuinely generous.** Most solo developers and
   early-stage startups spend less than this. They get the full product for
   free, build dependency on it, and upgrade organically. Portkey's free tier
   caps at 10K logs with 3-day retention — ours gives real enforcement with
   7-day retention for anyone under $1K/mo.
3. **$49 Pro matches Portkey's price point but includes budget enforcement.**
   Portkey charges $49/mo for production but gates budget enforcement behind
   enterprise. We include it at Pro. This is the competitive wedge in one
   pricing comparison.
4. **Proxied spend caps create natural upgrade pressure** without charging a
   percentage. Developers don't feel "taxed" on their AI costs — they pay a
   flat rate for the tier of service they need. The caps just gate which tier.
5. **Enterprise is where the real revenue is.** Teams spending $250K+/mo on
   LLM calls will happily pay $1K-5K/mo for controls and compliance. Custom
   pricing captures this without artificial ceilings.

**Why not pure percentage (Stripe-style):**
Stripe charges a percentage because it *enables revenue* — merchants earn money
through Stripe. We're on the cost side — our value is helping developers
spend *less*. Charging a percentage of spend creates a misalignment where our
revenue grows when their costs grow. Flat tiers with spend caps avoid this
tension while still scaling naturally.

**What we don't charge for:** Zero markup on LLM API calls. The proxy is
pass-through on pricing. We charge for the metering, enforcement, and
intelligence layer — never for the tokens themselves.

## Market context

**The structural thesis:** Just as AgentMail built email for agents because Gmail's
API isn't agent-native, NullSpend builds financial infrastructure for agents because
existing cost tools aren't built for autonomous, high-frequency, multi-provider agent
workflows that need real-time enforcement, not after-the-fact dashboards.

**Market size:** AI agent market $7.84B (2025) → $52.6B by 2030 (46% CAGR). 35%+ of
enterprises will have agent budgets >$5M in 2026. Agent infrastructure receives only
9% of VC capital despite growing demand — underfunded relative to opportunity.

**Timing:** Helicone's exit creates an immediate acquisition channel. Portkey's Series A
validates the category but their enforcement is enterprise-gated. LiteLLM's $7M ARR
proves demand but their DX is the anti-pattern we're positioned against.

See `docs/competitive-landscape-march-2026.md` for the full competitive analysis.

## Competitive wedge

> **Updated March 9, 2026:** Helicone was acquired by Mintlify on March 3, 2026
> and is entering maintenance mode. Their 16,000 organizations are orphaned.
> See `docs/competitive-landscape-march-2026.md` for the full analysis.

No hosted product under $500/month offers real budget enforcement with unified
LLM + tool call cost tracking. Helicone (our closest comp) just exited the
market — acquired by Mintlify, maintenance mode only. Portkey ($18M Series A)
has budget enforcement but gates it behind enterprise pricing with immutable
limits. LiteLLM has budget enforcement but requires Docker + Postgres + Redis
+ YAML and has 800+ open issues. We offer budget enforcement at startup pricing
with a one-line setup.

**The AgentMail parallel:** Just as AgentMail built email infrastructure that
is agent-native (when Gmail's API technically works but isn't built for agent
workflows), NullSpend builds financial infrastructure that is agent-native.
Existing tools (Stripe, Datadog, observability platforms) can technically track
costs, but none provide identity-based budget enforcement, cryptographic
receipts, or unified LLM + tool metering designed for autonomous agents.

## Architecture overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     Developer / Agent                           │
│  Uses OpenAI/Anthropic SDK with base URL pointed at NullSpend  │
│  OR connects MCP client through NullSpend MCP proxy            │
└────────────┬──────────────────────────────┬─────────────────────┘
             │ LLM API calls               │ MCP tool calls
             ▼                             ▼
┌────────────────────────┐    ┌──────────────────────────┐
│  LLM Proxy             │    │  MCP Cost Proxy          │
│  (Cloudflare Workers)  │    │  (stdio / HTTP)          │
│  Stream → tee → log    │    │  Intercept tools/call    │
│  Budget check (DO)     │    │  Track cost + duration   │
│  Cost calc per provider│    │  Budget enforcement      │
└────────┬───────────────┘    └────────┬─────────────────┘
         │                             │
         ▼                             ▼
┌──────────────────────────────────────────────────────────────┐
│                    Shared Infrastructure                      │
│  Durable Objects — budget enforcement (SQLite state)         │
│  Supabase Postgres — ledger, config, budgets, auth           │
│  Cloudflare KV — webhook endpoint caching                    │
└──────────────────────────────┬───────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────┐
│                    Dashboard (Next.js / Vercel)               │
│  Cost overview · Per-agent breakdown · Budget management      │
│  Kill receipts · Settings · API keys                          │
└──────────────────────────────────────────────────────────────┘
```

## Providers in scope

- **OpenAI** — GPT-5, GPT-4.1, GPT-4o, o3, o4-mini (Phase 1 — DONE)
- **Anthropic** — Claude Sonnet 4, Opus 4, Haiku 3/3.5/4.5 (Phase 3 — DONE)
- Post-launch based on demand: Gemini, Bedrock, Azure OpenAI

---

## Completed Phases

### Phase 0: Foundation & Repo Restructure — DONE

Cloudflare Workers project at `apps/proxy/`, Upstash Redis, monorepo
restructure with `packages/cost-engine/`, database tables (`budgets`,
`cost_events`), model pricing database with typed lookup.

### Phase 1: OpenAI Streaming Proxy — DONE

Working proxy at `/v1/chat/completions`. Request interception, stream
proxying with `response.body.tee()`, SSE usage extraction, cost calculation
in microdollars, cost event logging via `ctx.waitUntil()`, non-streaming
support, `passThroughOnException()` failover. 280+ unit and smoke tests.

### Phase 2: Budget Enforcement (Redis) — DONE

Atomic Redis Lua check-and-reserve script, pre-request budget estimation,
post-response reconciliation, budget hierarchy (key + user), STRICT_BLOCK
policy, budget CRUD API, reservation TTL auto-expiry. Concurrent request
safety verified via load tests.

### Phase 3: Anthropic Provider Support — DONE

Anthropic route at `/v1/messages`. Named-event SSE parsing (`message_start`,
`message_delta`), cache token accounting (read/write/5min/1hr), long-context
multipliers, extended thinking support, cost calculator with all pricing
tiers. Budget enforcement shared with OpenAI. 280 stress tests covering
pricing accuracy across 7 live models, edge cases, resilience, load,
security, and known Anthropic API issues.

### Phase 4: Dashboard Multi-Provider Support — DONE

Provider awareness throughout the dashboard: provider filter on cost events
API, provider breakdown analytics, formatted model/provider display names,
provider badge in Activity table, provider breakdown chart in Analytics,
Avg Cost/Request stat card, seed script with ~30% Anthropic events. No
schema migration required.

---

## Current Phase

### Phase 5: Launch Prep (now — 3 days)

**Goal:** Everything needed to put this in front of developers.

#### Scope

1. **README rewrite** — compelling README with the $47K horror story hook,
   one-line setup, architecture diagram
2. **`.env.example` audit** — verify all required env vars are documented
3. **`fillDateGaps` fix** — edge case in date gap filling for analytics
4. **Sidebar reorder** — Analytics above Activity, Settings at bottom
5. **Documentation** — quickstart guide, provider setup guides (OpenAI,
   Anthropic), budget configuration guide, API reference
6. **HN post draft** — "Show HN: NullSpend – FinOps for AI agents (budget
   enforcement that actually works)." Lead with the problem, show the gaps,
   link to live demo.
7. **Helicone migration guide (TIME-SENSITIVE)** — Helicone was acquired by
   Mintlify on March 3, 2026 and is entering maintenance mode. 16,000
   organizations need an alternative. Write a clear migration guide showing
   our proxy model is identical (change base URL). Blog post for SEO + docs
   page. Target: capture orphaned users while the window is open.

#### Acceptance criteria

- A developer can sign up, change their base URL, and see costs within 5 minutes
- README clearly communicates value with one-line setup
- HN post is ready to submit
- Helicone migration guide is published and SEO-indexed
- Free tier works without credit card

---

## Forward Roadmap

### How to read this roadmap

This roadmap is a **north star, not a stone tablet.** It captures our best
thinking about where the product goes, but it will be shaped — and
reshaped — by what real users and developers tell us after launch.

- **The Plan (Phases 6-9):** Concrete, scoped, likely to ship roughly as
  described. These are next up after launch.
- **The Direction (Phases 10-14):** Reasonable bets based on competitive
  research and first principles. Timing and scope will shift based on
  user demand. Features here get built when users ask for them, not on a
  calendar.
- **The Vision (Phases 15-22):** Long-term trajectory for investors,
  architectural decision-making, and strategic orientation. These are not
  commitments — they are possibilities that the earlier phases make
  achievable. Any of them could be reprioritized, transformed, or dropped
  based on what we learn.

**The metric that governs prioritization:** total dollar volume flowing
through the proxy. Every phase should either increase the number of
developers routing through us or increase the value delivered per request.
If a phase doesn't move one of those numbers, it gets deprioritized.

---

## The Plan (Phases 6-9)

These phases have concrete scope and are next in the build queue.

### Phase 6: Post-Launch Hardening (week 1-2 after launch)

Fix whatever real users surface. Extract common patterns from support
questions into better docs. Add the cost events log page to the dashboard
(paginated table with filters — it's in the frontend gap analysis as
pending). Wire up Stripe for Pro tier if demand warrants it, or stay free
to maximize adoption. Build the signup/onboarding flow if not completed
in Phase 5.

---

### Phase 7: MCP Tool Cost Proxy — Option C (week 3-4)

Modify the existing stdio MCP proxy: strip the approval gate, add duration
tracking, add HTTP calls to the CF Workers proxy for cost reporting and
budget pre-checks. New endpoint on the proxy: `POST /v1/mcp/track`. Cost
events logged with `provider: "mcp"`, `model: tool_name`. Shared Redis
budget pool — an agent's LLM calls and tool calls draw from the same
budget. This is the feature nobody else offers at our price point.

**Market timing note:** The MCP spec is still evolving. Option C (stdio
proxy modification) is low-risk because it builds on our existing MCP proxy
code. But this implementation may need to adapt as the spec stabilizes. We
accept this trade-off to ship MCP tracking early while competitors don't
have it.

**Reference:** `docs/technical-outlines/mcp-tool-tracking/MCP tool cost tracking.md`

---

### Phase 8: Cryptographic Cost Receipts — Kill Receipts (month 1-2)

Every time the proxy blocks a request or an agent exhausts its budget,
generate a signed, tamper-evident receipt. Ed25519 signature on the event
chain — request ID, model, estimated cost, budget state, timestamp,
decision (blocked/allowed). Chain-hashed per agent so the complete spend
history is provably unmodified. Public receipt viewer at `/receipt/{id}`.

This is 2-3 days of engineering and it's our clearest differentiator —
complete whitespace in the market. No competitor does this. Immediate use
case: when a developer's agent gets blocked, they get a human-readable
post-mortem explaining exactly why, not just a 429. Enterprise use case:
auditable proof that budget controls were enforced, exportable for
compliance.

---

### Phase 9: Webhook Event Stream (month 2)

Expose every cost event as a real-time webhook to customer-configured
endpoints. This is the Lithic pattern — customers build their own
integrations (PagerDuty alerts, Slack bots, internal accounting) on top
of the event stream. We don't build every integration; we expose the
primitive. Low engineering cost (~2 days), high platform leverage.

This also enables the JIT authorization pattern — customer's endpoint
decides per-request whether to approve, deny, or modify. But that's an
advanced use case we document, not something we build UI for initially.

---

## The Direction (Phases 10-14)

These phases are reasonable bets. Timing and scope will be determined by
what real users ask for. The descriptions below capture intent, not
detailed specifications — those get written when a phase moves into the
build queue.

### Phase 10: Programmable Spend Policies (driven by user demand)

Move beyond "max budget = $50" to richer policy rules. Per-model
allowlists, velocity limits (max spend per minute), time-of-day
restrictions. This is the Marqeta differentiation — programmable
authorization, not just a number. Store policies in Postgres, evaluate in
the proxy before the budget check.

**Wait signal:** Don't build this until at least 100 active users have hit
the limits of simple dollar-amount budgets. The current STRICT_BLOCK with
a dollar cap covers 90% of use cases. Let real demand dictate what policy
features to build first.

**Reference:** `docs/unified-policy-engine-spec.md`

---

### Phase 11: Model Routing + BATS Budget Injection (driven by user demand)

Rule-based model downgrade: if a policy says "use gpt-4o-mini for requests
under 500 input tokens," the proxy rewrites the model field before
forwarding. BATS-style budget injection: when spend exceeds a threshold,
inject remaining budget into the system prompt so the agent self-optimizes.

**Opt-in only (Layer 1).** These features modify the request payload. They
are disabled by default, require explicit developer opt-in via dashboard
toggles, and are clearly documented about exactly what they change and why.
A developer who never enables these features sees zero difference in proxy
behavior.

---

### Phase 12: Agent Ledger Accounts + Analytics V2 (month 3-4)

Each API key gets a dedicated ledger page — balance, transaction history,
spend rate chart, budget utilization. Frame it as a "bank statement for the
agent." Add per-agent cost breakdown, cost-per-task metrics, model usage
efficiency scores. This is where "financial infrastructure for AI agents"
becomes tangible in the UI, not just positioning language.

---

### Phase 13: MCP Gateway — Option D, Streamable HTTP (month 4-5)

Build the remote MCP gateway on CF Workers. By this point the MCP spec
will be more stable (June 2026 spec release expected), client support for
Streamable HTTP will be broader, and we'll have real usage data from
Option C telling us what developers actually need. The gateway receives
MCP JSON-RPC over Streamable HTTP, forwards to upstream servers, tracks
cost/duration, enforces budgets. Developer config: one URL in their MCP
client settings.

**Depends on:** Phase 7 usage data and MCP spec stability. If Option C
meets user needs and the spec is still in flux, this phase gets deferred.

---

### Phase 14: Context Compression Integration (month 5-6)

Partner with Compresr or The Token Company, or build a lightweight
compression layer. Proxy middleware that strips context bloat before
forwarding to the LLM. Enables a percentage-of-savings revenue model —
"we saved you $4,000 this month, our fee is 10%."

**Opt-in only (Layer 1).** This modifies the request payload. Disabled by
default, requires explicit developer opt-in, with clear documentation
about what is being compressed and how it affects model behavior.

---

### Phase 15: Enterprise + Open Core Split (month 6-8)

Create the `ee/` directory. SSO/SCIM, team/org budget hierarchy, compliance
audit logs with cryptographic tamper evidence, role-based access control.
This is the PostHog open-core model. The proxy stays Apache 2.0, enterprise
features are commercial license. Also build agent risk scores (reliability
score per API key based on budget compliance, cost predictability, error
rate) and anomaly detection (recursive loop detection, spend velocity
alerts). These features require the data volume we'll have by this point.

---

## The Vision (Phases 16-22)

These phases represent the long-term trajectory. They exist to inform
architectural decisions today, give investors confidence in the path, and
ensure we don't close off future options. They are not commitments. Any of
them could be reprioritized, transformed, or dropped based on what we learn
from real users.

### Phase 16: Agent Spend Intelligence

Once processing millions of cost events across thousands of organizations,
build intelligence on top of the data. Anomaly detection (recursive loops
before they hit $47K), cost benchmarking ("your agent costs $0.12/task,
median is $0.04"), model recommendation ("switch 60% of calls to save
$400/month"), forecasting ("Agent B exhausts budget by March 22"). Start
with SQL-driven heuristics and graduate to ML when data volume warrants it.

### Phase 17: Compliance Frameworks

**SOC 2 Type II** — first enterprise compliance milestone. Cryptographic
receipts + audit logs + budget enforcement already provide most control
evidence. 3-6 month process.

**HIPAA** — the proxy already doesn't store prompt content (only token
counts, model names, costs). Need BAA with Supabase/Upstash, encryption
attestations, access logging.

**EU AI Act** — by 2027, relevant for European customers. Audit trails
and enforcement proof map to governance requirements.

### Phase 18: Multi-Tenant Isolation + Team Hierarchies

Organization → team → user → agent budget hierarchies where each level
inherits and constrains the level below. Team A gets $500/month, User 1
gets $100/month, Agent X gets $25/day. Redis Lua scripts already check all
entity budgets independently — extending to deeper hierarchies is evolution,
not rewrite.

### Phase 19: Agent Identity + Access Control

Verifiable identity credentials for agents. Cryptographic identity
certificates tied to API keys. Enables access control (Agent X uses gpt-4o,
Agent Y restricted to gpt-4o-mini), cross-agent delegation tracking, and
integration with Visa's Trusted Agent Protocol / Mastercard's Agent Pay.
Bridge between internal FinOps and external agent commerce.

### Phase 20: Agent Marketplace Infrastructure

If agents have identity, budgets, and verifiable cost histories — build
the financial infrastructure for agents transacting with each other. Agent
A discovers Agent B, negotiates price, escrows payment through NullSpend,
releases on verified completion. "Stripe for the agent economy" end state.

### Phase 21: Embedded FinOps

Stop making developers come to a dashboard. VS Code/Cursor extension,
CLI tool (`nullspend status`), git hook for cost impact, CI/CD gate, Slack
bot with daily digests. The best financial infrastructure is invisible.

### Phase 22: Self-Hosted Enterprise Deployment

Docker Compose for proxy + Redis + Postgres. Helm charts for Kubernetes.
The Plausible Analytics model — some enterprises will never send data to a
hosted service. The open-source proxy already works self-hosted; this phase
packages it with the dashboard and configuration management.

---

## The Narrative Arc

**Phases 5-9 (The Plan):** Developer tool — "change your base URL, see
your costs, set your budgets, get cryptographic receipts."

**Phases 10-15 (The Direction):** Platform — "programmable policies, model
optimization, agent ledgers, enterprise features." Shaped by user demand.

**Phases 16-22 (The Vision):** Financial infrastructure — "intelligence,
compliance, identity, marketplace rails, embedded FinOps." Shaped by
market evolution.

Each phase is fundable on its own merits. Seed pitch is the developer tool
with a credible path to enterprise platform. The broader vision is what
demonstrates the size of the opportunity.

**What ultimately defines us:** The users and developers who route through
the proxy. Their feedback shapes what gets built, when, and how. The
principles (trust, transparency, security, simplicity) stay constant. The
features and priorities adapt.

---

## Decisions log

| Decision | Choice | Rationale |
|---|---|---|
| Proxy runtime | Cloudflare Workers | <1ms cold start, 100MB body limit, waitUntil, passThroughOnException. Vercel's 5MB limit is disqualifying. |
| Budget state store | Durable Objects (SQLite) | Co-located with Worker, race-condition-resistant, ~17ms p50 overhead |
| Cost precision | Microdollars (integers) | Avoids floating point errors in financial calculations |
| Launch providers | OpenAI + Anthropic only | Covers vast majority of agent developers. Add others post-launch based on demand. |
| Auth model | BYOK (pass-through) first | Provider keys never stored. Lowest friction. Vault mode is post-launch. |
| Dashboard hosting | Vercel (existing) | Keep the Next.js app where it is. Dashboard ≠ proxy — different latency requirements. |
| License | Apache 2.0 (proxy), proprietary (dashboard SaaS) | Following Helicone's model. Max adoption for proxy, monetize via dashboard. |
| Existing approval code | Preserve but deprioritize | Don't delete — may become a feature within FinOps. But don't invest in it now. |
| MCP approach | Option C first, Option D later | Option C (stdio proxy mod) ships in weeks. Option D (Streamable HTTP gateway) waits for spec stability. |
| Open core split | Phase 15, not sooner | Build the free user base first. Enterprise features require data volume. |
| Payload-modifying features | Opt-in only (Layer 1) | Model routing, budget injection, compression all require explicit developer opt-in. Default proxy behavior never touches payloads. |
| Kill receipts timing | Phase 8 (early) | 2-3 days of work, maximum differentiation. Complete whitespace — no competitor does this. Ship before policies or optimization. |
| Post-launch prioritization | User-feedback-driven | Phases 10+ scope and timing determined by what real users ask for, not by a predetermined calendar. |
| Helicone migration | Elevated to Phase 5 critical path | Helicone acquired by Mintlify (Mar 3, 2026), 16K orgs orphaned. Time-sensitive acquisition channel. Same proxy integration model = easy migration narrative. |
| Pricing model | Usage-based tiers (proxied spend caps) | Free ($1K/mo spend), Pro $49/mo ($50K), Team $199/mo ($250K), Enterprise custom. Natural unit is proxied spend. Flat rate per tier avoids "percentage tax" misalignment. Matches Portkey Pro price but includes budget enforcement. See Pricing Model section above. |
| Primary competitive position | "Budget enforcement at startup pricing" | Portkey gates enforcement behind enterprise. LiteLLM requires self-hosting. We offer enforcement at $49 (or usage-based) with zero infrastructure. This is the wedge. |
