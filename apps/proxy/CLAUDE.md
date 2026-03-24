# Proxy Worker (@nullspend/proxy)

Cloudflare Workers proxy that sits between agents and OpenAI. Authenticates requests, tracks costs, and enforces budgets.

## Commands

```bash
pnpm test             # Run proxy tests (from this directory)
pnpm dev              # Start wrangler dev server
pnpm deploy           # Deploy to Cloudflare
```

## Critical Rules

- **NEVER use `passThroughOnException()`** — proxy must fail closed (502), never forward unauthenticated/untracked requests to origin
- **NEVER add failover logic** that bypasses auth or cost tracking — this undermines the entire FinOps purpose
- Auth check must be the absolute first thing before any processing
- Body size limit (1MB) enforced both pre-read (Content-Length) and post-read (byte count)

## Testing

- Tests live in `src/__tests__/` directory
- Mock `cloudflare:workers` with `vi.mock("cloudflare:workers", ...)`
- Polyfill `crypto.subtle.timingSafeEqual` in `beforeAll`
- `makeEnv()` helper returns typed `Env` with test values
- `makeCtx()` helper returns mock `ExecutionContext`

## Architecture

**Entry & Routing**
- `src/index.ts` — entry point, routing, body parsing, session/trace extraction
- `src/routes/openai.ts` — OpenAI chat completions handler
- `src/routes/anthropic.ts` — Anthropic messages handler
- `src/routes/mcp.ts` — MCP budget check + cost event ingestion
- `src/routes/internal.ts` — internal budget invalidation/sync endpoint
- `src/routes/shared.ts` — shared budget denial handling, webhook dispatch helpers (used by all routes)

**Auth & Context**
- `src/lib/auth.ts` — API key auth (delegates to `api-key-auth.ts`)
- `src/lib/api-key-auth.ts` — SHA-256 hash lookup with positive/negative caching
- `src/lib/context.ts` — `RequestContext` (auth, connectionString, sessionId, traceId, tags)
- `src/lib/api-version.ts` — API version resolution (header → key → default)
- `src/lib/trace-context.ts` — W3C traceparent parsing, custom header fallback, auto-generation
- `src/lib/tags.ts` — `X-NullSpend-Tags` header parsing and validation
- `src/lib/validation.ts` — shared validation helpers (UUID regex, etc.)

**Budget Enforcement (Durable Object)**
- `src/durable-objects/user-budget.ts` — UserBudgetDO: SQLite tables (budgets, reservations, velocity_state, session_spend), checkAndReserve (with session limit enforcement), reconcile (with session spend correction), alarm cleanup (with session TTL)
- `src/lib/budget-orchestrator.ts` — checkBudget + reconcileBudget orchestration
- `src/lib/budget-do-client.ts` — DO RPC client (check, reconcile, upsert, remove, reset, velocity state)
- `src/lib/budget-do-lookup.ts` — Postgres → DOBudgetEntity lookup for DO population
- `src/lib/budget-spend.ts` — Postgres atomic spend increment + period reset write-back

**Cost Calculation**
- `src/lib/cost-calculator.ts` — OpenAI token-to-cost conversion
- `src/lib/cost-estimator.ts` — OpenAI pre-request cost estimation
- `src/lib/anthropic-cost-calculator.ts` — Anthropic token-to-cost (cache write TTLs, long context 2x)
- `src/lib/anthropic-cost-estimator.ts` — Anthropic pre-request estimation
- `src/lib/cost-logger.ts` — async DB write via `waitUntil()`

**Request/Response Processing**
- `src/lib/request-utils.ts` — `ensureStreamOptions`, `extractModelFromBody`
- `src/lib/sse-parser.ts` — OpenAI streaming response parser for usage extraction
- `src/lib/anthropic-sse-parser.ts` — Anthropic streaming parser
- `src/lib/headers.ts` — header sanitization (strip proxy headers, forward provider headers)
- `src/lib/anthropic-headers.ts` — Anthropic-specific header forwarding
- `src/lib/sanitize-upstream-error.ts` — strip API keys from upstream error responses
- `src/lib/errors.ts` — standardized error response builder
- `src/lib/upstream-allowlist.ts` — allowed upstream host validation

**Webhooks**
- `src/lib/webhook-events.ts` — event payload builders (15 event types)
- `src/lib/webhook-thresholds.ts` — `detectThresholdCrossings` (per-entity configurable thresholds)
- `src/lib/webhook-dispatch.ts` — dispatcher interface + Queue-based enqueue
- `src/lib/webhook-queue.ts` — webhook queue message type + enqueue helper
- `src/webhook-queue-handler.ts` — Queue consumer: fetch endpoint, sign, deliver, retry with exponential backoff
- `src/webhook-dlq-handler.ts` — DLQ consumer: log + metric + ack
- `src/lib/webhook-signer.ts` — HMAC-SHA256 signature generation
- `src/lib/webhook-cache.ts` — KV-cached endpoint lookup
- `src/lib/webhook-expiry.ts` — rotated secret expiry

**Infrastructure**
- `src/lib/db.ts` — Per-request postgres.js instance (max:1, prepare:false, fetch_types:false) — I/O context isolation
- `src/lib/timing-safe-equal.ts` — Constant-time string comparison (shared by internal auth + webhook signer)
- `src/lib/cache-kv.ts` — KV-backed caching helpers
- `src/routes/metrics.ts` — `GET /health/metrics` — AE SQL API query, KV caching (90s), negative caching (30s), JSON + Prometheus content negotiation
- `src/lib/write-metric.ts` — `writeLatencyDataPoint` — fire-and-forget AE data point write per request
- `src/lib/metrics.ts` — structured metric emission
- `src/lib/reconciliation-queue.ts` — Cloudflare Queue-based async reconciliation
- `src/lib/cost-event-queue.ts` — Cloudflare Queue-based async cost event logging (queue-first with direct fallback)
- `src/cost-event-queue-handler.ts` — Cost event queue consumer (batch INSERT + per-message fallback)
- `src/cost-event-dlq-handler.ts` — Cost event DLQ consumer (always-ack + best-effort write)
- `src/lib/constants.ts` — shared constants

## Cost Tracking Flow

```
Request → Resolve trace ID → Auth → Forward to provider → Parse response/stream → Extract usage → Calculate cost → Enqueue to COST_EVENT_QUEUE (fallback: direct DB write)
```

Cost events are enqueued to Cloudflare Queues via `logCostEventQueued()` / `logCostEventsBatchQueued()`. The queue consumer batch-INSERTs with `onConflictDoNothing` for idempotent re-delivery. Falls back to direct `logCostEvent()` when queue binding is absent (local dev).

Non-streaming: parse JSON response for `usage` field.
Streaming: SSE parser accumulates chunks, extracts final `usage` from `[DONE]`-adjacent message.
Cancelled streams: when the client aborts mid-stream, the SSE parser resolves with `cancelled: true` and no usage. The route writes an estimated cost event (tokens=0, cost=pre-request estimate) tagged with `_ns_estimated: "true"` and `_ns_cancelled: "true"` in the JSONB `tags` column, then reconciles the budget reservation with the estimate. The cost event write is try/catch-wrapped so failures cannot block budget reconciliation.

## Telemetry

Cost events include enrichment fields populated per-request:
- `budget_status` — `skipped` (no budgets / hasBudgets flag), `approved`, or `denied`
- `stop_reason` — provider finish/stop reason (`stop`, `max_tokens`, `end_turn`, `tool_calls`, etc.)
- `estimated_cost_microdollars` — pre-request budget estimate for accuracy analysis

SSE parsers capture `firstChunkMs` (time of first upstream chunk) for TTFB tracking.

AE data points include 4 doubles: `[overheadMs, upstreamMs, totalMs, ttfbMs]`. The `/health/metrics` endpoint exposes p50/p95/p99 for all four.

Anthropic cost events include cache split tags: `_ns_cache_write_tokens`, `_ns_cache_read_tokens`.
Provider rate limit proximity captured in tags: `_ns_ratelimit_remaining_requests`, `_ns_ratelimit_remaining_tokens`.

Error classification: `emitMetric("request_error", { status, reason })` on all error paths in `index.ts`. `emitMetric("budget_denied", { reason, provider, entityType })` on all denial paths in `shared.ts` and `mcp.ts`.

Auth includes `hasBudgets` flag (EXISTS subquery on budgets table). When false, budget orchestrator skips DO RPC entirely — 17ms → 2-3ms overhead for tracking-only users.
