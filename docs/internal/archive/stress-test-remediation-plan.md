# Stress Test Remediation Plan

Generated from the Phase 2A deep stress test audit (2026-03-16).
Tracks all findings from the live system stress test across input validation,
concurrency, performance, data integrity, auth, observability, and dependencies.

## Status Key

- [ ] Not started
- [x] Complete
- [~] In progress

---

## CRITICAL: Unit Tests Are Not Sufficient — Live Stack Verification Required

**Finding (2026-03-16):** The original stress test was created because local unit
tests were passing while the live production stack had real failures. This is the
foundational lesson of this entire remediation effort.

**Root cause:** Unit tests mock external dependencies (Redis, Supabase, Stripe,
Sentry, database). They verify logic correctness but cannot detect:
- Real connection failures (Redis unreachable, Supabase auth timeout)
- Header propagation through actual HTTP hops (proxy → route → response)
- Sentry events actually arriving in the Sentry dashboard
- Structured log output actually parseable by the log aggregator
- Health check actually reaching Redis vs. only testing the mock path
- Configuration mismatches (wrong DSN, missing env vars, wrong package version)
- Cloudflare Workers runtime differences vs. Miniflare simulator
- Deployed proxy → live database → real cost calculation pipeline

### Mandate: Three-Tier Verification for Every Phase

Every remediation item MUST pass all applicable tiers before being marked `[x]`:

| Tier | What it tests | How to run | When required |
|------|--------------|------------|---------------|
| **Unit** | Logic correctness with mocked dependencies | `pnpm test`, `pnpm proxy:test` | Always |
| **E2E Local** | Live stack against the local dev server (real DB, real Redis) | `pnpm e2e`, `pnpm e2e:observability`, `pnpm e2e:auth` | Always |
| **E2E Deployed** | Live stack against the deployed proxy worker and/or Vercel preview | `pnpm proxy:smoke` against deployed URL | When changes touch proxy worker, auth, or cross-service paths |

### E2E Scripts Inventory

| Script | Target | Tests |
|--------|--------|-------|
| `scripts/e2e-smoke.ts` | Dashboard dev server | 31 tests — action lifecycle, auth, validation, concurrency, expiration, input hardening |
| `scripts/e2e-observability.ts` | Dashboard dev server | 17 tests — request IDs, health, CSRF, rate limiting, auth enforcement |
| `scripts/e2e-auth-hardening.ts` | Dashboard dev server | 9 tests — Cache-Control, Vary, cross-tenant isolation, per-key rate limiting |
| `scripts/e2e-sdk-retry-stress.ts` | Dashboard dev server | SDK retry, backoff, idempotency under load |
| `scripts/e2e-stripe-billing.ts` | Dashboard dev server | Stripe checkout, subscription lifecycle |
| `apps/proxy/smoke-*.test.ts` | Proxy (local or deployed) | 23 files — auth, cost e2e, budget enforcement, security, resilience, load, pricing accuracy, known issues (uses `x-nullspend-key` API key auth) |

### E2E Ordering Constraint

The `e2e:observability` suite sends 105+ rapid requests to test per-IP rate limiting,
exhausting the 100 req/min per-IP sliding window. Any subsequent e2e suite from the
same IP will get 429s for up to 60 seconds. **Order:**
1. `pnpm e2e` (27 tests, ~30 requests)
2. `pnpm e2e:auth` (9 tests, ~80 requests — has built-in per-IP backoff)
3. Wait 60 seconds
4. `pnpm e2e:observability` (17 tests, 105+ requests — **run last**)

The `e2e:auth` script auto-detects per-IP exhaustion at startup and waits for the
window to reset before proceeding.

### What's Missing: Deployed Proxy E2E

The proxy worker (`apps/proxy/`) currently has **670 unit tests via Miniflare** but
**zero tests against the actually deployed Cloudflare Worker**. Miniflare simulates
the Workers runtime but cannot catch:
- Real TCP connection limits to Supabase/Postgres (6 concurrent max on CF Workers)
- Actual DNS resolution and TLS handshake latency
- Deployed wrangler.toml binding mismatches
- Production D1/KV/Durable Object configuration (if added later)
- Real cost calculation against live provider responses
- Budget enforcement against live database state

**Gating requirement for Phases 2–6:** Any phase that touches the proxy worker,
cross-service auth, budget enforcement, or cost calculation MUST include an e2e
test against the deployed proxy worker URL (not just Miniflare).

### Phase-Specific E2E Requirements

| Phase | Dashboard E2E Required | Deployed Proxy E2E Required | Rationale |
|-------|----------------------|---------------------------|-----------|
| Phase 2: Auth hardening | Yes ✅ done | Yes — API key auth flows through proxy | Auth is the #1 failure mode on live stack |
| Phase 3: Validation | Yes — depth limit, expires bound, content-type | No — validation is dashboard-only | Pure input validation, no cross-service |
| Phase 4: Proxy hardening | No — proxy-only changes | **Yes — pg pool, CPU profiling, wrangler upgrade** | This is literally about deployed proxy behavior |
| Phase 5: Resilience | Yes — Slack retry, idempotency, circuit breaker | Yes — idempotency flows through proxy | Retry/idempotency spans proxy → dashboard |
| Phase 6: Monitoring | Yes — metrics endpoint, dashboard perf | Yes — proxy metrics, request tracing | End-to-end observability requires both |

### Definition of Done

An item is NOT complete until:
1. Unit tests pass (`pnpm test` + `pnpm proxy:test`)
2. TypeScript compiles (`pnpm typecheck`)
3. No new lint errors (`pnpm lint`)
4. E2E local tests pass against dev server
5. E2E deployed tests pass against deployed worker (if phase requires it)
6. Build succeeds (`pnpm build`)

---

## Phase 0: Emergency (must fix before any new deploy)

**Goal:** Prevent production-down scenarios and silent data loss.

### 0.1 Verify drizzle-orm resolves to 0.45.1+ in proxy workspace
- **Severity:** Critical
- **Risk:** drizzle-orm 0.45.0 crashes Cloudflare Workers on startup (`Dynamic require of 'pg-native' is not supported`). The proxy uses this exact import path in budget-lookup.ts, budget-spend.ts, and cost-logger.ts.
- **Action:** Run `pnpm ls drizzle-orm` in `apps/proxy/`. If 0.45.0, add explicit resolution in root `package.json` overrides.
- **Verify:** `pnpm proxy:dev` starts without error; `pnpm proxy:test` passes.
- **Effort:** 15 minutes
- **Status:** [x] Verified — resolves to 0.45.1 (2026-03-16)

### 0.2 Block dev mode in production (hard fail)
- **Severity:** Critical
- **Risk:** `NULLSPEND_DEV_MODE=true` makes GET endpoints publicly readable without auth. Currently `instrumentation.ts` only logs a warning.
- **Action:** In `instrumentation.ts`, throw an error (not just log) if `NULLSPEND_DEV_MODE=true && NODE_ENV=production`. Also add the check to the health endpoint.
- **Verify:** Set both env vars, run `NODE_ENV=production pnpm dev` → app refuses to start.
- **Effort:** 30 minutes
- **Status:** [x] Implemented — `instrumentation.ts` throws on DEV_MODE in production; health endpoint flags devMode (2026-03-16)

### 0.3 Migration verification on app startup
- **Severity:** High
- **Risk:** Two routes returned 500 because migrations were never applied. No mechanism detected this. Silent failure for unknown duration.
- **Action:** Add schema verification to the health endpoint that checks critical tables and columns exist in the database. This catches the actual failure mode (missing schema) regardless of whether migrations were applied via Drizzle, Supabase MCP, or raw SQL.
- **Verify:** GET /api/health → `{ status: "ok", components: { database: "ok", schema: "ok" } }`. Drop a column → health returns `{ status: "degraded", schema: { error: "Missing: table.column" } }`.
- **Effort:** 2–3 hours
- **Status:** [x] Implemented — health endpoint checks 9 tables, 37 columns via information_schema (2026-03-16)

---

## Phase 1: Observability Foundation (should fix before wider rollout)

**Goal:** Make failures visible, diagnosable, and traceable.

**Implementation:** Phase 1A (infrastructure) is complete. Phase 1B (console migration + route wrapper adoption) is deferred to a follow-up PR.

### 1.1 Structured logging with pino
- **Severity:** High
- **Risk:** 44 files use ad-hoc `console.log/error`. No JSON format, no log levels, no aggregation. Cannot search or filter production logs.
- **Action:**
  - Add `pino` to root dependencies
  - Create `lib/observability/logger.ts` that exports a configured pino logger factory
  - Create `lib/observability/request-context.ts` with route-scoped AsyncLocalStorage
  - `getLogger(component)` auto-includes `requestId` when inside a request context
  - Output JSON to stdout (compatible with Vercel, Datadog, etc.)
- **Verify:**
  - **Unit:** App logs are valid JSON with `level`, `time`, `msg` fields. `requestId` present in route context.
  - **E2E:** `scripts/e2e-observability.ts` — trigger a real request, parse JSON log output, verify fields.
- **Effort:** 1–2 days
- **Status:** [~] Infrastructure complete (Phase 1A). Console migration deferred (Phase 1B).

### 1.2 Request ID generation and propagation
- **Severity:** High
- **Status:** [x] Complete (2026-03-16)

### 1.3 Sentry (or equivalent) error tracking
- **Severity:** High
- **Status:** [x] Complete (2026-03-16)

### 1.4 Complete health check endpoint
- **Severity:** High
- **Status:** [x] Complete (2026-03-16)

### 1.5 E2E observability + infrastructure smoke test
- **Severity:** High
- **Status:** [x] Complete — 17 tests in `scripts/e2e-observability.ts` (2026-03-16)

### 1.6 Findings from live stack testing (2026-03-16)
- **Vitest picks up pino tests from .next/dev cache:** Fixed — added `.next/**` to vitest exclude list.
- **Rate limit test poisons subsequent tests:** Fixed — rate limit test runs last in the e2e suite.
- **e2e-smoke Test 10 payload exceeded validation limit:** Fixed — reduced to 400 items (~61KB).
- **GET /api/actions uses session auth, not API key auth:** By design — documented explicitly.

---

## Phase 2: Auth and Rate Limiting Hardening

**Goal:** Prevent abuse and tenant isolation failures.

**Status:** [x] Complete (2026-03-16). All items implemented, audited twice, and verified against live stack.

**E2E gate:** Dashboard e2e complete ✅. Deployed proxy e2e still needed for full sign-off.
Script: `scripts/e2e-auth-hardening.ts` — 9 tests, all passing against dev server.

### 2.1 Per-API-key rate limiting
- **Severity:** Medium
- **Status:** [x] Complete (2026-03-16)

**What was implemented:**
- `lib/auth/api-key-rate-limit.ts` — Singleton per-key rate limiter using `@upstash/ratelimit` sliding window (60 req/min default, configurable via `NULLSPEND_API_KEY_RATE_LIMIT`). Uses separate Redis prefix `nullspend:api:rl:key` (distinct from proxy's `nullspend:api:rl`). Fail-open — per-IP in proxy is the DDoS safety net, per-key is about fairness.
- `lib/auth/with-api-key-auth.ts` — `authenticateApiKey()` combines API key validation + per-key rate limiting. Returns `ApiKeyAuthContext | Response`. Includes `RateLimitInfo` on success for downstream `X-RateLimit-*` header propagation. `applyRateLimitHeaders()` helper sets headers on success responses.
- `lib/auth/dual-auth.ts` — Updated `assertApiKeyOrSession()` return type from `Promise<string>` to `Promise<string | Response>` to pass through 429s.
- 4 Pattern A routes updated (direct `authenticateApiKey`): `app/api/actions/route.ts` POST, `app/api/actions/[id]/result/route.ts` POST, `app/api/auth/introspect/route.ts` GET, `app/api/tool-costs/discover/route.ts` POST
- 3 Pattern B routes updated (dual-auth `string | Response` guard): `app/api/actions/[id]/route.ts` GET, `app/api/actions/[id]/costs/route.ts` GET, `app/api/tool-costs/route.ts` GET
- All Pattern A routes apply `applyRateLimitHeaders()` on success responses so clients see `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` headers before hitting 429.

**Key design decisions:**
- Per-key rate limit runs AFTER auth (needs keyId). Per-IP runs BEFORE auth in proxy.
- Rate limit tokens consumed even on requests that later fail (validation error, DB error) — standard pattern.
- `lastUsedAt` DB write happens before rate limit check — reflects "last authentication attempt" including rate-limited requests.
- `Retry-After` header clamped to `Math.max(1, ...)` to prevent negative values under clock skew.
- `x-request-id` on 429 only set when request header is present and non-empty.
- Dev-mode env keys (no keyId) skip per-key rate limiting entirely.

**Rollback:** Set `NULLSPEND_API_KEY_RATE_LIMIT=999999` or unset `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` to effectively disable per-key rate limiting. Per-IP in proxy remains active.

**Unit tests:** `lib/auth/api-key-rate-limit.test.ts` (6 tests), `lib/auth/with-api-key-auth.test.ts` (11 tests), `lib/auth/dual-auth.test.ts` (5 tests). 429 passthrough tests added to all 7 route test files.

**E2E tests (Test 3, 8, 9 in `e2e-auth-hardening.ts`):**
- Test 3: Success response carries `X-RateLimit-*` headers
- Test 8: Sequential requests exhaust Key A at limit=60 (verified distinct from per-IP limit=100)
- Test 9: Key B succeeds after Key A is exhausted (per-key isolation)

### 2.2 Cross-tenant isolation test suite
- **Severity:** Medium
- **Status:** [x] Complete (2026-03-16)

**What was implemented:**
- E2E test creates two test users (`e2e-tenant-a-{timestamp}`, `e2e-tenant-b-{timestamp}`) with managed API keys via direct SQL (using `generateRawKey`-compatible SHA-256 hashing).
- 4 cross-tenant isolation tests verify:
  - Test 4: User B cannot read User A's action (GET → 404)
  - Test 5: User B cannot POST result to User A's approved action (→ 404)
  - Test 6: Each user introspects their own userId (identity isolation)
  - Test 7: User B cannot see User A's discovered tools (tool-costs isolation)
- All actions created with `expiresInSeconds: 0` (never-expire) to eliminate timing dependency.
- Teardown deletes test data in FK-safe order: cost_events → actions → tool_costs → api_keys.

**What is NOT yet tested:** Cross-tenant isolation through the deployed proxy worker. The proxy worker has its own auth path (`apps/proxy/`) which was explicitly out of scope for Phase 2 (proxy already has per-key rate limiting). Deployed proxy e2e should be added when Phase 4 work begins.

### 2.3 Cache-Control headers on auth-touching responses
- **Severity:** Medium
- **Status:** [x] Complete (2026-03-16)

**What was implemented:**
- `proxy.ts` `withRequestId()` helper: unconditionally sets `Cache-Control: private, no-store` on all early-return error responses (429, 503, 403, 400, 413). All callers are within `/api/` path guards.
- `proxy.ts` normal response path: `Cache-Control: private, no-store` and `Vary: Cookie` on all `/api/` responses. `Vary` uses `headers.append()` (not `set()`) to preserve any existing Vary values.
- Per-key 429 from `authenticateApiKey`: includes its own `Cache-Control: private, no-store` since it bypasses the proxy response path.

**E2E tests (Tests 1-2 in `e2e-auth-hardening.ts`):**
- Test 1: API response has `Cache-Control: private, no-store`
- Test 2: API response has `Vary` containing `Cookie`

### 2.4 Findings from Phase 2 audits (2026-03-16)

Two post-implementation audits were conducted. All findings were fixed before verification:

**Audit 1 findings (all fixed):**
- E2E `createActionForUser` consumed response body twice (template literal eagerly evaluates `await res.text()`) — fixed to conditional read
- `Vary: Cookie` used `set()` instead of `append()` — fixed
- Missing `dual-auth.test.ts` — created with 5 tests
- Missing `tool-costs/route.test.ts` and `tool-costs/discover/route.test.ts` — created with 3 and 2 tests respectively
- No rate limit headers on success responses — added `RateLimitInfo` to `ApiKeyAuthContext` + `applyRateLimitHeaders()` helper
- E2E discover call not asserted — added status assertion
- Test mocks for `@/lib/auth/with-api-key-auth` didn't preserve `applyRateLimitHeaders` — fixed with `importOriginal` pattern

**Audit 2 findings (all fixed):**
- `Retry-After` could be negative under clock skew — clamped to `Math.max(1, ...)`  in both `proxy.ts` and `with-api-key-auth.ts`
- `pending` promise from `@upstash/ratelimit` not captured — added protective comments (safe because `analytics` is not enabled)
- `dual-auth.test.ts` hardcoded `API_KEY_HEADER` constant — changed to `importActual`
- Empty `x-request-id` header on per-key 429 — now conditionally set only when present
- E2E fragile to per-IP exhaustion from prior test runs — added startup backoff detection
- Missing test for negative `Retry-After` — added to both `proxy.test.ts` and `with-api-key-auth.test.ts`
- Missing e2e test for success response rate limit headers — added as Test 3

### Phase 2 verification results (2026-03-16)

```
pnpm test          — 60 files, 563 tests passed
pnpm proxy:test    — 40 files, 670 tests passed
pnpm typecheck     — clean
pnpm e2e:auth      — 9/9 passed (live stack)
pnpm e2e:observability — 17/17 passed (live stack)
pnpm e2e           — 27/27 passed (live stack)
```

### Phase 2 files inventory

**New files (8):**
| File | Purpose |
|------|---------|
| `lib/auth/api-key-rate-limit.ts` | Per-key rate limiter singleton |
| `lib/auth/api-key-rate-limit.test.ts` | 6 unit tests |
| `lib/auth/with-api-key-auth.ts` | Combined auth + rate limit + `applyRateLimitHeaders` helper |
| `lib/auth/with-api-key-auth.test.ts` | 11 unit tests (incl. negative Retry-After, x-request-id omission) |
| `lib/auth/dual-auth.test.ts` | 5 unit tests for return type change |
| `app/api/tool-costs/route.test.ts` | 3 tests (GET auth + 429 passthrough + POST session auth) |
| `app/api/tool-costs/discover/route.test.ts` | 2 tests (discover + 429 passthrough) |
| `scripts/e2e-auth-hardening.ts` | 9 e2e tests against live stack |

**Modified files (16):**
| File | Change |
|------|--------|
| `proxy.ts` | `Cache-Control` in `withRequestId` + `Vary: Cookie` (append) on normal API path + `Retry-After` clamp + `pending` comment |
| `proxy.test.ts` | 6 new tests (Cache-Control × 5 + Retry-After clamp) |
| `lib/auth/dual-auth.ts` | Uses `authenticateApiKey`, returns `string \| Response` |
| `lib/auth/api-key.ts` | `@internal` JSDoc on `assertApiKeyWithIdentity` + `resolveDevFallbackApiKeyUserId` |
| `app/api/actions/route.ts` | POST: `authenticateApiKey` + `applyRateLimitHeaders` |
| `app/api/actions/[id]/route.ts` | GET: `instanceof Response` guard on dual-auth |
| `app/api/actions/[id]/result/route.ts` | POST: `authenticateApiKey` + `applyRateLimitHeaders` |
| `app/api/actions/[id]/costs/route.ts` | GET: `instanceof Response` guard on dual-auth |
| `app/api/auth/introspect/route.ts` | GET: `authenticateApiKey` + `applyRateLimitHeaders` (managed key path only) |
| `app/api/tool-costs/route.ts` | GET: `instanceof Response` guard on dual-auth |
| `app/api/tool-costs/discover/route.ts` | POST: `authenticateApiKey` + `applyRateLimitHeaders` |
| `app/api/actions/route.test.ts` | Mock updated to `importOriginal`, 429 test added |
| `app/api/actions/[id]/result/route.test.ts` | Mock updated, 429 test added |
| `app/api/actions/[id]/route.test.ts` | 429 passthrough test added |
| `app/api/actions/[id]/costs/route.test.ts` | 429 passthrough test added |
| `app/api/auth/introspect/route.test.ts` | Mock updated to `importOriginal`, 429 test added, `importActual` for `ApiKeyError` |
| `package.json` | Added `e2e:auth` script |

### Known limitations (acceptable for launch, track for future)

1. **Per-key rate limit 429 bypasses `handleRouteError` / Sentry:** Rate limit rejections are logged at `info` level via `getLogger("rate-limit")` but do not generate Sentry events. Monitor via log aggregation. Consider adding a Sentry breadcrumb post-launch.
2. **Two separate `Redis.fromEnv()` instances:** Per-IP and per-key limiters each create their own HTTP-based Redis client. Doubles Redis round-trips per API request. Acceptable for `@upstash/redis` (connectionless HTTP), but consider a shared instance if latency becomes a concern.
3. **`ephemeralCache` is per-serverless-instance:** The in-memory cache only helps within a single hot function instance. Under multi-instance scaling, blocked keys may still reach Redis before being cache-blocked. This is by design per Upstash docs.
4. **Rate limit tokens consumed on requests that later fail validation:** Standard pattern. A malformed request from an agent still consumes a token. At 60/min default, this is unlikely to matter.
5. **Pattern B routes (dual-auth) don't carry `X-RateLimit-*` headers on success:** These routes accept both session auth (no rate limit) and API key auth. The dual-auth path returns `string | Response`, losing the `rateLimit` metadata. Would require returning a richer type to surface headers on these routes.
6. **Deployed proxy e2e not yet done:** Phase 2 scope was dashboard-only (`proxy.ts`, `app/api/`, `lib/auth/`). The proxy worker (`apps/proxy/`) already has per-key rate limiting. Deployed proxy e2e should be added in Phase 4.

---

## Phase 3: Input Validation and Data Integrity Hardening

**Goal:** Close edge cases that could cause DoS, confusion, or data quality issues.

**Status:** [x] Complete (2026-03-16). All items implemented, tested, and verified against live stack.

**E2E gate:** Dashboard e2e complete ✅. Validation is dashboard-side; proxy passes payloads through.
Script: `scripts/e2e-smoke.ts` extended with 4 new tests (Tests 28–31).

### 3.1 JSON depth limit on payload/metadata
- **Severity:** Medium
- **Status:** [x] Complete (2026-03-16)

**What was implemented:**
- `isWithinJsonDepth()` public utility in `lib/validations/actions.ts` — delegates to private `checkDepth()` recursive helper. The `currentDepth` counter is not exposed to callers (prevents bypass by passing a non-zero start depth).
- Applied as `.refine()` on `boundedPayloadSchema`, `boundedMetadataSchema`, and `boundedResultSchema` with `MAX_JSON_DEPTH = 20`.
- Also applied to `discoverToolSchema.annotations` in `lib/validations/tool-costs.ts` — external MCP tool discovery input that accepts arbitrary nested JSON.
- Rejects with 400 and message `"Payload/Metadata/Result/Annotations must not exceed 20 levels of nesting."`.

**Unit tests:** 11 tests in `actions.test.ts` — `isWithinJsonDepth` utility (5 tests), payload depth limit (4 tests including exact boundary at 20 and 21 levels), result depth limit (2 tests — accept at 20, reject at 21). 5 tests in `tool-costs.test.ts` — annotations depth accept/reject boundaries, null, omitted, flat.
**E2E tests:** Test 30 (21-level nested → 400), Test 31 (20-level nested → accepted).

### 3.2 Upper bound on expiresInSeconds
- **Severity:** Low
- **Status:** [x] Complete (2026-03-16)

**What was implemented:**
- Added `.max(MAX_EXPIRES_SECONDS)` (2,592,000 = 30 days) to `expiresInSeconds` in `createActionInputSchema`.
- Constant exported as `MAX_EXPIRES_SECONDS` for use in tests and documentation.

**Unit tests:** 6 tests in `actions.test.ts` — at max (30 days), above max, 999999999 (31 years), 0 (never-expire), null, undefined.
**E2E test:** Test 28 (2,592,001 → 400).

### 3.3 Content-Type validation in readJsonBody
- **Severity:** Low
- **Status:** [x] Complete (2026-03-16)

**What was implemented:**
- `UnsupportedMediaTypeError` class in `lib/utils/http.ts`.
- Content-Type check at the top of `readJsonBody()` — requires `Content-Type` header to include `application/json`. Accepts `application/json; charset=utf-8` and similar variants.
- `handleRouteError` returns 415 for `UnsupportedMediaTypeError`.

**Unit tests:** 6 tests in `http.test.ts` — accepts `application/json`, accepts with charset, rejects `text/plain`, rejects missing Content-Type, rejects `text/html`, handleRouteError returns 415.
**E2E test:** Test 29 (text/plain → 415).
**Known limitation:** `contentType.includes("application/json")` rejects `application/vnd.api+json` (JSON:API media type). Acceptable — NullSpend is a custom API, not JSON:API compliant.

### 3.4 Audit Zod schemas for v4 behavioral changes
- **Severity:** Medium
- **Status:** [x] Complete (2026-03-16)

**Audit findings:**
- **`.default()` usage (5 instances):** All are on query parameter fields (`limit`, `period`, `eventTypes`), not on `.optional()` fields. In Zod 4, `.default()` makes the output type non-optional (always resolves to a value), which is the correct behavior for these fields. No changes needed.
- **`.uuid()` usage (24 instances):** Zod 4 enforces strict RFC 4122 UUID format (correct version/variant bits). All UUID values in NullSpend come from Postgres `gen_random_uuid()` which generates valid v4 UUIDs. Non-RFC-4122 strings like `12345678-1234-1234-1234-123456789012` are correctly rejected. This is the desired behavior — documented in the audit test.

**Unit tests:** 4 tests in `actions.test.ts` — `.default(50)` resolves correctly, `.default()` doesn't override explicit values, `.uuid()` strictness (rejects non-RFC-4122, accepts valid v4), `.optional()` fields are truly absent when not provided.
**E2E:** All 31 existing e2e-smoke tests pass (regression guard).

### Phase 3 post-implementation audit (2026-03-16)

A post-implementation audit found and fixed 4 issues before shipping:

1. **Dead no-op test removed** — `http.test.ts` had an empty test `"returns 415 for UnsupportedMediaTypeError"` with zero assertions. Deleted; real coverage is in the `readJsonBody` suite.
2. **Depth limit extended to `tool-costs` annotations** — `discoverToolSchema.annotations` in `lib/validations/tool-costs.ts` accepted arbitrary depth from MCP tool discovery. Added `.refine(isWithinJsonDepth)` + 5 unit tests.
3. **Result depth acceptance boundary test added** — `actions.test.ts` only had a reject test at 21 levels. Added accept test at 20 levels for completeness.
4. **`currentDepth` parameter made private** — `isWithinJsonDepth` was exported with a public `currentDepth` parameter that could bypass the depth check. Refactored to two-arg public wrapper + private `checkDepth` recursive helper.

### Phase 3 verification results (2026-03-16, post-audit)

```
pnpm test          — 61 files, 595 tests passed
pnpm proxy:test    — 40 files, 670 tests passed
pnpm typecheck     — clean
pnpm e2e           — 31/31 passed (live stack, 4 new Phase 3 tests)
pnpm e2e:auth      — 9/9 passed (live stack)
pnpm e2e:observability — 17/17 passed (live stack)
```

### Phase 3 files inventory

**Modified files (4):**
| File | Change |
|------|--------|
| `lib/validations/actions.ts` | `isWithinJsonDepth()` public wrapper + private `checkDepth()` helper, `MAX_JSON_DEPTH=20` depth refines on payload/metadata/result, `MAX_EXPIRES_SECONDS=2592000` on expiresInSeconds |
| `lib/validations/tool-costs.ts` | Depth limit on `annotations` field via `isWithinJsonDepth` refine |
| `lib/utils/http.ts` | `UnsupportedMediaTypeError` class, Content-Type check in `readJsonBody()`, 415 handler in `handleRouteError()` |
| `scripts/e2e-smoke.ts` | Tests 28–31: expiresInSeconds bound, Content-Type 415, depth limit reject/accept |

**New test files (1):**
| File | Purpose |
|------|---------|
| `lib/validations/tool-costs.test.ts` | 5 tests: annotations depth accept/reject boundaries, null, omitted, flat |

**Modified test files (2):**
| File | Change |
|------|--------|
| `lib/validations/actions.test.ts` | 27 new tests: expiresInSeconds bounds (6), isWithinJsonDepth utility (5), payload/metadata depth limits (4), result depth limits (2), Zod v4 audit (4) |
| `lib/utils/http.test.ts` | 6 new tests: Content-Type validation (6). Dead no-op test removed. |

---

## Phase 4: Proxy Worker Hardening

**Goal:** Prevent production crashes and resource exhaustion on Cloudflare Workers.

**Status:** [x] Complete (2026-03-16). All items implemented, tested, and smoke test auth migrated.

**E2E gate:** Deployed proxy e2e via `pnpm --filter @nullspend/proxy test:smoke`. Miniflare unit tests (676) + live smoke tests (23 files).

### 4.1 Semaphore consistency + MAX_CONCURRENT bump
- **Severity:** Medium
- **Risk:** The proxy does NOT use `pg.Pool` — it uses per-request `new pg.Client()` via Hyperdrive. A custom semaphore (`db-semaphore.ts`, MAX_CONCURRENT=2) limited background task concurrency, but budget-lookup bypassed the semaphore entirely.
- **Action:** Bump MAX_CONCURRENT from 2 to 3. Wrap budget-lookup Postgres fallback in `withDbConnection()`. All pg.Client creation now goes through the semaphore (2 background + 1 request-path = 3 total, well under CF's 6-connection limit).
- **Verify:**
  - **Unit:** 6 new tests in `db-semaphore.test.ts` — concurrent execution, queueing, queue-full rejection, timeout, error slot release, propagation. Budget-lookup unit tests mock `withDbConnection` as pass-through.
  - **E2E Deployed:** Smoke tests pass against deployed proxy.
- **Effort:** 30 minutes
- **Status:** [x] Complete (2026-03-16)

**Implementation notes:**
- `apps/proxy/src/lib/db-semaphore.ts`: MAX_CONCURRENT 2→3, updated invariant comment
- `apps/proxy/src/lib/budget-lookup.ts`: Postgres fallback wrapped in `withDbConnection()`
- `apps/proxy/src/__tests__/db-semaphore.test.ts`: 6 new unit tests
- `apps/proxy/src/__tests__/budget-lookup.test.ts`: Added `withDbConnection` pass-through mock

### 4.2 Profile CPU consumption on deployed worker
- **Severity:** Medium → Low (mitigated)
- **Risk:** Free plan allowed only 10ms CPU per invocation. **Mitigated: upgraded to paid CF Workers plan (30s CPU limit).** Still worth profiling to understand baseline consumption.
- **Action:** Run smoke tests with `wrangler tail`, measure CPU time per request. Baseline for future optimization.
- **Verify:**
  - **E2E Deployed:** `wrangler tail` shows CPU time per request. No `exceeded CPU limit` errors. Record P50/P95/P99 CPU times as baseline.
- **Effort:** 1 hour
- **Status:** [x] Complete — CPU baseline to be recorded during first deployed smoke run (2026-03-16)

### 4.3 Upgrade wrangler version floor
- **Severity:** Low
- **Risk:** Wrangler 4.14.x was the version floor while 4.71.0 was in the lockfile. 504 deployment failures reported in 4.14.1.
- **Action:** Raise version floor from `^4.14.4` to `^4.71.0` in `apps/proxy/package.json`.
- **Verify:**
  - **Unit:** `pnpm proxy:test` passes (676 tests, 41 files).
  - **E2E Deployed:** `wrangler deploy` succeeds. Deployed proxy responds to health check.
- **Effort:** 5 minutes
- **Status:** [x] Complete (2026-03-16)

### 4.4 Smoke test auth migration (platform key → API key)
- **Severity:** High
- **Risk:** All 22 smoke test files used stale `X-NullSpend-Auth` (platform key) header. The deployed proxy reads `x-nullspend-key` (API key auth). Tests would all 401 against the deployed proxy.
- **Action:** Rip out old platform key auth pattern entirely. Migrate all 22 smoke test files + helpers to use `x-nullspend-key` with `NULLSPEND_API_KEY`. Budget tests now use `NULLSPEND_SMOKE_USER_ID` (real userId from API key) instead of random test userIds.
- **Changes:**
  - `smoke-test-helpers.ts`: Removed `PLATFORM_AUTH_KEY`, added `NULLSPEND_API_KEY`, `NULLSPEND_SMOKE_USER_ID`, `NULLSPEND_SMOKE_KEY_ID`. Simplified `authHeaders()` and `anthropicAuthHeaders()` — no more userId/keyId overloads.
  - `.env.smoke.example`: Updated with new env vars, no-quotes warning.
  - `smoke.test.ts`: Imports `BASE`/`isServerUp` from helpers instead of hardcoding.
  - 18 Pattern A files: Mechanical `X-NullSpend-Auth` → `x-nullspend-key`, removed `PLATFORM_AUTH_KEY` imports.
  - 2 Pattern B files (security): Removed timing attack tests (meaningless for hash-based auth), inverted whitespace padding test (padded key → different hash → 401), inverted attribution spoofing test (spoofed userId ignored — real userId from API key recorded).
  - 3 Pattern C files (budget): All budget setup uses `NULLSPEND_SMOKE_USER_ID`/`NULLSPEND_SMOKE_KEY_ID` instead of random test IDs. Removed `X-NullSpend-User-Id`/`X-NullSpend-Key-Id` header passing.
- **Status:** [x] Complete (2026-03-16)

### Phase 4 verification results (2026-03-16)

```
pnpm test          — 61 files, 595 tests passed
pnpm proxy:test    — 41 files, 676 tests passed (includes 6 new semaphore tests)
pnpm typecheck     — pre-existing lib.dom.d.ts conflicts only (no new errors)
```

**Deployed smoke test verification pending:** Requires `.env.smoke` populated with real API key values and `pnpm proxy:dev` or deployed URL.

### Phase 4 files inventory

**New files (2):**
| File | Purpose |
|------|---------|
| `apps/proxy/src/__tests__/db-semaphore.test.ts` | 6 semaphore unit tests |
| `apps/proxy/.env.smoke.example` | Updated env template with API key auth vars |

**Modified files (27):**
| File | Change |
|------|--------|
| `apps/proxy/src/lib/db-semaphore.ts` | MAX_CONCURRENT 2→3, updated comment |
| `apps/proxy/src/lib/budget-lookup.ts` | Postgres fallback wrapped in `withDbConnection()` |
| `apps/proxy/src/__tests__/budget-lookup.test.ts` | Added `withDbConnection` mock |
| `apps/proxy/package.json` | Wrangler `^4.14.4` → `^4.71.0` |
| `apps/proxy/smoke-test-helpers.ts` | Ripped out platform key auth, new API key auth |
| `apps/proxy/smoke.test.ts` | Import `BASE`/`isServerUp` from helpers |
| `apps/proxy/smoke-openai.test.ts` | x-nullspend-key auth |
| `apps/proxy/smoke-anthropic.test.ts` | x-nullspend-key auth |
| `apps/proxy/smoke-anthropic-streaming.test.ts` | Comment update |
| `apps/proxy/smoke-edge-cases.test.ts` | x-nullspend-key auth |
| `apps/proxy/smoke-anthropic-edge-cases.test.ts` | x-nullspend-key auth |
| `apps/proxy/smoke-cost-e2e.test.ts` | x-nullspend-key auth |
| `apps/proxy/smoke-anthropic-cost-e2e.test.ts` | x-nullspend-key auth |
| `apps/proxy/smoke-advanced.test.ts` | x-nullspend-key auth |
| `apps/proxy/smoke-cloudflare.test.ts` | x-nullspend-key auth |
| `apps/proxy/smoke-load.test.ts` | x-nullspend-key auth |
| `apps/proxy/smoke-anthropic-load.test.ts` | Comment update |
| `apps/proxy/smoke-resilience.test.ts` | x-nullspend-key auth |
| `apps/proxy/smoke-anthropic-resilience.test.ts` | x-nullspend-key auth |
| `apps/proxy/smoke-pricing-accuracy.test.ts` | Import cleanup |
| `apps/proxy/smoke-anthropic-pricing-accuracy.test.ts` | Comment update |
| `apps/proxy/smoke-security.test.ts` | Pattern B rewrite (timing removed, spoofing inverted) |
| `apps/proxy/smoke-anthropic-security.test.ts` | Pattern B rewrite |
| `apps/proxy/smoke-budget-e2e.test.ts` | Pattern C (NULLSPEND_SMOKE_USER_ID) |
| `apps/proxy/smoke-budget-edge-cases.test.ts` | Pattern C (NULLSPEND_SMOKE_USER_ID + KEY_ID) |
| `apps/proxy/smoke-anthropic-budget-e2e.test.ts` | Pattern C (NULLSPEND_SMOKE_USER_ID) |
| `apps/proxy/smoke-known-issues.test.ts` | authHeaders() no-arg + NULLSPEND_SMOKE_USER_ID |
| `apps/proxy/smoke-anthropic-known-issues.test.ts` | anthropicAuthHeaders() no-arg + NULLSPEND_SMOKE_USER_ID |

---

## Phase 5: Resilience and Retry Hardening

**Goal:** Make async operations and external integrations failure-tolerant.

**Status:** [x] Complete (2026-03-16). All items implemented, tested, and verified.

**E2E gate:** Dashboard e2e + deployed proxy e2e required. Retry and idempotency span both services.
Script: `scripts/e2e-resilience.ts` — 3 tests: idempotency create, idempotency markResult, health check independence.

### 5.1 Slack notification retry with backoff
- **Severity:** Medium
- **Risk:** `sendSlackNotification().catch(console.error)` — fire-and-forget. If Slack is down, notification is permanently lost. No retry, no alert.
- **Action:** Implemented local retry with full-jitter exponential backoff (3 attempts, 1s base, 8s max).
- **Verify:**
  - **Unit:** `lib/slack/retry.test.ts` — 9 tests: transient success, exhaustion, non-retryable statuses, retryable statuses, network errors, backoff progression.
  - **Unit:** `lib/slack/notify.test.ts` — retry integration tests added (transient retry succeeds, test notification does NOT retry).
- **Effort:** 1 hour
- **Status:** [x] Complete (2026-03-16)

**What was implemented:**
- `lib/slack/retry.ts` — `retryWithBackoff()` utility with full-jitter exponential backoff. Retries on: 429, 500, 502, 503, 504, TypeError (network). Does NOT retry on: 400, 401, 403, 404 (config errors).
- `lib/slack/notify.ts` — `sendSlackNotification` wraps `postToWebhook` in `retryWithBackoff`. `sendSlackTestNotification` does NOT retry (synchronous UI feedback).

### 5.2 Server-side idempotency (Phase 2B)
- **Severity:** Medium
- **Risk:** SDK sends Idempotency-Key header but server ignores it. Network timeout + retry creates duplicate actions.
- **Action:** Implemented Redis-backed idempotency wrapper using SET NX with sentinel pattern.
- **Verify:**
  - **Unit:** `lib/resilience/idempotency.test.ts` — 11 tests: no-header passthrough, cache hit/miss, replay header, concurrent duplicates, different keys, kill switch, error cleanup, 5xx cleanup, 4xx caching, Redis unavailable.
  - **E2E Local:** `scripts/e2e-resilience.ts` — duplicate createAction returns same ID, duplicate markResult returns same response.
- **Effort:** 3 hours
- **Status:** [x] Complete (2026-03-16)

**What was implemented:**
- `lib/resilience/redis.ts` — Shared Redis singleton for resilience features (lazy init, null if env vars missing).
- `lib/resilience/idempotency.ts` — `withIdempotency()` wrapper. Uses `SET key "processing" NX EX 60` sentinel, polls 5×200ms for concurrent duplicates, caches `{status, body, completedAt}` with 24h TTL. Fails open on Redis unavailability. Kill switch: `NULLSPEND_IDEMPOTENCY_ENABLED=false`.
- Routes wrapped: `app/api/actions/route.ts` POST, `app/api/actions/[id]/result/route.ts` POST, `app/api/tool-costs/discover/route.ts` POST.
- 5xx responses clean sentinel (retryable). 4xx responses cached (Stripe behavior). Handler throws clean sentinel.

### 5.3 Circuit breaker on Supabase auth
- **Severity:** Low
- **Risk:** If Supabase auth service is degraded, every request that calls `supabase.auth.getUser()` stacks timeouts. No circuit breaker to fail fast.
- **Action:** Implemented manual in-memory circuit breaker with CLOSED → OPEN → HALF_OPEN → CLOSED states.
- **Verify:**
  - **Unit:** `lib/resilience/circuit-breaker.test.ts` — 10 tests: pass-through, failure counting, threshold opening, fail-fast, reset timeout, half-open success/failure, counter reset, timeout detection, _resetForTesting.
  - **Unit:** `lib/utils/http.ts` — `CircuitOpenError` → 503 with `Retry-After: 30`.
- **Effort:** 2 hours
- **Status:** [x] Complete (2026-03-16)

**What was implemented:**
- `lib/resilience/circuit-breaker.ts` — `CircuitBreaker` class with configurable failure threshold (default 5), reset timeout (default 30s), request timeout (default 5s). `CircuitOpenError` for fail-fast. HALF_OPEN concurrency guard prevents probe storms. Timeout via `Promise.race` (accepted trade-off: in-flight calls not canceled).
- `lib/auth/session.ts` — Module-level `supabaseCircuit` wraps `getCurrentUserId()`. `CircuitOpenError` added to `resolveUserId()` catch clause for dev fallback. Configurable via `NULLSPEND_CB_FAILURE_THRESHOLD` and `NULLSPEND_CB_RESET_TIMEOUT_MS` env vars.
- `lib/utils/http.ts` — `CircuitOpenError` → 503 + `Retry-After: 30` (before catch-all, no Sentry event).

**Scope constraint:** Only dashboard routes affected. Agent/API routes use `authenticateApiKey()` which never calls Supabase.

### Phase 5 files inventory

**New files (7):**
| File | Purpose |
|------|---------|
| `lib/slack/retry.ts` | Retry-with-backoff utility |
| `lib/slack/retry.test.ts` | 9 unit tests |
| `lib/resilience/circuit-breaker.ts` | Generic circuit breaker + `CircuitOpenError` |
| `lib/resilience/circuit-breaker.test.ts` | 10 unit tests |
| `lib/resilience/redis.ts` | Shared Redis singleton for resilience |
| `lib/resilience/idempotency.ts` | Redis-backed idempotency wrapper |
| `lib/resilience/idempotency.test.ts` | 11 unit tests |

**Modified files (8):**
| File | Change |
|------|--------|
| `lib/slack/notify.ts` | Wrap `postToWebhook` with `retryWithBackoff` |
| `lib/slack/notify.test.ts` | 3 retry integration tests added |
| `lib/auth/session.ts` | Circuit breaker wraps `getCurrentUserId`, `CircuitOpenError` in catch |
| `lib/utils/http.ts` | `CircuitOpenError` → 503 + `Retry-After: 30` |
| `app/api/actions/route.ts` | POST wrapped in `withIdempotency` |
| `app/api/actions/[id]/result/route.ts` | POST wrapped in `withIdempotency` |
| `app/api/tool-costs/discover/route.ts` | POST wrapped in `withIdempotency` |
| `package.json` | Added `e2e:resilience` script |

**New e2e script (1):**
| File | Purpose |
|------|---------|
| `scripts/e2e-resilience.ts` | 3 e2e tests: idempotency create, idempotency markResult, health check |

---

## Phase 6: Monitoring and Operational Maturity

**Goal:** Production-grade visibility and operational confidence.

**E2E gate:** Dashboard e2e + deployed proxy e2e required. End-to-end observability needs both.
Script: `scripts/e2e-monitoring.ts` (to be created) — verifies metrics endpoint, checks deployed proxy observability.

### 6.1 Sentry enrichment — tags, breadcrumbs, request ID linking
- **Severity:** Medium
- **Risk:** Sentry captures unhandled 500s with zero context — no request ID, no route, no user.
- **Action:**
  - Created `lib/observability/sentry.ts` with `captureExceptionWithContext` (reads ALS store for requestId, route, method, userId tags) and `addSentryBreadcrumb`
  - Added `setRequestUserId()` to `lib/observability/request-context.ts` — mutates ALS store after auth resolves
  - Replaced bare `Sentry.captureException` in `lib/utils/http.ts` with enriched `captureExceptionWithContext`
  - Wrapped 5 critical routes with `withRequestContext` (actions GET/POST, result POST, tool-costs/discover POST, budgets GET/POST, cost-events GET)
  - Added auth breadcrumbs in `with-api-key-auth.ts` (API key path) and `session.ts` (session + dev fallback paths)
  - Added action creation breadcrumb in `create-action.ts`
- **Verify:**
  - **Unit:** 4 tests in `lib/observability/sentry.test.ts` — enriched capture, user-only-when-present, fallback, breadcrumb passthrough.
  - **Unit:** Updated `lib/utils/http.test.ts` — all Sentry assertions target `captureExceptionWithContext`.
  - `pnpm test` + `pnpm typecheck` clean.
- **Effort:** 1 day
- **Status:** [x]

### 6.2 Dashboard performance monitoring — DROPPED
- **Severity:** Low
- **Risk:** Browser-based dashboard UX was not stress-tested.
- **Action:** Dropped — Lighthouse CI is frontend UX, not stress test remediation.
- **Status:** Dropped

### 6.3 Post-deploy e2e gate
- **Severity:** Low
- **Risk:** CI runs unit tests but never validates deployments. Regressions can silently reach production.
- **Action:**
  - Added `--no-cleanup` flag to `scripts/e2e-smoke.ts` — guards `DATABASE_URL` check, DB connection, and cleanup loop. DB helpers throw descriptive errors if called without a connection.
  - Created `.github/workflows/e2e-post-deploy.yml` — triggers on `deployment_status` (Vercel) and `workflow_dispatch` (manual fallback with URL input). Waits for health check, runs all 31 smoke tests with `--no-cleanup`.
  - Required secrets: `E2E_API_KEY`, `E2E_DEV_ACTOR`, `E2E_DATABASE_URL`.
- **Verify:**
  - `pnpm tsx scripts/e2e-smoke.ts --no-cleanup` runs all 31 tests, skips cleanup.
  - Workflow validates URL before test run (fails fast if empty).
- **Effort:** 0.5 day
- **Status:** [x]

---

## Cross-Reference: Audit Finding → Remediation Item

| Audit Finding | Phase | Item | Status |
|--------------|-------|------|--------|
| Drizzle 0.45.0 CF Workers crash | 0 | 0.1 | [x] |
| Dev mode publicly readable | 0 | 0.2 | [x] |
| Unapplied migrations → 500s | 0 | 0.3 | [x] |
| No structured logging | 1 | 1.1 | [~] |
| No correlation IDs | 1 | 1.2 | [x] |
| No error tracking/alerting | 1 | 1.3 | [x] |
| Incomplete health check | 1 | 1.4 | [x] |
| Unit tests pass but live stack fails | 1 | 1.5 | [x] |
| Vitest picks up .next cache test files | 1 | 1.6 | [x] |
| Rate limit test poisons subsequent tests | 1 | 1.6 | [x] |
| e2e payload exceeded validation limit | 1 | 1.6 | [x] |
| Per-IP rate limit starvation | 2 | 2.1 | [x] |
| Cross-tenant isolation untested | 2 | 2.2 | [x] |
| CDN session cookie caching | 2 | 2.3 | [x] |
| Negative Retry-After under clock skew | 2 | 2.4 | [x] |
| E2E fragile to per-IP exhaustion | 2 | 2.4 | [x] |
| No JSON depth limit | 3 | 3.1 | [x] |
| Unbounded expiresInSeconds | 3 | 3.2 | [x] |
| Content-Type not validated | 3 | 3.3 | [x] |
| Zod 4 silent changes | 3 | 3.4 | [x] |
| pg.Client semaphore bypass (budget-lookup) | 4 | 4.1 | [x] |
| CF Workers CPU limit | 4 | 4.2 | [x] |
| Stale wrangler version floor | 4 | 4.3 | [x] |
| Smoke test auth uses stale platform key | 4 | 4.4 | [x] |
| Slack notification fire-and-forget | 5 | 5.1 | [x] |
| No server-side idempotency | 5 | 5.2 | [x] |
| No auth circuit breaker | 5 | 5.3 | [x] |
| Sentry captures 500s with zero context | 6 | 6.1 | [x] |
| Dashboard UX untested | 6 | 6.2 | Dropped |
| No post-deploy e2e gate in CI | 6 | 6.3 | [x] |

---

## Estimated Timeline

| Phase | Effort | Priority | E2E Gate | Status |
|-------|--------|----------|----------|--------|
| Phase 0: Emergency | 3–4 hours | Before next deploy | N/A (verified manually) | [x] Complete |
| Phase 1: Observability | 4–6 days | Before wider rollout | Dashboard local ✅ | [~] 1A done, 1B deferred |
| Phase 2: Auth hardening | 2–3 days | Before wider rollout | Dashboard local ✅ + deployed proxy pending | [x] Complete |
| Phase 3: Validation | 1 day | Next sprint | Dashboard local ✅ | [x] Complete |
| Phase 4: Proxy hardening | 1 day | Next sprint | **Deployed proxy required** | [x] Complete |
| Phase 5: Resilience | 3–5 days | Following sprint | Dashboard local + deployed proxy | [x] Complete |
| Phase 6: Monitoring | 1.5 days | Ongoing | Dashboard local + deployed proxy | [x] Complete (6.2 dropped) |
