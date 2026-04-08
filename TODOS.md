# TODOS

## Attribution

### ~~Functional index for hot tag keys~~

**Completed:** 2026-04-04 (migration 0052_cost_events_customer_tag_index.sql)

### Per-customer cost threshold alerting

**What:** Webhook-based alerting when any customer's cost exceeds a configured threshold in a rolling window.

**Why:** Attribution answers "what does each customer cost?" Alerting answers "when does it change?" Together they close the FinOps feedback loop. The target user (backend dev at a SaaS startup) will want to know immediately when a customer's usage spikes.

**Context:** Leverage existing webhook infrastructure (dispatch, signing, threshold detection). Requires a new entity type for per-customer thresholds (e.g., "alert when any API key exceeds $50/day"). Could be polling-based (check on each cost event) or batch (periodic aggregation check). The webhook payload builders (`buildThresholdCrossingPayload`) and dispatch pipeline already exist. Main work is the threshold entity model and the trigger mechanism.

**Effort:** M
**Priority:** P2
**Depends on:** Attribution feature shipped. Webhook infrastructure (already exists).

## Design

### Create DESIGN.md

**What:** Codify the implicit design system into a DESIGN.md via `/design-consultation`.

**Why:** No single source of truth for design decisions. Each new page requires inferring patterns from existing code (typography scale, color tokens, spacing, component conventions). A DESIGN.md would make all future UI work faster and more consistent.

**Context:** The codebase uses Tailwind + shadcn/ui + base-ui with a dark monospace aesthetic. Typography: text-xl / text-sm / text-[13px] / text-xs / text-[11px]. Colors: CSS variables (chart-1 through chart-5, foreground, muted-foreground, etc.). Spacing: space-y-6 / space-y-4 / gap-3. The system exists implicitly and is consistent, but undocumented.

**Effort:** S
**Priority:** P3
**Depends on:** None

## Margins

### ~~CSV export for margin table~~

**Completed:** 2026-04-05 (GET /api/margins?format=csv with RFC 4180 escaping + formula injection defense)

### PDF export for margin table

**What:** Let users download the margin table as a styled PDF for board decks.

**Why:** The CFO use case. CSV is shipped. PDF adds polish for investor/board presentations.

**Context:** Requires HTML-to-PDF pipeline (e.g., Puppeteer, DocRaptor, or a headless Chrome service). The margin table data is already available via the API.

**Effort:** M
**Priority:** P3
**Depends on:** CSV export shipped

### Stripe key rotation support

**What:** When `STRIPE_ENCRYPTION_KEY` needs rotating, re-encrypt all stored Stripe connections. Store key version in ciphertext prefix (`v1:iv:ciphertext:tag`) so old keys can be tried during transition.

**Why:** Security hygiene. Without versioned encryption, a key rotation causes all Stripe connections to become undecryptable. Not urgent pre-launch but must exist before production customers.

**Context:** Current encryption is unversioned AES-256-GCM. Add a version prefix (`v1:`) to the ciphertext format. On rotation: write new `STRIPE_ENCRYPTION_KEY_V2` env var, run a migration script that decrypts with old key and re-encrypts with new key, then swap env vars.

**Effort:** S
**Priority:** P3
**Depends on:** Margin table shipped

### ~~Margin-driven Slack alerts~~

**Completed:** 2026-04-05 (lib/margins/margin-slack-message.ts — rich Block Kit messages with View Margins + Set Budget Cap deep links, HTTPS validation, per-crossing error isolation)

## SDK / Stress Test

> Items below were filed during PR #6 (stress test suite + 2 product bug fixes).
> Full design context lives in `docs/internal/test-plans/sdk-stress-test-plan.md` §15c
> (18 numbered follow-ups) and `docs/internal/test-plans/sdk-testing-gaps.md` (coverage map).
> This section captures the must-pick-up items in the canonical TODO format.

### SDK proxy 429 interception is dead code in proxy bailout mode

**What:** `tracked-fetch.ts:95` — when a request goes through the proxy (URL matches `proxyUrl` OR `x-nullspend-key` is in headers), the SDK calls `globalThis.fetch` and returns the raw `Response` BEFORE the 429 interception code at line 192 can run. The interception code is dead in real proxy usage. The SDK unit tests for it pass because they use a mocked fetch and a non-proxy URL.

**Why:** The whole point of the 429 interception is to convert proxy denial responses (`customer_budget_exceeded`, `velocity_exceeded`, `session_limit_exceeded`, `tag_budget_exceeded`) into typed `BudgetExceededError` / `VelocityExceededError` etc. so callers get rich error objects instead of having to parse 429 response bodies. Today, callers using the proxy get the raw 429 and have to parse it themselves. That's a real product gap — every customer using `enforcement: true` with `proxyUrl` set is missing a feature the SDK advertises.

**Context:** Stress test §6.9 documents this empirically — the test asserts `onDeniedFired === false` and parses the 429 body manually. The fix is structural, not mechanical: you need to either (a) move the interception BEFORE the `isProxied` bailout, or (b) add a "proxy mode but still intercept" code path that runs the request through `globalThis.fetch`, inspects the response, and converts to a typed error if it's a NullSpend denial. Either approach needs to preserve the no-double-count guarantee that's why the bailout exists. Plus updates to `packages/sdk/src/tracked-fetch.test.ts` for the new flow. Filed as 15c-1 in the stress test plan.

**Effort:** M (~2-4 hours, requires careful design to not break the bailout's purpose)
**Priority:** P1
**Depends on:** None

### SDK Functional E2E test suite

**What:** Create `apps/proxy/smoke-sdk-functional.test.ts` covering the SDK paths the stress test intentionally skipped (HITL actions, getCostSummary, listCostEvents pagination, custom fetch injection, retry config, requestTimeoutMs firing, apiVersion override, TimeoutError/RejectedError fields).

**Why:** The stress test focuses on race conditions and load behavior. HITL actions are blocking single-call flows that don't have race surfaces; read APIs (getCostSummary, paginated listCostEvents) are pure reads; retry config behavior is single-call timing. None of these belong in a stress suite, but they're real SDK features that need E2E coverage against the live deployed proxy + dashboard. Today they're only covered by unit tests with mocked fetch, which can't catch contract drift.

**Context:** ~11 tests, ~400 lines. Full scope mapped in `docs/internal/test-plans/sdk-testing-gaps.md` under "Functional E2E suite". Should be added in a separate PR (`feat/sdk-functional-tests`). Like the stress suite, this is manual-runs-only — never CI — because it hits live infra.

**Effort:** M (~2-3 hours)
**Priority:** P2
**Depends on:** None

### Vercel preview deployment failures (recurring)

**What:** Every PR shows the Vercel preview deployment as `fail` status. This has been happening on PR #5, PR #6, and every recent main commit visible in CI history.

**Why:** Vercel previews are how reviewers visually inspect dashboard changes before merge. With them broken, design QA is harder and we're flying blind on Next.js build regressions until something hits production. The team has been merging despite the failure, which normalizes ignoring CI signal.

**Context:** Run `npx vercel inspect <deployment-id> --logs` against any recent failing deployment to see the error. Common causes: env var missing, build OOM, Node version mismatch, package install failure. Could also be a stale Vercel project config that needs reconnecting after the recent monorepo refactors. Relevant deployment IDs in the recent CI: `dpl_8NWnhVMm5QQXvTVa2EREbkWWbyRd` (PR #6), `dpl_Gi7MaqSb2Y3iBZxSMdtd5yQ8hX95` (PR #5).

**Effort:** S (~30-60 min once you see the error logs)
**Priority:** P2
**Depends on:** None

### Pre-existing flaky test: permission-enforcement timeout

**What:** `app/api/__tests__/permission-enforcement.test.ts > Permission enforcement — viewer cannot write > POST /api/budgets → 403 (requires member)` times out at 5000ms when run as part of `pnpm test`. Passes in isolation in 4.4s.

**Why:** Single-test flakiness erodes trust in `pnpm test` — every run has a chance of red on this one test even when nothing is broken. Right now it's masked because it only happens under parallel load and the dashboard CI doesn't always trigger it.

**Context:** The test is genuinely slow (~4.4s in isolation, close to the 5000ms default). Under parallel load it tips over. Fix: either increase the per-test timeout to 10000ms with a comment explaining why, OR profile the test to find why the 403 path is so slow (probably a sync DB call or auth setup that should be mocked). Not in either of the merged PRs — it was pre-existing and noticed by /ship's test triage.

**Effort:** S (~30 min)
**Priority:** P3
**Depends on:** None

### Heavy stress intensity validation

**What:** Run `STRESS_INTENSITY=heavy pnpm test:stress stress-sdk-features.test.ts` once and verify all 43 tests still pass at 50 concurrent / 60 race / 100 batch events. Investigate any drift.

**Why:** Plan §19 step 13 explicitly calls for heavy intensity validation before declaring the stress test "done." Light + medium are validated (8 consecutive clean runs). Heavy is the upper bound — if there's a race window that only opens at 50+ concurrent, this is where it shows up.

**Context:** Cost ~$0.05 per heavy run if everything works first try. Manual run only. Requires `pnpm dev` running for direct-mode tests. Pre-flight: `pnpm jsonb:repair` should show 0 broken rows (we already cleaned them).

**Effort:** S (5 min wall + verification time if anything fails)
**Priority:** P3
**Depends on:** None

### Publish @nullspend/sdk 0.2.1 to npm

**What:** Bump the SDK version, run `pnpm publish` from `packages/sdk`. The current `0.2.0` has the customer primitive fixes but NOT the shutdown race fix from PR #6.

**Why:** If anyone outside the workspace consumes `@nullspend/sdk` from npm, they're missing the shutdown race fix (silent data loss when racing flush + shutdown). Internal proxy/dashboard code uses the workspace dependency and is already on the fixed version.

**Context:** Check `packages/sdk/package.json` for current version. The shutdown race fix is in commit d97268e on main. Verify with `pnpm test` from `packages/sdk` (381 tests should pass, including the new regression test). Then bump version, build, publish. May want to also coordinate with any external consumers about the breaking-change-shaped behavior fix (events that were silently lost are now flushed, so cost_event row counts may go up).

**Effort:** S (~15 min)
**Priority:** P3 (P0 if there are external consumers)
**Depends on:** None

### §6.8 fail-open session limit test burns OpenAI calls per run

**What:** `apps/proxy/stress-sdk-features.test.ts:977-1045` — the §6.8 client-side session limit test is a known no-op (the comment in the test acknowledges it). It fires up to 15 real OpenAI requests per stress run trying to exercise the fail-open path, but the SDK's session counter never advances because it requires a successful policy fetch.

**Why:** Each stress run wastes ~$0.005 on a test that asserts nothing. Over time at heavy intensity that adds up. Worse, the test masks a real coverage gap — client-side session limit enforcement is genuinely untested at the stress layer.

**Context:** Two options: (a) delete the test, log the gap once in beforeAll, accept that session-limit enforcement has unit-test-only coverage; (b) rewrite against a mock upstream so no real OpenAI spend is incurred and the session counter can be advanced deterministically. (a) is faster, (b) is more complete. Filed as 15c-3.

**Effort:** S (option a, 10 min) / M (option b, 1-2 hours)
**Priority:** P3
**Depends on:** None

### Cleanup: defensive jsonb_typeof guard in getDistinctTagKeys

**What:** `lib/cost-events/aggregate-cost-events.ts:368-393` — the `AND jsonb_typeof(${costEvents.tags}) = 'object'` guard in `getDistinctTagKeys` was added during PR #6 as a safety net for the brief deploy → repair window. After `pnpm jsonb:repair` ran (already done — all 804 rows are now object-typed), this guard is technically dead code.

**Why:** Either remove it (cleanest, code matches reality) or keep it permanently and document it as defensive (handles any future regression that reintroduces string-typed tags). Currently undocumented in a way that says which.

**Context:** Two options: (a) remove the guard (and the comment explaining it) since the issue is resolved; (b) keep it but add a comment saying it's a permanent defensive measure. The other readers (`->>`, `@>`) silently miss string-typed rows which is fine; only `jsonb_object_keys` raises, which is why the guard was added there specifically.

**Effort:** S (5 min)
**Priority:** P4
**Depends on:** None

### Address remaining 13 §15c quality follow-ups

**What:** `docs/internal/test-plans/sdk-stress-test-plan.md` §15c contains 18 numbered follow-up items. 2 are FIXED (15c-2, 15c-18). 3 are individually filed as TODOs above (15c-1 = 429 interception, 15c-3 = §6.8 OpenAI burn, 15c-16 = waitForQueueDrain quiescence). The remaining 13 items (15c-4 through 15c-15, plus 15c-17) are quality improvements ranging from "stream reader leak on error path" to "STRESS_USER_ID not in users table" to "DO invalidation parallel".

**Why:** None are critical. All are 5-30 line changes, isolated, low-risk. Worth picking off opportunistically as cleanup PRs but no urgency.

**Context:** Read §15c in the stress test plan for the full table with file:line and rationale for each. They're listed in priority-ish order but all are P4-equivalent.

**Effort:** S (each item 10-30 min)
**Priority:** P4
**Depends on:** None

### waitForQueueDrain quiescence vs queue drained

**What:** `apps/proxy/stress-sdk-features.test.ts` — `waitForQueueDrain` declares "queue drained" when the row count is stable for ~6 seconds. Cloudflare Queue can have variable delivery latency; retries can arrive after longer gaps.

**Why:** Could leave orphan rows in teardown (rare). Filed as 15c-16 (codex P2). Not currently observed in any of the 8+ stress runs, but the failure mode is plausible.

**Context:** Tighten the quiet window (e.g., 5 samples × 3 seconds = 15s) OR drive cleanup off exact request IDs / queue metrics instead of count stability. Current setup: 3 samples × 2 seconds = 6s stable plateau.

**Effort:** S (~30 min)
**Priority:** P4
**Depends on:** None

### Decide: GitHub Issues vs TODOS.md for issue tracking

**What:** The repo has GitHub Issues enabled (`hasIssuesEnabled: true`) but zero issues filed. The team uses TODOS.md instead. Should we consolidate everything into TODOS.md, or start using GitHub Issues for some classes of work (bugs, regressions, infra)?

**Why:** TODOS.md is great for product features and internal context. GitHub Issues are better for tracking bugs that need community visibility, attaching PR conversations, assigning to people, and integrating with project boards. Mixing both is fine but only if the boundary is clear. Right now there is no boundary because nobody has ever used Issues.

**Context:** No urgency. Worth deciding before the team grows past one developer. Could split: TODOS.md for product features and internal design, GitHub Issues for bugs from external contributors and operational regressions.

**Effort:** XS (decision only)
**Priority:** P4
**Depends on:** None

## Completed
