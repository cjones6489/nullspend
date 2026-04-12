# NullSpend

**Stop your AI agents from burning money.** Real-time cost tracking, hard budget
enforcement, and per-request receipts — one environment variable, zero code
changes.

---

## The problem

A developer watched their agent burn **$47,000 in a single weekend** on runaway
GPT-4 calls. They didn't know until the invoice hit.

AI agents call LLMs autonomously, at scale, across providers. Without real-time
cost controls, a misconfigured loop or hallucinating agent racks up thousands in
minutes. Your options today:

- **Portkey** — budget enforcement gated behind enterprise pricing
- **LiteLLM** — Docker + Postgres + Redis + YAML to self-host ($7M ARR, 800+
  open issues)
- **Helicone** — acquired by Mintlify (March 2026), entering maintenance mode.
  16,000 organizations orphaned.

## The fix

```bash
# Change one environment variable
OPENAI_BASE_URL=https://proxy.nullspend.dev/v1
```

That's it. Your existing code, existing SDK, existing streaming — all works
identically. No packages to install, no clients to wrap, no config files.

Works the same for Anthropic:

```bash
ANTHROPIC_BASE_URL=https://proxy.nullspend.dev/v1
```

## Setup (5 minutes)

### 1. Sign up and create an API key

Go to [nullspend.dev](https://nullspend.dev), sign up, and create an API key in
**Settings**.

### 2. Point your SDK at NullSpend

```typescript
// OpenAI — Node.js
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://proxy.nullspend.dev/v1",
  defaultHeaders: {
    "X-NullSpend-Key": process.env.NULLSPEND_API_KEY,
  },
});

// Everything else stays the same
const response = await client.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Hello" }],
});
```

```python
# OpenAI — Python
from openai import OpenAI

client = OpenAI(
    base_url="https://proxy.nullspend.dev/v1",
    default_headers={
        "X-NullSpend-Key": os.environ["NULLSPEND_API_KEY"],
    },
)
```

```typescript
// Anthropic — Node.js
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  baseURL: "https://proxy.nullspend.dev/v1",
  defaultHeaders: {
    "X-NullSpend-Key": process.env.NULLSPEND_API_KEY,
  },
});
```

Your real provider API key stays unchanged — pass it as usual.

### 3. Set a budget

In the dashboard, go to **Budgets** and set a spending ceiling (e.g.,
$50/month). When the budget is hit, the proxy returns a `429` with a clear error
explaining why. Your agent gets a standard HTTP error — no special handling
needed.

### 4. See your costs

Open the [dashboard](https://nullspend.dev/app/analytics). Cost events appear
within seconds — daily spend charts, per-model breakdown, per-key attribution.

## What you get

**Cost tracking** — Every request logged with provider, model, input/output/cached/reasoning
tokens, cost in microdollars, and duration. 45-model pricing catalog covers all
OpenAI and Anthropic models including GPT-4.1, o3, o4-mini, Claude Sonnet 4, and
Opus 4.

**Hard budget enforcement** — Per-user, per-API-key, and per-agent budgets with
configurable reset intervals (daily/weekly/monthly/yearly). Strict block, soft
block, or warn policies. Pre-request cost estimation blocks requests *before*
they hit the provider — not after the damage is done.

**Multi-provider** — OpenAI and Anthropic today. Gemini and others post-launch
based on demand.

**Zero overhead** — The proxy streams responses through as they arrive. Cost
calculation happens asynchronously after the stream completes. Your latency is
unchanged.

**Velocity limits** — Detect runaway agent loops in real time. Sliding window
cost-rate detection with automatic circuit breaker and cooldown. Webhook
notification when triggered and when recovered.

**Session limits** — Per-conversation spend caps tied to a session ID. Block a
single chat session from exceeding its allocation without affecting other sessions.

**Tags & tracing** — Attribute costs to teams, projects, or environments via
`X-NullSpend-Tags`. Correlate multi-call agent runs with W3C `traceparent` or
custom trace IDs.

**Team orgs** — Invite team members with role-based access (owner, admin, member,
viewer). Per-org billing, shared budgets, and feature gating by tier.

**Dashboard** — Analytics with daily spend trends, per-model and per-key
breakdown, provider comparison, activity log, and budget management. Webhook
notifications when budgets cross thresholds.

**Margins** — Connect Stripe to see per-customer profitability. Auto-match
Stripe customers to cost tags, track revenue vs AI cost, and get health tier
ratings (healthy/moderate/at-risk/critical). 3-month sparkline trends with
trajectory projection show where each customer is headed. Slack alerts fire
when a customer's margin crosses into a worse tier. CSV export for board decks.

**Slack integration** — Get notified on budget events and margin alerts. Approve
or reject human-in-the-loop actions directly from Slack.

**Request logging** — Opt-in capture of full request and response bodies for
debugging and audit (Pro/Enterprise). Both streaming (SSE) and non-streaming
responses are captured. Bodies are stored in R2 with a 1 MB cap per object.

**Security** — API keys SHA-256 hashed before storage. Timing-safe comparison.
RLS on all database tables. Rate limiting (per-IP and per-key). Nonce-based CSP.
91-point security audit completed.

## How it works

```
┌──────────────────────────────────────────────────────────────┐
│  Your Agent (existing code, unchanged)                        │
│  OPENAI_BASE_URL=https://proxy.nullspend.dev/v1              │
└──────────────┬───────────────────────────────────────────────┘
               │ Standard API calls
               ▼
┌──────────────────────────────────────────────────────────────┐
│  NullSpend Proxy (Cloudflare Workers, edge)                   │
│                                                               │
│  1. Authenticate (X-NullSpend-Key)                            │
│  2. Estimate cost → check budget → reserve                    │
│  3. Forward request to OpenAI / Anthropic                     │
│  4. Stream response back (zero modification)                  │
│  5. Calculate actual cost → reconcile budget                  │
│  6. Log cost event → dispatch webhooks                        │
└──────────────┬───────────────────────────────────────────────┘
               │
       ┌───────┴───────┐
       ▼               ▼
┌─────────────┐  ┌──────────────────┐
│  Supabase   │  │  Durable Objects │
│  Postgres   │  │  (SQLite)        │
│  (ledger)   │  │  (budget state)  │
└─────────────┘  └──────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────────┐
│  Dashboard (Next.js on Vercel)                                │
│  Analytics · Budgets · Margins · Activity · Webhooks · Keys  │
└──────────────────────────────────────────────────────────────┘
```

The proxy never modifies your requests or responses. It's a transparent
pass-through that meters and enforces. Your provider keys stay with you (BYOK).
Pro/Enterprise plans can opt in to request/response body logging for debugging —
bodies are stored in R2 with per-org retention policies.

## Pricing

| Tier | Price | Proxied Spend Cap | Budgets | Team Members | Retention | Request Logging |
|---|---|---|---|---|---|---|
| **Free** | $0/mo | $5,000/mo | 3 | 3 (viewers unlimited) | 30 days | -- |
| **Pro** | $49/mo | $50,000/mo | Unlimited | Unlimited | 90 days | Request/response bodies |
| **Enterprise** | Custom | Unlimited | Unlimited | Unlimited | Unlimited | Request/response bodies |

**Zero markup on LLM tokens.** We charge for the metering and enforcement layer,
never for the tokens themselves. Free tier requires no credit card.

## How we compare

| | NullSpend | Portkey | LiteLLM |
|---|---|---|---|
| **Setup** | 1 env var | 1 env var | Docker + PG + Redis + YAML |
| **Budget enforcement** | All tiers | Enterprise only | Self-hosted only |
| **Price** | From $0 | From $49 | Free (OSS) / enterprise |
| **Infrastructure** | Hosted | Hosted | Self-managed |
| **Identity-based budgets** | Yes | Enterprise | Yes |
| **Streaming support** | Full (SSE pass-through) | Full | Full |
| **Open issues** | — | — | 800+ |

## Project structure

```
nullspend/
├── apps/proxy/            # Cloudflare Worker — the LLM proxy
│   ├── src/routes/        #   OpenAI, Anthropic, MCP route handlers
│   ├── src/lib/           #   Auth, cost calc, budget, webhooks
│   └── src/durable-objects/ # Per-user budget state (Durable Objects)
├── app/                   # Next.js 16 dashboard (App Router)
├── components/            # UI components (shadcn/ui + Tailwind)
├── lib/                   # Dashboard logic — auth, actions, queries
├── packages/
│   ├── cost-engine/       # 45-model pricing catalog + cost calculation
│   ├── db/                # Drizzle ORM schema (source of truth)
│   ├── sdk/               # @nullspend/sdk — TypeScript client
│   ├── mcp-server/        # MCP server adapter (approval tools)
│   └── mcp-proxy/         # MCP tool gating proxy
├── drizzle/               # SQL migrations (Drizzle ORM)
└── docs/                  # Architecture, roadmap, competitive analysis
```

## Development

Prerequisites: Node 18+, pnpm.

```bash
git clone https://github.com/cjones6489/NullSpend.git
cd NullSpend
pnpm install
cp .env.example .env.local   # fill in Supabase + Upstash + Stripe credentials
pnpm db:generate             # generate Drizzle migrations
pnpm dev                     # start dashboard at localhost:3000
```

For the proxy:

```bash
cd apps/proxy
cp .dev.vars.example .dev.vars   # fill in provider keys + Upstash
npx wrangler dev                 # start proxy at localhost:8787
```

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Dashboard dev server |
| `pnpm proxy:dev` | Proxy dev server (wrangler) |
| `pnpm test` | Dashboard unit tests |
| `pnpm proxy:test` | Proxy unit tests |
| `pnpm typecheck` | TypeScript type check |
| `pnpm lint` | ESLint |
| `pnpm db:generate` | Generate Drizzle migration |
| `pnpm db:build` | Build @nullspend/db (required before next build) |

**Important:** `pnpm test` and `pnpm proxy:test` are separate suites — run both
when changes span dashboard and proxy.

## Test suite

~3,900+ tests across 4 tiers:

- **Tier 1 — Unit tests:** 1,734+ dashboard tests, 1,309+ proxy tests, 700
  cost-engine tests, 49 claude-agent tests. All mocked, runs in <20s.
- **Tier 2 — Integration tests:** Currently empty — budget enforcement moved
  from Redis Lua to Durable Objects (tested in Tier 1).
- **Tier 3 — Smoke tests:** 32 files hitting the deployed proxy with real
  OpenAI/Anthropic API calls. Manual pre-deploy verification.
- **Tier 4 — CI:** GitHub Actions runs typecheck + lint + all Tier 1 tests on
  every push/PR to main.

## Stack

| Layer | Technology |
|---|---|
| **Proxy** | Cloudflare Workers + Durable Objects |
| **Dashboard** | Next.js 16 (App Router) on Vercel |
| **Database** | Supabase Postgres via Drizzle ORM |
| **Budget state** | Cloudflare Durable Objects (SQLite) |
| **UI** | Tailwind CSS 4 + shadcn/ui |
| **Auth** | Supabase Auth (session) + SHA-256 API keys (proxy) |
| **Payments** | Stripe (subscription management) |
| **Monitoring** | Sentry + structured logging (Pino) |
| **Validation** | Zod |
| **Testing** | Vitest |

## Documentation

- [Budget Configuration](docs/guides/budget-configuration.md)
- [Migrating from Helicone](docs/guides/migrating-from-helicone.md)
- Full docs at [nullspend.dev/docs](https://nullspend.dev/docs)

## License

Private — not yet open source.
