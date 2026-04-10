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

_(empty — zero medium items)_

---

## Low — polish / defense-in-depth

_(all fixed — zero open low items)_

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
- BUG-1k-VERCEL-ENV-VAR-BUILD-TIME → dropped dead NEXT_PUBLIC_ fallback (Slice 1q)
- EC-1p-CB-TIMEOUT → CircuitTimeoutError + handleRouteError 503 (Slice 1q)
- BUG-1k-WORKFLOW-GREP-FRAGILE → grep replaced with jq (Slice 1q)
- BUG-1l-VERBOSE-GATE-BUFFER-ENCODING → Buffer-based length comparison (Slice 1q)
- BUG-1l-GAP7-CONFIG-DUPLICATION → extracted E2E_POSTGRES_OPTIONS (Slice 1q)
- BUG-1m-ADVISORY-LOCK-HASHTEXT-COLLISION → two-argument advisory lock (Slice 1q)
- Supabase 429 rate-limit classification → AuthApiError 429 trips breaker (Slice 1q)
