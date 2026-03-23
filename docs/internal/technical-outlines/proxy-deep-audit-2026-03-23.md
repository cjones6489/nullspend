# Proxy Deep Codebase Audit

**Date:** 2026-03-23
**Auditor:** Claude Opus 4.6
**Codebase state:** Post-QStash removal. 9ms p50 overhead. Zero external dependencies on hot path.
**Commit:** `2e8dd04` (docs: update proxy CLAUDE.md and TESTING.md for Queue-based webhooks)

---

## Context

After completing 4 refactors (Redis removal, pg→postgres.js, QStash→Queue) that reduced proxy overhead from 145ms to 9ms, we conducted a comprehensive deep audit across performance, bundle size, database queries, Durable Objects, testing, security, error handling, dependencies, and configuration.

**26 findings total.** Organized into 5 implementation phases by effort and impact.

---

## Phase 1: Quick Wins (~2-3 hours)

8 trivial/low-effort changes with immediate impact. Can be done in a single pass.

### 1.1 Remove `zod` dependency
- **Severity:** Critical (dead code in production bundle)
- **File:** `apps/proxy/package.json:22`
- **Description:** `zod` (^4.3.6, ~14KB) is listed as a production dependency but has zero imports anywhere in `apps/proxy/src/`. Pure dead weight that wrangler bundles, parses, and evaluates on every cold start.
- **Fix:** Remove `"zod": "^4.3.6"` from dependencies. Run `pnpm install`.
- **Effort:** Trivial
- **Validation:** `grep -r "from ['\"]zod" apps/proxy/src/` returns zero matches. `pnpm proxy:test` passes.

### 1.2 Optimize hex conversion (hot path allocation)
- **Severity:** High
- **Files:** `api-key-auth.ts:39-41`, `webhook-signer.ts:31-33`
- **Description:** `[...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("")` runs on every uncached auth request. Allocates: spread into new Array (32 elements), 32 strings from `.toString(16)`, 32 strings from `.padStart()`, final `.join("")`. Total: ~97 allocations per hash.
- **Fix:** Create a shared `toHex()` utility with pre-allocated lookup table:
  ```typescript
  const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
  export function toHex(buf: ArrayBuffer): string {
    const bytes = new Uint8Array(buf);
    let hex = "";
    for (let i = 0; i < bytes.length; i++) hex += HEX[bytes[i]];
    return hex;
  }
  ```
  Replace in both `api-key-auth.ts` and `webhook-signer.ts`.
- **Effort:** Low
- **Validation:** Existing hash tests should pass unchanged. Add a benchmark showing allocation reduction.

### 1.3 Drop redundant TextEncoder body size check
- **Severity:** High
- **File:** `index.ts:89-92` (inside `parseRequestBody`)
- **Description:** After `request.text()` reads the entire body, `new TextEncoder().encode(bodyText).byteLength` creates a **second copy** of the body just to check its byte length. For a 500KB JSON body, this allocates ~500KB of memory that's immediately discarded. The `Content-Length` pre-check (line 77) already catches well-behaved clients.
- **Fix:** Remove the post-read TextEncoder check. The pre-read Content-Length check + Workers runtime limits are sufficient. If paranoia is needed, use `new Blob([bodyText]).size` which is cheaper.
- **Effort:** Low
- **Validation:** `pnpm proxy:test` passes. Body size tests still validate the Content-Length check.

### 1.4 Remove unused `budgets` Map in Durable Object
- **Severity:** Medium
- **File:** `durable-objects/user-budget.ts:150, 249-257, 601, 701, 793, 839, 898, 949`
- **Description:** `loadBudgets()` does `SELECT * FROM budgets` and rebuilds an in-memory `Map<string, BudgetRow>` after every mutation (checkAndReserve, reconcile, populateIfEmpty, removeBudget, resetSpend, alarm). But the Map is only read in `populateIfEmpty` (line 733: `this.budgets.has(key)`) to return whether the entity existed. The hot-path `checkAndReserve` queries SQLite directly — it never reads the Map.
- **Fix:** Remove the `budgets` Map, `loadBudgets()`, and all calls to it. In `populateIfEmpty`, use the UPSERT's result to determine insert vs update. This eliminates 7 unnecessary `SELECT * FROM budgets` queries per mutation cycle.
- **Effort:** Low
- **Validation:** `pnpm proxy:test` passes. DO unit tests verify `populateIfEmpty` return value.

### 1.5 Consolidate DO schema version checks
- **Severity:** Medium
- **File:** `durable-objects/user-budget.ts:163-247`
- **Description:** `initSchema()` queries `_schema_version` four separate times during DO construction. Each is a `SELECT MAX(version)` query. Since migrations are monotonically increasing, a single version check is sufficient.
- **Fix:** Read version once, cascade through migrations with `if (version < 2)`, `if (version < 3)`, etc. Saves 3 SQLite queries on DO cold start.
- **Effort:** Trivial
- **Validation:** `pnpm proxy:test` passes. DO tests verify schema migration paths.

### 1.6 Use RETURNING clause in DO reconcile
- **Severity:** Medium
- **File:** `durable-objects/user-budget.ts:643-665`
- **Description:** After `UPDATE budgets SET spend = spend + ?`, a separate `SELECT spend FROM budgets WHERE ...` reads back the new value. This happens once per entity per reconciliation.
- **Fix:** Use `UPDATE ... RETURNING spend` to get the post-update value in a single statement. Eliminates N extra queries per reconciliation.
- **Effort:** Low
- **Validation:** Reconciliation tests pass. Budget spend values match.

### 1.7 Eliminate double webhook endpoint lookup
- **Severity:** Medium
- **Files:** `routes/openai.ts:84-106`, `routes/anthropic.ts`, `routes/mcp.ts` (all webhook dispatch blocks)
- **Description:** Webhook dispatch first checks KV cache (`getWebhookEndpoints` — metadata only), then if endpoints exist, queries DB for secrets (`getWebhookEndpointsWithSecrets`). The KV read is pure overhead — when `hasWebhooks` is true (the common case), the DB query always runs.
- **Fix:** In the webhook dispatch blocks inside route handlers, skip the KV `getWebhookEndpoints` call. Go directly to `getWebhookEndpointsWithSecrets`. If empty, skip dispatch. The KV cache only saved one DB query for zero-endpoint users, but `hasWebhooks=true` already filters those out.
- **Effort:** Low
- **Validation:** Webhook dispatch tests pass. Smoke tests verify delivery.

### 1.8 Parallelize webhook dispatch to endpoints
- **Severity:** Low
- **File:** `lib/webhook-dispatch.ts:48-63`
- **Description:** `dispatchToEndpoints` dispatches sequentially via `for...of await`. Each `queue.send()` is <1ms but for N endpoints, it's N serial awaits.
- **Fix:** Replace `for...of` with `Promise.allSettled` for parallel dispatch. Failures are already caught per-endpoint.
- **Effort:** Trivial
- **Validation:** `webhook-dispatch.test.ts` passes. "continues after failure" test still works.

---

## Phase 2: Hot Path Optimization (~half day)

3 medium-effort changes that reduce work on every request.

### 2.1 Preserve raw body text (avoid re-serialization)
- **Severity:** High
- **Files:** `index.ts` (parseRequestBody), `lib/context.ts`, `routes/openai.ts:289`, `routes/anthropic.ts`
- **Description:** `parseRequestBody` reads body as text, parses to JSON, discards the text. Route handlers then `JSON.stringify(ctx.body)` to forward upstream. Every request pays parse + re-serialize. For large payloads (tool definitions, long conversations), this is significant.
- **Fix:** Preserve `bodyText` in `RequestContext`. Pass it directly to `fetch()` as the body. Only re-serialize if the body was mutated (only `ensureStreamOptions` for streaming requests). Extract `model`, `stream`, `tools` by reading from the parsed object.
- **Effort:** Medium
- **Validation:** All route tests pass. Benchmark shows reduced overhead for large payloads.

### 2.2 Remove correlated subquery from auth lookup
- **Severity:** Medium
- **File:** `api-key-auth.ts:73-81`
- **Description:** The auth query includes `EXISTS(SELECT 1 FROM webhook_endpoints w WHERE w.user_id = k.user_id AND w.enabled = true)` — a correlated subquery on every cache miss. `hasWebhooks` is only used to decide whether to create a WebhookDispatcher, which is just a queue envelope.
- **Fix:** Remove the `EXISTS` subquery. Check webhook existence lazily — only when actually dispatching, in the `waitUntil` block. The auth query becomes a simple `SELECT ... FROM api_keys WHERE key_hash = $1 AND revoked_at IS NULL`.
- **Effort:** Medium (requires removing `hasWebhooks` from auth result and plumbing it differently)
- **Validation:** Auth tests pass. Webhook dispatch still works via lazy lookup.

### 2.3 Add webhook-queue-handler tests (critical gap)
- **Severity:** High (testing gap)
- **Files:** New `__tests__/webhook-queue-handler.test.ts`, `__tests__/webhook-queue.test.ts`
- **Description:** `webhook-queue-handler.ts` has significant business logic (endpoint lookup, HMAC dual-signing at delivery, exponential backoff retry, permanent failure detection, rotation window check) with zero test coverage.
- **Fix:** Write tests covering:
  - Successful delivery (200 → ack, `webhook_delivered` metric)
  - Server error (500 → retry with backoff delay)
  - Rate limited (429 → retry with backoff)
  - Permanent failure (400 → ack, log)
  - Network error (fetch throws → retry)
  - Timeout (AbortSignal → retry)
  - Deleted endpoint (not in lookup → ack, skip)
  - Batch-cached lookup (2 messages same userId → 1 DB call)
  - Signing with fresh timestamp (not stale from enqueue)
  - Dual-signing within rotation window
  - `enqueueWebhook` success/failure metrics
- **Effort:** Medium
- **Validation:** New tests all pass.

---

## Phase 3: Correctness Fixes (~half day)

2 changes that fix incorrect behavior under failure conditions.

### 3.1 Distinguish auth error from auth rejection
- **Severity:** High
- **File:** `api-key-auth.ts:97-103`
- **Description:** When `lookupKeyInDb` fails (Hyperdrive down), it returns `null` — same as an invalid key. Valid users get 401 when the auth infrastructure is temporarily unavailable. No way to distinguish "bad key" from "auth infra down."
- **Fix:** Return a three-state result: `{ status: "authenticated", identity }`, `{ status: "rejected" }`, or `{ status: "error" }`. On `"error"`, `index.ts` returns 503 instead of 401. Consistent with fail-closed principle while giving actionable error info.
- **Effort:** Medium
- **Validation:** Auth tests cover all three states. Smoke test verifies 503 on simulated DB failure.

### 3.2 Self-healing expired reservations in DO
- **Severity:** Medium
- **File:** `durable-objects/user-budget.ts:604-609`
- **Description:** After `checkAndReserve`, alarm scheduling uses `setAlarm()` outside the `transactionSync` block. If `setAlarm` fails, expired reservations won't be cleaned up, permanently holding budget capacity.
- **Fix:** Add a defensive expired-reservation scan at the start of `checkAndReserve`. Before checking budget, delete any reservations past their `expires_at`. This self-heals missed alarms.
- **Effort:** Medium
- **Validation:** DO test simulates missed alarm scenario.

---

## Phase 4: Strategic Bundle Reduction (~1 day)

1 high-effort change with potentially massive latency impact.

### 4.1 Replace Drizzle ORM with raw postgres queries
- **Severity:** Opportunity
- **Files:** `lib/db.ts`, `lib/cost-logger.ts`, `lib/budget-spend.ts`, `lib/budget-do-lookup.ts`
- **Description:** `drizzle-orm` (~90KB) is used in 4 files for simple INSERT, UPDATE, and SELECT queries. The proxy uses no complex query building, no joins, no subqueries via Drizzle. Auth and webhook queries already use raw `getSql()` tagged templates. If QStash removal (66KB) gave 47% latency improvement, Drizzle removal (~90KB) could yield similar or larger gains.
- **Fix:** Rewrite 4 files to use raw `getSql()` tagged templates:
  - `cost-logger.ts`: `INSERT INTO cost_events (...) VALUES (...) ON CONFLICT DO NOTHING`
  - `budget-spend.ts`: `UPDATE budgets SET spend = spend + $1 WHERE entity_type = $2 AND entity_id = $3`
  - `budget-do-lookup.ts`: `SELECT * FROM budgets WHERE (entity_type, entity_id) IN (...)`
  - `db.ts`: Remove `getDb()` and `drizzle-orm/postgres-js` import
- **Effort:** High (4 files + their tests)
- **Validation:** All tests pass. Benchmark shows bundle size reduction and latency improvement.
- **Risk:** Losing Drizzle's type safety for INSERT values. Mitigate with runtime validation or TypeScript type assertions on query results.

---

## Phase 5: Structural Improvement (~1-2 days)

1 medium-effort change that reduces long-term maintenance burden.

### 5.1 Extract shared route handler (eliminate 3-way duplication)
- **Severity:** High (maintainability)
- **Files:** `routes/openai.ts` (672 lines), `routes/anthropic.ts` (671 lines), `routes/mcp.ts` (partial overlap)
- **Description:** OpenAI and Anthropic route handlers are ~95% identical. Budget denial handling, webhook dispatch, streaming/non-streaming split, error recovery, and reconciliation are all copy-pasted. Each new feature (velocity limits, session limits, tag budgets) is duplicated across both files. Currently ~1,300 lines for what should be ~700.
- **Fix:** Extract `handleProviderRoute(config)` that takes a provider-specific config:
  ```typescript
  interface ProviderConfig {
    provider: "openai" | "anthropic";
    baseUrl: string;
    buildUpstreamHeaders: (request: Request) => Headers;
    buildClientHeaders: (response: Response, apiVersion?: string) => Headers;
    calculateCost: (model, responseModel, usage, requestId, durationMs, attribution) => CostEvent;
    estimateMaxCost: (model, body) => number;
    createSSEParser: (body: ReadableStream) => { readable, resultPromise };
    extractModel: (body) => string;
  }
  ```
  Budget denial, webhook dispatch, reconciliation, streaming, non-streaming, and error handling become shared code parameterized by the config.
- **Effort:** Medium-High
- **Validation:** All route tests pass. Smoke tests verify both providers.

---

## Deferred / Accepted Risks

| # | Finding | Severity | Rationale for deferral |
|---|---------|----------|----------------------|
| 13 | AE SQL string interpolation | Medium | `QUERY_WINDOW_MINUTES` is a hardcoded constant, not user input |
| 16 | Magic number configurability | Medium | Acceptable pre-launch. Add env configurability post-launch. |
| 17 | Cost event direct fallback connection storm | Medium | Queue fallback is rare. Add monitoring metric. |
| 18 | Dynamic SQL in checkAndReserve | Low | SQLite parameterized, performance impact negligible |
| 20 | Pre-auth rate limit key exposure | Low | Mitigated by IP rate limiter |
| 24 | Reconciliation retry delays hardcoded | Low | Monitor via existing metrics |

---

## Phase Summary

| Phase | Scope | Effort | Expected Impact |
|-------|-------|--------|-----------------|
| **1** | 8 quick wins (zod, hex, body check, DO Map, schema, RETURNING, webhook lookup, parallel dispatch) | 2-3 hours | ~5-15% latency, cleaner DO, less memory |
| **2** | 3 hot path optimizations (raw body, auth subquery, webhook tests) | ~half day | Measurable latency reduction on large payloads |
| **3** | 2 correctness fixes (auth 503, DO self-heal) | ~half day | Better failure mode behavior |
| **4** | Drizzle removal (~90KB bundle) | ~1 day | Potentially massive latency win (cf. QStash: 66KB → 47%) |
| **5** | Route handler deduplication | ~1-2 days | -600 lines, faster feature development |

**Re-evaluation gate between each phase.** Benchmark after Phase 1 and Phase 4 to measure actual impact.
