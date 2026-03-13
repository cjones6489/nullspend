# AgentSeam Roadmap

> **Note:** The master roadmap for the FinOps pivot is at
> `docs/finops-pivot-roadmap.md`. This file preserves the history of the
> original approval layer phases and tracks the FinOps build progress.

## Completed (Original Platform — Approval Layer)

### Phase 0 — Repo Setup
- Next.js app with TypeScript, Tailwind, shadcn/ui
- Supabase connection (auth + Postgres)
- Drizzle ORM with migrations
- ESLint, Vitest, pnpm workspace

### Phase 1 — Core Backend
- `actions` table with full lifecycle schema
- Create, get, approve, reject, result API routes
- Explicit state machine with optimistic locking
- Zod validation on all boundaries

### Phase 2 — Inbox UI + Auth
- Supabase email/password auth (signup, login, session refresh)
- Dashboard shell with sidebar navigation
- Inbox page with status tabs and action table
- Action detail page with payload viewer and approve/reject controls
- TanStack Query data layer with mutations and cache invalidation

### Phase 3 — API Keys + Dashboard Completion
- `api_keys` table with SHA-256 hashing
- Settings page: create, name, revoke API keys
- History page with status filters
- Per-user action ownership (`ownerUserId`)
- DB-backed API key auth for SDK routes

### Phase 4 — SDK Package
- `@agentseam/sdk` TypeScript package at `packages/sdk/`
- `AgentSeam` client with `proposeAndWait`, `createAction`, `getAction`, `waitForDecision`, `markResult`
- Custom error types: `AgentSeamError`, `TimeoutError`, `RejectedError`
- 19 unit tests, tsup build (ESM + CJS + types)

### Phase 5 — MCP Adapters
- `@agentseam/mcp-server` — tools: `propose_action`, `check_action`
- `@agentseam/mcp-proxy` — stdio proxy with selective tool gating
- 49 unit tests across config, gate, and proxy modules

### Action Expiration
- Configurable server-side TTL, lazy check-on-read
- Expiration-aware approve/reject (409 Conflict when expired)

### Slack Notifications
- Block Kit messages, interactive approve/reject buttons
- HMAC-SHA256 signing verification, per-user webhook config

---

## Completed (FinOps Pivot)

### FinOps Phase 0 — Foundation & Repo Restructure
- Cloudflare Workers project at `apps/proxy/`
- Upstash Redis with REST-based connectivity from CF Workers
- `packages/cost-engine/` with model pricing database
- `budgets` and `cost_events` database tables

### FinOps Phase 1 — OpenAI Streaming Proxy
- `/v1/chat/completions` proxy with stream tee, SSE parsing
- Cost calculation in microdollars (integer precision)
- Async cost event logging via `ctx.waitUntil()`
- `passThroughOnException()` failover
- 280+ unit and smoke tests

### FinOps Phase 2 — Budget Enforcement (Redis)
- Atomic Lua check-and-reserve script
- Pre-request estimation, post-response reconciliation
- Key + user budget hierarchy, STRICT_BLOCK policy
- Budget CRUD API, reservation TTL auto-expiry

### FinOps Phase 3 — Anthropic Provider Support
- `/v1/messages` route with named-event SSE parsing
- Cache token accounting (read/write/5min/1hr), long-context multipliers
- Budget enforcement shared with OpenAI path
- 280 stress tests across 7 live Anthropic models

### FinOps Phase 4 — Dashboard Multi-Provider Support
- Provider filter on cost events API
- Provider breakdown analytics (chart + table)
- Formatted model/provider display names (30+ models)
- Provider badge in Activity, ProviderBreakdown in Analytics
- Seed script with ~30% Anthropic event mix

---

## Current: Phase 5 — Launch Prep

See `docs/finops-pivot-roadmap.md` for full details and forward roadmap
(Phases 5-22).
