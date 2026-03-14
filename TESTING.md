# Testing

NullSpend has ~1,590 tests across 106 files organized into four tiers.

## Quick Reference

```bash
pnpm test             # Root tests (dashboard: lib/, app/api/, components/)
pnpm proxy:test       # Proxy worker unit tests (apps/proxy/src/__tests__/)
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

### Tier 2 — Integration Tests (real Redis)

`apps/proxy/src/__tests__/budget-lua-integration.test.ts` runs real Lua scripts against a live Upstash Redis instance. Requires `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` env vars.

### Tier 3 — Smoke Tests (live deployed worker + real APIs)

The 23 `apps/proxy/smoke*.test.ts` files hit the deployed Cloudflare Worker and make real API calls to OpenAI/Anthropic. They require API keys and a deployed proxy. These are NOT run in CI.

### Tier 4 — CI Pipeline

`.github/workflows/ci.yml` runs Tier 1 tests on push/PR to main: typecheck, lint, root tests, proxy tests, cost-engine tests.

---

## Proxy Worker Tests (`apps/proxy/src/__tests__/`)

33 files, ~560 tests. All mock `cloudflare:workers`, `@upstash/redis/cloudflare`, and external dependencies.

### Naming Convention

| Pattern | Purpose |
|---|---|
| `{module}.test.ts` | Core functionality and happy paths |
| `{module}-edge-cases.test.ts` | Boundary values, malformed input, error paths |
| `{module}-all-models.test.ts` | Parameterized tests across every model in the pricing catalog |

### By Domain

**Auth**
| File | What it tests |
|---|---|
| `auth.test.ts` | Platform key validation, timing-safe comparison |

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

**Cost Logging**
| File | What it tests |
|---|---|
| `cost-logger.test.ts` | `logCostEvent` — Postgres write, local dev bypass, error handling |

**Budget System**
| File | What it tests |
|---|---|
| `budget.test.ts` | Lua scripts: checkAndReserve, reconcile, populateCache |
| `budget-edge-cases.test.ts` | Attribution nulls, zero estimates, 429 body structure, sensitive data |
| `budget-lookup.test.ts` | `lookupBudgets` — Redis cache + Postgres fallback |
| `budget-spend.test.ts` | `updateBudgetSpend` — Postgres atomic increment, error handling |
| `budget-streaming.test.ts` | Streaming responses with budget reservation lifecycle |
| `budget-reconcile-failures.test.ts` | Partial failures: Redis/Postgres divergence, TTL expiry, zero cost |
| `budget-lua-integration.test.ts` | **Real Redis** — Lua script correctness against live Upstash |

**Route Handlers**
| File | What it tests |
|---|---|
| `openai-route.test.ts` | `handleChatCompletions` — full request lifecycle |
| `anthropic-route.test.ts` | `handleAnthropicMessages` — full request lifecycle |
| `anthropic-budget-route.test.ts` | Anthropic route with budget enforcement |
| `index-entry.test.ts` | Top-level router: routing, body parsing, health endpoints |
| `upstream-timeout.test.ts` | Fetch timeout/error — reservation cleanup verification |

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

**Rate Limiting**
| File | What it tests |
|---|---|
| `rate-limit-edge-cases.test.ts` | Per-key limits, header length, empty key, fail-open behavior |

**Regression**
| File | What it tests |
|---|---|
| `regression.test.ts` | Guards against specific previously-fixed bugs |

---

## Proxy Smoke Tests (`apps/proxy/smoke*.test.ts`)

23 files. Require a deployed worker and API keys. Organized by provider and concern:

| Pattern | Files |
|---|---|
| `smoke*.test.ts` (no prefix) | OpenAI tests |
| `smoke-anthropic*.test.ts` | Anthropic tests |
| `smoke-budget*.test.ts` | Budget enforcement E2E |

Subtypes: core, edge-cases, cost-e2e, security, resilience, load, pricing-accuracy, known-issues, streaming, cloudflare.

---

## Dashboard Tests (root `pnpm test`)

Co-located with source files. ~400 tests across 37 files.

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
- `cost-event-summary.test.ts` — Analytics query validation
- `cross-package.test.ts` — SDK/DB enum sync verification

**API Routes** (`app/api/`)
- One test file per route: actions CRUD, keys CRUD, budgets, cost-events, slack config/callback/test

**Other**
- `lib/queries/actions.test.ts`, `lib/utils/format.test.ts`, `lib/slack/*.test.ts`
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
4. Mock `@upstash/redis/cloudflare` for Redis
5. Polyfill `crypto.subtle.timingSafeEqual` in `beforeAll`
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
