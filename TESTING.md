# Testing

NullSpend has ~2,900+ tests across ~175 files organized into four tiers.

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

The 26 `apps/proxy/smoke*.test.ts` files hit the deployed Cloudflare Worker and make real API calls to OpenAI/Anthropic. They require API keys and a deployed proxy. These are NOT run in CI.

### Tier 4 — CI Pipeline

`.github/workflows/ci.yml` runs Tier 1 tests on push/PR to main: typecheck, lint, root tests, proxy tests, cost-engine tests.

---

## Proxy Worker Tests (`apps/proxy/src/__tests__/`)

73 files, ~1,254 tests. All mock `cloudflare:workers` and external dependencies.

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

26 files. Require a deployed worker and API keys. Organized by provider and concern:

| Pattern | Files |
|---|---|
| `smoke*.test.ts` (no prefix) | OpenAI tests |
| `smoke-anthropic*.test.ts` | Anthropic tests |
| `smoke-budget*.test.ts` | Budget enforcement E2E |
| `smoke-session-limits.test.ts` | Session limit enforcement E2E |
| `smoke-trace.test.ts` | W3C traceparent propagation E2E |
| `smoke-metrics.test.ts` | AE metrics endpoint + latency headers E2E |
| `smoke-body-capture.test.ts` | Streaming + non-streaming body capture, R2 storage, internal retrieval endpoint E2E |

Subtypes: core, edge-cases, cost-e2e, security, resilience, load, pricing-accuracy, known-issues, streaming, cloudflare, trace, session-limits, metrics, body-capture.

---

## Proxy Stress Tests (`apps/proxy/stress-*.test.ts`)

4 files, 28 tests. More aggressive than smoke tests — designed to find race conditions, degradation thresholds, and state inconsistency. Require a deployed worker, API keys, and `DATABASE_URL`.

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

Config: `vitest.stress.config.ts` — 300s timeout, sequential files, `.env.smoke` env vars.

Intensity levels control concurrency (light: 10-15, medium: 25-40, heavy: 50-80).

---

## Dashboard Tests (root `pnpm test`)

Co-located with source files. 918 tests across 80 files.

**Auth** (`lib/auth/`)
- `session.test.ts` — `getCurrentUserId`, `getUser()` validation, dev mode fallback
- `api-key.test.ts` — API key authentication flow
- `api-key-db.test.ts` — Database-backed key validation
- `key-utils.test.ts` — Key generation, hashing, prefix extraction

**Actions** (`lib/actions/`)
- `create-action.test.ts`, `approve-action.test.ts`, `reject-action.test.ts` — HITL lifecycle
- `transitions.test.ts` — State machine validation
- `expiration.test.ts` — TTL enforcement
- `mark-result.test.ts`, `list-actions.test.ts`, `errors.test.ts`

**Validations** (`lib/validations/`)
- `actions.test.ts`, `api-keys.test.ts`, `budgets.test.ts`, `slack.test.ts` — Zod schemas
- `cost-events.test.ts` — `listCostEventsQuerySchema` requestId filter validation
- `cost-event-summary.test.ts` — Analytics query validation
- `webhooks.test.ts` — `payloadMode` in create/update/record schemas
- `cross-package.test.ts` — SDK/DB enum sync verification

**API Routes** (`app/api/`)
- One test file per route: actions CRUD, keys CRUD, budgets, cost-events, cost-events/{id}, slack config/callback/test
- `cost-events/[id]/route.test.ts` — Fetch-back endpoint: owned event, missing, other user's, auth, invalid ID, prefixed ID
- `velocity-status/route.test.ts` — Live velocity state polling: auth, proxy fetch, graceful degradation

**Other**
- `lib/queries/actions.test.ts`, `lib/utils/format.test.ts`, `lib/slack/*.test.ts`
- `lib/webhooks/dispatch.test.ts` — Cost event webhook builders (proxy/dashboard shape parity), `dispatchToEndpoints` signing/filtering/expiry, `buildThinCostEventPayload`, `dispatchCostEventToEndpoints` (thin/full/mixed/undefined fallback/event filter/expiry), non-cost-event to thin endpoint
- `components/actions/action-timeline.test.ts`

---

## Package Tests

**cost-engine** (`packages/cost-engine/src/`) — 627 tests
- `pricing.test.ts` — `getModelPricing`, `costComponent`, `isKnownModel`
- `edge-cases.test.ts` — Boundary values, precision, accumulation drift
- `scenarios.test.ts` — Realistic multi-provider API call scenarios
- `all-models.test.ts` — All 38 models: catalog completeness, exact rates, tier consistency
- `catalog.test.ts` — Pricing data structural validation
- `exports.test.ts` — Public API surface verification

**claude-agent** (`packages/claude-agent/src/`) — 34 tests
- `with-nullspend.test.ts` — `withNullSpend` config transformer: URL, headers, passthrough, tag/traceId/actionId validation, newline injection, env merging, edge cases

**Other packages** — co-located `*.test.ts` files:
- `packages/db/src/schema.test.ts` — Schema structure validation
- `packages/sdk/src/client.test.ts` — SDK client behavior
- `packages/mcp-server/src/config.test.ts`, `tools.test.ts`
- `packages/mcp-proxy/src/config.test.ts`, `proxy.test.ts`, `gate.test.ts`

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
