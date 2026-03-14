# NullSpend

**The FinOps layer for AI agents.** Track every dollar your agents spend on LLM
tokens, enforce hard budget ceilings, and get the receipts to prove it.

## The problem

AI agents call LLMs autonomously, at scale, across multiple providers. Without
real-time cost controls, a misconfigured loop or runaway agent can burn through
thousands of dollars before anyone notices. Existing tools either gate budget
enforcement behind enterprise pricing (Portkey), require Docker + Postgres +
Redis + YAML to self-host (LiteLLM), or just exited the market entirely
(Helicone → acquired by Mintlify, March 2026).

## The fix: one environment variable

```bash
# Before
OPENAI_BASE_URL=https://api.openai.com/v1

# After
OPENAI_BASE_URL=https://proxy.nullspend.com/v1
```

That's it. Your existing code, existing SDK, existing streaming — all works
identically. No package to install, no client to wrap, no config files. One
environment variable and you have cost tracking + budget enforcement.

Works the same for Anthropic:

```bash
# Before
ANTHROPIC_BASE_URL=https://api.anthropic.com

# After
ANTHROPIC_BASE_URL=https://proxy.nullspend.com/anthropic
```

## What you get

- **Real-time cost tracking** — every request logged with model, tokens, cost
  in microdollars, and provider attribution
- **Hard budget enforcement** — set spending ceilings per API key. The proxy
  blocks requests that would exceed the budget. No soft limits, no warnings —
  hard stops.
- **Multi-provider support** — OpenAI and Anthropic today, more coming based on
  demand
- **Zero latency overhead** — the proxy streams responses through as they
  arrive; cost calculation happens asynchronously
- **Dashboard** — analytics, per-model and per-key cost breakdown, daily spend
  charts, activity log

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                   Developer / Agent                       │
│  Uses OpenAI/Anthropic SDK with base URL → NullSpend     │
└────────────┬─────────────────────────────────────────────┘
             │ LLM API calls (unchanged)
             ▼
┌──────────────────────────────┐
│  NullSpend Proxy             │
│  (Cloudflare Workers)        │
│  Stream → tee → log          │
│  Budget check (Upstash Redis)│
│  Cost calc per provider      │
└────────────┬─────────────────┘
             │
             ▼
┌──────────────────────────────────────────────────────────┐
│  Supabase Postgres — cost ledger, budgets, API keys      │
│  Upstash Redis — atomic budget state (Lua scripts)       │
└────────────┬─────────────────────────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────────────────────┐
│  Dashboard (Next.js on Vercel)                            │
│  Analytics · Activity · Budgets · Settings · API Keys    │
└──────────────────────────────────────────────────────────┘
```

## Quickstart

1. **Sign up** at [nullspend.com](https://nullspend.com) and create an API key
   in Settings
2. **Point your SDK at the NullSpend proxy** and add the auth header:
   ```typescript
   const client = new OpenAI({
     baseURL: "https://proxy.nullspend.com/v1",
     defaultHeaders: {
       "X-NullSpend-Auth": process.env.PLATFORM_AUTH_KEY,
     },
   });
   ```
   Your real OpenAI/Anthropic API key stays unchanged — pass it as usual.
3. **Run your agent** — costs appear in the dashboard within seconds

## Pricing

| Tier | Monthly Price | Proxied Spend Cap | Budgets | Retention |
|---|---|---|---|---|
| **Free** | $0 | $1,000/mo | 1 | 7 days |
| **Pro** | $49/mo | $50,000/mo | Unlimited | 30 days |
| **Team** | $199/mo | $250,000/mo | Unlimited | 90 days |
| **Enterprise** | Custom | Unlimited | Unlimited | Custom |

Zero markup on LLM API calls. The proxy is pass-through on pricing — we charge
for the metering, enforcement, and intelligence layer, never for the tokens.

## Competitive comparison

| Feature | NullSpend | Portkey | LiteLLM |
|---|---|---|---|
| Setup | 1 env var | 1 env var | Docker + PG + Redis + YAML |
| Budget enforcement | All tiers | Enterprise only | Self-hosted only |
| Pricing | From $0 | From $49 | Free (OSS) + support tiers |
| Infrastructure | Hosted | Hosted | Self-managed |
| Open issues | — | — | 800+ |

## Project structure

```
apps/proxy/        Cloudflare Worker — the LLM proxy
app/               Next.js dashboard (routes, layouts, API handlers)
components/        UI components (shadcn/ui)
lib/               Business logic, DB, auth, validations, cost engine
packages/
  cost-engine/     Shared pricing data and cost calculation
  db/              Drizzle ORM schema and queries
  sdk/             @nullspend/sdk — TypeScript client (approval layer)
  mcp-server/      @nullspend/mcp-server — MCP server adapter
  mcp-proxy/       @nullspend/mcp-proxy — MCP tool gating proxy
drizzle/           Schema migrations
docs/              Architecture, roadmap, competitive analysis
```

## Development

Prerequisites: Node 18+, pnpm.

```bash
git clone https://github.com/cjones6489/AgentSeam.git
cd AgentSeam
pnpm install
cp .env.example .env.local  # fill in credentials
pnpm db:push                # push schema to Supabase
pnpm dev                    # start dashboard dev server
```

For the proxy:

```bash
cd apps/proxy
cp .dev.vars.example .dev.vars  # fill in provider keys
npx wrangler dev                # start proxy dev server
```

## Commands

| Command | Description |
|---|---|
| `pnpm dev` | Start the dashboard dev server |
| `pnpm build` | Production build (db + Next.js) |
| `pnpm test` | Run unit tests (Vitest) |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | TypeScript type check |
| `pnpm db:push` | Push Drizzle schema to Supabase |
| `pnpm db:generate` | Generate Drizzle migrations |
| `pnpm db:studio` | Open Drizzle Studio |

## Stack

- **Proxy:** Cloudflare Workers (TypeScript)
- **Dashboard:** Next.js App Router on Vercel
- **Database:** Supabase Postgres via Drizzle ORM
- **Budget state:** Upstash Redis (atomic Lua scripts)
- **UI:** Tailwind CSS + shadcn/ui
- **Validation:** Zod
- **Package manager:** pnpm

## Documentation

- [docs/finops-pivot-roadmap.md](docs/finops-pivot-roadmap.md) — master roadmap
- [docs/competitive-landscape-march-2026.md](docs/competitive-landscape-march-2026.md) — competitive analysis
- [docs/finops-pivot-tech-audit.md](docs/finops-pivot-tech-audit.md) — technology audit
- [docs/architecture.md](docs/architecture.md) — system architecture

## License

Private — not yet open source.
