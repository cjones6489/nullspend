# AgentSeam Codebase Audit v2 — Comprehensive Report

**Date:** March 13, 2026
**Method:** 12-agent parallel audit (6 foreground + 6 background)
**Agents:** Auth/Security, Proxy Worker, Database/Schema, Database/Packages, Cost/API, Dashboard/Components, Code Quality, Architecture/Prod Readiness, Dependency/Supply Chain, Tests/Build
**Scope:** Full codebase — Next.js 16 dashboard, Cloudflare Workers proxy, all monorepo packages, dependencies, CI/CD, observability
**Context:** Follow-up to the original 91-finding audit (90 done, 1 partial). All agents read the prior audit to check for regressions.

---

## Status Legend

| Icon | Meaning |
|------|---------|
| TODO | Not yet addressed |
| REGR | Regression of a previously-fixed finding |

---

## Executive Summary

| Severity | Count |
|----------|-------|
| Critical | 3 |
| High | 10 |
| Medium | 18 |
| Low | 25 |
| Info | 5 |
| **Total** | **61** |

**Good news:** All 780 tests pass (396 root + 384 proxy). No critical security regressions in application logic. The original 91 findings remain addressed. Core security fundamentals are strong (timing-safe auth, parameterized queries, Zod validation, fail-closed proxy).

**Key concerns for production:**
- Schema/migration drift will break on fresh deploy (C1)
- 3 packages missing `"private": true` — dependency confusion risk (C2)
- No CI/CD pipeline, no structured logging, no error monitoring (H4-H6)
- Rate limiter fails open on Redis error (M1)
- Cost analytics silently drop data from revoked keys (M6)
- CSP in report-only mode provides zero XSS protection (M10)
- Upstream error responses forwarded unsanitized from proxy (M12)
- 2 regressions from the M9 refactor (M4, M5)

---

## Critical

### C1 — Missing migration for `cost_events.action_id` column, FK, and index [DONE]

**Agents:** Database (x2)
**File:** `packages/db/src/schema.ts:127,134`

The schema defines `actionId` with FK to `actions.id` and an index, but NO migration creates them. The database does not have this column. `lib/cost-events/get-cost-events-by-action.ts:33` queries `eq(costEvents.actionId, actionId)` — this will fail at runtime on a cleanly-migrated database.

**Remediation:** Run `pnpm db:generate` to produce a migration, apply via Supabase MCP.

---

### C2 — Three packages missing `"private": true` — dependency confusion risk [DONE]

**Agents:** Dependency/Supply Chain
**Files:** `packages/sdk/package.json`, `packages/mcp-server/package.json`, `packages/mcp-proxy/package.json`

These packages lack `"private": true`. If the `@agentseam` npm scope is not claimed, an attacker could publish malicious packages under these names. `@agentseam/db` and `@agentseam/cost-engine` correctly have it.

**Remediation:**
1. Add `"private": true` to all three immediately
2. Verify `@agentseam` npm scope is claimed, or create `.npmrc` with a dummy registry

---

### C3 — Upstash API key permanently in git history [DONE]

**Agents:** Auth/Security, Dependency/Supply Chain
**File:** `.cursor/mcp.json` (commit `9fbb38a`)

The key `25f8ed3d-751b-4334-a058-a5f2dd362dcc` is recoverable via `git show 9fbb38a:.cursor/mcp.json`. While removed from tracking in commit `8f62626`, the history is permanent.

**Remediation:** Rotate the Upstash API key immediately. Consider `git filter-repo` to scrub from history if the repo was ever shared.

---

## High

### H1 — Session auth uses `getClaims()` — JWT not server-validated [DONE]

**Agents:** Auth/Security, Auth/Security (foreground)
**File:** `lib/auth/session.ts:17`

`getCurrentUserId()` uses `getClaims()` which only decodes the JWT locally without validating against the Supabase Auth server. The audit research doc explicitly recommended switching to `getUser()` for security-critical operations (approve/reject, key management).

**Remediation:** Switch to `supabase.auth.getUser()` for `resolveSessionUserId()`. Keep `getClaims()` only in `proxy.ts` for session refresh.

---

### H2 — `readJsonBody` body size not enforced post-read [DONE]

**Agents:** Auth/Security, Code Quality
**File:** `lib/utils/http.ts:37-42`

Checks `Content-Length` header (client-controlled) but then calls `request.text()` which reads the entire body. An attacker can omit `Content-Length` and send multi-megabyte payloads. The proxy does this correctly (double-check both header and byte length).

**Remediation:** Add after `request.text()`:
```ts
if (new TextEncoder().encode(rawBody).byteLength > maxBytes) throw new PayloadTooLargeError(maxBytes);
```

---

### H3 — Upstream error responses forwarded unsanitized from proxy [DONE]

**Agents:** Proxy Worker (background)
**Files:** `apps/proxy/src/routes/openai.ts:116-128`, `apps/proxy/src/routes/anthropic.ts:127-138`

When upstream returns non-2xx, the entire response body is forwarded verbatim to the client. This may leak upstream API key fragments, account identifiers, internal request IDs, or rate limit details revealing the organization's upstream tier.

**Remediation:** Parse upstream error responses and return sanitized error messages. At minimum, strip/replace body for 401/403 upstream errors.

---

### H4 — No CI/CD pipeline [DONE]

**Agent:** Architecture
**File:** (missing `.github/workflows/`)

No automated testing, type-checking, linting, or deployment. A production service handling financial data must have CI gates.

**Remediation:** Create `.github/workflows/ci.yml` running `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm proxy:test`.

---

### H5 — No structured logging or observability [TODO]

**Agent:** Architecture

Both proxy and dashboard use only `console.log/error/warn`. No structured JSON logging, no APM/tracing, no metrics, no alerting. Proxy failures (cost-logger, budget) are fire-and-forget in Cloudflare Workers logs that rotate after ~24h.

**Remediation:** Integrate structured logging (pino for dashboard, CF Logpush for proxy) and error monitoring (Sentry).

---

### H6 — No error monitoring service [TODO]

**Agent:** Architecture

Error boundaries exist in React but only log to `console.error`. No Sentry/Bugsnag. For a FinOps product, silent cost tracking failures directly impact product value.

**Remediation:** Integrate error monitoring for both dashboard and proxy.

---

### H7 — No environment variable validation at startup [DONE]

**Agent:** Architecture
**File:** `lib/db/client.ts`, `apps/proxy/src/index.ts`

Missing required env vars (`DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `PLATFORM_AUTH_KEY`) fail at first use, not at startup. No schema-based validation.

**Remediation:** Add Zod-based env validation (e.g., `@t3-oss/env-nextjs`) that runs at startup.

---

### H8 — RLS policies not in any migration [DONE]

**Agent:** Database (background)
**Files:** All `drizzle/*.sql` files

CLAUDE.md states "RLS is enabled on all tables" and C2 was marked DONE, but NO migration contains `ENABLE ROW LEVEL SECURITY` or `CREATE POLICY`. Drizzle snapshots show `"isRLSEnabled": false`. RLS was either applied via Supabase dashboard (unreproducible) or never applied.

**Remediation:** Create a versioned migration with all RLS policies. Templates exist in `docs/audit-research.md` section 2.2.

---

### H9 — `actions` CHECK constraints dropped in migration 0002, never re-added [DONE]

**Agent:** Database (background)
**File:** `drizzle/0002_certain_mandroid.sql:52-53`

Migration 0002 drops both `actions_status_check` and `actions_action_type_check` constraints. No subsequent migration re-adds them. The database accepts arbitrary values for `status` and `action_type`.

**Remediation:** Create a migration re-adding the constraints for both columns.

---

### H10 — Budget DELETE/POST routes lack transaction boundaries [DONE]

**Agent:** Database (background)
**File:** `app/api/budgets/[id]/route.ts:18-36`

The DELETE handler fetches, checks ownership, then deletes — three queries with no transaction or FOR UPDATE lock. TOCTOU vulnerability under concurrent requests.

**Remediation:** Wrap in `db.transaction()` with `.for("update")`.

---

## Medium

### M1 — Rate limiter fails OPEN on Redis error [DONE]

**Agents:** Proxy Worker (x2), Auth/Security
**Files:** `apps/proxy/src/index.ts:41-44`, `proxy.ts:45`

Both rate limiters catch Redis errors and allow requests through. A Redis outage silently disables all rate limiting.

**Remediation:** Fail-closed (503) for the FinOps proxy. At minimum, alert on failures. Consider in-memory fallback.

---

### M2 — `getRatelimit()` creates new instance per request [DONE]

**Agent:** Auth/Security (foreground)
**File:** `proxy.ts:10-18`

Creates new `Ratelimit` + `Redis` connection per request. Prevents `ephemeralCache` from working.

**Remediation:** Hoist to module-level singleton with lazy initialization.

---

### M3 — Rate limiting IP extraction uses spoofable `x-forwarded-for` [DONE]

**Agent:** Auth/Security (foreground)
**File:** `proxy.ts:26-28`

Takes the first `x-forwarded-for` entry (client-supplied). On Vercel, `request.ip` is the trusted real IP.

**Remediation:** Use `request.ip` as primary identifier.

---

### M4 — `resolveAction` setFields can override `status` [DONE] [REGR]

**Agent:** Auth/Security (foreground)
**File:** `lib/actions/resolve-action.ts:18,56`

Spread order `{ status: targetStatus, ...setFields }` allows `setFields` to override `status`. Also typed as `Record<string, unknown>` — too loose.

**Remediation:** Swap to `{ ...setFields, status: targetStatus }` and narrow the type.

---

### M5 — `resolveAction` uses `new Date()` instead of `sql NOW()` [DONE] [REGR]

**Agent:** Cost/API
**File:** `lib/actions/resolve-action.ts:41`

L11 fix reintroduced by M9 refactor. Clock skew risk between JS runtime and database.

**Remediation:** Change to `` sql`NOW()` ``.

---

### M6 — Cost analytics silently drop data from revoked API keys [DONE]

**Agents:** Cost/API, Database (background), Code Quality
**File:** `lib/cost-events/aggregate-cost-events.ts:9`

`isNull(apiKeys.revokedAt)` in `baseConditions` hides all historical spend from revoked keys. Also uses `INNER JOIN` which drops events with null `apiKeyId`.

**Remediation:** Remove `isNull(apiKeys.revokedAt)`. Consider `LEFT JOIN` and scoping via `costEvents.userId` instead.

---

### M7 — Anthropic `anthropic-version` header silently overrides client value [DONE]

**Agents:** Proxy Worker (x2)
**File:** `apps/proxy/src/lib/anthropic-headers.ts:17`

Always sets `2023-06-01` regardless of client value. Clients cannot use newer API features.

**Remediation:** Forward client's header if present; inject default only if absent.

---

### M8 — `getModelPricing` returns mutable reference to pricing singleton [DONE]

**Agent:** Database/Packages
**File:** `packages/cost-engine/src/pricing.ts:16-18`

**Remediation:** `Object.freeze()` each entry or return shallow copies.

---

### M9 — No CHECK constraints for non-negative token counts [DONE]

**Agents:** Database (x2)
**File:** `packages/db/src/schema.ts:121-124`

**Remediation:** Add migration with CHECK constraints on all 4 token columns.

---

### M10 — CSP in report-only mode — zero XSS protection [DONE]

**Agents:** Auth/Security, Architecture, Dependency/Supply Chain
**File:** `proxy.ts:121`

`Content-Security-Policy-Report-Only` logs but does NOT block. No reporting endpoint configured either.

**Remediation:** Promote to enforcing `Content-Security-Policy`. Add `report-to` endpoint.

---

### M11 — CSRF relies solely on `Origin` header presence [DONE]

**Agents:** Auth/Security (x2), Code Quality
**File:** `proxy.ts:56-73`

When `Origin` is absent, no CSRF check runs. Older browsers or form submissions may omit it.

**Remediation:** For session-authenticated routes, require `Origin` or fall back to `Referer` check.

---

### M12 — Budget estimation ignores long-context rate multipliers (Anthropic) [DONE]

**Agents:** Proxy Worker (x2)
**File:** `apps/proxy/src/lib/anthropic-cost-estimator.ts:53-75`

Estimator uses base rates, but calculator applies 2x input / 1.5x output for >200K tokens. Also ignores cache write costs. Budget reservations could be underestimated by up to 2x.

**Remediation:** Apply long-context multipliers in estimator when input exceeds 200K tokens.

---

### M13 — Slack callback authorization silently bypasses on DB failure [DONE]

**Agents:** Code Quality, Auth/Security (background)
**File:** `app/api/slack/callback/route.ts:140-142`

If the DB lookup fails, error is logged but execution continues — action approved/rejected without authorization check.

**Remediation:** Return error response instead of falling through.

---

### M14 — Budget spend updates not batched in transaction [DONE]

**Agent:** Database (background)
**File:** `apps/proxy/src/lib/budget-spend.ts:46-58`

Iterates entities with separate UPDATEs, no transaction. If second update fails, first entity's spend is incremented but second is not.

**Remediation:** Wrap the loop in `db.transaction()`.

---

### M15 — No explicit REVOKE on anon role in any migration [DONE]

**Agent:** Database (background)
**Files:** All `drizzle/*.sql` files

CLAUDE.md claims "anon role has zero privileges" but no migration has `REVOKE ALL ... FROM anon`.

**Remediation:** Add explicit REVOKE statements to the RLS migration.

---

### M16 — DB semaphore queue unbounded, no timeout [DONE]

**Agents:** Proxy Worker, Architecture, Code Quality
**File:** `apps/proxy/src/lib/db-semaphore.ts:10-12`

Queue grows unboundedly under sustained load. If a callback never resolves (DB hang), the slot is never released.

**Remediation:** Add timeout to queue wait and max queue depth with circuit-breaker.

---

### M17 — `shadcn` listed as production dependency [DONE]

**Agent:** Dependency/Supply Chain
**File:** `package.json`

CLI code-generation tool. Never imported at runtime. Bloats prod dependency tree.

**Remediation:** Move to `devDependencies`.

---

### M18 — `budgets.maxBudgetMicrodollars` allows zero or negative values [DONE]

**Agent:** Database (background)
**File:** `packages/db/src/schema.ts:100`

No CHECK constraint. Zero budget permanently blocks; negative breaks arithmetic.

**Remediation:** Add migration: `CHECK (max_budget_microdollars > 0)` and `CHECK (spend_microdollars >= 0)`.

---

## Low

### L1 — `updatedAt` columns have no auto-update trigger [DONE]

**Agents:** Database (x2)
**File:** `packages/db/src/schema.ts:91,106`

`defaultNow()` only fires on INSERT. Slack config upsert manually sets it; future UPDATE paths may forget.

**Remediation:** Add `moddatetime` trigger or document manual requirement.

---

### L2 — Budget column types too loose (no `.$type<>()`) [DONE]

**Agent:** Database/Packages
**File:** `packages/db/src/schema.ts:98,102,103`

`entityType`, `policy`, `resetInterval` typed as plain `text` despite CHECK constraints.

**Remediation:** Add `.$type<>()` annotations.

---

### L3 — Duplicated ACTION_TYPES/STATUSES across db and sdk [DONE]

**Agents:** Multiple
**Files:** `packages/db/src/schema.ts`, `packages/sdk/src/types.ts`

**Remediation:** Add cross-package equality test.

---

### L4 — Auth callback redirect doesn't block backslashes [DONE]

**File:** `app/(auth)/auth/callback/route.ts:8`

---

### L5 — Login page leaks Supabase auth error details [DONE]

**File:** `app/(auth)/login/page.tsx:40`

---

### L6 — Dead code: `buildFailoverHeaders` [DONE]

**Agents:** Multiple
**File:** `apps/proxy/src/lib/headers.ts:64-72`

---

### L7 — Attribution headers unvalidated in proxy [DONE]

**Agents:** Proxy Worker (x2)
**Files:** `apps/proxy/src/routes/openai.ts:29-31`, `apps/proxy/src/routes/anthropic.ts:41-43`

`x-agentseam-user-id`, `x-agentseam-key-id` used in Redis keys and DB writes without length/format validation. Any authenticated caller can impersonate any identity.

**Remediation:** Validate format (UUID, max length). Document as admin-level trust boundary.

---

### L8 — `NODE_ENV === "development"` fallback for dev auth [DONE]

**Agent:** Auth/Security (background)
**Files:** `lib/auth/api-key.ts:42`, `lib/auth/session.ts:8`

Misconfigured staging with `NODE_ENV=development` enables auth bypass. `instrumentation.ts` only checks `AGENTSEAM_DEV_MODE`.

**Remediation:** Remove `NODE_ENV` fallback in future release; add startup check for `NODE_ENV=development` in production.

---

### L9 — INNER JOIN drops cost events with null `apiKeyId` [DONE]

**File:** `lib/cost-events/aggregate-cost-events.ts:34`

---

### L10 — `requestCount` missing `.mapWith(Number)` [DONE]

**File:** `lib/cost-events/aggregate-cost-events.ts:50`

---

### L11 — Sidebar active-route fragile prefix matching [DONE]

**File:** `components/dashboard/sidebar.tsx:62`

---

### L12 — Missing `aria-current="page"` on sidebar [DONE]

**File:** `components/dashboard/sidebar.tsx:64-76`

---

### L13 — Command palette `useEffect` re-subscribes on toggle [DONE]

**File:** `components/dashboard/command-palette.tsx:35-45`

---

### L14 — SDK/MCP test mocks missing `expiresAt` field [DONE]

**Files:** `packages/sdk/src/client.test.ts`, `packages/mcp-server/src/tools.test.ts`

---

### L15 — `@agentseam/mcp-proxy` lists unused `zod` dependency [DONE]

**File:** `packages/mcp-proxy/package.json:34`

---

### L16 — `totalsSchema` period validation too permissive [DONE]

**File:** `lib/validations/cost-event-summary.ts:46`

---

### L17 — `totalCostMicrodollars` missing `.nonnegative()` [DONE]

**File:** `lib/validations/cost-event-summary.ts:9`

---

### L18 — `recharts` override range misaligns with pin [DONE]

**File:** `package.json:54,66`

---

### L19 — No `.npmrc` for registry pinning [DONE]

**Agent:** Dependency/Supply Chain

**Remediation:** Create `.npmrc` pinning `@agentseam` scope.

---

### L20 — Dual zod versions in lockfile (3.x + 4.x) [TODO]

**Agent:** Dependency/Supply Chain

`@modelcontextprotocol/sdk` brings zod 3.x alongside project's zod 4.x.

---

### L21 — No dashboard health check endpoint [DONE]

**Agent:** Architecture

**Remediation:** Add `app/api/health/route.ts` with DB connectivity check.

---

### L22 — Rate limiting is IP-only, no per-key limiting in proxy [DONE]

**Agent:** Architecture

**Remediation:** Add per-API-key rate limiting using `x-agentseam-key-id` after auth.

---

### L23 — `costEvents.userId` nullable with no attribution constraint [DONE]

**Agent:** Database (background)
**File:** `packages/db/src/schema.ts:118`

Cost events can exist with neither `userId` nor `apiKeyId`, invisible to all dashboard queries.

**Remediation:** Consider `CHECK (user_id IS NOT NULL OR api_key_id IS NOT NULL)`.

---

### L24 — Stale `packages/shared/dist/**` in eslint ignores [DONE]

**Agent:** Architecture
**File:** `eslint.config.mjs:10`

`packages/shared/` was deleted in H16. Harmless but stale config.

---

### L25 — Budget denial response leaks exact spend figures [DONE]

**Agent:** Proxy Worker (background)
**Files:** `apps/proxy/src/routes/openai.ts:84-96`, `apps/proxy/src/routes/anthropic.ts:93-106`

Detailed budget information (exact spend, remaining, limit in microdollars) returned to clients.

---

## Info

### I1 — Analytics shortcut uses non-mnemonic `G N`

**File:** `components/dashboard/command-palette.tsx:25`

### I2 — Wrangler config doesn't document required secrets

**File:** `apps/proxy/wrangler.jsonc`

### I3 — `costComponent` docstring dimensional analysis unclear

**File:** `packages/cost-engine/src/pricing.ts:29-41`

### I4 — Hyperdrive ID in committed wrangler config

**File:** `apps/proxy/wrangler.jsonc:12`
Not a secret, but reveals infrastructure details.

### I5 — No proxy deployment runbook

No docs for Hyperdrive setup, secret configuration, DNS/routing, or rollback.

---

## Test & Build Health

| Check | Status | Details |
|-------|--------|---------|
| Root tests (`pnpm test`) | **PASS** | 400/400 |
| Proxy tests (`pnpm proxy:test`) | **PASS** | 382/382 |
| TypeScript (`pnpm typecheck`) | **FAIL** | 13 errors — all in test files (`NODE_ENV` readonly in `@types/node@25`, Zod v4 type change) |
| Lint (`pnpm lint`) | **FAIL** | 56 errors — all unused vars in tests/scripts, 2 in production code |
| Dependency audit (`pnpm audit`) | **9 vulns** | 4 HIGH (dev-only), 5 MODERATE (1 runtime) |

### Dependency Vulnerabilities

| Severity | Package | Via | Runtime? | Fix |
|----------|---------|-----|----------|-----|
| HIGH | `flatted` <3.4.0 | eslint > flat-cache | Dev-only | Update eslint or override |
| HIGH | `undici` <7.24.0 (3 CVEs) | wrangler > miniflare | Dev-only | Update wrangler |
| MODERATE | `esbuild` <0.25.0 | wrangler, @opennextjs/cloudflare | Dev-only | Update wrangler |
| MODERATE | `hono` <4.12.7 | @modelcontextprotocol/sdk | **Runtime** | Update @modelcontextprotocol/sdk |

---

## Positive Observations

All 12 agents confirmed these strengths remain intact:

- **Timing-safe API key comparison** with SHA-256 hashing and length-equalization
- **Parameterized queries throughout** — no SQL injection vectors found by any agent
- **Zod validation on all API inputs** with bounded payload sizes
- **Clean dependency DAG** — no circular dependencies
- **Comprehensive test suites** — 780 tests total with strong coverage
- **Auth-first architecture** in proxy — validates before any processing
- **Fail-closed error handling** — 502 on unhandled proxy errors, 503 on budget service failure
- **Security headers configured** — HSTS, X-Frame-Options: DENY, nosniff, Referrer-Policy
- **Optimistic concurrency** — `SELECT ... FOR UPDATE` with status-based WHERE clauses
- **Budget reservation lifecycle** — every code path (success, failure, timeout, parse error) reconciles reservations
- **Slack signature verification** — HMAC-SHA256 with timestamp replay protection
- **Auth callback redirect sanitization** — blocks `//` prefix open redirects
- **Correct SSE parsing** — `TextDecoder` with `{ stream: true }` for multi-byte UTF-8 safety
- **Deferred rounding in cost calculation** — sum floats, round once to avoid per-component error accumulation

---

## Recommended Priority Order

### Phase 0 — Immediate (today)
1. **C3**: Rotate Upstash API key (git history exposure)
2. **C2**: Add `"private": true` to 3 packages (5-second fix, prevents dependency confusion)

### Phase 1 — Pre-Production Blockers
3. **C1**: Generate missing `action_id` migration (code will break on fresh deploy)
4. **H4**: Create CI/CD pipeline (no other quality gate exists)
5. **H5/H6**: Integrate error monitoring + structured logging
6. **M5**: Fix L11 regression (`new Date()` → `sql NOW()`) [REGR]
7. **M4**: Fix setFields spread order in resolveAction [REGR]

### Phase 2 — Security Hardening
8. **H1**: Switch to `getUser()` for security-critical auth
9. **H2**: Post-read body size enforcement in `readJsonBody`
10. **H3**: Sanitize upstream error responses in proxy
11. **H8**: Create RLS migration (version-controlled)
12. **H9**: Re-add dropped `actions` CHECK constraints
13. **M1**: Rate limiter fail-closed policy
14. **M10**: Promote CSP to enforcing mode
15. **M11**: CSRF Referer fallback

### Phase 3 — Data Integrity
16. **M6**: Don't hide revoked-key cost data
17. **H10**: Transaction boundaries on budget routes
18. **M14**: Transaction for budget spend updates
19. **M9**: Non-negative token CHECK constraints
20. **M18**: Positive budget CHECK constraint

### Phase 4 — Operational Readiness
21. **H7**: Env var validation at startup
22. **M2/M3**: Singleton rate limiter + trusted IP extraction
23. **M7**: Forward client's anthropic-version header
24. **M12**: Long-context multipliers in budget estimator
25. **M13**: Slack callback fail-closed on DB error

### Phase 5 — Quality & Cleanup
26. Fix 13 typecheck errors + 56 lint errors
27. Update deps to resolve 9 audit vulnerabilities
28. **M17**: Move `shadcn` to devDependencies
29. All remaining Low and Info items
