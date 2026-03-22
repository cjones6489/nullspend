# Open-Source Migration Plan

Working document for restructuring NullSpend as an open-core project. Covers strategy, licensing, codebase changes, and implementation roadmap.

**Status:** Planning
**Last updated:** 2026-03-21

---

## Table of Contents

1. [Strategy & Business Model](#1-strategy--business-model)
2. [Market Research & Precedents](#2-market-research--precedents)
3. [Licensing](#3-licensing)
4. [Codebase Audit](#4-codebase-audit)
5. [Open vs Paid Split](#5-open-vs-paid-split)
6. [Implementation Phases](#6-implementation-phases)
7. [Self-Hosting Architecture](#7-self-hosting-architecture)
8. [Revenue Model](#8-revenue-model)
9. [Open Questions](#9-open-questions)
10. [References](#10-references)

---

## 1. Strategy & Business Model

### Model: Open Core + Managed Hosting

Following the PostHog/LiteLLM/Infisical model:

- **Core product is MIT-licensed** — drives adoption, builds trust, enables community
- **Enterprise features in `ee/` directory** — proprietary license, requires license key for production use
- **Managed hosting is the primary revenue** — NullSpend Cloud handles infrastructure so teams don't have to
- **Self-hosting is a distribution channel, not a revenue center** — gets us into organizations that evaluate before buying

### Why This Model

1. **LiteLLM has 18K GitHub stars** doing a worse version of what we do. Open source is the distribution moat.
2. **Zero users today.** We need adoption before revenue. MIT core removes all friction.
3. **Enterprise features (SSO, RBAC, audit logs) are natural paywalls** that don't degrade the core product.
4. **PostHog learned the hard way:** paid self-hosting consumed engineering resources for 3.5% of users. They killed it and focused on Cloud. We should skip that phase entirely.

### Key Principle

> Self-hosters get the full core product. Cloud customers get convenience + enterprise governance. Never move a free feature to paid.

---

## 2. Market Research & Precedents

### How Comparable Companies Structure Open Core

| Company | Core License | Paid Code | Separation | Enterprise Gate | Self-Host | Revenue Signal |
|---------|-------------|-----------|------------|-----------------|-----------|----------------|
| **PostHog** | MIT | Proprietary (`ee/`) | `ee/` dir in monorepo | SSO, RBAC, audit logs, compliance | Docker Compose (hobby only) | ~$100M+ ARR target |
| **LiteLLM** | MIT | Proprietary (`enterprise/`) | `enterprise/` dir in monorepo | SSO, SCIM, audit logs, guardrails | Full (license key) | $1-10M est. |
| **GitLab** | MIT | Proprietary (`ee/`) | `ee/` dir + module prepending | Security, compliance, AI features | Full (license key) | $491M rev |
| **Infisical** | MIT | Proprietary (`ee/`) | `ee/` dir in monorepo | SSO, RBAC, audit logs, compliance | Full (license key env var) | $1.7M rev |
| **Cal.com** | AGPL-3.0 | Proprietary (`/packages/features/ee`) | `/ee` dir in turborepo | "Multiplayer" team/org features | Full (license key) | $5.1M rev |
| **Sentry** | FSL → Apache-2.0 | Same code, SaaS pricing | None — single edition | Hosted SaaS vs self-managed | Full (unsupported) | $3B+ valuation |
| **Lago** | AGPL-3.0 | None (support/hosting) | None — fully open | Support tier + managed hosting | Full (all features free) | $22M raised |

### Key Patterns

1. **MIT + `ee/` directory is the dominant model** — used by PostHog, LiteLLM, GitLab, Infisical
2. **Features that consistently gate paid tiers:** SSO/SAML, RBAC, audit logs, compliance certs, team/org management
3. **Usage-based pricing beats per-seat** — removes friction, grows with customer success
4. **Self-hosting via Docker Compose** is the standard — keep it simple, don't try to support K8s
5. **PostHog maintains a FOSS mirror** (`posthog-foss`) that strips `ee/` automatically — useful for license-sensitive adopters

### PostHog Lessons (from their public writing)

- None of the multi-billion-dollar open-source companies monetized in the first five years
- Open source is great for distribution but bad for direct monetization
- They tried enterprise plans, paid self-hosted, and cloud — settled on cloud as sustainable
- 90%+ of companies use PostHog completely free; revenue comes from expansion of the 10%
- Killing K8s self-hosting was the right call — engineering cost was disproportionate to revenue

### Infisical Lesson

- Started as closed-source SaaS, struggled with traction
- YC partner Dalton Caldwell told them: "This thing is not working. What IP rights are you talking about? Just do it."
- Going open source was the pivotal decision — 20x revenue growth YoY after open-sourcing
- License key as env var (`LICENSE_KEY`) is simple and effective

### Cal.com Heuristic

- "Singleplayer vs multiplayer" determines what's free vs paid
- Individual-use features are open; team/org features are enterprise
- For NullSpend: single-agent cost tracking = free, multi-team governance = paid

---

## 3. Licensing

### Decision: MIT + Proprietary `ee/`

| Directory | License | Rationale |
|-----------|---------|-----------|
| Everything outside `ee/` | MIT | Maximum adoption, no friction, enterprise-friendly |
| `ee/` | Proprietary source-available | Can read/modify for development; production use requires license key |

### Why Not AGPL

- Scares enterprise legal teams with blanket anti-AGPL policies
- Cal.com and Lago use it successfully, but they're SaaS products — our SDK/proxy gets embedded in customer infrastructure, which makes AGPL more problematic
- MIT is the safe choice for a proxy that sits in customers' request paths

### Why Not BSL/FSL

- Controversial in the developer community (HashiCorp backlash)
- Sentry's FSL works for them because they're already established
- As a new project, we need maximum community trust

### License Files Needed

1. `LICENSE` (root) — MIT
2. `ee/LICENSE` — Proprietary source-available

### Proprietary `ee/LICENSE` Template

Based on PostHog and Infisical precedents:

```
NullSpend Enterprise Edition License

Copyright (c) 2026 NullSpend

Permission is hereby granted to any person obtaining a copy of this
software to copy and modify the software for development and testing
purposes only.

Production use of this software requires a valid NullSpend Enterprise
license agreement. Contact sales@nullspend.com for licensing.

It is forbidden to copy, merge, publish, distribute, sublicense,
and/or sell copies of the Software for production use without a
valid license agreement.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
```

---

## 4. Codebase Audit

### Current Structure

```
nullspend/
├── app/                    # Next.js 16 dashboard (pages + API routes)
│   ├── (auth)/             # Login/signup (Supabase-coupled)
│   ├── (dashboard)/        # Dashboard pages
│   └── api/                # API routes (keys, budgets, actions, cost-events, stripe, webhooks)
├── apps/proxy/             # Cloudflare Workers proxy
│   ├── src/lib/            # Core logic (cost calc, budget, auth, parsing)
│   ├── src/routes/         # Route handlers (OpenAI, Anthropic, MCP, internal)
│   ├── src/durable-objects/ # DO-backed budget enforcement
│   └── src/__tests__/      # 68 test files, ~1,161 tests
├── packages/
│   ├── cost-engine/        # Pricing catalog + calculation (zero deps)
│   ├── db/                 # Drizzle schema (pure Postgres)
│   ├── sdk/                # Client SDK (zero deps)
│   ├── claude-agent/       # Claude Agent SDK adapter
│   ├── mcp-server/         # MCP server
│   └── mcp-proxy/          # MCP proxy
├── lib/                    # Dashboard shared utilities
│   ├── auth/               # Supabase auth (tightly coupled)
│   ├── stripe/             # Stripe billing (hosted-only)
│   ├── db/                 # Database client
│   ├── webhooks/           # Webhook dispatch
│   └── ...
├── components/             # React dashboard UI
├── drizzle/                # SQL migrations (21 files)
└── proxy.ts                # Next.js 16 proxy (Supabase auth middleware)
```

### Infrastructure Coupling Assessment

| Dependency | Coupling | Scope | Notes |
|-----------|---------|-------|-------|
| **Postgres** | Loose | Dashboard + Proxy | Any Postgres works (Supabase, RDS, Cloud SQL, local) |
| **Supabase Auth** | Tight | Dashboard only | `resolveSessionUserId()`, login/signup, middleware |
| **Stripe** | Tight | Dashboard only | Billing, subscriptions, tier enforcement |
| **Cloudflare Workers** | Moderate | Proxy only | HYPERDRIVE, KV, Durable Objects, Queues, Analytics Engine |
| **Upstash Redis** | Moderate | Proxy + Dashboard | Budget caching, rate limiting, webhook cache |
| **QStash** | Light | Proxy only | Async webhook delivery (optional) |

### What's Already Infrastructure-Agnostic

| Component | Dependencies | Status |
|-----------|-------------|--------|
| `packages/cost-engine` | Zero | Publish as-is to npm |
| `packages/sdk` | Zero | Publish as-is to npm |
| `packages/claude-agent` | `@anthropic-ai/sdk` only | Publish as-is to npm |
| `packages/db` | `drizzle-orm` only | Drop RLS policies for plain Postgres |
| Proxy cost calculation logic | `@nullspend/cost-engine` | Portable |
| Proxy SSE parsers | None | Portable |
| Proxy request/response utils | None | Portable |
| Proxy auth (API key lookup) | Postgres | Portable |

### What Needs Abstraction

| Component | Current Coupling | Required Change |
|-----------|-----------------|-----------------|
| Dashboard auth | Supabase `auth.getUser()` | `AuthProvider` interface |
| Dashboard billing | Stripe API | `BillingProvider` interface (or remove for OSS) |
| Dashboard middleware | Supabase session check | Pluggable auth check |
| Login/signup pages | Supabase UI | Generic auth flow |
| RLS policies | `auth.uid()::text` | Drop for plain Postgres |
| `subscriptions` table | Stripe IDs | Optional — exclude from OSS schema |

### Secrets Audit

No hardcoded secrets found. All credentials are externalized via env vars. Safe to open-source.

Checked: `.env.example`, `.dev.vars.example`, `.env.smoke.example` — all placeholder templates with no real values.

---

## 5. Open vs Paid Split

### Open Source (MIT)

Everything needed to run NullSpend as a single-team cost tracking and budget enforcement tool:

**Proxy Core:**
- OpenAI and Anthropic request proxying
- Cost calculation (all models, cache tokens, reasoning tokens)
- Budget enforcement (hard limits, period reset)
- Velocity limits (rate-of-spend detection)
- Session limits
- Tag-based attribution
- SSE stream parsing and cost extraction
- Webhook notifications (threshold crossings, budget exceeded, request blocked)
- API key authentication
- W3C traceparent propagation
- Cost event logging

**Packages:**
- `@nullspend/cost-engine` — pricing catalog and calculation
- `@nullspend/db` — Drizzle schema and migrations
- `@nullspend/sdk` — client SDK
- `@nullspend/claude-agent` — Claude Agent SDK adapter
- `@nullspend/mcp-server` — MCP server
- `@nullspend/mcp-proxy` — MCP proxy

**Dashboard:**
- Cost event activity feed
- Analytics and charts
- Budget management UI
- API key management
- Webhook configuration
- Single-user or single-team usage

**Infrastructure:**
- Docker Compose for self-hosting
- Cloudflare Workers deployment for proxy
- Plain Postgres support (no Supabase required)

### Paid Enterprise (`ee/`)

Features that organizations need but individual developers and small teams don't:

**Authentication & Access:**
- SSO / SAML integration
- SCIM user provisioning
- RBAC — granular permissions for who can manage budgets, view costs, approve actions

**Governance:**
- Audit logs with configurable retention
- Org/team hierarchy — nested budgets, inherited policies
- Approval workflows — multi-level HITL chains
- Compliance exports

**Advanced Analytics:**
- Cross-team cost attribution and reporting
- Custom dashboards and alerting rules
- Cost anomaly detection
- Budget forecasting

**Managed Cloud Extras:**
- Managed hosting (no infrastructure to run)
- Automatic upgrades
- Premium support
- SLA guarantees
- Higher rate limits and data retention

### Decision: HITL Approval Workflows

Open question: should basic HITL (propose → approve → execute) be in core or `ee/`?

**Argument for core:** It's a key differentiator, and keeping it open drives adoption. Single-agent approval is "singleplayer."
**Argument for `ee/`:** Multi-level approval chains, team-based routing, and escalation policies are enterprise features.

**Recommended split:** Basic HITL (single approver) in core. Multi-level chains and team routing in `ee/`.

---

## 6. Implementation Phases

### Phase 0: Structural Prep (Low effort, do first)

- [ ] Create `ee/` directory at repo root
- [ ] Add `LICENSE` (MIT) to repo root
- [ ] Add `ee/LICENSE` (proprietary source-available) to `ee/`
- [ ] Add `CONTRIBUTING.md` with DCO or CLA guidance
- [ ] Add `.github/ISSUE_TEMPLATE/` and `.github/PULL_REQUEST_TEMPLATE.md`
- [ ] Update `README.md` for open-source audience (what it does, quickstart, architecture diagram)
- [ ] Add `SECURITY.md` (vulnerability disclosure policy)
- [ ] Audit all files for hardcoded `nullspend.com` references — make configurable

### Phase 1: Auth Abstraction (Medium effort)

Abstract Supabase auth so the dashboard works with any auth provider.

- [ ] Define `AuthProvider` interface in `lib/auth/types.ts`:
  ```typescript
  interface AuthProvider {
    resolveUserId(request: Request): Promise<string | null>;
    getUser(request: Request): Promise<User | null>;
    signOut(request: Request): Promise<void>;
  }
  ```
- [ ] Create `SupabaseAuthProvider` implementing the interface (current behavior)
- [ ] Create `DevAuthProvider` for local development (extends current dev mode fallback)
- [ ] Wire auth provider selection via env var: `AUTH_PROVIDER=supabase|dev|custom`
- [ ] Update `proxy.ts` (Next.js middleware) to use the interface
- [ ] Update all `resolveSessionUserId()` call sites to use the interface
- [ ] Document how to implement a custom `AuthProvider` (Clerk, Auth0, etc.)

### Phase 2: Billing Abstraction (Medium effort)

Remove hard Stripe dependency so self-hosted instances work without billing.

- [ ] Define `BillingProvider` interface or make billing entirely optional
- [ ] Move Stripe-specific code to `lib/stripe/` (already there) and guard with env check
- [ ] When `STRIPE_SECRET_KEY` is not set, treat all users as "unlimited" tier
- [ ] Move `subscriptions` table to optional migration
- [ ] Update tier enforcement to fall back to no-limit when billing is disabled

### Phase 3: Database Portability (Low effort)

- [ ] Create `drizzle/oss/` migration set that excludes RLS policies and Supabase-specific SQL
- [ ] Document plain Postgres setup (create database, run migrations, connect)
- [ ] Make `subscriptions` table optional (only created when billing is enabled)
- [ ] Verify schema works with: plain Postgres 15+, Supabase, AWS RDS, Cloud SQL

### Phase 4: Self-Hosting Package (Medium effort)

- [ ] Create `docker-compose.yml` at repo root:
  - Postgres 15
  - Redis (or Valkey)
  - Dashboard (Next.js)
  - Migration runner (applies Drizzle migrations on startup)
- [ ] Create `Dockerfile` for dashboard
- [ ] Document proxy deployment options:
  - Option A: Deploy to own Cloudflare Workers account (recommended)
  - Option B: Future — generic Node.js runtime (lower priority)
- [ ] Create `.env.example` with all required vars documented
- [ ] Write self-hosting guide: `docs/self-hosting.md`

### Phase 5: Enterprise Feature Scaffolding (Medium effort)

- [ ] Create `ee/` directory structure:
  ```
  ee/
  ├── LICENSE
  ├── lib/
  │   ├── auth/          # SSO/SAML providers
  │   ├── rbac/          # Role-based access control
  │   ├── audit/         # Audit log system
  │   └── org/           # Org/team hierarchy
  └── README.md
  ```
- [ ] Implement license key validation:
  ```typescript
  // lib/license.ts
  function isEnterpriseEnabled(): boolean {
    return !!process.env.NULLSPEND_LICENSE_KEY;
  }
  ```
- [ ] Add runtime feature gates:
  ```typescript
  function requireEnterprise(feature: string): void {
    if (!isEnterpriseEnabled()) {
      throw new Error(`${feature} requires a NullSpend Enterprise license`);
    }
  }
  ```
- [ ] Guard `ee/` imports so the app works without them

### Phase 6: Documentation & Launch Prep

- [ ] `README.md` — project overview, architecture diagram, quickstart
- [ ] `docs/self-hosting.md` — Docker Compose setup, env vars, proxy deployment
- [ ] `docs/configuration.md` — all config options documented
- [ ] `docs/contributing.md` — how to contribute, code style, PR process
- [ ] `docs/architecture.md` — public version of internal architecture doc
- [ ] API documentation for proxy endpoints
- [ ] SDK documentation with examples
- [ ] Update `show-hn-draft.md` to reflect open-source angle

### Phase 7: Launch

- [ ] Final security audit of all code being published
- [ ] Remove any internal references, debug endpoints, or staging URLs
- [ ] Set up GitHub Actions for CI on public repo
- [ ] Publish npm packages: `@nullspend/cost-engine`, `@nullspend/sdk`, `@nullspend/claude-agent`
- [ ] Create GitHub releases with changelogs
- [ ] Show HN post
- [ ] Product Hunt launch (optional)

---

## 7. Self-Hosting Architecture

### Target: Docker Compose + Cloudflare Workers

```
┌─────────────────────────────────────────┐
│           Self-Hosted Stack              │
│                                          │
│  ┌──────────┐  ┌──────────┐             │
│  │ Dashboard │  │ Postgres │             │
│  │ (Next.js) │──│  15+     │             │
│  │ :3000     │  │  :5432   │             │
│  └──────────┘  └──────────┘             │
│       │              │                   │
│       │         ┌──────────┐             │
│       └─────────│  Redis   │             │
│                 │  :6379   │             │
│                 └──────────┘             │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│      Cloudflare (user's account)         │
│                                          │
│  ┌──────────┐  ┌──────────┐             │
│  │  Proxy   │  │ Durable  │             │
│  │ (Worker) │──│ Objects  │             │
│  │          │  │          │             │
│  └──────────┘  └──────────┘             │
│       │                                  │
│  ┌──────────┐  ┌──────────┐             │
│  │ Queues   │  │   KV     │             │
│  └──────────┘  └──────────┘             │
└─────────────────────────────────────────┘
         │
         ▼
   ┌──────────┐
   │  LLM     │
   │ Provider  │
   │ (OpenAI,  │
   │ Anthropic)│
   └──────────┘
```

### Why Not Docker for the Proxy?

The proxy uses Cloudflare-specific primitives that can't run in Docker:
- **Durable Objects** — stateful SQLite per budget entity (race-condition-resistant enforcement)
- **Cloudflare Queues** — cost event and reconciliation queues
- **Hyperdrive** — connection pooling for Postgres
- **KV** — edge caching
- **Analytics Engine** — latency metrics

Porting these to generic equivalents (Redis, SQS, plain connection pools) is possible but would degrade the enforcement guarantees that make NullSpend better than LiteLLM. **Don't port. Require Cloudflare Workers for the proxy.**

PostHog's lesson applies here: they killed K8s self-hosting because supporting diverse infrastructure consumed too much engineering time for too few users. We should learn from that and not try to be platform-agnostic on day one.

### Future: Generic Runtime (Phase 8+, only if demand warrants)

If significant demand exists for non-Cloudflare deployment:
- Replace Durable Objects with Redis + Lua scripts (we already have the Lua scripts from pre-DO era)
- Replace Cloudflare Queues with BullMQ or SQS
- Replace Hyperdrive with pgBouncer
- Replace KV with Redis
- Package as Docker container

This is a major effort. Don't do it speculatively.

---

## 8. Revenue Model

### Pricing Approach: Usage-Based

Following PostHog's model — no per-seat pricing, meter on natural usage dimensions:

| Dimension | Free Tier | Paid |
|-----------|-----------|------|
| Proxy requests / month | 100K | Usage-based |
| Cost events stored | 30-day retention | 90-day / 1-year |
| Active budgets | 10 | Unlimited |
| Webhook endpoints | 3 | Unlimited |
| API keys | 5 | Unlimited |

### Paid Tiers (Draft)

| Tier | Price | Includes |
|------|-------|----------|
| **Free** | $0 | Core product, 100K requests/mo, 30-day retention, community support |
| **Pro** | ~$49/mo + usage | Higher limits, 90-day retention, email support |
| **Team** | ~$199/mo + usage | Team features, 1-year retention, priority support |
| **Enterprise** | Custom | SSO, RBAC, audit logs, compliance, dedicated support, SLA |

### Why Usage-Based

- **Removes adoption friction** — no budget approval needed to start
- **Revenue grows with customer success** — more agents = more spend = more NullSpend usage
- **PostHog data point:** median customer increases spending 3x within 18 months
- **Aligns incentives** — we only make money when the product is actively providing value

---

## 9. Open Questions

### Strategic

- [ ] **Repo: rename or keep?** Current repo is `AgentSeam`. Do we rename to `nullspend` for the public repo?
- [ ] **GitHub org:** Create `nullspend` org on GitHub?
- [ ] **CLA vs DCO:** Do we require a Contributor License Agreement (like GitLab) or Developer Certificate of Origin (like Linux kernel)? CLA is stronger for commercial licensing but adds friction.
- [ ] **FOSS mirror:** Should we maintain a separate `nullspend-foss` repo (like PostHog) that strips `ee/`? Or is it overkill at our stage?
- [ ] **When to launch:** Before or after first paying customer? PostHog says adoption first, monetization later. But Infisical went open-source specifically to get traction.

### Technical

- [ ] **Auth abstraction depth:** Do we support pluggable auth providers from day one, or ship with Supabase + dev mode only and add more later?
- [ ] **Proxy deployment:** Require Cloudflare Workers, or invest in a Docker-based alternative? (Recommendation: require CF Workers, don't port speculatively.)
- [ ] **npm package scoping:** Keep `@nullspend/*` or use unscoped names for discoverability?
- [ ] **Monorepo tooling:** Stay with pnpm workspaces or add Turborepo for better caching/parallelism?
- [ ] **CI for public repo:** Mirror existing GitHub Actions or set up fresh?

### Legal

- [ ] **Trademark:** Register "NullSpend" before open-sourcing
- [ ] **License review:** Have a lawyer review the `ee/LICENSE` text
- [ ] **Patent clause:** Include explicit patent grant in MIT license? (Standard MIT doesn't include one; Apache-2.0 does)

---

## 10. References

### PostHog

- [How we monetized our open source devtool](https://posthog.com/blog/open-source-business-models)
- [The hidden benefits of being an open-source startup](https://newsletter.posthog.com/p/the-hidden-benefits-of-being-an-open)
- [The companies that shaped PostHog](https://newsletter.posthog.com/p/the-companies-that-shaped-posthog)
- [Sunsetting Kubernetes support](https://posthog.com/blog/sunsetting-helm-support-posthog)
- [How we got our first 1,000 users](https://posthog.com/founders/first-1000-users)
- [PostHog Handbook](https://posthog.com/handbook)
- [PostHog GitHub](https://github.com/PostHog/posthog)
- [PostHog FOSS mirror](https://github.com/PostHog/posthog-foss)
- [PostHog ee/ License](https://github.com/PostHog/posthog/blob/master/ee/LICENSE)

### LiteLLM

- [LiteLLM GitHub](https://github.com/BerriAI/litellm)
- [Enterprise Features](https://docs.litellm.ai/docs/proxy/enterprise)
- [Budget & Spend Tracking](https://docs.litellm.ai/docs/proxy/users)
- [Pricing Guide](https://www.truefoundry.com/blog/litellm-pricing-guide)

### Other Precedents

- [GitLab Single Codebase Blog](https://about.gitlab.com/blog/a-single-codebase-for-gitlab-community-and-enterprise-edition/)
- [GitLab EE Features Guidelines](https://docs.gitlab.com/development/ee_features/)
- [Infisical GitHub](https://github.com/Infisical/infisical)
- [Infisical Enterprise Self-Hosting](https://infisical.com/docs/self-hosting/ee)
- [Cal.com AGPL Blog](https://cal.com/blog/changing-to-agplv3-and-introducing-enterprise-edition)
- [Lago AGPL Blog](https://getlago.com/blog/open-source-licensing-and-why-lago-chose-agplv3)
- [Sentry FSL Introduction](https://blog.sentry.io/introducing-the-functional-source-license-freedom-without-free-riding/)

### Market Context

- [FinOps for AI Overview](https://www.finops.org/wg/finops-for-ai-overview/)
- [10 Tools for LLM Cost Management 2026](https://www.stackspend.app/resources/blog/10-tools-llm-cost-management-2026)
- [The $400M Cloud Leak: Why 2026 is the Year of AI FinOps](https://analyticsweek.com/finops-for-agentic-ai-cloud-cost-2026/)
- [YC W26 Batch Directory](https://www.ycombinator.com/companies?batch=Winter+2026)
- [Respan (Keywords AI) on YC](https://www.ycombinator.com/companies/respan)
