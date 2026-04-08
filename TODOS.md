# TODOS

## Attribution

### ~~Functional index for hot tag keys~~

**Completed:** 2026-04-04 (migration 0052_cost_events_customer_tag_index.sql)

### Per-customer cost threshold alerting

**What:** Webhook-based alerting when any customer's cost exceeds a configured threshold in a rolling window.

**Why:** Attribution answers "what does each customer cost?" Alerting answers "when does it change?" Together they close the FinOps feedback loop. The target user (backend dev at a SaaS startup) will want to know immediately when a customer's usage spikes.

**Context:** Leverage existing webhook infrastructure (dispatch, signing, threshold detection). Requires a new entity type for per-customer thresholds (e.g., "alert when any API key exceeds $50/day"). Could be polling-based (check on each cost event) or batch (periodic aggregation check). The webhook payload builders (`buildThresholdCrossingPayload`) and dispatch pipeline already exist. Main work is the threshold entity model and the trigger mechanism.

Customer attribution is fully shipped as of Phase 0 finish 2026-04-08 — this work is unblocked and is the only P2 in TODOS. Natural next pickup after Phase 0.

**Effort:** M
**Priority:** P2
**Depends on:** Attribution feature shipped ✅ (2026-04-08). Webhook infrastructure ✅ (already exists).

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

## Phase 2 / Revenue Infrastructure

### Embedded metered billing pass-through (Stripe Billing Meter API)

**What:** NullSpend calculates per-customer AI costs, applies a configurable margin, and creates Stripe usage records on the customer's own Stripe subscription. The SaaS can charge their end-users for AI usage without building their own metering pipeline — NullSpend becomes the metering layer. Fiat-native equivalent of what Locus does with USDC wallets, minus the crypto.

**Why:** Three things at once:
1. **Revenue model evolution.** Today NullSpend charges flat subscription tiers. Metered pass-through adds a percentage-of-customer-billing revenue stream that scales with customer value delivered.
2. **Customer lock-in.** Once a SaaS is using NullSpend to BILL their customers (not just track), switching cost is significant — it replaces their whole usage→invoice pipeline.
3. **Strategic positioning.** Closes the loop between the Stripe revenue sync (Phase 0) and the cost tracking: NullSpend is the ONLY tool that sees both the cost AND the revenue for each customer.

**Context:** Builds directly on Phase 0's customer attribution + margin table. The margin table already computes per-customer revenue from Stripe invoices; this inverts the flow — instead of READING Stripe invoices, we WRITE Stripe usage records. Key design decisions:
  - Map `customer_mappings.tag_value` → Stripe customer → subscription item (reuse existing mapping infra)
  - Margin config per-customer or per-org: "charge 2x cost" / "cost + $0.05/request" / custom function
  - Aggregation period: match Stripe billing cycle (monthly, typically)
  - Reconciliation: periodic cron aggregates unreported cost_events, creates UsageRecord via Stripe Billing Meter API, marks events as reported
  - Failure handling: partial Stripe writes must be recoverable (idempotency keys, retry queue)
  - Dashboard: new billing page showing pending amounts, reported amounts, failed writes, margin per customer
  - Opt-in feature: off by default, org enables per customer mapping

**Open design questions to resolve BEFORE implementation:**
  1. Stripe Billing Meter vs legacy UsageRecord API? (Stripe is pushing Meter API; check if it's GA)
  2. Push model (sync on each cost event) or pull model (cron aggregates + pushes batch)? Pull is probably right — aligns with Stripe's batching expectations
  3. Margin schema: store as JSONB (flexible) or dedicated columns (typed)?
  4. Idempotency key format: `{org_id}-{customer_id}-{period_start}` — deterministic retry support
  5. What happens when a customer_mapping is deleted but unreported cost_events exist? (Orphan handling)
  6. Reconciliation failure → alerting path (reuse Slack margin-alert infra?)

**Not in scope initially:**
  - Net settlement between multi-party usage (that's 6.S Agent Commerce Settlement, separate item)
  - Mid-period margin changes (treat margin as snapshot-at-write-time)
  - Non-Stripe payment providers (Paddle, Chargebee) — defer until customer asks

**Effort:** L (2 weeks minimum per the roadmap — realistic 3 weeks with dashboard + design doc + eng review)

**Priority:** P3 (strategic, not urgent). Moved up to P2 once Phase 1 launch is done or if a customer explicitly asks.

**Depends on:**
  - ✅ Customer attribution (Phase 0 finish, 2026-04-08)
  - ✅ Stripe revenue sync (Phase 0 finish, 2026-04-04)
  - ✅ Margin table + customer_mappings (Phase 0 finish)
  - Design doc written + eng review BEFORE implementation (roadmap spec is only ~8 lines)
  - Decision on sync vs batch push model
  - Stripe Billing Meter API research (GA status, pricing, rate limits)

**Reference:** Full roadmap context at `docs/internal/nullspend-technical-feature-roadmap.md` §6.1 "Metered Billing Pass-Through" (line 607). Scheduled as Month 5-6 on the formal roadmap.

## SDK / Stress Test

> Items below were filed during PR #6 (stress test suite + 2 product bug fixes).
> Full design context lives in `docs/internal/test-plans/sdk-stress-test-plan.md` §15c
> (18 numbered follow-ups) and `docs/internal/test-plans/sdk-testing-gaps.md` (coverage map).
> This section captures the must-pick-up items in the canonical TODO format.

### ~~Add `X-NullSpend-Denied` response header to proxy 429 denials~~

**Completed:** 2026-04-08 on `feat/sdk-followups-from-f1-f11` (commit `8ca3c9a`). Proxy now stamps `X-NullSpend-Denied: 1` on all 9 denial Response constructors (5 in `apps/proxy/src/routes/shared.ts`, 4 in `apps/proxy/src/routes/mcp.ts`). SDK `parseDenialPayload` gates on the header — upstream provider 429s never carry it so they fall through with zero body parsing. Bonus: `dispatchDenialCode` unknown-code path now surfaces to `onCostError` as a real drift signal (was previously silent because of the collision-avoidance constraint that no longer applies). New unit test: valid NullSpend body but missing header → fall through. Hard-cut, no backward compat. **Order-of-ops for shipping: deploy proxy first, then publish SDK 0.2.1.**

### ~~SDK Functional E2E test suite~~

**Completed:** 2026-04-07 on `feat/sdk-functional-tests` — `apps/proxy/smoke-sdk-functional.test.ts` ships F1–F11 (11 tests, 14 entries with sub-tests) plus the dual-auth fix for `app/api/cost-events/summary/route.ts` that was blocking F5. Manual-runs-only via `pnpm proxy:smoke smoke-sdk-functional.test.ts`. Full plan + eng review at `~/.claude/plans/wondrous-hugging-goblet.md`.

### ~~Add public fields to `TimeoutError` (SDK)~~

**Completed:** 2026-04-08 on `feat/sdk-followups-from-f1-f11` (commit `b5043e4`). `TimeoutError` now exposes `public readonly actionId: string` and `public readonly timeoutMs: number`, mirroring the `RejectedError` pattern. F2-B and F11 in `smoke-sdk-functional.test.ts` updated to assert the new fields directly. Existing unit test `packages/sdk/src/client.test.ts` "throws TimeoutError when deadline passes" rewritten to capture and field-assert. 14/14 live smoke tests pass.

### ~~Align `ListCostEventsOptions.cursor` SDK type with server schema~~

**Completed:** 2026-04-08 on `feat/sdk-followups-from-f1-f11` (commit `5c6c55d`). SDK type widened to `string | { createdAt: string; id: string }`. `client.ts listCostEvents()` stringifies internally if it's an object. F6 inline `JSON.stringify(page1.cursor) as unknown as string` workaround removed — pass the response cursor straight back. 4 new unit tests cover string cursor pass-through, object cursor stringification, response cursor round-trip, and absent cursor. **Note:** Python SDK has the same bug — see follow-up below.

### Align `ListCostEventsOptions.cursor` Python SDK type with server schema

**What:** `packages/sdk-python/src/nullspend/types.py:143-145` — Python SDK's `ListCostEventsOptions.cursor` is typed as `str | None` but the response returns it as `dict[str, str] | None`. The Python docs at `content/docs/sdks/python.md:256` show users having to do `json.dumps(result.cursor)` themselves — same bug as the TS SDK had.

**Why:** Symmetry with the TS SDK fix. Worth doing as a separate PR because it touches Python test suite + types.py + client.py + docs.

**Context:** Mirror the TS approach: widen the dataclass field type to `str | dict[str, str] | None` and json.dumps internally in `list_cost_events()`. Update `test_client.py` and `content/docs/sdks/python.md`.

**Effort:** S (~30 min)
**Priority:** P4
**Depends on:** None

### ~~Customer attribution end-to-end smoke test (F12)~~

**Completed:** 2026-04-08 on `feat/sdk-quick-close-followups` (commits `98ac6e6` + `b48b01d`). F12 added to `apps/proxy/smoke-sdk-functional.test.ts` — single test that creates a customer-scoped session, makes one real OpenAI request through the deployed proxy, polls cost_events for the row, then verifies the SDK `listCostEvents` response surfaces the `customerId` field. ~$0.005 per run, ~5s wall.

**Two real bugs forced by F12** (filed as separate commits):
1. The dashboard read path (`list-cost-events.ts`, `serialize-cost-event.ts`, `[id]/route.ts`, `sessions/[sessionId]/route.ts`, `get-cost-events-by-action.ts`) never SELECTed `customer_id`. Customer attribution had been a write-only field since the feature shipped 2026-04-04 — the read path silently dropped it.
2. The SDK `CostEventRecord` type didn't expose `customerId` at all. Without F12 these would have shipped silently.

15/15 smoke tests passing live, including F12. Filter assumption note: F12 doesn't use a `customerId` query filter (which doesn't exist on the dashboard or SDK). Instead it fetches the most recent 100 events and finds the matching one by unique `customerId` baked with the run ID. A `customerId` filter would be a separate (P4) follow-up.

### F8 retry timing precision tightening (smoke-sdk-functional)

**What:** F8-A in `apps/proxy/smoke-sdk-functional.test.ts` asserts retry gaps are `>= 40ms` (50ms base × 0.8 jitter floor). Could measure `retryBaseDelayMs` and `maxRetryTimeMs` more precisely with explicit timing windows instead of the generous floor.

**Why:** Filed during the eng review of `feat/sdk-functional-tests`. The current bound catches "retries didn't wait at all" regressions but wouldn't catch "retries waited too long" regressions. Not blocking — current coverage is good enough for the canonical doc scope.

**Context:** Only worth doing if regressions emerge. Optional polish.

**Effort:** S (~30 min)
**Priority:** P5
**Depends on:** None

### F5/F6 pre-seed cost events for stability (smoke-sdk-functional)

**What:** F5 (`getCostSummary`) and F6 (`listCostEvents`) currently assert response shape only and soft-skip pagination if the smoke org has zero events. If smoke runs become flaky due to empty windows, add a `beforeAll` `client.reportCost()` of a small synthetic event (and add it to cleanup).

**Why:** Filed during the eng review of `feat/sdk-functional-tests`. Current production has events for the smoke key from prior smoke runs, so it's a non-issue today. Adds noise to production data so was rejected for the initial PR.

**Context:** Only if the soft-skip starts firing in real runs.

**Effort:** S (~15 min)
**Priority:** P5
**Depends on:** None

### Pre-existing flaky test: permission-enforcement timeout

**What:** `app/api/__tests__/permission-enforcement.test.ts > Permission enforcement — viewer cannot write > POST /api/budgets → 403 (requires member)` times out at 5000ms when run as part of `pnpm test`. Passes in isolation in 4.4s.

**Why:** Single-test flakiness erodes trust in `pnpm test` — every run has a chance of red on this one test even when nothing is broken. Right now it's masked because it only happens under parallel load and the dashboard CI doesn't always trigger it.

**Context:** The test is genuinely slow (~4.4s in isolation, close to the 5000ms default). Under parallel load it tips over. Fix: either increase the per-test timeout to 10000ms with a comment explaining why, OR profile the test to find why the 403 path is so slow (probably a sync DB call or auth setup that should be mocked). Not in either of the merged PRs — it was pre-existing and noticed by /ship's test triage.

**Effort:** S (~30 min)
**Priority:** P3
**Depends on:** None

### ~~Heavy stress intensity validation~~

**Completed:** 2026-04-08 — `STRESS_INTENSITY=heavy pnpm test:stress stress-sdk-features.test.ts` ran clean: 42 passed + 1 skipped (the §7.7 `it.skip` covered by §6.9), 142.76s wall, ~$0.05. Pre-flight `jsonb:repair` showed 0 broken rows. Plan §19 step 13 acceptance criterion is now met across light + medium + heavy intensities. No race windows surfaced at 50 concurrent / 60 race / 100 batch events.

### Publish @nullspend/sdk 0.2.1 to npm

**What:** Bump the SDK version, run `pnpm publish` from `packages/sdk`. The current `0.2.0` has the customer primitive fixes but NOT (a) the shutdown race fix from PR #6 NOR (b) the proxy 429 interception fix from §15c-1 (TODOS.md "Completed" section, 2026-04-07).

**Why:** If anyone outside the workspace consumes `@nullspend/sdk` from npm, they're missing two real fixes:
1. **Shutdown race fix** — silent data loss when racing flush + shutdown
2. **Proxy 429 interception fix** — typed errors (`BudgetExceededError`, etc.) now thrown for proxy denials with `enforcement: true`. Previously the proxied path bailed out before interception could run, returning raw 429s. **Behavior change**: any caller catching 429 manually will now see typed errors thrown unexpectedly. Must be called out in the release notes.

Internal proxy/dashboard code uses the workspace dependency and is already on the fixed version.

**Context:** Check `packages/sdk/package.json` for current version. Both fixes are on main. Verify with `pnpm test` from `packages/sdk` (389 tests should pass — was 381 before the 429 interception fix). Then bump version, build, publish. The release notes should explicitly document the typed-error behavior change so any external user catching 429 manually has a heads up.

**Effort:** S (~15 min)
**Priority:** P3 (P0 if there are external consumers)
**Depends on:** None

### ~~§6.8 fail-open session limit test burns OpenAI calls per run~~

**Completed:** 2026-04-08 on `feat/sdk-quick-close-followups` (commit `cd7d530`). Took option (a) — deleted the §6.8 stress test entirely and replaced the describe block with an inline comment documenting why. Heavy stress validation post-deletion confirmed no regression: 42 + 1 skipped (was 43 + 1 skipped). Coverage of the fail-open path remains intact via unit tests in `packages/sdk/src/tracked-fetch.test.ts` (mocked clock + fetch, deterministic). Live-stack coverage of client-side session limit enforcement is now a P5 nice-to-have — see the inline comment in the test file for how to restore it (mock upstream, or coordinate policy endpoint to return permissive policy for stress test org).

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

### SDK proxy 429 interception is dead code in proxy bailout mode (P1) — DONE 2026-04-07

**Problem:** `tracked-fetch.ts:95` bailed out via `globalThis.fetch(input, init)` before the 429 interception block at line 192 could run. In real proxy usage (the only mode that ever produces NullSpend denial codes), the typed-error API surface (`BudgetExceededError`, `VelocityExceededError`, `SessionLimitExceededError`, `TagBudgetExceededError`) was dead code. Customers using `enforcement: true` with `proxyUrl` got raw 429s. Stress test §6.9 documented this empirically.

**Fix:** Restructured the proxied branch into `fetch → if (429 && enforcement) intercept → return raw response`. Extracted the inline interception block (~85 lines) into two helpers: `parseDenialPayload` (returns null on parse failure or no-error-field; surfaces JSON parse failure + non-string code to `onCostError` as a drift signal) and `dispatchDenialCode` (calls `safeDenied` then throws the typed error; surfaces unknown codes to `onCostError`). The direct path was refactored to call the same helpers. The no-double-count guarantee is structurally preserved — the proxied branch never reaches the cost-tracking code.

**Test changes:** `packages/sdk/src/tracked-fetch.test.ts` — restructured the existing 15-test "proxy 429 interception" describe block into 3 sub-describes ("via proxyUrl" with 13 rewritten + 7 new tests, "via x-nullspend-key header" with 1 new test, "direct mode (defensive)" with 2 retained tests). Net: 23 tests, +8. The 8 new tests cover: proxied 200 → no cost tracking (no-double-count regression), `enforcement: false` gate, customer header injection ordering, malformed JSON body → `onCostError` + raw response, `error: null` → silent fall-through, `Retry-After: 0` → `retryAfterSeconds === 0` (locks the `Number.isFinite` change), unknown denial code → `onCostError` (drift signal), header-based proxy detection (`x-nullspend-key`) + 429 → typed error. `apps/proxy/stress-sdk-features.test.ts` §6.9 was flipped from documenting the gap to verifying the fix end-to-end.

**Verified:** SDK unit tests 389/389 passing (was 381, +8 net). Typecheck clean. Proxy unit tests 1341/1341. Dashboard tests 1815/1815. Live §6.9 against deployed proxy: PASS (Phase 0 transport matrix + §6.9 = 6/6 passed, ~46s, <$0.01).

**Filed in:** §15c-1 (and §15c-17 design choice resolved by the same fix). Both marked ✅ FIXED in `docs/internal/test-plans/sdk-stress-test-plan.md`.

