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
```

IMPORTANT: `pnpm test` and `pnpm proxy:test` are separate — always run both when changes span root and proxy.

## Non-Obvious Conventions

- `proxy.ts` is Next.js 16's replacement for `middleware.ts` — runs on Node.js runtime
- Proxy worker uses `.js` extensions in relative imports (ESM requirement)
- User IDs are stored as `text` (not `uuid`) to match Supabase `auth.uid()::text`
- Schema source of truth: `packages/db/src/schema.ts`
- RLS is enabled on all tables but Drizzle bypasses it (direct connection) — RLS protects PostgREST only
- `anon` role has zero privileges on application tables
- API keys: SHA-256 hashed before storage, timing-safe comparison on lookup
- Auth: session-based (`resolveSessionContext`) for dashboard, API key (`authenticateApiKey`) for agents
- Data isolation: all dashboard queries scope by `orgId` (from `resolveSessionContext` or `authenticateApiKey`). `userId` is only used for Stripe subscriptions, budget entity ownership verification, and audit logging.
- Dual-auth routes use `assertApiKeyOrSession` which returns `{ userId, orgId }` — orgId is guaranteed non-null (null orgId returns 403)
- Error responses: `{ error: { code: "machine_code", message: "Human readable text.", details: null } }` — consistent across dashboard and proxy
- HTTP status semantics: 401 = identity unknown, 403 = identity known but unauthorized
- Stripe API version pinned in `lib/stripe/client.ts` (`STRIPE_API_VERSION`) — single source of truth
- Two Stripe integrations: own billing (`lib/stripe/`, `STRIPE_SECRET_KEY`) and customer revenue sync (`lib/margins/`, per-org encrypted keys via `STRIPE_ENCRYPTION_KEY`)
- Margins use the `customer` tag key convention — cost events tagged with `X-NullSpend-Tags: customer=acme-corp`
- Margin health tiers: healthy (>=50%), moderate (20-49%), at_risk (0-19%), critical (<0%)
- Revenue sync uses DELETE+re-INSERT replace strategy per customer per period (idempotent)
- Margin threshold crossings dispatch both webhooks and Slack alerts independently (per-crossing error isolation)

## Dependencies

- Root `package.json` has `pnpm.overrides` pinning `drizzle-orm@^0.45.1` across all workspace packages to prevent version mismatch issues

## Slack Integration

- `SLACK_BOT_TOKEN` (xoxb-...) — Slack Web API bot token for budget negotiation threaded replies. Optional; falls back to incoming webhook if absent.
- `SLACK_CHANNEL_ID` — Channel ID for budget negotiation messages. Required alongside `SLACK_BOT_TOKEN`.
- Existing webhook URL (via `slackConfigs` table) is used for all non-budget actions and as fallback.

## Supabase

- Project ref: set in .env.local (not committed)
- Use `apply_migration` (not `execute_sql`) for DDL via MCP
- RLS policies scope to `auth.uid()::text` for `authenticated` role

## Testing

See @TESTING.md for the full test map (~230 files, ~3,940+ tests across 4 tiers). Key points:

- Proxy tests: `apps/proxy/src/__tests__/` — naming convention: `{module}.test.ts`, `-edge-cases.test.ts`, `-all-models.test.ts`
- Dashboard tests: co-located with source files
- When adding a new model to pricing-data.json, update the `-all-models.test.ts` files too

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
