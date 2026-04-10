# E2E Framework Audit Backlog

Outstanding findings from the 4 audit passes on Slice 1 (2026-04-09).
Tracked here so a new session can pick up exactly where we left off.

**Source:** `/audit-build` and `/audit-edge-cases` passes across Slices 1e-1o.
**Session memory:** `memory/project_session_summary_20260409_slice1_completion.md`

---

## Critical — fix before relying on framework as launch gate

_(empty — zero critical items)_

---

## High — fix soon after critical

_(empty — zero high items)_

---

## Medium — address within a session or two

### BUG-1k-VERCEL-ENV-VAR-BUILD-TIME — NEXT_PUBLIC_ fallback is dead code on Vercel
- **Severity:** Medium
- **Effort:** ~3 min
- **Status:** Open
- **Files:** `app/api/version/route.ts`
- **What:** `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA` is inlined at build time in Next.js. The fallback to plain `VERCEL_GIT_COMMIT_SHA` never triggers on Vercel because both are set to the same value during the build. The NEXT_PUBLIC_ variant is a compile-time constant, not a runtime env var read.
- **Fix:** Use only `process.env.VERCEL_GIT_COMMIT_SHA` (server-side runtime). Drop the NEXT_PUBLIC_ variant. Update comment.

---

## Low — polish / defense-in-depth

### BUG-1i-AUTHUNKNOWN — `AuthUnknownError` not classified as service failure
- **Severity:** Low
- **Effort:** ~5 min
- **Status:** ✅ Fixed (Slice 1p)
- **Files:** `lib/auth/session.ts` (`isSupabaseServiceFailure`)
- **What:** `AuthUnknownError` is thrown when auth-js can't parse the response JSON (CDN interstitial, HTML error page). My classifier returns `false` → breaker doesn't count it.
- **Fix:** Added `if (e.name === "AuthUnknownError") return true;` to `isSupabaseServiceFailure`. Regression test added.

### BUG-1k-WORKFLOW-GREP-FRAGILE — JSON parsing in bash uses grep not jq
- **Severity:** Low
- **Effort:** ~5 min
- **Status:** Open
- **Files:** `.github/workflows/e2e-post-deploy.yml`
- **What:** SHA verification step parses JSON with `grep -oE '"commit_sha":"[a-f0-9]+"'`. Fragile on whitespace/reorder. `jq` is preinstalled on GitHub Actions Ubuntu.
- **Fix:** Replace with `jq -r '.commit_sha // empty'`.

### BUG-1l-VERBOSE-GATE-BUFFER-ENCODING — String length ≠ byte length for non-ASCII
- **Severity:** Low
- **Effort:** ~10 min
- **Status:** Open
- **Files:** `app/api/health/route.ts`
- **What:** Verbose gate's length pre-check uses `String.length` (UTF-16 code units), but `timingSafeEqual` compares `Buffer.from(str)` (UTF-8 bytes). Multi-byte chars would have matching string length but different byte length → `timingSafeEqual` throws → caught by `try/catch` → fails safely. But the length check leaks timing info.
- **Fix:** Compare `Buffer.from(a).length !== Buffer.from(b).length` instead of `a.length !== b.length`.

### BUG-1l-GAP7-CONFIG-DUPLICATION — Gap-7 test duplicates postgres config
- **Severity:** Low
- **Effort:** ~15 min
- **Status:** Open
- **Files:** `tests/e2e/infra/proxy-reachable.e2e.test.ts`
- **What:** Lazy postgres client duplicates `prepare: false, fetch_types: false` etc from `lib/db/client.ts`. Config drift possible.
- **Fix:** Extract shared connection config to a small helper.

### BUG-1m-ADVISORY-LOCK-HASHTEXT-COLLISION — hashtext int32 → pg_advisory_xact_lock int64
- **Severity:** Low
- **Effort:** ~5 min
- **Status:** Open
- **Files:** `scripts/bootstrap-e2e-org.ts`
- **What:** Using only ~2^32 of the lock key space. No issue with 1 slug. For defense-in-depth, use two-argument form `pg_advisory_xact_lock(42, hashtext(slug))` with a dedicated namespace.

### Supabase 429 rate-limit classification
- **Severity:** Low
- **Effort:** ~10 min
- **Status:** Open
- **Files:** `lib/auth/session.ts`
- **What:** Supabase 429 returns `AuthApiError(status=429)`, not `AuthRetryableFetchError`. My classifier treats it as a client error (status < 500). Arguably should trip the breaker — repeated 429s from auth suggest we need to back off.
- **Fix:** Add `if (e.name === "AuthApiError" && e.status === 429) return true;` or treat all 4xx >= 429 as service conditions.

---

## Observability improvements (not bugs)

### Slack-on-failure doesn't distinguish failure type
- **Effort:** ~15 min
- **What:** SHA mismatch vs genuine test failure look identical in Slack. Add failure context to the notification payload.

### No metric/breadcrumb for circuit breaker state transitions
- **Effort:** ~20 min
- **What:** Breaker logs via pino but doesn't emit Sentry breadcrumbs or custom metrics. Can't dashboard "breaker open duration" over time.

### No canary / feature flag for auth code changes
- **Effort:** N/A (process, not code)
- **What:** Auth path changes like Slice 1i ship to 100% of traffic immediately. No percentage rollout for critical paths.

---

## Already closed (for reference)

Findings from all 4 audit passes that are resolved — see
`memory/project_session_summary_20260409_slice1_completion.md` for the
full list. Key highlights:

- BUG-1 globalSetup env propagation → fail-fast (Slice 1e)
- BUG-2 CSP body not checked → body parsing (Slice 1e)
- BUG-3 Bootstrap non-transactional → db.transaction (Slice 1e)
- BUG-4 Orphan cleanup → typed deletes (Slice 1f)
- BUG-5 PROTECTED_ORG_IDS duplication → shared module (Slice 1e)
- BUG-6 Unverified bootstrap key → post-insert HTTP check (Slice 1e)
- BUG-7 Circuit breaker trips on 401s → fixed correctly in Slice 1i
- BUG-8 Workflow build drift → composite action (Slice 1l)
- BUG-9 Async sweep discovery → sync fs (Slice 1e)
- EC-2 CSP 3xx skip → explicit assertion (Slice 1j)
- EC-3 Orphan drift → schema walk test (Slice 1j)
- EC-4 Protected org normalization → trim+lowercase (Slice 1j)
- EC-5 Vercel rollback → /api/version + SHA check (Slice 1k)
- EC-7 Bootstrap 429 → inconclusive handling (Slice 1m)
- EC-9 Concurrent bootstrap → advisory lock (Slice 1m)
- EC-10 Workflow URL validation → regex check (Slice 1m)
- Drift-3 / G-18 verbose gate → opt-in INTERNAL_HEALTH_SECRET (Slice 1l)
- Drift-4 Sweep P1-19 comment → rewritten (Slice 1e)
- Gap-7 Cost event DB verification → PONG + DB query (Slice 1l + 1o)
- X-NullSpend-Tags format → JSON not key=value (Slice 1o)
- BUG-1i-REGRESSION → UpstreamServiceError + handleRouteError 503 (Slice 1p)
- BUG-1i-TEST-CONTRACT → tests assert UpstreamServiceError not raw AuthApiError (Slice 1p)
- BUG-1i-AUTHUNKNOWN → AuthUnknownError classified as service failure (Slice 1p)
