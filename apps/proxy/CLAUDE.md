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
- Mock `@upstash/redis/cloudflare` for Redis
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
- `src/lib/webhook-events.ts` — event payload builders (13 event types)
- `src/lib/webhook-thresholds.ts` — `detectThresholdCrossings` (per-entity configurable thresholds)
- `src/lib/webhook-dispatch.ts` — endpoint dispatch with HMAC signing
- `src/lib/webhook-signer.ts` — HMAC-SHA256 signature generation
- `src/lib/webhook-cache.ts` — Redis-cached endpoint lookup
- `src/lib/webhook-expiry.ts` — rotated secret expiry

**Infrastructure**
- `src/lib/db-semaphore.ts` — Postgres connection concurrency limiter (MAX_CONCURRENT=5)
- `src/lib/cache-kv.ts` — KV-backed caching helpers
- `src/lib/metrics.ts` — structured metric emission
- `src/lib/reconciliation-queue.ts` — Cloudflare Queue-based async reconciliation
- `src/lib/constants.ts` — shared constants

## Cost Tracking Flow

```
Request → Resolve trace ID → Auth → Forward to provider → Parse response/stream → Extract usage → Calculate cost → Log (with trace_id, session_id, tags) async via waitUntil()
```

Non-streaming: parse JSON response for `usage` field.
Streaming: SSE parser accumulates chunks, extracts final `usage` from `[DONE]`-adjacent message.
