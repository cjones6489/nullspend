# AgentSeam Security & Quality Audit Findings

**Date:** March 2026
**Method:** 6-agent parallel audit (Security, Database, API Routes, Architecture, Code Quality, Test Coverage)
**Scope:** Full codebase — Next.js app, Cloudflare Workers proxy, monorepo packages

---

## Status Legend

| Icon | Meaning |
|------|---------|
| DONE | Fix merged and tested |
| PARTIAL | Partially mitigated |
| TODO | Not yet addressed |

---

## Summary

| Severity | Total | Done | Partial | Todo |
|----------|-------|------|---------|------|
| Critical | 3 | 1 | 1 | 1 |
| High | 16 | 16 | 0 | 0 |
| Medium | 32 | 19 | 0 | 13 |
| Low | 40 | 5 | 0 | 35 |
| **Total** | **91** | **41** | **1** | **49** |

---

## Critical

### C1 — Live production secrets may be tracked in git [DONE]

**Agent:** Security
**Files:** `.env.local`

Git status showed `M .env.local` (modified tracked file). Supabase DB password, OpenAI key, Redis credentials, and API key are all in plaintext.

**Remediation:**
1. Verify `.env.local` is in `.gitignore` (it should be by default in Next.js)
2. Run `git rm --cached .env.local` if it is tracked
3. Rotate ALL secrets that may have been committed: Supabase DB password, OpenAI key, Redis credentials, platform API key
4. Audit git history with `git log --all --full-history -- .env.local`

---

### C2 — No Row Level Security (RLS) policies on Supabase tables [DONE]

**Agent:** Database
**Files:** `drizzle/` migrations, Supabase dashboard

No RLS policies exist in any migration or schema file. If tables are accessed with anything other than the service role key, data is either fully exposed or fully blocked depending on Supabase defaults.

**Remediation:**
1. Create RLS policies for each table scoped to `auth.uid()`:
   - `actions`: users can only read/write their own rows (`owner_user_id = auth.uid()`)
   - `api_keys`: users can only manage their own keys (`user_id = auth.uid()`)
   - `slack_configs`: users can only access their own config (`user_id = auth.uid()`)
   - `budgets`: policy depends on entity type
   - `cost_events`: users can read their own events (`user_id = auth.uid()`)
2. Enable RLS on all tables: `ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;`
3. Add policies via Drizzle migration or direct SQL migration

---

### C3 — Dev fallback auth pattern fragile in production [PARTIAL]

**Agent:** API Routes, Security
**Files:** `lib/auth/api-key.ts`, `lib/auth/session.ts`

`resolveDevFallbackApiKeyUserId()` crashes in production if `AGENTSEAM_DEV_ACTOR` is unset. The `NODE_ENV` check alone is unreliable. All API-key-authenticated routes using `identity?.userId ?? resolveDevFallbackApiKeyUserId()` share this fragility.

**Mitigation applied:** `instrumentation.ts` now warns at startup when dev-only env vars are set in production and can hard-fail with `AGENTSEAM_STRICT_BOOT=true`.

**Remaining work:**
1. Consider refactoring the fallback pattern to never throw — return a clear error response instead
2. Add integration test that simulates production env without dev vars

---

## High

### H1 — No rate limiting on any endpoint [DONE]

**Agent:** Security
**Files:** All `app/api/` routes, `proxy.ts`

No rate limiting on API routes, proxy, or Slack callbacks. An attacker with a valid key can flood the DB or run up OpenAI costs unboundedly.

**Remediation:**
1. Add rate limiting middleware — options:
   - `@upstash/ratelimit` with Redis (recommended for serverless)
   - Per-IP sliding window in `proxy.ts`
2. Suggested limits:
   - API routes: 100 req/min per user
   - Action creation: 20 req/min per user
   - API key creation: 5 req/min per user
   - Slack callbacks: 60 req/min per workspace
   - Proxy: 120 req/min per API key

---

### H2 — No CSRF protection on session-based routes [DONE]

**Agent:** Security
**Files:** `app/api/actions/[id]/approve/route.ts`, `app/api/actions/[id]/reject/route.ts`, `app/api/keys/route.ts`, `app/api/slack/config/route.ts`

Approve/reject, key management, and Slack config routes use session cookies but have no CSRF tokens or Origin header validation.

**Remediation:**
1. Validate `Origin` or `Referer` header against known origins on all state-mutating session-based routes
2. Alternatively, require a custom header (e.g., `X-Requested-With`) that cannot be sent cross-origin without CORS preflight
3. Next.js 16 `proxy.ts` can check Origin globally

---

### H3 — Proxy failover bypasses authentication and cost tracking [DONE]

**Agent:** Security, API Routes
**Files:** `apps/proxy/src/routes/openai.ts`

`passThroughOnException()` and catch block forward to OpenAI without logging costs. If the handler crashes after the auth check, the request succeeds against OpenAI with zero cost tracking. This undermines the entire FinOps purpose.

**Remediation:**
1. Move auth check to the earliest possible point, before any code that could throw
2. Ensure failover path still logs a partial cost event (even if estimated)
3. Consider removing `passThroughOnException()` — a failed proxy should fail closed, not open
4. At minimum, log failover events for alerting

---

### H4 — Cost events lack user attribution [DONE]

**Agent:** API Routes
**Files:** `apps/proxy/src/lib/cost-logger.ts`

`calculateOpenAICost` always returns `userId: null` and `apiKeyId: null`. Per-user and per-agent cost tracking is impossible.

**Remediation:**
1. Pass authenticated user/key identity from the auth middleware into the cost logger
2. Store `apiKeyId` (from platform key lookup) and `userId` (from key's owner) on every cost event
3. This is a prerequisite for per-user budget enforcement

---

### H5 — No request body size limits [DONE]

**Agent:** Security, API Routes
**Files:** `apps/proxy/src/routes/openai.ts`, `app/api/` routes

Neither the proxy nor Next.js API routes enforce body size limits. `request.text()` reads the entire body into memory. Denial-of-service via memory exhaustion is possible.

**Remediation:**
1. Proxy (Cloudflare Workers): Check `Content-Length` header, reject if > 10MB (configurable)
2. Next.js API routes: Add body size validation in `readJsonBody` utility
3. Add Zod `.max()` constraints on `payloadJson` and `metadataJson` string lengths

---

### H6 — No model allowlist on proxy [DONE]

**Agent:** API Routes
**Files:** `apps/proxy/src/routes/openai.ts`, `apps/proxy/src/lib/cost-calculator.ts`

Any model string is forwarded to OpenAI. Unknown models get `costMicrodollars = 0` — effectively free untracked usage through the proxy.

**Remediation:**
1. Maintain an allowlist of supported models in the cost calculator
2. Reject or warn on unknown models (configurable: block vs. log-and-allow)
3. At minimum, flag cost events where `costMicrodollars = 0` due to unknown model

---

### H7 — Slack callback lacks user-to-owner authorization [DONE]

**Agent:** Security, API Routes, Code Quality
**Files:** `app/api/slack/callback/route.ts`

Any Slack workspace member who can see the channel can approve or reject any action. There is no mapping between Slack user IDs and AgentSeam action owners.

**Remediation:**
1. Store the Slack user ID of the action owner when sending the notification
2. On callback, verify that the Slack user ID matches the owner (or is in an authorized approvers list)
3. Return an ephemeral Slack message ("You are not authorized to approve this action") on mismatch

---

### H8 — Incomplete migration history [DONE]

**Agent:** Database
**Files:** `drizzle/0000_talented_hedge_knight.sql`

The first migration only creates `actions` without `owner_user_id` or `expires_at`, and is missing 4 entire tables (`api_keys`, `slack_configs`, `budgets`, `cost_events`). A fresh database cannot be bootstrapped from migrations alone.

**Fix applied:**
- Migration `0002_certain_mandroid.sql` creates missing tables and adds missing columns
- Migrations `0003_add_slack_user_id.sql` and `0004_cost_events_index_and_fk.sql` registered in `_journal.json`
- All 5 migrations now tracked in Drizzle journal for fresh DB bootstrap

---

### H9 — `ownerUserId` on actions table is nullable but always required [DONE]

**Agent:** Database, API Routes, Security
**Files:** `packages/db/src/schema.ts:51`

Every query filters by `ownerUserId`, every creation sets it, but the column allowed NULL. Null rows would be orphaned and invisible to all queries.

**Fix applied:**
- `packages/db/src/schema.ts`: Added `.notNull()` to `ownerUserId`
- `packages/db/src/schema.test.ts`: Added `expect(cols.ownerUserId.notNull).toBe(true)`
- `drizzle/0002_certain_mandroid.sql`: Migration with safe backfill (DELETE nulls, then SET NOT NULL)

---

### H10 — Missing Content-Security-Policy header [DONE]

**Agent:** Code Quality, Security
**Files:** `proxy.ts`

No CSP header existed. Research confirmed `proxy.ts` is the correct Next.js 16 convention (renamed from `middleware.ts`).

**Fix applied:**
- `proxy.ts`: Added nonce-based CSP with `Content-Security-Policy-Report-Only`
- Per-request nonce via `crypto.randomUUID()`
- `x-nonce` request header for Server Components
- `'strict-dynamic'` for script loading
- Supabase origin in `connect-src`
- Dev-only `'unsafe-eval'` and `'unsafe-inline'`

---

### H11 — `ActionType`/`ActionStatus` defined in 3 separate places [DONE]

**Agent:** Architecture, Code Quality
**Files:** `packages/db/src/schema.ts`, `packages/sdk/src/types.ts`, `lib/utils/status.ts`

Each file independently defines identical type unions. No single source of truth — will silently drift as types are added or removed.

**Remediation:**
1. Export canonical types from `@agentseam/db` (they already exist there)
2. Re-export from `@agentseam/sdk` for external consumers
3. Remove duplicate definitions in `lib/utils/status.ts`
4. Add a lint rule or test that verifies type consistency

---

### H12 — No tests for API key routes [DONE]

**Agent:** Test Coverage
**Files:** `app/api/keys/route.ts`, `app/api/keys/[id]/route.ts`

GET, POST (create), and DELETE (revoke) for API keys have zero test coverage. These are security-critical operations.

**Remediation:**
1. Create `app/api/keys/route.test.ts` covering:
   - GET: returns keys for authenticated user, 401 on no session
   - POST: creates key, returns prefix + raw key, 400 on invalid input
2. Create `app/api/keys/[id]/route.test.ts` covering:
   - DELETE: revokes key, 404 on missing key, 401 on unauthorized

---

### H13 — No tests for approve/reject API routes [DONE]

**Agent:** Test Coverage
**Files:** `app/api/actions/[id]/approve/route.ts`, `app/api/actions/[id]/reject/route.ts`

Core human-in-the-loop endpoints have no test files. These are the most critical user-facing operations.

**Remediation:**
1. Create test files for both routes covering:
   - Happy path: approve/reject a pending action
   - 404 on missing action
   - 409 on already-approved/rejected action
   - 401 on unauthenticated request
   - Expiration edge cases

---

### H14 — No unit tests for core action functions [DONE]

**Agent:** Test Coverage
**Files:** `lib/actions/approve-action.ts`, `lib/actions/reject-action.ts`, `lib/actions/create-action.ts`, `lib/actions/mark-result.ts`

Only tested indirectly through mocked route tests. Direct unit tests would catch logic errors without route-level mocking overhead.

**Remediation:**
1. Create unit tests with mocked DB client for each function
2. Test state transition validation, timestamp setting, error handling

---

### H15 — No `test:all` script across monorepo [DONE]

**Agent:** Test Coverage
**Files:** `package.json`

Root `pnpm test` runs `vitest run` which excludes `packages/**` and `apps/**`. No single command runs all tests across the monorepo. CI could miss regressions.

**Remediation:**
1. Add a `test:all` script: `pnpm -r run test`
2. Wire it into CI
3. Alternatively, use `vitest.workspace.ts` to configure all packages

---

### H16 — `@agentseam/shared` is completely dead code [DONE]

**Agent:** Architecture, Code Quality
**Files:** `packages/shared/`

Exports types (`EntityType`, `BudgetPolicy`, `BudgetRecord`, `CostEventRecord`) but nothing imports from it. Never listed as a dependency in any `package.json`. Duplicates `@agentseam/db` inferred types.

**Remediation:**
1. Delete `packages/shared/` entirely, or
2. Consolidate shared types there and update imports across the monorepo

---

## Medium

### M1 — `bulkExpireActions` runs on every list request [TODO]

**Agent:** Database
**Files:** `lib/actions/list-actions.ts`

Every `listActions()` call issues a write query before the read to expire actions. Wasted I/O under load.

**Remediation:** Move expiration to a background cron job or separate endpoint. Only expire on read if cron hasn't run recently.

---

### M2 — `lastUsedAt` UPDATE on every API key auth [TODO]

**Agent:** Database
**Files:** `lib/auth/api-key.ts`

Write-per-request for API key last-used tracking creates high write load under heavy traffic.

**Remediation:** Batch updates — buffer in memory and flush every N seconds, or use a separate analytics pipeline.

---

### M3 — Proxy creates new `pg.Client` per request [DONE]

**Agent:** Database
**Files:** `apps/proxy/src/lib/cost-logger.ts`

Every cost event creates a fresh connection (TCP + TLS + auth overhead per request).

**Remediation:** Use a connection pool, or better, use `ctx.waitUntil()` with a batched async logger (e.g., Kafka, Upstash QStash).

---

### M4 — Cursor pagination uses timestamp only [DONE]

**Agent:** API Routes
**Files:** `lib/actions/list-actions.ts`

`createdAt` as cursor. Concurrent inserts with the same timestamp can skip rows.

**Fix applied:**
- Composite cursor `{ createdAt, id }` replaces single-field timestamp cursor
- Zod schema validates cursor as JSON-encoded `{ createdAt: datetime, id: uuid }`
- `OR(gt(createdAt, cursor), AND(eq(createdAt, cursor), gt(id, cursorId)))` prevents row skipping
- `orderBy: [desc(createdAt), desc(id)]` ensures deterministic ordering

---

### M5 — Missing cost analytics indexes [DONE]

**Agent:** Database
**Files:** `packages/db/src/schema.ts`

No index on `(provider, model, createdAt)` for cost aggregation dashboards.

**Fix applied:**
- Added composite index `cost_events_provider_model_created_at_idx` on `(provider, model, createdAt)`
- Schema updated in `packages/db/src/schema.ts`
- Migration `0004_cost_events_index_and_fk.sql` uses `CREATE INDEX CONCURRENTLY`

---

### M6 — No foreign keys between `costEvents` and `apiKeys` [DONE]

**Agent:** Database
**Files:** `packages/db/src/schema.ts`

Orphaned cost events can reference deleted API keys with no referential integrity.

**Fix applied:**
- Added `.references(() => apiKeys.id, { onDelete: "set null" })` to `costEvents.apiKeyId`
- Migration `0004_cost_events_index_and_fk.sql` adds FK constraint `cost_events_api_key_id_api_keys_id_fk`

---

### M7 — No cascading deletes defined anywhere [TODO]

**Agent:** Database

When a Supabase Auth user is deleted, all `actions`, `apiKeys`, `slackConfigs`, `budgets`, `costEvents` are orphaned.

**Remediation:** Add cascading deletes or soft-delete pattern tied to Supabase auth user lifecycle.

---

### M8 — ESLint ignores entire `apps/` directory [TODO]

**Agent:** Architecture
**Files:** `eslint.config.mjs`

Root config has `apps/**` in ignores. Proxy code gets zero lint coverage.

**Remediation:** Remove the blanket ignore; add per-package ESLint configs if needed.

---

### M9 — `approveAction`/`rejectAction` are 90% identical [DONE]

**Agent:** Code Quality
**Files:** `lib/actions/approve-action.ts`, `lib/actions/reject-action.ts`

~170 lines of duplication. Only differ in target status, timestamp column, and actor field.

**Fix applied:**
- Extracted `resolveAction()` shared helper in `lib/actions/resolve-action.ts`
- Handles fetch, FOR UPDATE locking, expiration check, transition assertion, and optimistic update
- `approveAction` and `rejectAction` reduced to thin wrappers (~15 lines each, down from ~85)

---

### M10 — Triple Supabase auth call per approve/reject [DONE]

**Agent:** Code Quality
**Files:** `app/api/actions/[id]/approve/route.ts`, `app/api/actions/[id]/reject/route.ts`

`assertSession()`, `resolveSessionUserId()`, `resolveApprovalActor()` each call `getCurrentUserId()` separately — 3 round-trips to Supabase.

**Fix applied:**
- Added `resolveSessionContext()` function that makes a single auth call
- Approve/reject routes now use `const { userId } = await resolveSessionContext()` — 1 call instead of 3

---

### M11 — `waitWithAbort`/`interruptibleSleep` duplicated in 2 packages [TODO]

**Agent:** Code Quality
**Files:** `packages/mcp-server/src/tools.ts`, `packages/mcp-proxy/src/gate.ts`

Identical utility functions in two packages.

**Remediation:** Extract to `@agentseam/shared` or a common utils package.

---

### M12 — Slack webhook URL returned in full [DONE]

**Agent:** Security
**Files:** `app/api/slack/config/route.ts`

`GET /api/slack/config` returns the full `webhookUrl`. Webhook URLs are bearer tokens.

**Fix applied:**
- Added `maskWebhookUrl()` helper that masks path segments: `https://hooks.slack.com/services/****/****/xxxx****`
- Applied to both GET and POST response serialization

---

### M13 — `NODE_ENV` check unreliable for security decisions [DONE]

**Agent:** Security
**Files:** `lib/auth/api-key.ts`, `lib/auth/session.ts`

Multiple auth paths use `NODE_ENV === "development"` to enable fallback auth. Misconfigured production could disable all auth.

**Fix applied:**
- Added `AGENTSEAM_DEV_MODE=true` as explicit opt-in for dev fallback auth
- Both `api-key.ts` and `session.ts` now check `AGENTSEAM_DEV_MODE === "true" || NODE_ENV === "development"` (backwards compat)
- `instrumentation.ts` warns if `AGENTSEAM_DEV_MODE` is set in production
- `.env.example` documents the new variable

---

### M14 — Missing `transpilePackages` or build ordering [DONE]

**Agent:** Architecture
**Files:** `next.config.ts`

No `transpilePackages: ["@agentseam/db"]` or build script ordering. DB package must be pre-built before Next.js build.

**Fix applied:**
- Added `transpilePackages: ["@agentseam/db"]` to `next.config.ts`

---

### M15 — `budgets.spendMicrodollars` has no concurrency protection [TODO]

**Agent:** Database
**Files:** `packages/db/src/schema.ts`

When budget enforcement is implemented, naive UPDATE without atomic increment will cause lost updates under concurrency.

**Remediation:** Use `SET spend = spend + $1` (atomic increment) or Redis Lua scripts as designed in the build spec.

---

### M16 — Cost-engine and DB type contract is implicit [TODO]

**Agent:** Architecture
**Files:** `packages/cost-engine/`, `packages/db/src/schema.ts`

Type alignment between cost-engine `CostEvent` and DB `CostEventRow` relies on structural matching, not explicit shared types.

**Remediation:** Import the DB types in the cost-engine or use a shared interface.

---

### M17 — No `pgEnum` for `status` and `action_type` columns [TODO]

**Agent:** Database
**Files:** `packages/db/src/schema.ts`

DB has no enum constraint; relies on hand-written `CHECK` constraint in migration 0001. Drizzle migrations will never manage these automatically.

**Remediation:** Convert to `pgEnum` in schema and generate migration.

---

### M18 — `budgets.entityType` and `policy` lack constraint enforcement [TODO]

**Agent:** Database
**Files:** `packages/db/src/schema.ts`

Free-text columns with no CHECK constraint. Invalid values can be inserted.

**Remediation:** Add CHECK constraints or `pgEnum`.

---

### M19 — Missing `expiresAt` column in initial migration [TODO]

**Agent:** Database
**Files:** `drizzle/0000_talented_hedge_knight.sql`

Migration 0000 creates `actions` without `expires_at`. Schema and migration were out of sync.

**Remediation:** Now addressed by migration 0002 which adds the column. Verify full migration sequence works on fresh DB.

---

### M20 — Transactions lack `SELECT ... FOR UPDATE` row locking [DONE]

**Agent:** Database, API Routes
**Files:** `lib/actions/approve-action.ts`, `lib/actions/reject-action.ts`, `lib/actions/mark-result.ts`

Optimistic concurrency works but has a TOCTOU window under concurrent approvals.

**Fix applied:**
- Added `.for("update")` to transaction SELECTs in `approve-action.ts`, `reject-action.ts`, `mark-result.ts`
- Updated mock chains in all 3 test files to support `.for()` method

---

### M21 — No rate limiting on API key creation [TODO]

**Agent:** API Routes
**Files:** `app/api/keys/route.ts`

An authenticated user could create unlimited keys.

**Remediation:** Limit to 5-10 key creation requests per minute per user. Also consider a max keys per user limit.

---

### M22 — Failover bypasses cost tracking [DONE]

**Agent:** API Routes
**Files:** `apps/proxy/src/routes/openai.ts`

Catch block failover to OpenAI produces no cost events. (Overlaps with H3.)

**Remediation:** See H3.

---

### M23 — `passThroughOnException` could forward unauthenticated requests [DONE]

**Agent:** API Routes
**Files:** `apps/proxy/src/routes/openai.ts`

If the Worker crashes before auth completes, the request is forwarded to origin without authentication. (Overlaps with H3.)

**Remediation:** See H3.

---

### M24 — 25-second timeout too aggressive for large completions [DONE]

**Agent:** API Routes
**Files:** `apps/proxy/src/routes/openai.ts`

Non-streaming GPT-4 can take >25s. Timeout would abort and trigger failover.

**Remediation:** Increase timeout to 120s for non-streaming, or make it configurable per model.

---

### M25 — Expiration update in approve/reject missing `ownerUserId` filter [DONE]

**Agent:** API Routes
**Files:** `lib/actions/approve-action.ts`, `lib/actions/reject-action.ts`

TOCTOU gap — the expiration WHERE clause doesn't include `ownerUserId`, so a race could affect the wrong user's action.

**Fix applied:**
- Added `eq(actions.ownerUserId, ownerUserId)` to expiration update WHERE clause in both `approve-action.ts` and `reject-action.ts`

---

### M26 — `markResult` does not check expiration [DONE]

**Agent:** API Routes
**Files:** `lib/actions/mark-result.ts`

Unlike approve/reject, `markResult` does not verify the action hasn't expired before writing the result.

**Resolution:** Not a bug — `isActionExpired()` only applies to `pending` actions. `markResult` operates on `approved`/`executing` actions which are past the expiration window. No code change needed.

---

### M27 — SSRF potential in webhook URL validation [DONE]

**Agent:** Security
**Files:** `app/api/slack/config/route.ts` or validation logic

`startsWith("https://hooks.slack.com/")` could be bypassed with `hooks.slack.com.evil.com`.

**Remediation:** Parse with `new URL()` and check `hostname === "hooks.slack.com"`.

---

### M28 — No payload size limits on action creation [DONE]

**Agent:** Security
**Files:** Zod schemas, `lib/validations/actions.ts`

`payloadJson` and `metadataJson` accept arbitrary-size JSON.

**Fix applied:**
- `payload`: 64KB max serialized size via `.refine()`
- `metadata`: 16KB max serialized size via `.refine()`
- `result`: 64KB max serialized size via `.refine()`
- `errorMessage`: 4,000 chars max via `.max(4_000)`
- `agentId`: 255 chars max via `.max(255)`

---

### M29 — API key error returns 403 instead of 401 [DONE]

**Agent:** Security
**Files:** `lib/utils/http.ts`

Should return 401 for authentication failure, not 403. 403 implies the identity is known but unauthorized.

**Fix applied:**
- Changed `ApiKeyError` handler in `handleRouteError()` from `status: 403` to `status: 401`

---

### M30 — Database connection string may leak in proxy logs [DONE]

**Agent:** Security
**Files:** `apps/proxy/src/lib/cost-logger.ts`

`console.error` on DB failure may include connection string with password.

**Fix applied:**
- Changed catch block to log `err.message` only instead of full error object

---

### M31 — Session fallback logic duplicated across 3 functions [DONE]

**Agent:** Code Quality
**Files:** `lib/auth/session.ts`

`assertSession()`, `resolveSessionUserId()`, `resolveApprovalActor()` all have identical try/catch/fallback pattern.

**Fix applied:**
- Extracted shared `resolveUserId()` core with `tryDevFallback()` helper
- All three functions reduced to thin one-line wrappers
- 127 lines → 80 lines, zero logic duplication

---

### M32 — No root `vitest.config.ts` [DONE]

**Agent:** Test Coverage, Architecture

Root `vitest run` uses default discovery, could pick up package tests incorrectly.

**Resolution:** Already addressed — root `vitest.config.ts` excludes `packages/**` and `apps/**`. Each package has its own `vitest.config.ts`. `pnpm test:all` runs all tests across the monorepo.

---

## Low

### L1 — No pagination on API key listing [TODO]
`app/api/keys/route.ts` — Returns all keys. Add cursor pagination for users with many keys.

### L2 — Reuses `actionIdParamsSchema` for key ID validation [TODO]
`app/api/keys/[id]/route.ts` — Semantic mismatch. Create a dedicated `keyIdParamsSchema`.

### L3 — Non-null assertion on `revokedAt` [TODO]
`app/api/keys/[id]/route.ts` — Uses `!` assertion. Add proper null check.

### L4 — Slack notification re-fetches action after creation [TODO]
`app/api/actions/route.ts` — Extra DB round-trip. Pass the created action directly.

### L5 — Redundant `assertSession()` call in approve/reject routes [DONE]
Fixed by M10 — routes now use single `resolveSessionContext()` call.

### L6 — Action ID in Slack button value is user-controllable [TODO]
Mitigated by Slack signature verification, but worth noting.

### L7 — Webhook URL validation allows any path structure [TODO]
Only checks URL prefix, not that the path matches Slack's expected format.

### L8 — Test notification returns 400 for all failure types [TODO]
Should differentiate 404 (no config) from 502 (webhook error).

### L9 — Streaming response silently swallows errors mid-stream [TODO]
No partial cost event logged when streaming fails.

### L10 — `computeExpiresAt` tristate behavior undocumented [TODO]
`undefined` = default, `null` = never, `0` = never — not documented anywhere.

### L11 — Clock skew risk between `sql NOW()` and `new Date()` [TODO]
`bulkExpireActions` uses `sql NOW()` while `expireAction` uses `new Date()`.

### L12 — `lastUsedAt` update not atomic with key lookup [TODO]
Two separate queries — key could be revoked between lookup and update.

### L13 — Header-based auth dispatch leaks timing information [TODO]
Different response times for session vs. API key auth paths.

### L14 — `readJsonBody` does not enforce max body size [TODO]
See H5.

### L15 — ZodError issues returned verbatim to client [DONE]
Sanitized: `handleRouteError` now maps issues to `{ path, message }` only, stripping internal Zod fields.

### L16 — No request ID propagation across the stack [TODO]
No correlation ID between proxy, API routes, and DB queries.

### L17 — No CORS headers on API routes [TODO]
May be needed if SDK or external clients call the API directly.

### L18 — Missing Content-Security-Policy header [DONE]
Fixed via nonce-based CSP in `proxy.ts`.

### L19 — MCP proxy spawns arbitrary commands from env [TODO]
By design, but the trust boundary is undocumented.

### L20 — No audit log for API key creation/revocation [TODO]
Security-sensitive operations should be logged.

### L21 — Redundant `conditions.length > 0` check in `listActions` [DONE]
Removed — `conditions` always has at least the `ownerUserId` filter.

### L22 — Inconsistent error response format [TODO]
Proxy and Next.js API return differently shaped error objects.

### L23 — `Phase 3` stale planning comment in openai route [DONE]
Removed stale comment from `apps/proxy/src/routes/openai.ts`.

### L24 — `createBrowserSupabaseClient` throws `Error` not `SupabaseEnvError` [TODO]
Inconsistent error typing.

### L25 — Error boundary leaks `error.message` to dashboard users [TODO]
Should show generic message in production.

### L26 — `UPSTREAM_FORWARD_HEADERS` includes `content-type` which is always overwritten [TODO]
Dead header in the forward list.

### L27 — `assertApiKey()` function is dead code [DONE]
Removed from `lib/auth/api-key.ts`. Test file updated to cover `AGENTSEAM_DEV_MODE` fallback instead.

### L28 — `isTerminalActionStatus()` and `TERMINAL_ACTION_STATUSES` unused [DONE]
Removed from `lib/utils/status.ts`.

### L29 — `Provider` type includes "mcp" but no MCP pricing exists [TODO]
Type allows a value that has no implementation.

### L30 — No `schemaFilter: ["public"]` in drizzle.config for Supabase [TODO]
Could pick up Supabase internal schemas during introspection.

### L31 — No explicit connection pool size configuration [TODO]
Relies on driver defaults.

### L32 — `costMicrodollars` can be negative [TODO]
No CHECK constraint. Add `CHECK (cost_microdollars >= 0)`.

### L33 — `costEvents` missing `actionId` for cost attribution [TODO]
Cannot link a cost event to a specific action. Needed for per-action cost reporting.

### L34 — `resetInterval` is unvalidated free text [TODO]
No enum or CHECK constraint on budget reset interval.

### L35 — `slackConfigs.updatedAt` does not auto-update [TODO]
Set on creation via `defaultNow()` but never updated on modification.

### L36 — No time-series partitioning consideration for `costEvents` [TODO]
Will become a performance issue at scale.

### L37 — `pnpm` override for drizzle-orm should be documented [TODO]
Undocumented in repo guide.

### L38 — `lib/actions/errors.ts` custom error classes have no tests [TODO]
Error classes untested.

### L39 — `packages/shared` has no test script or test files [TODO]
See H16 — package may be dead code entirely.

### L40 — Proxy smoke tests not wired into CI [TODO]
Smoke tests exist but are manual-only.

---

## Recommended Priority Order

### Phase 1 — Security Critical (do first)
- **C1**: Secrets in git — rotate immediately
- **C2**: RLS policies — database security
- **H1**: Rate limiting — DoS prevention
- **H2**: CSRF protection — session security
- **H5**: Body size limits — memory DoS prevention
- **M27**: SSRF in webhook URL — input validation

### Phase 2 — FinOps Integrity (core product value)
- **H3**: Proxy failover bypasses cost tracking
- **H4**: Cost events lack user attribution
- **H6**: Model allowlist on proxy
- **M3**: Connection pooling in proxy
- **M24**: Timeout configuration

### Phase 3 — Code Quality & Testing
- **H12**: API key route tests
- **H13**: Approve/reject route tests
- **H14**: Core action function tests
- **H15**: `test:all` monorepo script
- **H11**: Consolidate duplicate type definitions
- **H16**: Remove dead `@agentseam/shared` package

### Phase 4 — Database Hardening
- **M4**: Composite cursor pagination
- **M5**: Analytics indexes
- **M6**: Foreign keys
- **M7**: Cascading deletes
- **M15**: Atomic budget updates
- **M17**: pgEnum for status/type columns
- **M20**: Row locking in transactions

### Phase 5 — Polish
- Remaining medium and low findings
- M8 (ESLint coverage), M9 (code dedup), M10 (auth round-trips)
- Low-severity cleanup items

---

## Positive Observations

The audit also highlighted significant strengths:

- Timing-safe comparisons for API keys and Slack signatures
- API keys hashed with SHA-256 before storage (never stored in plaintext)
- Parameterized queries throughout (no SQL injection vectors found)
- Zod validation on all API inputs
- Clean dependency DAG with no circular dependencies
- Excellent proxy test suite (SSE parsing, cost calculation, edge cases)
- Mathematically rigorous cost-engine tests with IEEE 754 handling
- Consistent build tooling across all packages (tsup, dual ESM/CJS)
- Security headers configured (HSTS, X-Frame-Options, nosniff, Referrer-Policy)
- Optimistic concurrency control on state transitions
- Slack signature verification follows official protocol with timestamp drift protection
- Auth callback redirect sanitization prevents open redirect attacks
