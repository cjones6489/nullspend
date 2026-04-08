# NullSpend

FinOps layer for AI agents — cost tracking, budget enforcement, and human-in-the-loop approval.

## Principles

Research thoroughly, plan carefully, trust first, test often.

When planning implementations that touch external libraries (Next.js, Drizzle, Supabase, Cloudflare Workers, Upstash, Stripe, Recharts, Zod, etc.), consult Context7 MCP for current documentation before coding. Training data goes stale — the API may have changed.

## Structure

```
nullspend/                  # Next.js 16 dashboard (root)
├── apps/proxy/             # Cloudflare Workers proxy (@nullspend/proxy)
├── packages/db/            # Drizzle ORM schema (@nullspend/db)
├── packages/sdk/           # Client SDK (@nullspend/sdk)
├── packages/cost-engine/   # Cost calculation (@nullspend/cost-engine)
├── packages/claude-agent/  # Claude Agent SDK adapter (@nullspend/claude-agent)
├── packages/mcp-server/    # MCP server (@nullspend/mcp-server)
├── packages/mcp-proxy/     # MCP proxy (@nullspend/mcp-proxy)
├── packages/docs-mcp-server/ # Docs MCP server (@nullspend/docs)
├── proxy.ts                # Next.js 16 proxy (replaces middleware.ts)
└── drizzle/                # SQL migrations
```

## Commands

```bash
pnpm test             # Root tests (excludes packages/ and apps/)
pnpm proxy:test       # Proxy worker tests (apps/proxy/)
pnpm dev              # Next.js dev server
pnpm proxy:dev        # Proxy dev server (wrangler)
pnpm typecheck        # TypeScript check
pnpm lint             # ESLint
pnpm db:generate      # Generate Drizzle migration
pnpm db:build         # Build @nullspend/db (required before next build)
pnpm cost-engine:build # Build @nullspend/cost-engine (required before next build — exports point to dist/)
```

IMPORTANT: `pnpm test` and `pnpm proxy:test` are separate — always run both when changes span root and proxy.

## Conventions and domain rules

Path-scoped rules live in `.claude/rules/` and load on-demand when matching files are touched. Edit those rather than adding to CLAUDE.md.

- `code-conventions.md` — general API/data layer (auth, error format, schema, identity)
- `stripe-margins.md` — Stripe integrations, customer attribution, margin tracking
- `slack.md` — Slack bot token + webhook fallback config
- `database.md` — Supabase MCP usage, RLS scope, migration command
- `security.md` — timing-safe comparisons, webhook URL validation, body size limits

## Dependencies

- Root `package.json` has `pnpm.overrides` pinning `drizzle-orm@^0.45.1` across all workspace packages to prevent version mismatch issues

## Testing

See @TESTING.md for the full test map (~231 files, ~3,955+ tests across 4 tiers). Key points:

- Proxy tests: `apps/proxy/src/__tests__/` — naming convention: `{module}.test.ts`, `-edge-cases.test.ts`, `-all-models.test.ts`
- Dashboard tests: co-located with source files
- When adding a new model to pricing-data.json, update the `-all-models.test.ts` files too

## Design System

Always read DESIGN.md before making any visual or UI decisions.
All font choices, colors, spacing, and aesthetic direction are defined there.
Do not deviate without explicit user approval.
In QA mode, flag any code that doesn't match DESIGN.md.

## Strategy, Vision, and Roadmap

The canonical, maintained docs for NullSpend strategy live in `docs/internal/`.
Always read these directly when the user asks about strategy, vision, roadmap,
priorities, competition, or distribution. Do not reason from training data or
assume you know the current state — these docs evolve.

- `docs/internal/nullspend-vision.md` — vision, thesis, three-surface model
  (Proxy/SDK/MCP), spending envelopes, $1B framing
- `docs/internal/nullspend-technical-feature-roadmap.md` — current 6-month
  roadmap, monthly priorities, strategic moves
- `docs/internal/nullspend-domination-playbook.md` — go-to-market, framework
  integrations, content strategy, OSS plan

## Compact instructions

When compacting, preserve: recent code changes, test results, architectural decisions made during this session, and any user preferences expressed. Discard: verbose file reads, exploration output, debugging traces, and old search results.

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
- Save progress, checkpoint, resume → invoke checkpoint
- Code quality, health check → invoke health
