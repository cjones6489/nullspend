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

## Dependencies

- Root `package.json` has `pnpm.overrides` pinning `drizzle-orm@^0.45.1` across all workspace packages to prevent version mismatch issues

## Supabase

- Project ref: set in .env.local (not committed)
- Use `apply_migration` (not `execute_sql`) for DDL via MCP
- RLS policies scope to `auth.uid()::text` for `authenticated` role

## Testing

See @TESTING.md for the full test map (~168 files, ~2,800+ tests across 4 tiers). Key points:

- Proxy tests: `apps/proxy/src/__tests__/` — naming convention: `{module}.test.ts`, `-edge-cases.test.ts`, `-all-models.test.ts`
- Dashboard tests: co-located with source files
- When adding a new model to pricing-data.json, update the `-all-models.test.ts` files too

## Compact instructions

When compacting, preserve: recent code changes, test results, architectural decisions made during this session, and any user preferences expressed. Discard: verbose file reads, exploration output, debugging traces, and old search results.
