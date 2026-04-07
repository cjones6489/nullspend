# SDK Testing Gaps & Coverage Map

> Living document. Updated whenever SDK surface area changes or new test
> coverage lands. Source of truth for "what's tested where" and "what's
> still missing."

**Last updated:** 2026-04-07
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
| **Functional E2E** | `apps/proxy/smoke-sdk-functional.test.ts` *(does not exist yet — see §"Plan" below)* | Single-call correctness against the live deployed proxy + dashboard. Read APIs, HITL action lifecycle, retry config behavior. | Concurrency races. |
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
| `constructor()` | ✅ | ✅ happy | — | proxyUrl validation, custom fetch, retry config covered by unit only |
| `createAction()` | ✅ | ❌ | ❌ | HITL — no race concern, belongs in Functional |
| `getAction()` | ✅ | ❌ | ❌ | HITL — Functional |
| `markResult()` | ✅ | ❌ | ❌ | HITL — Functional |
| `reportCost()` | ✅ | ✅ §0.1, §6.4.1 | — | |
| `reportCostBatch()` | ✅ | ✅ §6.4.2/.5, §6.12, §7.6 | — | |
| `queueCost()` | ✅ | ✅ §6.4.3, §7.6b | — | |
| `flush()` | ✅ | ✅ §6.4.3 | — | |
| `shutdown()` | ✅ | ✅ §6.13 idempotency | — | ⚠️ shutdown DURING active flush race untested → Stress §5.9 below |
| `createTrackedFetch("openai")` | ✅ | ✅ multiple | — | |
| `createTrackedFetch("anthropic")` | ✅ | ✅ §6.10, §0.5 | — | |
| `customer(id, opts?)` | ✅ | ⚠️ session() interface bypassed | — | CustomerSessionOptions fields not exercised through actual session() — Stress §5.3 |
| `checkBudget()` | ✅ | ✅ §6.11 (shape only) | — | |
| `listBudgets()` | ✅ | ✅ §6.11 | — | |
| `getCostSummary()` | ✅ | ❌ | ❌ | Read API, no races — Functional |
| `listCostEvents()` | ✅ | ✅ §6.11 (no pagination) | ❌ | Pagination (limit, cursor) — Functional |
| `requestBudgetIncrease()` | ✅ | ❌ | ❌ | HITL wrapper — Functional |
| `proposeAndWait()` / `waitForDecision()` | ✅ | ❌ | ❌ | HITL orchestrator — Functional |

### TrackedFetchOptions fields (9)

| Field | Unit | Stress | Functional | Gap addressed in |
|---|---|---|---|---|
| `customer` | ✅ | ✅ multiple | — | |
| `sessionId` | ✅ | ⚠️ §6.8 fail-open only | — | Stress §5.1 (propagation to cost_events.session_id) |
| `tags` | ✅ | ⚠️ via direct ingest only | — | Stress §5.1 (propagation through tracked fetch path) |
| `traceId` | ✅ | ❌ | — | Stress §5.1 |
| `actionId` | ✅ | ❌ | ❌ | HITL correlation — Functional + Stress §5.1 |
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
| `TimeoutError` | Unit only | ❌ | HITL — Functional |
| `RejectedError` | Unit only | ❌ | HITL — Functional |

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
| `apiVersion` override | ✅ | ❌ | ❌ | Functional — single call against custom version |
| `fetch` (custom) | ✅ | ❌ | ❌ | Functional — verify custom fetch is called |
| `requestTimeoutMs` firing | ✅ | ⚠️ §6.8 setup only | ❌ | Functional — assert timeout actually fires |
| `maxRetries` firing | ✅ | ⚠️ §6.8 (set to 0) | ❌ | Functional — assert retries happen |
| `retryBaseDelayMs` | ✅ | ❌ | ❌ | Functional — measure delay |
| `maxRetryTimeMs` | ✅ | ❌ | ❌ | Functional — assert wall-time cap |
| `onRetry` callback | ✅ | ❌ | ❌ | Functional |
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

### Functional E2E suite (separate PR — `feat/sdk-functional-tests`)

Will land in `apps/proxy/smoke-sdk-functional.test.ts` (or similar). Targets
all single-call SDK paths against live infra. NOT a stress test — single
sequential calls, no concurrency. Should run alongside other smoke tests in
the manual smoke suite.

| § | Coverage area | Tests | Estimated lines |
|---|---|---|---|
| F1 | HITL Action lifecycle | `createAction` → `getAction` → `markResult(executing)` → `markResult(executed)` happy path | ~40 |
| F2 | HITL polling | `waitForDecision()` happy + timeout + manual approve via dashboard API | ~50 |
| F3 | HITL orchestrator | `proposeAndWait()` happy / rejected / timeout | ~60 |
| F4 | Budget increase wrapper | `requestBudgetIncrease()` end-to-end with manual approve | ~50 |
| F5 | Read API: getCostSummary | All 3 periods (7d, 30d, 90d), assert response shape | ~30 |
| F6 | Read API: listCostEvents pagination | limit + cursor round-trip | ~30 |
| F7 | Custom fetch injection | Provide a custom fetch, verify it's called | ~20 |
| F8 | Retry config behavior | Force a 503, observe retries, verify onRetry called, verify maxRetries cap | ~40 |
| F9 | requestTimeoutMs firing | Slow endpoint, verify abort | ~20 |
| F10 | apiVersion header override | Verify custom version sent | ~15 |
| F11 | Error classes from HITL | TimeoutError, RejectedError instanceof + field validation | ~30 |

**Total:** ~400 lines, ~11 tests. **Not in this PR.** Tracked here so the next
PR can pick it up cleanly.

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

## Status as of 2026-04-07

- **Stress test:** 33 passing tests (2 phases pre-PR-6 baseline) → 42+ after Phase 5 lands
- **Unit tests:** ~530 tests across `packages/sdk/src/*.test.ts`
- **Functional E2E suite:** does not exist yet — file as `feat/sdk-functional-tests` after this PR ships
- **Smoke tests:** ~29 files across `apps/proxy/smoke-*.test.ts`
- **SDK public methods covered by stress:** 11 of 18 → 11 of 18 after Phase 5 (HITL + getCostSummary intentionally deferred to Functional)
- **TrackedFetchOptions fields fully covered:** 4 of 9 → 9 of 9 after Phase 5
- **CustomerSessionOptions fields covered via session():** 0 of 7 → 7 of 7 after Phase 5
- **Error class field validation:** 1 of 8 → 4 of 8 after Phase 5 (Velocity/TagBudget/Timeout/Rejected stay in unit only)
