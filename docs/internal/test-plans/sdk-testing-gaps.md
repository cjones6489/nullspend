# SDK Testing Gaps & Coverage Map

> Living document. Updated whenever SDK surface area changes or new test
> coverage lands. Source of truth for "what's tested where" and "what's
> still missing."

**Last updated:** 2026-04-08
**Maintainer:** stress test PR #6 (initial draft) → ongoing per-PR updates

---

## Test surface taxonomy

The SDK is tested across four distinct surfaces, each catching a different
class of bug. This document classifies every SDK feature against these
surfaces and identifies missing coverage.

| Surface | File location | What it catches | What it can't catch |
|---|---|---|---|
| **Unit** | `packages/sdk/src/*.test.ts` | Logic correctness in isolation. Mocked `fetch`, mocked clock. | Real network, real DB state, real concurrent races, real upstream behavior. |
| **Stress** | `apps/proxy/stress-sdk-features.test.ts` | Concurrent races, queue drops, DO sync gaps, attribution leaks under load, end-to-end attribution propagation. | Single-call correctness (covered by unit). Pure read APIs (no races). HITL flows (no concurrency by design). |
| **Functional E2E** | `apps/proxy/smoke-sdk-functional.test.ts` | Single-call correctness against the live deployed proxy + dashboard. Read APIs, HITL action lifecycle, retry config behavior. | Concurrency races. |
| **Smoke (existing)** | `apps/proxy/smoke-*.test.ts` | Provider-specific live API calls (OpenAI, Anthropic) through the proxy. Cost calculation accuracy. | SDK-side surface area. |

**Rule of thumb:**
- Race condition or load concern → **Stress**
- Single-call correctness against live infra → **Functional E2E**
- Pure logic, no I/O → **Unit**
- Live provider call, cost math → **Smoke**

---

## SDK public API inventory

Every method, field, and option exported from `@nullspend/sdk`. Coverage
columns: ✅ tested | ⚠️ partial | ❌ untested | N/A not applicable.

### NullSpend class methods (18)

| Method | Unit | Stress | Functional | Notes |
|---|---|---|---|---|
| `constructor()` | ✅ | ✅ happy | ✅ F7/F8/F9/F10 | proxyUrl validation by unit; custom fetch + retry + timeout + apiVersion config validated in Functional via fetch injection |
| `createAction()` | ✅ | ❌ | ✅ F1 | |
| `getAction()` | ✅ | ❌ | ✅ F1 | |
| `markResult()` | ✅ | ❌ | ✅ F1 | |
| `reportCost()` | ✅ | ✅ §0.1, §6.4.1 | — | |
| `reportCostBatch()` | ✅ | ✅ §6.4.2/.5, §6.12, §7.6 | — | |
| `queueCost()` | ✅ | ✅ §6.4.3, §7.6b | — | |
| `flush()` | ✅ | ✅ §6.4.3 | — | |
| `shutdown()` | ✅ | ✅ §6.13 idempotency | — | ⚠️ shutdown DURING active flush race untested → Stress §5.9 below |
| `createTrackedFetch("openai")` | ✅ | ✅ multiple | ✅ F4 (enforced+spy) | |
| `createTrackedFetch("anthropic")` | ✅ | ✅ §6.10, §0.5 | — | |
| `customer(id, opts?)` | ✅ | ⚠️ session() interface bypassed | — | CustomerSessionOptions fields not exercised through actual session() — Stress §5.3 |
| `checkBudget()` | ✅ | ✅ §6.11 (shape only) | — | |
| `listBudgets()` | ✅ | ✅ §6.11 | ✅ F7 (via spy) | |
| `getCostSummary()` | ✅ | ❌ | ✅ F5 | All 3 periods + shape; required dual-auth fix on `/api/cost-events/summary` route |
| `listCostEvents()` | ✅ | ✅ §6.11 (no pagination) | ✅ F6 | Pagination round-trip with cursor stringify workaround (filed as follow-up) |
| `requestBudgetIncrease()` | ✅ | ❌ | ✅ F4 | Lifecycle + policy cache invalidation observed via fetch spy on `/api/policy` |
| `proposeAndWait()` / `waitForDecision()` | ✅ | ❌ | ✅ F2/F3 | F2a happy + F2b TimeoutError; F3a happy + F3b RejectedError |

### TrackedFetchOptions fields (9)

| Field | Unit | Stress | Functional | Gap addressed in |
|---|---|---|---|---|
| `customer` | ✅ | ✅ multiple | — | |
| `sessionId` | ✅ | ⚠️ §6.8 fail-open only | — | Stress §5.1 (propagation to cost_events.session_id) |
| `tags` | ✅ | ⚠️ via direct ingest only | — | Stress §5.1 (propagation through tracked fetch path) |
| `traceId` | ✅ | ❌ | — | Stress §5.1 |
| `actionId` | ✅ | ❌ | ⚠️ F1/F4 set agentId only | HITL correlation surface used in F1/F4; full propagation through cost_events tested in Stress §5.1 |
| `enforcement` | ✅ | ✅ §6.6/6.7b/6.8 | — | |
| `sessionLimitMicrodollars` | ✅ | ⚠️ fail-open only | — | Stress §5.7 (happy-path enforcement) |
| `onCostError` | ✅ | ❌ firing | — | Stress §5.7 (assert callback fires under stress) |
| `onDenied` | ✅ | ✅ §6.6, §6.7b | — | |

### CustomerSessionOptions fields (7)

| Field | Unit | Stress | Functional |
|---|---|---|---|
| `plan` | ✅ | ❌ via session() interface | — |
| `sessionId` | ✅ | ❌ via session() interface | — |
| `sessionLimitMicrodollars` | ✅ | ❌ via session() interface | — |
| `tags` | ✅ | ❌ via session() interface | — |
| `enforcement` | ✅ | ❌ via session() interface | — |
| `onCostError` | ✅ | ❌ | — |
| `onDenied` | ✅ | ❌ via session() interface | — |

All addressed in Stress §5.3 below.

### Error classes (8)

| Class | instanceof | Field validation | Notes |
|---|---|---|---|
| `NullSpendError` | ✅ §6.12 | ⚠️ statusCode only | |
| `BudgetExceededError` | ✅ | ❌ | Stress §5.6 |
| `MandateViolationError` | ✅ §6.6 | ⚠️ requested only | Stress §5.6 |
| `SessionLimitExceededError` | ✅ | ❌ | Stress §5.6 |
| `VelocityExceededError` | Unit only | ❌ | Cannot test in stress under proxy bailout (§15c-1). Unit covers it. |
| `TagBudgetExceededError` | Unit only | ❌ | Same as above. |
| `TimeoutError` | Unit only | ❌ + ✅ F2b/F11 | ⚠️ instanceof + message only — no public fields exist (filed as follow-up) |
| `RejectedError` | Unit only | ❌ + ✅ F3b/F11 | `actionId` + `actionStatus` validated |

### CostEventInput fields (15)

| Field | Stress test coverage | Gap addressed in |
|---|---|---|
| `provider`, `model` | ✅ | |
| `inputTokens`, `outputTokens` | ✅ basic | |
| `cachedInputTokens` | ❌ never asserted in DB | Stress §5.5 |
| `reasoningTokens` | ❌ never asserted in DB | Stress §5.5 |
| `costMicrodollars` | ✅ | |
| `costBreakdown` | ❌ shape never verified in DB | Stress §5.5 |
| `durationMs` | ❌ never asserted | Stress §5.5 |
| `sessionId` | ❌ never asserted | Stress §5.5 |
| `traceId` | ❌ | Stress §5.5 |
| `eventType: "tool"` | ❌ | Stress §5.4 |
| `toolName`, `toolServer` | ❌ | Stress §5.4 |
| `customer` | ✅ | |
| `tags` | ✅ shape | Stress §5.5 (round-trip assertion) |

### NullSpendConfig fields

| Field | Unit | Stress | Functional | Notes |
|---|---|---|---|---|
| `proxyUrl` | ✅ | ✅ | — | |
| `apiVersion` override | ✅ | ❌ | ✅ F10 | Header value asserted via fetch spy |
| `fetch` (custom) | ✅ | ❌ | ✅ F7 | Custom fetch invoked, headers + URL captured |
| `requestTimeoutMs` firing | ✅ | ⚠️ §6.8 setup only | ✅ F9 | Slow fetch + AbortSignal.timeout fires within bound |
| `maxRetries` firing | ✅ | ⚠️ §6.8 (set to 0) | ✅ F8a/F8b | Retry-then-succeed AND cap enforcement (3 calls = 1 + 2 retries) |
| `retryBaseDelayMs` | ✅ | ❌ | ✅ F8a | Asserted via `info.delayMs` from onRetry callback (deterministic, full-jitter aware) |
| `maxRetryTimeMs` | ✅ | ❌ | ❌ | Wall-time cap not asserted in F8 — could add if regressions emerge |
| `onRetry` callback | ✅ | ❌ | ✅ F8a | Fired with correct attempt indices, method, path, delayMs |
| `costReporting.batchSize` | ✅ | ✅ §7.6b | — | |
| `costReporting.flushIntervalMs` | ✅ | ✅ §7.6b | — | |
| `costReporting.maxQueueSize` | ✅ | ✅ §7.6b | — | |
| `costReporting.onDropped` | ✅ | ✅ §7.6b | — | |
| `costReporting.onFlushError` | ✅ | ❌ firing | — | Stress §5.8 |

---

## Things the SDK does NOT support (and never will)

The user asked about "creating data, adding keys, removing keys, adding tags,
removing tags." The SDK is a CLIENT, not an admin tool. These operations are
**not part of the SDK surface area**:

| Operation | Where | Why not in SDK |
|---|---|---|
| Create / delete API keys | Dashboard `/api/keys` | Admin operation requiring session auth |
| Create / delete budgets | Dashboard `/api/budgets` | Admin operation requiring session auth |
| Update budget config | Dashboard `/api/budgets/:id` | Admin operation |
| Create / manage customers | N/A — customers are tags, not entities | Customers are first-class on cost events but have no separate CRUD |
| Add / remove tags from existing events | N/A — events are immutable | Cost events are append-only |

These belong in **dashboard tests** (`app/api/*/route.test.ts`), not SDK tests.
The dashboard CRUD is already covered by route tests at the dashboard level —
see `app/api/budgets/route.test.ts`, `app/api/cost-events/route.test.ts`,
`app/api/keys/route.test.ts`. The stress test creates fixtures via raw SQL in
`beforeAll` rather than through the dashboard API specifically because the SDK
doesn't expose key/budget management.

---

## Plan: what gets added where

### Stress test Phase 5 (added in PR #6, this branch)

Adds 9 tests targeting only **stress-relevant** gaps — concurrency, races,
attribution propagation under load, queue interaction. Pure functional tests
go to Functional E2E (separate PR).

| § | Test | Gap addressed | Lines |
|---|---|---|---|
| 5.1 | Tracked fetch field propagation through proxy → cost_events (sessionId, tags, traceId, actionId) | Tracked fetch propagation under load — silent loss of attribution would only show across many concurrent calls | ~60 |
| 5.2 | Same propagation through SDK direct ingest (no proxy) | Same as 5.1 but for the non-proxy path | ~50 |
| 5.3 | CustomerSession plan/sessionId/tags through the actual `customer()` interface | CustomerSessionOptions fields untested via session() — interface contract | ~50 |
| 5.4 | Tool event tracking (`eventType: "tool"`, toolName, toolServer) round-trip | Entire tool tracking surface untested at the SDK level | ~30 |
| 5.5 | CostEventInput field round-trip (cachedInputTokens, reasoningTokens, costBreakdown, durationMs, sessionId, traceId) | Field-by-field DB column verification | ~50 |
| 5.6 | Error class field validation (entityType, entityId, limit, spend on BudgetExceededError; mandate/requested/allowed on MandateViolationError) | Only `instanceof` checks today — silent regressions in error fields would slip through | ~40 |
| 5.7 | Happy-path session limit enforcement via tracked fetch (not just fail-open) | sessionLimitMicrodollars + onCostError firing under realistic conditions | ~50 |
| 5.8 | onFlushError callback fires on flush failure (CostReporter pointed at unreachable baseUrl) | Callback configured but never asserted to actually fire | ~30 |
| 5.9 | shutdown() during active flush — race | Documented gap in §6.13 unit-test-only coverage | ~40 |

**Total:** ~400 new lines, ~30s additional test time at light intensity.

### Functional E2E suite — SHIPPED 2026-04-08

Landed in `apps/proxy/smoke-sdk-functional.test.ts` (commit `973e9ba`,
branch `feat/sdk-functional-tests`). 14 test entries covering 11 F-numbers
against the live deployed proxy + dashboard. Sequential calls, no concurrency.
Manual-runs-only via `pnpm proxy:smoke smoke-sdk-functional.test.ts`.

| § | Coverage area | Tests | What landed |
|---|---|---|---|
| F1 | HITL Action lifecycle | createAction → SQL approve → getAction → markResult(executing) → markResult(executed) | ✅ |
| F2a | waitForDecision happy | createAction → mid-poll SQL approve → resolves with `approved` | ✅ |
| F2b | waitForDecision timeout | No approve → throws `TimeoutError` (instanceof + message — no public fields) | ✅ |
| F3a | proposeAndWait happy | execute callback fires, action terminal state = `executed` | ✅ |
| F3b | proposeAndWait rejected | SQL reject → throws `RejectedError` with `actionId` + `actionStatus` | ✅ |
| F4 | requestBudgetIncrease | poll → approve → execute → policy cache invalidation observed via `/api/policy` fetch spy | ✅ |
| F5 | getCostSummary all 3 periods | Required dual-auth fix on `/api/cost-events/summary` route to land first | ✅ |
| F6 | listCostEvents pagination | limit + cursor round-trip; cursor stringify workaround inline | ✅ |
| F7 | Custom fetch injection | Spy fetch invoked with expected URL + `x-nullspend-key` header | ✅ |
| F8a | Retry on 503 + onRetry + idempotency | Retry-then-succeed; same idempotency key reused; `info.delayMs` bounded by `retryBaseDelayMs * 2^attempt` | ✅ |
| F8b | maxRetries cap | 1 initial + 2 retries → throws `NullSpendError` with `statusCode: 503` | ✅ |
| F9 | requestTimeoutMs firing | Slow fetch + `AbortSignal.timeout` aborts within bound | ✅ |
| F10 | apiVersion override | `NullSpend-Version` header value asserted via spy | ✅ |
| F11 | Error class fields | TimeoutError + RejectedError direct construction; validates built `dist/` matches source | ✅ |

**Approval mechanism:** direct SQL UPDATE on `actions` table — the dashboard
`/api/actions/[id]/approve` route is session-cookie auth (admin role) and the
SDK API key cannot call it. Mirrors what `lib/actions/resolve-action.ts` does
at the SQL level. RETURNING rowcount asserts the action existed and was
pending — fails loudly if the approve race fires. Symmetric cleanup in
beforeAll AND afterAll handles orphan rows from prior crashed runs.

**Two consecutive clean local runs:** 14/14 in 43s and 32s. Zero orphan rows
post-cleanup.

**Follow-ups filed in TODOS.md:**
1. Add public `actionId` + `timeoutMs` fields to `TimeoutError` (P4)
2. Align `ListCostEventsOptions.cursor` SDK type with server schema (P4)
3. F8 retry timing precision tightening (P5, optional polish)
4. F5/F6 pre-seed cost events for stability (P5, only if soft-skip starts firing)

### Stays in Unit tests only (no E2E needed)

The SDK unit test suite (`packages/sdk/src/*.test.ts`) already covers these
exhaustively. They don't need stress or functional E2E coverage:

- `validateCustomerId` edge cases (empty, whitespace, length, character set)
- `policy-cache` TTL, invalidation, mandate matrix
- `provider-parsers` (SSE chunk parsing for OpenAI/Anthropic)
- `cost-calculator` cost math
- `retry` calculation helpers
- `polling` helpers (interruptibleSleep, waitWithAbort)
- Constructor validation for all error cases
- Header injection for X-NullSpend-Customer (3 forms: Headers/array/object)
- proxyUrl origin matching (trailing-slash variants, confusable hostnames)

---

## Open questions / pending decisions

1. **Should the Functional E2E suite live in `apps/proxy/` or `packages/sdk/`?**
   Argument for proxy: it talks to the deployed proxy and uses smoke env vars.
   Argument for sdk: it's testing the SDK, not the proxy. Most other smoke
   tests live in `apps/proxy/` so consistency suggests proxy.

2. **Does HITL Action E2E need a real Slack/email notification channel?**
   Probably not — the dashboard's `markResult` route accepts approval calls
   from the test code itself, no human required. Test can be fully automated.

3. **Should `requestBudgetIncrease` end-to-end go in stress or functional?**
   Functional. It's a sequential proposeAndWait flow with no race surface.

---

## Maintenance protocol

When adding a new SDK method or option:

1. Add a row to the relevant inventory table above (NullSpend methods,
   TrackedFetchOptions, CostEventInput, etc.)
2. Tag it with the appropriate test surface (Unit / Stress / Functional)
3. If the gap should be addressed in this PR, add it to the "Stress test
   Phase X" section. Otherwise add it to "Functional E2E suite" or "Stays
   in Unit only."
4. After the test is added, mark the row ✅ and note the section number.

When dropping an SDK method:

1. Mark the row strikethrough or move to a "Removed" section.
2. Note in the per-PR diff which tests were also removed.

---

## Status as of 2026-04-08

- **Stress test:** 43+ passing tests across Phases 0–5
- **Unit tests:** ~530 tests across `packages/sdk/src/*.test.ts`
- **Functional E2E suite:** ✅ shipped in `apps/proxy/smoke-sdk-functional.test.ts` (commit `973e9ba`) — 14 test entries covering F1–F11, two consecutive clean runs (43s, 32s)
- **Smoke tests:** 30 files across `apps/proxy/smoke-*.test.ts`
- **SDK public methods covered by Functional:** 7 new methods (createAction, getAction, markResult, getCostSummary, listCostEvents pagination, requestBudgetIncrease, proposeAndWait/waitForDecision)
- **NullSpendConfig fields covered by Functional:** 6 new fields (apiVersion, fetch, requestTimeoutMs, maxRetries, retryBaseDelayMs, onRetry) — only `maxRetryTimeMs` remains untested
- **Error class coverage:** TimeoutError + RejectedError now validated from built `dist/` artifact (publish-time guard against build-vs-source drift)
- **Real product gap closed during this PR:** dashboard `/api/cost-events/summary` route was session-cookie-only → now supports `assertApiKeyOrSession("viewer")`, unblocking SDK `getCostSummary()` callers
