# AgentSeam

FinOps layer for AI agents — cost tracking, budget enforcement, and human-in-the-loop approval.

## Principles

Research thoroughly, plan carefully, trust first, test often.

## Structure

```
agentseam/                  # Next.js 16 dashboard (root)
├── apps/proxy/             # Cloudflare Workers proxy (@agentseam/proxy)
├── packages/db/            # Drizzle ORM schema (@agentseam/db)
├── packages/sdk/           # Client SDK (@agentseam/sdk)
├── packages/cost-engine/   # Cost calculation (@agentseam/cost-engine)
├── packages/mcp-server/    # MCP server (@agentseam/mcp-server)
├── packages/mcp-proxy/     # MCP proxy (@agentseam/mcp-proxy)
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
pnpm db:build         # Build @agentseam/db (required before next build)
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
- Auth: session-based (`resolveSessionUserId`) for dashboard, API key (`assertApiKeyWithIdentity`) for agents
- Error responses: 401 = identity unknown, 403 = identity known but unauthorized

## Dependencies

- Root `package.json` has `pnpm.overrides` pinning `drizzle-orm@^0.45.1` across all workspace packages to prevent version mismatch issues

## Supabase

- Project ref: set in .env.local (not committed)
- Use `apply_migration` (not `execute_sql`) for DDL via MCP
- RLS policies scope to `auth.uid()::text` for `authenticated` role

## Audit

Active security audit in `docs/audit-findings.md` with research in `docs/audit-research.md`.
