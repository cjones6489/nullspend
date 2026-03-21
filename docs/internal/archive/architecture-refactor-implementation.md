# Architecture Refactor — Implementation Guide

## Overview

This document is the single source of truth for the NullSpend architecture refactor.
It covers 8 implementation phases, each independently deployable and testable. Every
phase produces a commit with passing tests before the next phase begins.

**Core principle:** One code path through the proxy. No separate tracking vs enforcement
modes. When no budgets exist, the budget check resolves instantly from the auth cache.
When budgets exist, the same check enforces atomically via Redis Lua scripts. The
developer doesn't choose a mode — they optionally configure budgets and enforcement
activates automatically.

**What we're starting from (current state after auth unification commit `192e37c`):**
- Worker accepts both `x-nullspend-key` (API key, DB lookup) and `x-nullspend-auth`
  (platform key, timing-safe compare) via dual-auth in `authenticateRequest()`
- Route handlers have `auth.method === "api_key" | "platform_key"` branching
- `lookupBudgets()` uses named params `{ keyId, userId }` (already refactored)
- API key auth has LRU cache (256 entries, 60s TTL) with negative caching
- MCP proxy supports both `authMode: "api_key"` and `authMode: "platform_key"`
- Catch-all gateway route at `app/v1/[...path]/route.ts`
- Introspect endpoint at `app/api/auth/introspect/route.ts`

**What we're building toward:**
- Single auth path (API key only, no platform key)
- `hasBudgets` flag on auth identity for zero-cost budget bypass
- Middleware pipeline with `RequestContext` replacing per-handler boilerplate
- Standard error contract across all routes
- Extended `cost_events` schema with event_type, tool fields, session tracking
- OpenAI-compatible upstream routing via header

---

## Phase 1: Schema Migration

**Goal:** Add 7 columns to `cost_events` before any production data exists.

**Risk level:** Low (additive columns with defaults, no data to migrate)

### Migration: `drizzle/0016_extend_cost_events.sql`

```sql
ALTER TABLE cost_events ADD COLUMN event_type TEXT NOT NULL DEFAULT 'llm'
  CHECK (event_type IN ('llm', 'tool'));

ALTER TABLE cost_events ADD COLUMN tool_name TEXT;
ALTER TABLE cost_events ADD COLUMN tool_server TEXT;

ALTER TABLE cost_events ADD COLUMN tool_calls_requested JSONB;
ALTER TABLE cost_events ADD COLUMN tool_definition_tokens INTEGER DEFAULT 0;

ALTER TABLE cost_events ADD COLUMN upstream_duration_ms INTEGER;

ALTER TABLE cost_events ADD COLUMN session_id TEXT;

CREATE INDEX cost_events_event_type_idx ON cost_events (event_type);
CREATE INDEX cost_events_session_id_idx ON cost_events (session_id)
  WHERE session_id IS NOT NULL;
CREATE INDEX cost_events_tool_server_name_idx
  ON cost_events (tool_server, tool_name)
  WHERE event_type = 'tool';
```

### Schema update: `packages/db/src/schema.ts`

Add to the `costEvents` table definition:

```typescript
eventType: text("event_type").$type<"llm" | "tool">().notNull().default("llm"),
toolName: text("tool_name"),
toolServer: text("tool_server"),
toolCallsRequested: jsonb("tool_calls_requested").$type<{ name: string; id: string }[] | null>(),
toolDefinitionTokens: integer("tool_definition_tokens").default(0),
upstreamDurationMs: integer("upstream_duration_ms"),
sessionId: text("session_id"),
```

### Downstream: `apps/proxy/src/lib/cost-logger.ts`

No code changes needed — `logCostEvent` accepts `Omit<NewCostEventRow, "id" | "createdAt">`.
The new fields are optional (nullable / have defaults), so existing callers continue
to work. New callers pass the additional fields.

### Files
- New: `drizzle/0016_extend_cost_events.sql`
- Modify: `packages/db/src/schema.ts`

### Acceptance criteria
- [ ] Migration applies cleanly via Supabase MCP `apply_migration`
- [ ] `pnpm db:build` succeeds
- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes (existing cost event tests unchanged — new fields are optional)
- [ ] Existing `cost_events` rows (if any) get `event_type = 'llm'` default

### Verification
```bash
pnpm db:build && pnpm typecheck && pnpm test
```

---

## Phase 2: Kill Platform Key Auth + Add `hasBudgets`

**Goal:** Remove dual-auth branching. Single auth path: `x-nullspend-key` only.
Add `hasBudgets` flag to auth identity for zero-cost budget bypass.

**Risk level:** High (touches every route handler and every test file). Run all 3
test suites after this phase.

### 2A. Update `apps/proxy/src/lib/api-key-auth.ts`

Add `hasBudgets: boolean` to `ApiKeyIdentity`. Change the DB query to include a
budgets-exist subquery:

```typescript
export interface ApiKeyIdentity {
  userId: string;
  keyId: string;
  hasBudgets: boolean;
}
```

DB query becomes:
```sql
SELECT k.id, k.user_id,
  EXISTS(
    SELECT 1 FROM budgets b
    WHERE (b.entity_type = 'api_key' AND b.entity_id = k.id::text)
       OR (b.entity_type = 'user' AND b.entity_id = k.user_id)
  ) AS has_budgets
FROM api_keys k
WHERE k.key_hash = $1 AND k.revoked_at IS NULL
```

The `hasBudgets` flag is cached for 60s alongside the identity. When a developer
creates their first budget, enforcement activates within 60s (next cache expiry).

### 2B. Simplify `apps/proxy/src/lib/auth.ts`

Remove `validatePlatformKey()`, remove `method` field from `AuthResult`, remove
platform key branch. Remove the `platformAuthKey` parameter.

```typescript
export interface AuthResult {
  userId: string;
  keyId: string;
  hasBudgets: boolean;
}

export async function authenticateRequest(
  request: Request,
  connectionString: string,
): Promise<AuthResult | null> {
  const apiKey = request.headers.get("x-nullspend-key");
  if (!apiKey) return null;
  const identity = await authenticateApiKey(apiKey, connectionString);
  if (!identity) return null;
  return { userId: identity.userId, keyId: identity.keyId, hasBudgets: identity.hasBudgets };
}
```

### 2C. Simplify all route handlers

**`apps/proxy/src/routes/openai.ts`:**
- Remove `extractAttribution` import and `legacyAttribution` logic
- Attribution comes directly from `auth`: `userId: auth.userId`, `apiKeyId: auth.keyId`
- Remove `auth.method` branching
- Add `hasBudgets` fast-path: only instantiate Redis and call `lookupBudgets` when
  `auth.hasBudgets` is true
- Remove `env.PLATFORM_AUTH_KEY` from `authenticateRequest()` call
- Extract `sessionId` from `x-nullspend-session` header (new)
- Measure `upstreamDurationMs` around the fetch call (new)

**`apps/proxy/src/routes/anthropic.ts`:** Same changes as openai.ts.

**`apps/proxy/src/routes/mcp.ts`:**
- Remove platform key branching in both `handleMcpBudgetCheck` and `handleMcpEvents`
- Attribution from `auth.userId` / `auth.keyId` directly
- Add `hasBudgets` fast-path to `handleMcpBudgetCheck`
- MCP events handler: set `eventType: "tool"`, `toolName`, `toolServer` as
  separate fields instead of encoding in `model`

### 2D. Update `apps/proxy/src/index.ts`

- Remove `env.PLATFORM_AUTH_KEY` from handler calls
- Rate limiter: already reads `x-nullspend-key` (no change needed)
- Remove `x-nullspend-key-id` fallback from rate limiter

### 2E. Delete `apps/proxy/src/lib/request-utils.ts` `extractAttribution()`

The function is no longer needed — attribution comes from auth result.
Keep `ensureStreamOptions()`, `extractModelFromBody()` (still used).

### 2F. Update ALL test files

Every test file that mocks auth needs updating:
- Mock `authenticateRequest` to return `{ userId, keyId, hasBudgets }` (no `method`)
- Remove all `X-NullSpend-Auth` header references from test requests
- Remove platform key test cases (no backward compat)
- Update `lookupBudgets` assertions for `hasBudgets` fast-path behavior
- Add tests for `hasBudgets: false` → no Redis calls
- Add tests for `hasBudgets: true` → full budget pipeline

Test files to update (11 files):
- `api-key-auth.test.ts` — add `hasBudgets` assertion
- `auth.test.ts` — remove platform key tests, simplify
- `mcp-route.test.ts`
- `openai-route.test.ts`
- `anthropic-route.test.ts`
- `anthropic-budget-route.test.ts`
- `budget.test.ts`
- `budget-streaming.test.ts`
- `budget-edge-cases.test.ts`
- `upstream-timeout.test.ts`
- `index-entry.test.ts`

### Files
- Modify: `apps/proxy/src/lib/api-key-auth.ts`
- Modify: `apps/proxy/src/lib/auth.ts`
- Modify: `apps/proxy/src/routes/openai.ts`
- Modify: `apps/proxy/src/routes/anthropic.ts`
- Modify: `apps/proxy/src/routes/mcp.ts`
- Modify: `apps/proxy/src/index.ts`
- Modify: `apps/proxy/src/lib/request-utils.ts`
- Modify: 11 test files in `apps/proxy/src/__tests__/`

### Acceptance criteria
- [ ] No references to `platform_key`, `x-nullspend-auth`, `x-nullspend-user-id`,
      or `x-nullspend-key-id` in any proxy route handler or lib file
- [ ] `AuthResult` has no `method` field
- [ ] `authenticateRequest()` takes 2 params (request, connectionString) not 3
- [ ] `hasBudgets: false` → Redis.fromEnv() never called, lookupBudgets never called
- [ ] `hasBudgets: true` → full budget enforcement pipeline runs
- [ ] All 3 test suites pass: `pnpm proxy:test` + `pnpm test` + `cd packages/mcp-proxy && pnpm test`
- [ ] `pnpm typecheck` passes

### Verification
```bash
pnpm db:build && pnpm typecheck && pnpm proxy:test && pnpm test && cd packages/mcp-proxy && pnpm test
```

---

## Phase 3: Middleware Pipeline + Standard Error Contract

**Goal:** Refactor `index.ts` to a route registry with shared middleware. Standardize
error responses across all routes.

**Risk level:** Medium (structural change to request flow, but logic is identical)

### 3A. Create `apps/proxy/src/lib/errors.ts`

```typescript
export interface NullSpendError {
  error: string;
  message: string;
  details?: Record<string, unknown>;
}

export function errorResponse(
  error: string,
  message: string,
  status: number,
  details?: Record<string, unknown>,
): Response {
  const body: NullSpendError = { error, message };
  if (details) body.details = details;
  return Response.json(body, { status });
}
```

### 3B. Create `apps/proxy/src/lib/context.ts`

```typescript
import type { Redis } from "@upstash/redis/cloudflare";
import type { AuthResult } from "./auth.js";

export interface RequestContext {
  body: Record<string, unknown>;
  auth: AuthResult;
  redis: Redis | null; // null when auth.hasBudgets is false
  connectionString: string;
  sessionId: string | null;
}
```

### 3C. Refactor `apps/proxy/src/index.ts`

Replace if/else chain with route registry. Auth, body parsing, and rate limiting
run once in the middleware pipeline before handler dispatch.

Handler signature changes from:
```typescript
(request: Request, env: Env, body: Record<string, unknown>) => Promise<Response>
```
To:
```typescript
(request: Request, env: Env, ctx: RequestContext) => Promise<Response>
```

### 3D. Update all route handlers

- Accept `RequestContext` as third param instead of `body`
- Remove internal `authenticateRequest()` calls (done in middleware)
- Remove internal body parsing (done in middleware)
- Use `ctx.auth`, `ctx.body`, `ctx.redis`, `ctx.connectionString`, `ctx.sessionId`
- Replace all ad-hoc `Response.json({ error: ... })` with `errorResponse()`

### 3E. Update all route handler tests

Tests now mock the middleware output (RequestContext) instead of mocking auth
separately. The auth mock moves from per-test-file to a shared `makeContext()` helper.

### Files
- New: `apps/proxy/src/lib/errors.ts`
- New: `apps/proxy/src/lib/context.ts`
- Modify: `apps/proxy/src/index.ts`
- Modify: `apps/proxy/src/routes/openai.ts`
- Modify: `apps/proxy/src/routes/anthropic.ts`
- Modify: `apps/proxy/src/routes/mcp.ts`
- Modify: all route test files

### Acceptance criteria
- [ ] `index.ts` uses route Map, no if/else chain for route dispatch
- [ ] Auth, body parsing, rate limiting happen once before handler
- [ ] All error responses use `errorResponse()` from `errors.ts`
- [ ] Error codes match the contract table (see architecture-refactor-v2.md)
- [ ] All 3 test suites pass

---

## Phase 4: Response Field Extraction

**Goal:** Extract upstream duration, session ID, and tool calls from LLM responses.
Populate the new `cost_events` columns from Phase 1.

**Risk level:** Low (additive extraction in async path, doesn't change request flow)

### 4A. Upstream duration measurement

In each route handler, record `performance.now()` before and after the upstream
`fetch()`. For streaming, measure time-to-first-byte (when fetch resolves).
Pass `upstreamDurationMs` to the cost event.

### 4B. Session ID extraction

Extract `x-nullspend-session` header (already in `ctx.sessionId` from Phase 3).
Pass to cost event.

### 4C. Tool call detection from OpenAI responses

In `sse-parser.ts`, extend `SSEResult` with `toolCalls`:
```typescript
export interface SSEResult {
  usage: OpenAIUsage | null;
  model: string | null;
  toolCalls: { name: string; id: string }[] | null;
}
```

Extract from `choices[0].message.tool_calls` in the final message chunk.

### 4D. Tool call detection from Anthropic responses

In `anthropic-sse-parser.ts`, watch for `content_block_start` events with
`type: "tool_use"`. Collect `{ name, id }` from each.

### 4E. Tool definition token estimation

In route handlers, estimate tool schema overhead:
```typescript
const toolDefinitionTokens = body.tools
  ? Math.ceil(JSON.stringify(body.tools).length / 4)
  : 0;
```

### 4F. MCP events handler: use new columns

In `mcp.ts` `handleMcpEvents`, set:
```typescript
eventType: "tool",
toolName: event.toolName,
toolServer: event.serverName,
```
Instead of encoding in `model: "${event.serverName}/${event.toolName}"`.
Keep `model` as `${event.serverName}/${event.toolName}` for backward compat
with analytics queries until dashboard is updated.

### Files
- Modify: `apps/proxy/src/lib/sse-parser.ts`
- Modify: `apps/proxy/src/lib/anthropic-sse-parser.ts`
- Modify: `apps/proxy/src/routes/openai.ts`
- Modify: `apps/proxy/src/routes/anthropic.ts`
- Modify: `apps/proxy/src/routes/mcp.ts`
- Modify: `apps/proxy/src/lib/cost-calculator.ts` (accept new fields)
- Modify: `apps/proxy/src/lib/anthropic-cost-calculator.ts` (accept new fields)

### Acceptance criteria
- [ ] Cost events include `upstream_duration_ms` for all LLM calls
- [ ] Cost events include `session_id` when header is present
- [ ] Cost events include `tool_calls_requested` when LLM response contains tool calls
- [ ] Cost events include `tool_definition_tokens` when request contains tool schemas
- [ ] MCP events have `event_type: "tool"`, `tool_name`, `tool_server` columns populated
- [ ] All 3 test suites pass

---

## Phase 5: OpenAI-Compatible Upstream Routing

**Goal:** Support Groq, Together AI, Fireworks, Mistral, and any OpenAI-compatible
provider via a single `x-nullspend-upstream` header.

**Risk level:** Low (additive feature, doesn't change existing flow)

### 5A. Create `apps/proxy/src/lib/upstream-allowlist.ts`

```typescript
const DEFAULT_ALLOWED = new Set([
  "https://api.openai.com",
  "https://api.groq.com/openai",
  "https://api.together.xyz",
  "https://api.fireworks.ai/inference",
  "https://api.mistral.ai",
  "https://api.perplexity.ai",
  "https://openrouter.ai/api",
]);

export function isAllowedUpstream(url: string): boolean {
  const normalized = url.replace(/\/+$/, "");
  return DEFAULT_ALLOWED.has(normalized);
}
```

### 5B. Update OpenAI route handler

Read `x-nullspend-upstream` header. If present and allowed, forward there instead
of `OPENAI_BASE_URL`. If present and not allowed, return 400.

For unknown models (not in pricing-data.json), log cost as $0 with a warning flag.

### Files
- New: `apps/proxy/src/lib/upstream-allowlist.ts`
- Modify: `apps/proxy/src/routes/openai.ts`
- New: `apps/proxy/src/__tests__/upstream-allowlist.test.ts`

### Acceptance criteria
- [ ] Request with `x-nullspend-upstream: https://api.groq.com/openai` routes to Groq
- [ ] Request with unknown upstream returns 400
- [ ] Request without header routes to OpenAI (default, unchanged)
- [ ] Unknown models log cost as $0 with `model` field populated
- [ ] All test suites pass

---

## Phase 6: Dashboard Updates

**Goal:** Reorder sidebar for tracking-first experience. Update analytics to use
new `event_type` column. Extend introspect with `hasBudgets`.

**Risk level:** Low (UI changes, no proxy changes)

### 6A. Sidebar reorder: `components/dashboard/sidebar.tsx`

```typescript
const navSections = [
  {
    label: "FinOps",
    items: [
      { href: "/app/analytics", label: "Analytics", icon: BarChart3 },
      { href: "/app/activity", label: "Activity", icon: Activity },
      { href: "/app/budgets", label: "Budgets", icon: DollarSign },
      { href: "/app/tool-costs", label: "Tool Costs", icon: Wrench },
    ],
  },
  {
    label: "Account",
    items: [
      { href: "/app/billing", label: "Billing", icon: CreditCard },
      { href: "/app/settings", label: "Settings", icon: Settings },
    ],
  },
];
```

Remove the "Approvals" section (Inbox + History). If kept as a feature later,
add under a "Developer Tools" section.

### 6B. Extend introspect with `hasBudgets`

Update `app/api/auth/introspect/route.ts` to include `hasBudgets` in response.
Query budgets table for existence check.

### 6C. Update analytics queries

Update `lib/cost-events/aggregate-cost-events.ts` to use `event_type` column
for cleaner LLM vs tool separation (instead of `provider = 'mcp'`).

### Files
- Modify: `components/dashboard/sidebar.tsx`
- Modify: `app/api/auth/introspect/route.ts`
- Modify: `lib/cost-events/aggregate-cost-events.ts`

### Acceptance criteria
- [ ] Sidebar leads with Analytics under FinOps
- [ ] No "Approvals" section in default sidebar
- [ ] Introspect returns `hasBudgets: boolean`
- [ ] Analytics uses `event_type` for LLM vs tool breakdown
- [ ] `pnpm test` passes

---

## Phase 7: MCP Proxy Cleanup

**Goal:** Remove platform key support from MCP proxy. Use `hasBudgets` from
introspect to skip budget HTTP calls.

**Risk level:** Medium (changes MCP proxy config and startup flow)

### 7A. Simplify `packages/mcp-proxy/src/config.ts`

Remove `platformKey`, `userId`, `keyId` from `ProxyConfig`. Remove `authMode` field.
Remove deprecation warnings (we're past the deprecation window — just remove).
Remove the legacy env var detection.

Required env vars: `NULLSPEND_URL`, `NULLSPEND_API_KEY`, `UPSTREAM_COMMAND`.
Optional: `NULLSPEND_SERVER_NAME`, `NULLSPEND_COST_TRACKING`, etc.

### 7B. Simplify `packages/mcp-proxy/src/cost-tracker.ts`

`EventBatcher` and `BudgetClient` only accept `{ backendUrl, apiKey }`.
Remove the platform key auth path entirely. Always send `x-nullspend-key` header.

`CostTrackerConfig` simplified:
```typescript
export interface CostTrackerConfig {
  backendUrl: string;
  apiKey: string;
  serverName: string;
  budgetEnforcementEnabled: boolean;
  toolCostOverrides: Record<string, number>;
  hasBudgets: boolean;
}
```

When `hasBudgets` is false, `BudgetClient.check()` returns `{ allowed: true }`
immediately (no HTTP call).

### 7C. Simplify `packages/mcp-proxy/src/index.ts`

Startup introspect already exists. Extend to read `hasBudgets` from response.
Remove all platform key auth code paths.

### 7D. Update MCP proxy tests

Remove legacy auth mode tests. Update config tests for 3 required env vars only.

### Files
- Modify: `packages/mcp-proxy/src/config.ts`
- Modify: `packages/mcp-proxy/src/config.test.ts`
- Modify: `packages/mcp-proxy/src/cost-tracker.ts`
- Modify: `packages/mcp-proxy/src/cost-tracker.test.ts`
- Modify: `packages/mcp-proxy/src/index.ts`

### Acceptance criteria
- [ ] MCP proxy starts with only 3 env vars + cost tracking enabled
- [ ] No references to `platformKey`, `x-nullspend-auth`, `NULLSPEND_PLATFORM_KEY`
- [ ] `hasBudgets: false` → no HTTP calls for budget checks
- [ ] `hasBudgets: true` → budget checks work as before
- [ ] `cd packages/mcp-proxy && pnpm test` passes

---

## Phase 8: Documentation

**Goal:** Update all docs to reflect the new architecture.

**Risk level:** None (docs only)

### Files
- Modify: `CLAUDE.md` — new auth section, updated architecture diagram, remove
  platform key references
- Modify: `apps/proxy/CLAUDE.md` — update architecture, remove platform key docs
- Modify: `proxy.ts` — add comment clarifying it's Next.js 16 request middleware
- Modify: `README.md` — update developer setup instructions

### Acceptance criteria
- [ ] No references to platform key in any developer-facing doc
- [ ] Auth section describes: session (dashboard), API key (everything else)
- [ ] Developer setup shows 3 env vars for MCP proxy, 1 URL + 1 header for LLM proxy
- [ ] Architecture diagram shows single auth path

---

## Phase Dependency Graph

```
Phase 1 (Schema)
    ↓
Phase 2 (Kill platform key + hasBudgets)  ← highest risk, most files
    ↓
Phase 3 (Middleware + errors)  ← refactors index.ts + handler signatures
    ↓
Phase 4 (Response fields)  ← uses new schema columns + new handler signatures
    ↓
Phase 5 (Upstream routing)  ← additive, uses middleware context

Phase 6 (Dashboard)  ← independent of Phases 3-5, depends on Phase 1+2
Phase 7 (MCP proxy)  ← depends on Phase 2 (no platform key) + Phase 6 (introspect)
Phase 8 (Docs)       ← after everything else
```

Phases 1-5 are sequential (each builds on previous).
Phase 6 can start after Phase 2.
Phase 7 can start after Phase 6.
Phase 8 is last.

---

## What Is NOT Changing

- **Lua budget scripts** (`budget.ts`) — production-grade, keep as-is
- **SSE parser TransformStream pattern** — correct, only extending return type
- **Cost calculators** — per-provider implementations stay separate
- **Cost engine** (`pricing-data.json`) — JSON pricing lookup unchanged
- **Infrastructure** — CF Workers + Upstash Redis + Supabase Postgres + Vercel
- **Stripe billing** — unchanged
- **MCP proxy EventBatcher + circuit breaker** — unchanged (only auth headers change)
- **DB semaphore** — unchanged
- **Reservation/reconciliation pattern** — unchanged
- **Catch-all gateway route** (`app/v1/[...path]/route.ts`) — keep for onboarding

---

## Estimated Effort

| Phase | Effort | Risk |
|-------|--------|------|
| 1. Schema migration | 30 min | Low |
| 2. Kill platform key + hasBudgets | 1 day | High |
| 3. Middleware + errors | Half day | Medium |
| 4. Response fields | Half day | Low |
| 5. Upstream routing | Half day | Low |
| 6. Dashboard | Half day | Low |
| 7. MCP proxy cleanup | Half day | Medium |
| 8. Documentation | 1 hour | None |
| **Total** | **~4-5 days** | |
