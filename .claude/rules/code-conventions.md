---
paths:
  - "app/**"
  - "lib/**"
  - "components/**"
  - "packages/db/**"
  - "packages/sdk/**"
  - "packages/cost-engine/**"
  - "packages/mcp-server/**"
  - "packages/mcp-proxy/**"
  - "packages/claude-agent/**"
  - "packages/docs-mcp-server/**"
  - "apps/proxy/**"
  - "proxy.ts"
---

# Code Conventions

General API and data-layer conventions for NullSpend code. Loaded when touching
any code path; skipped for pure docs / strategy / research work.

## Architecture

- `proxy.ts` is Next.js 16's replacement for `middleware.ts` — runs on Node.js runtime
- Proxy worker uses `.js` extensions in relative imports (ESM requirement)
- Schema source of truth: `packages/db/src/schema.ts`

## Identity and data model

- User IDs are stored as `text` (not `uuid`) to match Supabase `auth.uid()::text`
- RLS is enabled on all tables but Drizzle bypasses it (direct connection) — RLS protects PostgREST only
- `anon` role has zero privileges on application tables

## Authentication

- API keys: SHA-256 hashed before storage, timing-safe comparison on lookup
- Auth: session-based (`resolveSessionContext`) for dashboard, API key (`authenticateApiKey`) for agents
- Dual-auth routes use `assertApiKeyOrSession` which returns `{ userId, orgId }` — orgId is guaranteed non-null (null orgId returns 403)

## Data isolation

- All dashboard queries scope by `orgId` (from `resolveSessionContext` or `authenticateApiKey`)
- `userId` is only used for Stripe subscriptions, budget entity ownership verification, and audit logging

## Error responses

- Format: `{ error: { code: "machine_code", message: "Human readable text.", details: null } }` — consistent across dashboard and proxy
- HTTP status semantics: **401 = identity unknown, 403 = identity known but unauthorized**
