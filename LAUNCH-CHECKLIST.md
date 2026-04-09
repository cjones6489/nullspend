# NullSpend Launch Checklist — 2026-04-09

**Source:** `/cso` + `/qa` passes on 2026-04-08
**Reports:** `.gstack/security-reports/2026-04-08-cso-launch-readiness.json`, `.gstack/qa-reports/qa-report-nullspend-dev-2026-04-08.md`

**Legend:** ✅ done · 🟡 in-progress · 🔴 blocker · ⏳ waiting (on deploy / user / external) · ⬜ todo

---

## P0 — Must fix before launch

### P0-1 — CSP nonce + CDN cache collision
**Status:** 🟡 fix committed `a93792f`, ⏳ waiting on Vercel auto-deploy, then ⬜ verify in prod

**Why it's P0:** Login page has no form fields in production. React never hydrates because CSP blocks every cached `<script nonce="OLD">` tag while the header carries a fresh nonce. Every interactive element on every page is dead.

**What's done:**
- `proxy.ts` now sets `Cache-Control: private, no-store` on ALL routes (was `/api/*` only)
- 6 regression tests added in `proxy.test.ts`
- 1879/1879 tests passing, typecheck clean
- Pushed to `origin/main` at 2026-04-08

**What's left:**
- [ ] Vercel auto-deploy completes (watch in Vercel dashboard)
- [ ] `curl -D - https://www.nullspend.dev/login` twice — confirm `Cache-Control: private, no-store` + `X-Vercel-Cache: MISS`
- [ ] Open `/login` in real browser — confirm email + password fields + Sign in button visible
- [ ] Submit form with real credentials — confirm reaches `/app/home`

---

### P0-2 — Vercel environment variables
**Status:** 🔴 needs user verification in Vercel dashboard

**Why it's P0:** `/api/health` currently reports `{"status":"degraded"}`. Verbose mode leaks `NEXT_PUBLIC_SUPABASE_ANON_KEY: Invalid input: expected string, received undefined`. Once P0-1 is fixed and users can log in, every authenticated DB call will 500 if this env var is actually missing.

**Must be set (go to Vercel → Settings → Environment Variables → Production):**
- [ ] `NEXT_PUBLIC_SUPABASE_URL` — starts with `https://`
- [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY` — confirmed present as a string
- [ ] `NEXT_PUBLIC_APP_URL` — `https://www.nullspend.dev` (blocks host-header injection for Stripe checkout)
- [ ] `DATABASE_URL` — Supabase pooler / Hyperdrive connection string
- [ ] `STRIPE_SECRET_KEY` — `sk_live_...`
- [ ] `STRIPE_WEBHOOK_SECRET` — `whsec_...`
- [ ] `STRIPE_ENCRYPTION_KEY` — 32+ byte random for AES-256-GCM. **Back this up in 1Password NOW**; losing it bricks every stored Stripe connection.
- [ ] `CRON_SECRET` — revenue-sync cron auth
- [ ] `SUPABASE_SERVICE_ROLE_KEY` — admin actions (if used server-side)
- [ ] `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` — rate limiter
- [ ] `INTERNAL_SECRET` — dashboard ↔ proxy bridge

**Must NOT be set (any present is a backdoor):**
- [ ] `NULLSPEND_DEV_MODE` — must be absent or `false`
- [ ] `NULLSPEND_API_KEY` — dev-only fallback, empty in prod
- [ ] `NULLSPEND_DEV_ACTOR` — dev-only user impersonation, empty in prod

**Verify after:** `curl https://www.nullspend.dev/api/health` must return `200 {"status":"ok"}`.

---

### P0-3 — Docs hardcode wrong domain
**Status:** 🔴 blocked on decision — what IS the real proxy URL?

**Why it's P0:** `docs/quickstart/openai.md`, `docs/overview.md`, `docs/guides/migrating-from-helicone.md` (and others) hardcode `nullspend.dev` and `proxy.nullspend.dev`. Anyone following the quickstart tomorrow copies a URL that doesn't resolve in DNS.

**Evidence:**
- `curl -sI https://proxy.nullspend.dev` → `Could not resolve host`
- `curl -s https://nullspend.dev` → 114 bytes, JS redirects to `/lander` (parking page)

**Decisions needed:**
- [ ] What is the real proxy Worker URL? Options:
  - (a) `https://proxy.nullspend.dev` — requires new DNS record + Cloudflare Worker route
  - (b) Subpath on dashboard domain like `https://www.nullspend.dev/proxy/v1` — simpler, no new DNS, but changes the worker routing
  - (c) Point `proxy.nullspend.dev` at the real Worker — requires domain ownership of `.com`
- [ ] What should `nullspend.dev` do? (redirect to `.dev`, placeholder, nothing?)

**After decision:**
- [ ] Global sed: `nullspend.dev` → `nullspend.dev` across `docs/` and `content/`
- [ ] Update `OPENAI_BASE_URL` / `baseURL` references to the chosen proxy URL
- [ ] Manually verify one quickstart flow end-to-end with a real OpenAI key

---

## P1 — High-embarrassment, fix before launch if possible

### P1-4 — Footer Privacy / Terms links dead
**Status:** ⬜ needs decision

**Evidence:** `links` output shows `Privacy → /#` and `Terms → /#` on the landing page footer.

**Options:**
- [ ] Write real Privacy + Terms pages (use a generator like terms.io or hire a lawyer — not doing this tonight)
- [ ] Remove the footer links until real pages exist (safe launch move)
- [ ] Point both to a single "Legal" placeholder page that says "coming soon" (ugly but honest)

---

### P1-5 — Contact Us email wrong domain
**Status:** ⬜ one-line fix

**Evidence:** `Contact Us → mailto:support@nullspend.dev`. Domain has no email delivery.

**Fix:** change to `support@nullspend.dev` (if mailbox exists) OR replace with a contact form OR remove. Grep for `support@nullspend.dev` across the repo to find all occurrences.

---

### P1 — Bump Next.js 16.1.6 → 16.1.7
**Status:** ⬜ one-command fix, needs regression test

**Why:** 5 open advisories against 16.1.6. Most are Vercel-mitigated, but it's a single-point release and trivial to apply. From CSO audit.

**Fix:**
```bash
pnpm update next@16.1.7
pnpm typecheck && pnpm test && pnpm proxy:test
```

If tests pass → commit → push → piggyback on the same Vercel deploy.

---

### P1 — Bump drizzle-orm 0.45.1 → 0.45.2
**Status:** ⬜ one-command fix (defense-in-depth, NOT exploitable in current code)

**Why:** CVE-2026-39356 SQL injection via `sql.identifier()` / `.as()`. **NullSpend does not use either pattern** (verified in CSO audit). Pure defense-in-depth. Can be deferred to post-launch safely.

**Fix:**
```bash
# Edit package.json pnpm.overrides: drizzle-orm ^0.45.1 → ^0.45.2
pnpm install
pnpm test && pnpm proxy:test
```

---

## P2 — Cosmetic / nice-to-have

### P2 — `/pricing` returns 404
**Status:** ⬜ fixable in 5 min

**Why:** Nav link goes to `/#pricing` (anchor on homepage) which works, but anyone typing `/pricing` directly gets a 404. Google crawlers, old shared links, etc.

**Fix:** add `app/(marketing)/pricing/page.tsx` OR add a 301 redirect in `next.config.js`:
```ts
async redirects() {
  return [{ source: '/pricing', destination: '/#pricing', permanent: true }];
}
```

---

### P2 — `usage-page.html` committed to repo root
**Status:** ⬜ one-liner

**Fix:** `git rm usage-page.html && git commit -m "chore: remove accidentally committed saved-page export"`

---

### P2 — e2e-post-deploy.yml script injection pattern
**Status:** ⬜ hardening (low exploit likelihood)

**Why:** `${{ github.event.deployment_status.target_url }}` interpolated directly into a bash heredoc at line 35-44. Canonical GitHub Actions hardening violation.

**Fix:** read into `env:` first:
```yaml
- name: Resolve preview URL
  env:
    PREVIEW_URL: ${{ github.event.deployment_status.target_url }}
    DISPATCH_URL: ${{ github.event.inputs.preview_url }}
  run: |
    URL="$DISPATCH_URL"
    [ -z "$URL" ] && URL="$PREVIEW_URL"
    ...
```

---

### P2 — Login skeleton fallback UX
**Status:** ⬜ defensive insurance

**Why:** If hydration ever fails again (not because of P0-1 but something else), users see two empty boxes with no error message. Add a 5-second timeout that shows "Something went wrong loading the login form. Refresh the page." Auto-resolved by the P0-1 fix for now.

**Fix:** update `app/(auth)/login/page.tsx` LoginSkeleton to include an error fallback after 5s.

---

## Testing & Observability Gaps

**Principle:** Every bug fix must also close the detection gap that let it slip through, otherwise we'll ship the same bug class again. Each P0/P1/P2 above names a specific gap. The items below are the durable coverage additions we need — some critical enough for tonight, most for the first week post-launch.

### Critical gap — add before launch if possible

**G-1 — Post-deploy smoke test for CSP nonce freshness** 🔴 should exist before launch
- **Bug it would have caught:** ISSUE-001 (CSP nonce + CDN cache collision)
- **Gap:** No post-deploy verification that HTML responses carry a fresh nonce per request. Unit tests catch the middleware logic but not the Vercel CDN interaction.
- **Fix:** Add to `.github/workflows/e2e-post-deploy.yml` a step that runs after the existing `/api/health` wait:
  ```bash
  # Verify CSP nonce changes per request on HTML routes (ISSUE-001 regression)
  N1=$(curl -sD - "$URL/login" | grep -i "content-security-policy" | grep -oE "nonce-[a-f0-9-]+" | head -1)
  sleep 2
  N2=$(curl -sD - "$URL/login" | grep -i "content-security-policy" | grep -oE "nonce-[a-f0-9-]+" | head -1)
  [ "$N1" = "$N2" ] && echo "FAIL: CSP nonce cached ($N1)" && exit 1
  # And no X-Vercel-Cache HIT
  curl -sD - "$URL/login" | grep -i "x-vercel-cache" | grep -qi "HIT" && echo "FAIL: HTML cached" && exit 1
  echo "OK: fresh nonces per request"
  ```
- **Effort:** S (~15 min)

**G-2 — Link checker in CI** 🟡 should exist before launch
- **Bugs it would have caught:** ISSUE-004 (footer Privacy/Terms → `/#`), ISSUE-005 (Contact email wrong domain), ISSUE-006 (`/pricing` 404), P0-3 (docs hardcode wrong domain)
- **Gap:** No CI check that validates every URL in the rendered landing page + docs actually resolves.
- **Fix options:** (a) `lychee` GitHub Action pointed at the deployed preview URL, (b) custom script that parses `<a href>` from the rendered HTML + every `](url)` in `docs/` markdown and `curl -I`s each, (c) `linkinator` npm package
- **Effort:** S (~30 min to wire up + add to `.github/workflows/ci.yml`)

**G-24 — Post-deploy DB connectivity assertion** 🔴 would have caught P0-C
- **Bug it would have caught:** P0-C (ENOTFOUND on Supabase direct Postgres URL from Vercel Node runtime, due to Supabase IPv6-only migration for free-tier direct URLs)
- **Gap:** `/api/health` has been reporting `{"status":"degraded"}` in production since the first deploy and nothing alerted on it. The CSO and QA passes never verified actual DB connectivity from the deployed runtime.
- **Fix:** add a step to `.github/workflows/e2e-post-deploy.yml` that hits `/api/health` and fails the deploy if it returns non-200 or `{"status":"degraded"}`. Takes 3 lines.
- **Effort:** S (~10 min)
- **Lesson learned:** "tests pass locally with .env.local" does not equal "works in production." Always include a deploy-time connectivity check.

**G-3 — Health endpoint alerting** 🔴 needed within 24h of launch
- **Bug it would have caught:** ISSUE-002 (`/api/health` reporting degraded in production)
- **Gap:** No uptime monitor. `/api/health` reports degraded but nothing pages you.
- **Fix options:** (a) BetterUptime / UptimeRobot / Pingdom hitting `/api/health` every 60s, alerting via Slack on non-200, (b) Vercel's built-in uptime monitoring, (c) a Cloudflare Worker cron that curls the endpoint and posts to the existing Slack webhook infra on failure
- **Effort:** S (~15 min for option a)

### High-value gaps — add within first week post-launch

**G-4 — Visual regression / smoke test on critical auth pages**
- **Bug it would have caught:** ISSUE-001 (login page stuck on Suspense fallback)
- **Gap:** No headless browser test that asserts the login page actually renders form fields. Unit tests only verify React component trees, not that React actually hydrates in prod.
- **Fix:** Add a Playwright / Puppeteer smoke test to `e2e-post-deploy.yml` that loads `/login`, waits for `input[type="email"]` to be visible, and asserts a "Sign in" button exists. Same for `/signup`. ~5 lines per page.
- **Effort:** M (~1h including Playwright setup if not already installed)

**G-5 — Docs drift detection**
- **Bug it would have caught:** P0-3 (docs hardcode nullspend.dev)
- **Gap:** No verification that URLs in docs match the real deployed endpoints. The docs quickstart tells users to hit `proxy.nullspend.dev` which doesn't resolve.
- **Fix:** A script in `scripts/verify-docs-urls.ts` that parses every URL from `docs/**/*.md` and `content/**/*.md`, ignores localhost, then `curl -I`s each. Fail CI on any 4xx/5xx/DNS failure. Run on push + nightly.
- **Effort:** S (~45 min)

**G-6 — Client-side error reporting verification**
- **Bugs it would have caught:** ISSUE-001 hydration failures, any future CSP violation, any unhandled React error
- **Gap:** Sentry is installed (`@sentry/nextjs`) but we haven't verified it actually captures client-side errors in production. The 35+ CSP violations per page load should have paged someone.
- **Fix:** Add a client-side test harness that intentionally throws once in a hidden component on every deploy, and verify Sentry receives it within 5 minutes. Also: wire Sentry to the Slack webhook infra so critical errors page you.
- **Effort:** M (~1h to verify Sentry is actually wired end-to-end, configure Slack alerting)

**G-7 — CSP violation report collection**
- **Gap:** CSP is enforced in prod but has no `report-uri` or `report-to` directive. Browsers detect violations but report them into the void.
- **Fix:** Add `report-uri /api/csp-report` to the CSP in `proxy.ts`, create `app/api/csp-report/route.ts` that logs violations + emits a metric. Sample at 10% to avoid cost blowouts. Alert on >10 violations/min.
- **Effort:** M (~1h)

**G-8 — Post-deploy canary**
- **Gap:** No canary that runs after each prod deploy to verify the critical paths (landing loads, /login renders fields, /api/health is 200, /docs loads, sample API key can call /api/policy).
- **Fix:** Use the existing `/canary` skill in gstack, or write a custom script that runs the 5-step launch-morning verification sequence (see bottom of this doc) automatically on every deploy.
- **Effort:** S (~30 min if using /canary skill, longer for custom)

**G-9 — Nightly SDK functional smoke run**
- **Gap:** `apps/proxy/smoke-sdk-functional.test.ts` exists with 18 tests but is manual-only (production-mutating). If the SDK breaks, we find out from a user.
- **Fix:** Create a dedicated isolated org for smoke runs (not shared with real users), schedule the test as a nightly GitHub Action against that org, alert on failure.
- **Effort:** M (~2h including test org setup)

**G-10 — Real webhook delivery test**
- **Gap:** Webhook delivery is covered by unit tests (mocked fetch) but never verified end-to-end with a real external HTTPS endpoint. If TLS/DNS/signing is broken in production, we find out from a user whose webhook never fires.
- **Fix:** Add an e2e test that creates a test webhook endpoint pointed at webhook.site (or a hosted test server), triggers a cost event, polls webhook.site for receipt, verifies HMAC signature. Run nightly.
- **Effort:** M (~2h)

**G-11 — Real Slack alert firing test**
- **Gap:** Same as G-10 but for Slack alerts. Unit tests mock the Slack fetch. No e2e verification.
- **Fix:** Configure a dedicated `#test-alerts` Slack channel, trigger margin/budget/velocity alerts against a test org on a schedule, assert the messages appear. Run nightly.
- **Effort:** M (~1h given Slack webhook infra already exists)

**G-12 — Upgrade URL click-through verification**
- **Bug class:** Phase 0 shipped the `upgrade_url` feature but never verified a real user clicking a real 429 response and landing on a real payment page.
- **Fix:** Add a Playwright test that provokes a 429 against a tiny budget, extracts `error.upgrade_url` from the response, navigates to it, asserts the page loads (whatever that page is).
- **Effort:** S (~30 min)

**G-13 — Cold-start latency measurement**
- **Gap:** Smoke tests run against a warm worker. First-byte latency from cold starts is unknown.
- **Fix:** Add a scheduled action that hits the deployed proxy after N minutes of idle and records the latency. Alert on regression. Publish the P99 on the status page.
- **Effort:** S (~30 min)

### Lower-priority gaps — backlog

**G-14 — Visual diff / screenshot regression on marketing page** — every deploy, compare landing page screenshot to baseline, flag changes. Effort: M.

**G-15 — Synthetic signup → first-request flow** — end-to-end: create test account, get API key, call proxy, see cost event, delete account. Runs nightly. Effort: L.

**G-16 — Vercel env var drift detection** — script that enumerates expected env vars from `lib/env.ts` and asserts they're set in Vercel prod via the Vercel API. Effort: S.

**G-17 — Pre-existing flaky test `permission-enforcement.test.ts`** — timeouts at 5000ms under parallel load. From TODOS.md. Effort: S.

**G-18 — Gate `/api/health?verbose=1` behind internal auth** — leaks env var names and schema. From CSO audit. Effort: S.

**G-19 — Decouple `lib/env.ts`** — missing Supabase vars shouldn't break DB access. From QA report (relates to P0-2). Effort: S.

**G-20 — SDK npm publish 0.2.1** — deliberate launch event. From TODOS.md. Effort: S.

**G-21 — Stripe encryption key rotation procedure documented** — from CSO audit + TODOS.md. Effort: S.

**G-22 — `pnpm update` for 22 transitive CVEs** — none exploitable, pure hygiene. Effort: S.

---

## Post-launch (do NOT block launch on these)

Most of the G-N items above go here — they're the follow-through on closing detection gaps. The priority order is:
1. **G-3 (health alerting)** — within 24h of launch, non-negotiable
2. **G-1, G-2, G-4** — within first week (CSP verification, link checker, visual smoke)
3. **G-5, G-6, G-7** — within first two weeks (docs drift, Sentry verification, CSP reporting)
4. **G-8, G-9, G-10, G-11, G-12, G-13** — first month (canary, nightly smokes, webhook/Slack verification)
5. **G-14 through G-22** — backlog, address opportunistically

Also from previous sessions (not launch blockers):
- SDK npm publish 0.2.1 (deliberate launch event)
- Stripe key rotation procedure documented

---

## Launch-morning verification checklist

Run this sequence AFTER all P0s are fixed and the deploy is live:

```bash
# 1. Cache behavior fixed
curl -D - https://www.nullspend.dev/login 2>&1 | grep -iE "cache-control|x-vercel-cache|age:"
# Expect: Cache-Control: private, no-store · NO "Age:" header · X-Vercel-Cache: MISS (or absent)

# 2. Health endpoint green
curl https://www.nullspend.dev/api/health
# Expect: {"status":"ok"}

# 3. Console clean on landing
# Open https://www.nullspend.dev in a real browser with DevTools
# Expect: 0 CSP violations in Console tab

# 4. Login renders + works
# Open https://www.nullspend.dev/login in a real browser
# Expect: email field, password field, Sign in button all visible
# Submit real creds → reach /app/home

# 5. Proxy smoke (once you've confirmed the real proxy URL)
curl -X POST https://<real-proxy-url>/v1/chat/completions \
  -H "X-NullSpend-Key: <your key>" \
  -H "Authorization: Bearer <openai key>" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"ping"}]}'
# Expect: 200 + real OpenAI response, cost event appears in dashboard within 5s

# 6. Dashboard loads
# Open https://www.nullspend.dev/app/home
# Expect: real data, no 500s, console clean
```

If any of steps 1-6 fail → **DO NOT LAUNCH.** Fix and re-run the full sequence.

---

## Contact & ops while fixing

- **Vercel dashboard:** check deploy logs if anything fails to build
- **Supabase dashboard:** verify DB is reachable, check for connection pool exhaustion
- **Cloudflare dashboard:** verify Worker is deployed, Hyperdrive + Queues healthy
- **Current session memory:** `.claude/projects/C--Users-cjone-Projects-AgentSeam/memory/MEMORY.md`

**If you get stuck at 2am:** the simplest rollback is to revert to the last known-good commit in Vercel (use the "Promote to Production" button on a previous deploy). The fix in `a93792f` is the first new commit tonight, so reverting to `74045e6` puts you back where you were (broken login, but at least the marketing page and docs still show).
