# Testing

NullSpend has ~3,965+ tests across ~233 files organized into four tiers.

## Quick Reference

```bash
pnpm test             # Root tests (dashboard: lib/, app/api/, components/)
pnpm proxy:test       # Proxy worker unit tests (apps/proxy/src/__tests__/)
pnpm claude-agent:test # Claude Agent SDK adapter tests
pnpm db:build && npx vitest run --config packages/cost-engine/vitest.config.ts --dir packages/cost-engine
                      # Cost-engine tests
```

Smoke tests (require live deployed worker + API keys):
```bash
cd apps/proxy && npx vitest run smoke.test.ts          # OpenAI core
cd apps/proxy && npx vitest run smoke-anthropic.test.ts # Anthropic core
```

**Important:** `pnpm test` and `pnpm proxy:test` are separate suites — always run both when changes span root and proxy.

## Test Tiers

### Tier 1 — Unit Tests (all mocked, fast)

Every test in this tier uses mocked dependencies and runs in <15 seconds total.

### Tier 2 — Integration Tests

Currently empty — the Redis-based Lua integration tests were removed when budget enforcement moved to Durable Objects.

### Tier 3 — Smoke Tests (live deployed worker + real APIs)

The 29 `apps/proxy/smoke*.test.ts` files hit the deployed Cloudflare Worker and make real API calls to OpenAI/Anthropic. They require API keys and a deployed proxy. These are NOT run in CI.

### Tier 4 — CI Pipeline

`.github/workflows/ci.yml` runs Tier 1 tests on push/PR to main: typecheck, lint, root tests, proxy tests, cost-engine tests.

---

## E2E Framework (`tests/e2e/`)

End-to-end tests that run against a live stack. See `tests/e2e/README.md` for
the full tier model, directory layout, and how to add a test.

**Status:** framework is being built incrementally. Current slices:

| Slice | Status | What it adds |
|---|---|---|
| 0 — Scaffolding + script-injection fix + CI wiring | ✅ shipped | `tests/e2e/` skeleton, `vitest.e2e.config.ts`, `playwright.config.ts`, `e2e-post-deploy.yml` hardened, JUnit artifact upload |
| 1 — Post-deploy infra smoke | ✅ shipped | `tests/e2e/infra/` with 5 suites: CSP nonce freshness, `/api/health` all-components-ok, DNS/SSL for prod hosts, proxy PONG, dashboard routes crash sweep. Closes P0-1/A2, P0-B, P0-C, P0-D, P0-E, P0-F, P1-19 detection gaps. |
| 1a — Workflow unblock + secret guard + Slack alerts | ✅ shipped | Extended condition to cover Production, pre-flight secret guard, Slack-on-failure. The workflow has NEVER run before Slice 1a because the condition was Preview-only. |
| 1b — Bootstrap E2E test org script | ✅ shipped | `scripts/bootstrap-e2e-org.ts` provisions `e2e-bootstrap-org` via real drizzle + `lib/auth/api-key.ts` helpers. Idempotent rotation. |
| 1c — Workflow build-step parity | ✅ shipped | Added missing sdk/claude-agent/docs builds to `e2e-post-deploy.yml` |
| 1d — Disable legacy `scripts/e2e-smoke.ts` | ✅ shipped | Legacy script requires dev mode; disabled in CI pending Slice 4 port |
| 1e — Critical audit fixes | ✅ shipped | globalSetup fail-fast, CSP body parsing, transactional bootstrap, shared `PROTECTED_ORG_IDS`, bootstrap key verification |
| 1f — Slice 1e audit follow-up | ✅ shipped | Typed drizzle deletes (replaced `sql.raw`), Object.freeze drop + `ProtectedOrgError` class, Content-Type gated verify, exit code 2 for inconclusive, `NULLSPEND_SKIP_KEY_VERIFY` flag, 24 new unit tests for global-setup + protected-orgs |
| 1g — Supabase circuit breaker fix | ✅ shipped | `getCurrentUserId()` throws `AuthenticationRequiredError` OUTSIDE the breaker so unauthenticated requests don't trip it |
| 1h — Production URL override | ✅ shipped | Workflow uses stable `www.nullspend.dev` for Production deploys (Vercel per-deployment URLs are behind Deployment Protection) |
| 1i — Circuit breaker service/client classification | ✅ shipped | Verified against `@supabase/auth-js` source: `auth.getUser()` NEVER throws. Added `isSupabaseServiceFailure` helper that promotes `AuthRetryableFetchError` + 5xx responses to thrown exceptions INSIDE the breaker. 10 new regression tests with realistic `mockResolvedValue({error: ...})` patterns. |
| 1j — Medium edge-case fixes | ✅ shipped | CSP body test explicit 3xx assertion (EC-2), orphan cleanup drift test walking drizzle schema (EC-3), `assertNotProtected` input normalization + 6 new tests (EC-4) |
| 1k — Commit-SHA verification | ✅ shipped | New `/api/version` endpoint + workflow step that verifies deployed SHA matches `github.sha`. Catches Vercel auto-rollback, multi-deploy races, atomic-swap window (EC-5). 13 unit tests. |
| 1l — Composite action + verbose gate + cost event DB verification | ✅ shipped | `.github/actions/build-workspace-packages/action.yml` (BUG-8), `/api/health?verbose=1` opt-in gate via `INTERNAL_HEALTH_SECRET` + 9 new tests (Drift-3 / G-18), DB verification of PONG cost events (Gap-7) |
| 1m — Low-severity edge cases | ✅ shipped | Bootstrap 429 as inconclusive (EC-7), Postgres advisory lock for concurrent bootstrap (EC-9), workflow URL sanity check (EC-10) |
| 1n — Documentation + observability | ✅ shipped | Triage runbook + cost observability SQL examples in `tests/e2e/README.md` |
| 2 — Build-time + deploy-time env validation | ⬜ | `scripts/verify-env.ts`, Vercel env drift detection |
| 3 — Link checker | ⬜ | `lychee` on PR + nightly |
| 4 — Port orphan E2E scripts to vitest | ⬜ | `scripts/e2e-*.ts` → `tests/e2e/dashboard/` |
| 5 — Browser E2E (Playwright) | ⬜ | Login hydration, signup flow, tier-limit toast |
| 6 — Nightly full-model matrix | ⬜ | All OpenAI + Anthropic models incl. reasoning |
| 7 — Python SDK into CI + E2E | ⬜ | Python unit tests in CI + pytest E2E nightly |
| 8 — Alerting + flaky quarantine + Sentry verification | ⬜ | Slack on red, CSP report-uri, quarantine mechanism |
| 9 — Phase 4 chaos validation | ⬜ | Intentional P0 regression → framework catches each |

### Tier map

| Layer | Where | Runs in | Blocks |
|---|---|---|---|
| L2 PR E2E | `tests/e2e/{infra,docs}/` | CI on every PR | ✅ merge |
| L3 Post-deploy | `tests/e2e/{infra,dashboard,browser}/` | Every Preview + Production deploy | ✅ deploy |
| L4 Nightly | `tests/e2e/{proxy-nightly,python-sdk}/` | cron 02:00 UTC | ❌ alert only |
| L5 Chaos | `tests/e2e/chaos/` | manual only | ❌ |

### Commands

```bash
pnpm e2e:run                 # Run all vitest E2E tests (tests/e2e/**/*.e2e.test.ts)
pnpm e2e:scaffold-check      # Verify framework plumbing (0 tests expected in Slice 0)
pnpm e2e:browser             # Run Playwright browser tests
pnpm e2e:browser:install     # Install Chromium for Playwright (one-time)
pnpm e2e:bootstrap           # Provision / rotate the dedicated E2E test org
```

### E2E bootstrap org

`scripts/bootstrap-e2e-org.ts` provisions a dedicated test org (slug:
`e2e-bootstrap-org`, user_id: `e2e-bootstrap-user`) and emits credentials
to stdout in `key=value` format. It's idempotent — re-running deletes
any prior bootstrap org (matched by slug) and creates a fresh one.

The script uses the real `generateRawKey()` / `hashKey()` / `extractPrefix()`
helpers from `lib/auth/api-key.ts`, the same code path the dashboard uses
when a real user creates a key. No parallel implementation, no mocked hashing.

**To rotate credentials** (and update CI):

```bash
pnpm e2e:bootstrap | while IFS='=' read -r name value; do
  case "$name" in
    E2E_API_KEY|E2E_DEV_ACTOR)
      printf '%s' "$value" | gh secret set "$name"
      ;;
  esac
done
```

The pipeline never echoes plaintext values to terminal or logs. The
plaintext API key is unrecoverable after the script completes — it's
hashed at insert time, only the hash is stored.

The legacy `pnpm e2e`, `e2e:auth`, `e2e:observability`, `e2e:resilience` scripts
still work and run the existing `scripts/e2e-*.ts` files. They will be deleted
in Slice 4 after the ports land.

### Env config

Copy `.env.e2e.example` to `.env.e2e` (gitignored). CI reads the same vars from
GitHub Actions secrets — see `.github/workflows/e2e-post-deploy.yml` for the
full list.

---

## Proxy Worker Tests (`apps/proxy/src/__tests__/`)

77 files, ~1,309 tests. All mock `cloudflare:workers` and external dependencies.

### Naming Convention

| Pattern | Purpose |
|---|---|
| `{module}.test.ts` | Core functionality and happy paths |
| `{module}-edge-cases.test.ts` | Boundary values, malformed input, error paths |
| `{module}-all-models.test.ts` | Parameterized tests across every model in the pricing catalog |

### By Domain

**Auth & API Versioning**
| File | What it tests |
|---|---|
| `auth.test.ts` | Platform key validation, timing-safe comparison |
| `api-key-auth.test.ts` | SHA-256 hash lookup, positive/negative caching, timing-safe comparison |
| `api-version.test.ts` | API version resolution: header → key → default |

**Trace Context**
| File | What it tests |
|---|---|
| `trace-context.test.ts` | `resolveTraceId` — W3C traceparent parsing, custom header, auto-generation |

**Cost Calculation — OpenAI**
| File | What it tests |
|---|---|
| `cost-calculator.test.ts` | `calculateOpenAICost` — core formula, model fallback, attribution |
| `cost-calculator-edge-cases.test.ts` | Zero tokens, large counts, negative tokens, missing fields |
| `cost-calculator-all-models.test.ts` | All 14 OpenAI models: basic cost, cached, gpt-5 family, reasoning, negatives |
| `cost-estimator.test.ts` | `estimateMaxCost` — pre-request budget estimation |
| `cost-estimator-edge-cases.test.ts` | Edge cases for estimation |

**Cost Calculation — Anthropic**
| File | What it tests |
|---|---|
| `anthropic-cost-calculator.test.ts` | `calculateAnthropicCost` — cache write TTLs, long context 2x, bug avoidance |
| `anthropic-cost-calculator-all-models.test.ts` | All 22 Anthropic models: basic, cached, cache write, dated model parity |
| `anthropic-cost-estimator.test.ts` | `estimateAnthropicMaxCost` — pre-request estimation |

**Cost Logging & Queue**
| File | What it tests |
|---|---|
| `cost-logger.test.ts` | `logCostEvent` — Postgres write via shared pool, local dev bypass, error handling, `throwOnError` option, `pg_error` metric |
| `cost-event-queue.test.ts` | `enqueueCostEvent`, `enqueueCostEventsBatch`, `getCostEventQueue`, queue-first fallback helpers, timeout behavior, fallback metric emission |
| `cost-event-queue-handler.test.ts` | Queue consumer: batch INSERT + ack, per-message fallback on failure, poison message isolation, empty batch, connectionString from env |
| `cost-event-dlq-handler.test.ts` | DLQ consumer: always-ack, metric emission, best-effort write, null userId, HYPERDRIVE unavailable guard |

**Body Storage (Request/Response Logging)**
| File | What it tests |
|---|---|
| `body-storage.test.ts` | `storeRequestBody`, `storeResponseBody`, `storeStreamingResponseBody` — R2 key layout, content types, 1MB cap, error resilience; `retrieveBodies` — JSON/SSE format detection, preference, null handling |
| `stream-body-accumulator.test.ts` | `createStreamBodyAccumulator` — passthrough integrity, text accumulation, 1MB overflow truncation, empty stream, multi-byte UTF-8, cancellation partial buffer, overflow metric emission |
| `request-bodies-internal.test.ts` | `handleRequestBodies` — auth, validation, path traversal defense, R2 retrieval, JSON parsing, SSE format `_format` wrapper, corrupt body isolation |

**Budget System**
| File | What it tests |
|---|---|
| `budget.test.ts` | Lua scripts: checkAndReserve, reconcile, populateCache |
| `budget-edge-cases.test.ts` | Attribution nulls, zero estimates, 429 body structure, sensitive data |
| `budget-lookup.test.ts` | `lookupBudgets` — DO lookup + Postgres fallback |
| `budget-spend.test.ts` | `updateBudgetSpend` — Postgres atomic increment, error handling |
| `budget-streaming.test.ts` | Streaming responses with budget reservation lifecycle |
| `budget-reconcile-failures.test.ts` | Partial failures: DO/Postgres divergence, TTL expiry, zero cost |
| `velocity-limits.test.ts` | Velocity limit enforcement: sliding window, circuit breaker, recovery, edge cases |
| `velocity-webhook-recovery.test.ts` | `velocity.recovered` webhook builder + route dispatch (OpenAI, MCP, multi-entity) |
| `velocity-state-internal.test.ts` | `GET /internal/budget/velocity-state` — auth, validation, happy path, DO error |
| `parse-thresholds.test.ts` | `parseThresholds` — JSON safety, malformed input, default fallback, reference isolation |
| `budget-do-client.test.ts` | DO RPC client: check, reconcile, upsert, remove, reset, velocity state |
| `budget-do-lookup.test.ts` | Postgres → DOBudgetEntity lookup, field mapping, velocity conversion, error handling |
| `budget-orchestrator.test.ts` | Budget check orchestration: DO path, period reset write-back, entity construction |
| `user-budget-do.do.test.ts` | **Cloudflare runtime** — DO SQLite integration: populate, check, reconcile, alarm |

**Route Handlers**
| File | What it tests |
|---|---|
| `openai-route.test.ts` | `handleChatCompletions` — full request lifecycle |
| `openai-budget-route.test.ts` | OpenAI route with budget enforcement |
| `anthropic-route.test.ts` | `handleAnthropicMessages` — full request lifecycle |
| `anthropic-budget-route.test.ts` | Anthropic route with budget enforcement |
| `mcp-route.test.ts` | MCP budget check + cost event ingestion routes |
| `index-entry.test.ts` | Top-level router: routing, body parsing, health endpoints |
| `internal.test.ts` | Internal budget invalidation/sync endpoint |
| `internal-route.test.ts` | Internal route handler: auth, body parsing, action dispatch |
| `internal-route-stress.test.ts` | Internal route under concurrent load |
| `upstream-timeout.test.ts` | Fetch timeout/error — reservation cleanup verification |
| `stream-cancellation-cost.test.ts` | Partial stream cancellation — cost tracking accuracy |
| `stream-cancellation-cost-event.test.ts` | Cancelled stream estimated cost event write, error isolation, tag preservation, model fallback |

**Request/Response Processing**
| File | What it tests |
|---|---|
| `request-utils.test.ts` | `ensureStreamOptions`, `extractModelFromBody` |
| `request-utils-edge-cases.test.ts` | Non-boolean stream, null/array/object model values |
| `attribution.test.ts` | `extractAttribution` — header validation, length limits, injection |
| `sanitize-upstream-error.test.ts` | `sanitizeUpstreamError` — strips API keys, extracts safe fields |
| `sse-parser.test.ts` | OpenAI SSE stream parser — usage extraction |
| `sse-parser-edge-cases.test.ts` | Malformed SSE, partial chunks, empty streams |
| `anthropic-sse-parser.test.ts` | Anthropic SSE stream parser |
| `headers-edge-cases.test.ts` | Header sanitization edge cases |
| `anthropic-headers.test.ts` | Anthropic-specific header forwarding |

**Webhooks**
| File | What it tests |
|---|---|
| `webhook-events.test.ts` | Payload builders: cost_event, budget.exceeded, threshold, reset, request.blocked, test.ping, isCritical override, `buildThinCostEventPayload` shape/URL/uniqueness |
| `webhook-thresholds.test.ts` | `detectThresholdCrossings` — default thresholds, custom thresholds, empty/single, mixed entities, backward compat |
| `webhook-dispatch.test.ts` | Queue-based dispatch: enqueue message shape, event filtering, fail-open error handling, thin events |
| `webhook-signer.test.ts` | HMAC-SHA256 signature generation and verification |
| `webhook-cache.test.ts` | KV-cached endpoint lookup, invalidation, `payloadMode` DB mapping + null fallback |
| `webhook-expiry.test.ts` | Rotated secret expiry logic |

**Tags & Attribution**
| File | What it tests |
|---|---|
| `tags.test.ts` | `X-NullSpend-Tags` header parsing, validation, size limits |
| `validation.test.ts` | Shared validation helpers (UUID regex, etc.) |

**Session Limits**
| File | What it tests |
|---|---|
| `session-limits.test.ts` | Session limit enforcement: orchestrator pass-through, OpenAI/Anthropic/MCP denial responses (429 session_limit_exceeded), webhook dispatch, no-enforcement when session limit or sessionId absent, buildSessionLimitExceededPayload builder |

**Rate Limiting**
| File | What it tests |
|---|---|
| `rate-limit-edge-cases.test.ts` | Per-key limits, header length, empty key, fail-open behavior |

**Infrastructure**
| File | What it tests |
|---|---|
| `cache-kv.test.ts` | KV-backed caching helpers |
| `metrics.test.ts` | Structured metric emission |
| `write-metric.test.ts` | AE `writeLatencyDataPoint` — fire-and-forget, missing binding, error resilience |
| `health-metrics.test.ts` | `handleMetrics` — KV cache, AE query, content negotiation, negative caching, value coercion, metric emission |
| `upstream-allowlist.test.ts` | Allowed upstream host validation |

**Reconciliation Queue**
| File | What it tests |
|---|---|
| `reconciliation-queue.test.ts` | Queue message serialization, enqueue/dequeue |
| `reconciliation-fallback.test.ts` | Direct reconciliation fallback when queue unavailable |
| `queue-handler.test.ts` | Queue consumer: message processing, retries, DLQ |
| `queue-retry-e2e.test.ts` | Queue retry lifecycle end-to-end |
| `dlq-handler.test.ts` | Dead letter queue processing and alerting |

**Regression**
| File | What it tests |
|---|---|
| `regression.test.ts` | Guards against specific previously-fixed bugs |

---

## Proxy Smoke Tests (`apps/proxy/smoke*.test.ts`)

32 files. Require a deployed worker and API keys. Organized by provider and concern:

| Pattern | Files |
|---|---|
| `smoke*.test.ts` (no prefix) | OpenAI tests |
| `smoke-anthropic*.test.ts` | Anthropic tests |
| `smoke-budget*.test.ts` | Budget enforcement E2E, customer threshold webhook verification (ST-9) |
| `smoke-session-limits.test.ts` | Session limit enforcement E2E |
| `smoke-trace.test.ts` | W3C traceparent propagation E2E |
| `smoke-metrics.test.ts` | AE metrics endpoint + latency headers E2E |
| `smoke-body-capture.test.ts` | Streaming + non-streaming body capture, R2 storage, internal retrieval endpoint E2E |
| `smoke-sdk-functional.test.ts` | SDK functional E2E: HITL action lifecycle (createAction → approve → markResult, waitForDecision, proposeAndWait, requestBudgetIncrease + policy cache invalidation), read APIs (getCostSummary all 3 periods, listCostEvents pagination), config behavior (custom fetch, retry/onRetry, requestTimeoutMs, apiVersion override), error class fields (TimeoutError, RejectedError). 14 test entries (F1–F11). Manual-runs-only — never CI. Approval mechanism: direct SQL UPDATE on `actions` table (the dashboard `/approve` route is session-only auth). Symmetric cleanup in beforeAll + afterAll handles orphan rows. See `apps/proxy/CLAUDE.md` and `docs/internal/test-plans/sdk-testing-gaps.md` "Functional E2E suite". |

Subtypes: core, edge-cases, cost-e2e, security, resilience, load, pricing-accuracy, known-issues, streaming, cloudflare, trace, session-limits, metrics, body-capture, sdk-functional.

---

## Proxy Stress Tests (`apps/proxy/stress-*.test.ts`)

5 files. More aggressive than smoke tests — designed to find race conditions, degradation thresholds, and state inconsistency. Require a deployed worker, API keys, and `DATABASE_URL`.

```bash
pnpm proxy:stress                          # Default (medium intensity)
STRESS_INTENSITY=heavy pnpm proxy:stress   # Heavy intensity
STRESS_INTENSITY=light pnpm proxy:stress   # Light intensity
```

| File | What it tests |
|---|---|
| `stress-concurrency.test.ts` | Concurrency ramp (10-80), cross-provider interleave, sustained load, latency tracking |
| `stress-budget-races.test.ts` | Budget race conditions: tight budget + concurrent requests, $0 budget enforcement, sequential exhaust, post-reconciliation consistency |
| `stress-streaming.test.ts` | Rapid abort storms, concurrent stream management, mixed abort+complete, cost events for aborted streams |
| `stress-recovery.test.ts` | Post-stress health, normal request flow, error handling, DB consistency, negative spend detection |
| `stress-sdk-features.test.ts` | `@nullspend/sdk` against the deployed proxy: Phase 0 transport matrix → Phase 1 functional → Phase 2 concurrent → Phase 3 mid-test mutation → Phase 4 verification. Production-mutating; manual runs only. Requires `pnpm dev` running for direct-mode subset. See `apps/proxy/CLAUDE.md` and `docs/internal/test-plans/sdk-stress-test-plan.md`. Crash recovery: `pnpm --filter @nullspend/proxy stress:cleanup`. |

Config: `vitest.stress.config.ts` — 300s timeout, sequential files, `.env.smoke` env vars.

Intensity levels control concurrency (light: 10-15, medium: 25-40, heavy: 50-80).

---

## Dashboard Tests (root `pnpm test`)

Co-located with source files. ~1,744 tests across 141 files.

**Auth** (`lib/auth/`)
- `session.test.ts` — `getCurrentUserId`, `getUser()` validation, dev mode fallback
- `api-key.test.ts` — API key authentication flow
- `api-key-db.test.ts` — Database-backed key validation
- `key-utils.test.ts` — Key generation, hashing, prefix extraction

**Actions** (`lib/actions/`)
- `create-action.test.ts`, `approve-action.test.ts`, `reject-action.test.ts` — HITL lifecycle
- `approve-action.test.ts` — includes budget_increase sideEffect, partial approval, tier cap rollback, approvedAmount > requestedAmount
- `transitions.test.ts` — State machine validation
- `expiration.test.ts` — TTL enforcement
- `mark-result.test.ts`, `list-actions.test.ts`, `errors.test.ts`

**Validations** (`lib/validations/`)
- `actions.test.ts`, `api-keys.test.ts`, `budgets.test.ts`, `slack.test.ts` — Zod schemas
- `budgets.test.ts` — includes `policySchema` enum validation, policy in create/response/entity schemas, invalid policy rejection
- `cost-events.test.ts` — `listCostEventsQuerySchema` requestId filter validation
- `cost-event-summary.test.ts` — Analytics query validation
- `webhooks.test.ts` — `payloadMode` in create/update/record schemas
- `cross-package.test.ts` — SDK/DB enum sync verification

**API Routes** (`app/api/`)
- One test file per route: actions CRUD, keys CRUD, budgets, cost-events, cost-events/{id}, slack config/callback/test
- `budgets/route.test.ts` — includes policy round-trip (store + return for all three values), policy omitted preserves DB default, invalid policy 400
- `cost-events/[id]/route.test.ts` — Fetch-back endpoint: owned event, missing, other user's, auth, invalid ID, prefixed ID
- `cost-events/batch/route.test.ts` — Batch ingestion: per-event budget accounting, tag isolation, proxy cache sync, dispatch failure isolation, threshold detection, threshold Slack alerts, observability logging, math invariants
- `velocity-status/route.test.ts` — Live velocity state polling: auth, proxy fetch, graceful degradation

**Other**
- `lib/budgets/increase.test.ts` — `executeBudgetIncrease`: happy path, `BudgetEntityNotFoundError` on missing entity (SELECT + UPDATE paths), invalid payload, tier cap, partial approval, zero/negative amount, approvedAmount > requestedAmount
- `components/actions/budget-increase-card.test.ts` — Payload parsing (valid/invalid/boundary), `mutateActionResponseSchema` budgetIncrease field (preserve/absent/partial/over-approval), display logic (spendColor thresholds, percent clamping, zero-limit safety), dollar→microdollar conversion, exceeds-requested detection, client-side $1M cap, status-aware labels, inbox amount extraction, `BudgetEntityNotFoundError` class + `handleRouteError` 404 mapping
- `lib/slack/budget-message.test.ts` — Budget increase Slack templates: pending (details + buttons), truncation, decision (approved/rejected), completion, formatDollars
- `lib/slack/budget-threshold-message.test.ts` — Budget threshold Slack alerts: warning/critical/exceeded message building, mrkdwn injection defense, zero-limit guard, `budget.exceeded` display, dispatch (config lookup, HTTPS validation, inactive skip, failure isolation)
- `lib/queries/actions.test.ts`, `lib/utils/format.test.ts`, `lib/slack/*.test.ts`
- `lib/webhooks/dispatch.test.ts` — Cost event webhook builders (proxy/dashboard shape parity), `dispatchToEndpoints` signing/filtering/expiry, `buildThinCostEventPayload`, `dispatchCostEventToEndpoints` (thin/full/mixed/undefined fallback/event filter/expiry), non-cost-event to thin endpoint
- `components/actions/action-timeline.test.ts`

**Margins** (`lib/margins/`, `app/api/margins/`)
- `lib/margins/margin-query.test.ts` — `computeHealthTier` boundary values (5 tests)
- `lib/margins/margin-query-edge-cases.test.ts` — NaN, Infinity, -0, zero revenue/cost, budget suggestions, blended margin (10 tests)
- `lib/margins/getMarginTable.test.ts` — `computeProjection` unit tests (10), `getMarginTable` integration tests (23): ghost-row filter, sparkline, projection, tier worsening, sorting, blended margin, budget suggestions, health tier counts, name fallback, connection status
- `lib/margins/getCustomerDetail.test.ts` — `getCustomerDetail`: null mapping, revenue over time, model breakdown, margin edge cases, name from current period (10 tests)
- `lib/margins/sync.test.ts` — `syncOrgRevenue`: no connection, revoked, decrypt fail, duration tracking (4 tests)
- `lib/margins/sync-edge-cases.test.ts` — Null created timestamp, non-USD filtering, skippedCurrencies tracking (multi-currency + empty), error status passthrough (7 tests)
- `lib/margins/sync-updatedAt.test.ts` — `updatedAt` set on success/decrypt-fail/API-error, invoice processing: microdollar conversion, aggregation, deleted/string customers, metadata passthrough, dedup (9 tests)
- `lib/margins/auto-match.test.ts` — `runAutoMatch`: metadata match, ID match, conflict prevention, preference ordering (6 tests)
- `lib/margins/auto-match-edge-cases.test.ts` — Double-mapping prevention, conflict counting, empty/undefined metadata (5 tests)
- `lib/margins/encryption.test.ts` — AES-256-GCM round-trip, AAD validation, randomization, truncation, key validation (13 tests)
- `lib/margins/periods.test.ts` — Period formatting, parsing, labels (12 tests)
- `lib/margins/webhook.test.ts` — `buildMarginThresholdPayload`, `detectWorseningCrossings` (14 tests)
- `lib/margins/margin-slack-message.test.ts` — `buildMarginAlertMessage`: structure, URLs, emojis, escaping, null name (7); `dispatchMarginSlackAlert`: webhook send, config skip, inactive skip, error handling, HTTPS validation (5)
- `app/api/margins/route.test.ts` — Period validation, default period, CSV format, CSV escaping, CSV injection defense, empty CSV, JSON fallback (10 tests)
- `app/api/margins/route-edge-cases.test.ts` — Month validation (00, 13, 99), SQL injection, empty period (7 tests)
- `app/api/margins/[customer]/route.test.ts` — Period validation, auth, 404, URL decoding, SQL injection (9 tests)
- `app/api/margins/unmatched/route.test.ts` — Unmatched customers, unmapped tags, auto-matches, null normalization, auth, errors (16 tests)
- `app/api/stripe/connect/route.test.ts` — Key validation, race conditions, Stripe errors (9 tests)
- `app/api/stripe/disconnect/route.test.ts` — Cascade delete, auth, 404 (5 tests)
- `app/api/stripe/revenue-sync/route.test.ts` — Cron auth, session auth, aggregate counts (6 tests)
- `app/api/customer-mappings/route.test.ts` — GET list, POST create, DELETE validation/404/success (10 tests)

---

## Package Tests

**cost-engine** (`packages/cost-engine/src/`) — 700 tests
- `pricing.test.ts` — `getModelPricing`, `costComponent`, `isKnownModel`
- `edge-cases.test.ts` — Boundary values, precision, accumulation drift
- `scenarios.test.ts` — Realistic multi-provider API call scenarios
- `all-models.test.ts` — All 38 models: catalog completeness, exact rates, tier consistency
- `catalog.test.ts` — Pricing data structural validation
- `exports.test.ts` — Public API surface verification

**claude-agent** (`packages/claude-agent/src/`) — 49 tests
- `with-nullspend.test.ts` — `withNullSpend` config transformer: URL, headers, passthrough, tag/traceId/actionId validation, newline injection, env merging, edge cases

**Other packages** — co-located `*.test.ts` files:
- `packages/db/src/schema.test.ts` — Schema structure validation
- `packages/sdk/src/client.test.ts` — SDK client behavior, `requestBudgetIncrease` (happy path, rejected, timeout, cache invalidation), `proxyUrl` constructor validation (missing scheme, non-HTTP, empty, trailing slash), `customer()` validation (empty/whitespace, length, character set, special chars, trim), `createTrackedFetch` customer validation parity
- `packages/sdk/src/tracked-fetch.test.ts` — Tracked fetch: cost tracking, proxy detection (configurable `proxyUrl` via URL origin comparison, `x-nullspend-key` header fallback, confusable hostname rejection, port mismatch), `X-NullSpend-Customer` header injection (direct mode, proxy mode before bailout, Request-object input preserves Authorization, case-insensitive dedup in Headers/array/object forms), streaming, enforcement (mandates, budgets, session limits), `onDenied` safety, accumulation, edge cases, enriched budget entity details, proxy 429 interception (`budget_exceeded`, `customer_budget_exceeded` with null/missing details fallback, `velocity_exceeded`, `session_limit_exceeded`, `tag_budget_exceeded`, NullSpend vs upstream)
- `packages/sdk/src/customer-id.ts` — Shared customer ID validator (length ≤256, regex `[a-zA-Z0-9._:-]+`) called by both `customer()` and `buildTrackedFetch` so direct and indirect callers get identical fail-fast behavior. Mirrors the proxy's validation in `apps/proxy/src/lib/customer.ts`.
- `packages/sdk/src/policy-cache.test.ts` — Policy cache: TTL, invalidation, mandate/budget/session-limit checks, fail-open, budget entity details on denial
- `packages/mcp-server/src/config.test.ts`, `tools.test.ts`
- `packages/mcp-proxy/src/config.test.ts`, `proxy.test.ts`, `gate.test.ts`
- `packages/docs-mcp-server/src/config.test.ts` — Zero-config loader, ConfigError class
- `packages/docs-mcp-server/src/search.test.ts` — Tokenization, scoring, synonyms, substring matching, real data smoke tests
- `packages/docs-mcp-server/src/tools.test.ts` — Tool registration, search→fetch workflow, path normalization, traversal defense

---

## Writing New Tests

### Proxy worker tests

1. Place in `apps/proxy/src/__tests__/`
2. Follow the naming convention: `{module}.test.ts`, add `-edge-cases` or `-all-models` suffix as needed
3. Mock `cloudflare:workers` with `vi.mock("cloudflare:workers", ...)`
4. Polyfill `crypto.subtle.timingSafeEqual` in `beforeAll`
6. Use `.js` extensions in imports (ESM requirement)

### Dashboard tests

Co-locate with source: `lib/foo/bar.ts` → `lib/foo/bar.test.ts`

### Cost-engine tests

Co-locate in `packages/cost-engine/src/`. Include exact arithmetic in comments so expected values are traceable.

### Adding a new model

When adding a model to `packages/cost-engine/src/pricing-data.json`:
1. Add exact rates to the parameterized arrays in `all-models.test.ts` (cost-engine)
2. Add to the proxy calculator test: `cost-calculator-all-models.test.ts` (OpenAI) or `anthropic-cost-calculator-all-models.test.ts` (Anthropic)
3. Verify with `pnpm proxy:test` and the cost-engine test command
