# NullSpend Codebase Audit — 2026-04-02

Comprehensive audit across 9 dimensions: test failures, type errors, dead code, data flow integrity, auth/security, enforcement edge cases, SDK/proxy parity, schema drift, documentation drift, and dependency health.

**Test suite baseline**: 3,557 tests (3,553 pass, 4 fail) across root, proxy, claude-agent, and cost-engine.

**After Batch 1 fixes**: 3,560 tests (3,560 pass, 0 fail), typecheck clean, lint 20 errors (down from 23).

**After Batch 2 fixes**: 3,583 tests (3,583 pass, 0 fail), typecheck clean. P0-1 tag budget over-counting fixed with per-event budget updates + 23 new math/accounting tests.

---

## P0 — Ship Blockers

### P0-1. Tag budget over-counting in batch cost event route

- **Status**: [x] Fixed 2026-04-02 — per-event budget update + 23 new math/accounting tests
- **File**: `app/api/cost-events/batch/route.ts:74-84`
- **Category**: Data flow integrity
- **Impact**: Financial — tag-based budget tracking is incorrect for batch ingestion with heterogeneous tags

**Description**: When a batch contains events with different tags (e.g., event A: `env=prod` $1, event B: `env=dev` $2), all tags are merged via `Object.assign(mergedTags, row.tags)` and the total batch cost ($3) is charged to every matching tag budget. This causes:

1. `Object.assign` overwrites — if both events share a tag key with different values, only the last value survives
2. The total cost of ALL events is charged to EVERY matching tag budget, not just the per-tag cost subset

**Example**:
```
Batch: [{env=prod, cost=$1}, {env=dev, cost=$2}]
Expected: env=prod budget += $1, env=dev budget += $2
Actual:   env=dev budget += $3, env=prod budget += $0
```

API key and user budgets are unaffected (they don't depend on tags).

**Fix**: Update budget spend in the batch route to iterate per-event (or aggregate costs per unique tag combination) rather than merging all tags and applying total cost once.

**Tests to add**: Batch with heterogeneous tags → verify per-tag budget increments match per-tag costs.

---

### P0-2. Four failing tests — date-sensitive fixtures

- **Status**: [x] Fixed 2026-04-02
- **Files**: `app/api/policy/route.test.ts` (3 tests), `components/actions/budget-increase-card.test.ts` (1 timeout)
- **Category**: Test failures
- **Impact**: CI broken

**Description**: The policy route correctly resets spend for expired budget periods. But test fixtures hardcode `currentPeriodStart: new Date("2026-03-01T00:00:00Z")` with `resetInterval: "monthly"`. Since today is April 2, the March→April period has expired, so the implementation resets spend to 0 — breaking the assertions that expected the spend to be counted.

**Failing tests**:

| Test | Expected | Actual | Root cause |
|---|---|---|---|
| `route.test.ts:120` "returns most restrictive budget" | remaining=1,000,000 | 5,000,000 | Expired period → spend reset to 0 |
| `route.test.ts:221` "computes period_end" | `2026-04-01T00:00:00.000Z` | `2026-05-03T00:13:16.443Z` | Expired → new period starts from now |
| `route.test.ts:275` "clamps remaining to zero when overspent" | 0 | 5,000,000 | Same expired period issue |
| `budget-increase-card.test.ts:618` "returns 404 with budget_entity_not_found code" | Pass | Timeout (5s) | Dynamic imports exceed default timeout |

**Fix**: Use future dates in test fixtures or mock `Date.now()` via `vi.useFakeTimers()`. For the timeout, increase the test timeout or restructure to avoid heavy dynamic imports.

---

### P0-3. `event_type` CHECK constraint rejects "custom"

- **Status**: [x] Fixed 2026-04-02 — migration 0050_allow_custom_event_type.sql
- **Files**: `drizzle/0016_extend_cost_events.sql`, `packages/db/src/schema.ts:154`, `packages/sdk/src/types.ts:201`
- **Category**: Schema drift
- **Impact**: SDK users sending `eventType: "custom"` get a DB constraint violation error

**Description**: The TypeScript schema declares `eventType.$type<"llm" | "tool" | "custom">()` and the SDK type allows `"custom"`. But the PostgreSQL CHECK constraint from migration 0016 only allows `('llm', 'tool')`. No subsequent migration added `"custom"`.

```sql
-- drizzle/0016_extend_cost_events.sql
CHECK (event_type IN ('llm', 'tool'))  -- missing 'custom'
```

```typescript
// packages/db/src/schema.ts:154
eventType: text("event_type").$type<"llm" | "tool" | "custom">().notNull().default("llm")
```

**Fix**: Add migration: `ALTER TABLE cost_events DROP CONSTRAINT ...; ALTER TABLE cost_events ADD CONSTRAINT ... CHECK (event_type IN ('llm', 'tool', 'custom'));`

---

### P0-4. `entityType` enum mismatch — "agent" and "team" unreachable

- **Status**: [x] Fixed 2026-04-02 — removed from TS type, DB CHECK unchanged
- **Files**: `packages/db/src/schema.ts:113`, `lib/validations/budgets.ts:9`, `drizzle/0006_add_budget_check_constraints.sql`
- **Category**: Schema drift
- **Impact**: Inconsistent type definitions; future "agent" entity feature will hit validation wall

**Description**:

| Source | Allowed values |
|---|---|
| DB schema TS type | `"user" \| "agent" \| "api_key" \| "team" \| "tag"` |
| DB CHECK constraint | `('user', 'agent', 'api_key', 'team', 'tag')` |
| Zod validation | `["api_key", "user", "tag"]` |

No API path can create "agent" or "team" budgets. The policy endpoint could return them if they existed in the DB.

**Fix (option A — remove unused)**: Remove `"agent"` and `"team"` from the TS type. Leave DB CHECK as-is (won't hurt). Re-add when those features ship.

**Fix (option B — add support)**: Add `"agent"` and `"team"` to the Zod validation schema. Only do this when the agent entity feature ships.

---

### P0-5. `resetInterval` "yearly" allowed in DB but rejected by API

- **Status**: [x] Fixed 2026-04-02 — added "yearly" to Zod validation + test
- **Files**: `packages/db/src/schema.ts:118`, `lib/validations/budgets.ts:23`
- **Category**: Schema drift
- **Impact**: TS type says yearly is valid, but API rejects it

**Description**:

| Source | Allowed values |
|---|---|
| DB schema TS type | `"daily" \| "weekly" \| "monthly" \| "yearly" \| null` |
| DB CHECK constraint | `('daily', 'weekly', 'monthly', 'yearly')` |
| Zod validation | `["daily", "weekly", "monthly"]` |
| Policy endpoint `computePeriodEnd` | Handles `"yearly"` correctly |

**Fix**: Add `"yearly"` to the Zod validation schema in `lib/validations/budgets.ts:23`. The implementation already handles it.

---

### P0-6. SDK missing velocity limit enforcement

- **Status**: [ ] Open
- **Files**: `packages/sdk/src/tracked-fetch.ts`, `packages/sdk/src/policy-cache.ts`
- **Category**: SDK/proxy parity
- **Impact**: SDK-only users bypass velocity limits entirely

**Description**: The proxy enforces velocity limits (spending-rate circuit breaker) via Durable Object sliding window. The SDK has zero velocity enforcement. The policy endpoint (`/api/policy`) also does not return velocity state.

**Proxy enforcement path**: `budget-orchestrator.ts` → DO `checkAndReserve` → velocity_state SQLite table → returns `velocityDenied: true` → HTTP 429 `velocity_exceeded`

**SDK path**: None. SDK consumers never see velocity_exceeded.

**Fix (short-term)**: Document the gap in SDK README. Add velocity/tag detection to SDK proxy 429 interception (`tracked-fetch.ts:156-183`) so SDK consumers using the proxy get proper error types.

**Fix (medium-term)**: Add velocity state to PolicyResponse and implement client-side enforcement.

---

### P0-7. SDK missing tag budget enforcement

- **Status**: [ ] Open
- **Files**: `packages/sdk/src/tracked-fetch.ts`
- **Category**: SDK/proxy parity
- **Impact**: SDK-only users can overspend on tagged resources

**Description**: The proxy enforces tag-specific budget limits via the Durable Object. The SDK sends tags in request metadata but never checks against tag budgets. The policy endpoint returns the most restrictive budget but doesn't break down per-tag.

**Fix (short-term)**: Document the gap. Ensure SDK proxy 429 interception handles `tag_budget_exceeded` code.

**Fix (medium-term)**: Add per-tag budget state to PolicyResponse. Requires backend changes to expose tag budget allocations.

---

## P1 — Should Fix This Sprint

### P1-1. Five TypeScript errors (`pnpm typecheck`)

- **Status**: [x] Fixed 2026-04-02 — all 5 errors resolved, typecheck clean
- **Category**: Type safety

| # | File | Line | Error | Fix |
|---|---|---|---|---|
| 1 | `components/usage/recent-activity.tsx` | 73 | `useRef()` needs initial arg (React 19) | `useRef<...>(undefined)` |
| 2 | `packages/sdk/src/sse-parser.ts` | 109 | `cancel` not in `Transformer` type | Type assertion or `as any` |
| 3 | `packages/sdk/src/sse-parser.ts` | 271 | Same `cancel` issue | Same fix |
| 4 | `components/actions/budget-increase-card.test.ts` | 481 | Can't destructure TS interface at runtime | Remove or restructure type parity test |
| 5 | `lib/slack/notify.test.ts` | 232 | Array destructure type mismatch in filter | Fix type annotation on destructure |

---

### P1-2. Fire-and-forget budget updates in dashboard path — no retry

- **Status**: [ ] Open
- **File**: `app/api/cost-events/batch/route.ts:101-103`
- **Category**: Data flow integrity
- **Impact**: Cost events saved but budget spend never incremented if update fails

**Description**: The `afterInsert()` function (budget spend update + threshold detection + webhook dispatch) runs fire-and-forget after the HTTP 201 response is sent. If it fails, cost events exist in DB but budgets are never incremented. Unlike the proxy which has Cloudflare Queue retry, the dashboard API path has no retry mechanism.

**Fix**: Either await the budget update before responding, or implement a retry mechanism (e.g., Upstash QStash task for failed updates).

---

### P1-3. No webhook retry in dashboard path

- **Status**: [ ] Open
- **File**: `lib/webhooks/dispatch.ts:99-120`
- **Category**: Data flow integrity
- **Impact**: Webhook events silently lost on delivery failure

**Description**: Dashboard webhook dispatch is a single delivery attempt with 5s timeout. The proxy uses Cloudflare Queues with exponential backoff retry and DLQ. Dashboard-originated webhooks (cost event batch, action lifecycle events) have no retry.

**Fix**: Implement a retry queue (Upstash QStash or similar) for dashboard webhook delivery, or route all webhook dispatch through the proxy's queue.

---

### P1-4. Budget sync gap after approval — DO stale for up to 60s

- **Status**: [ ] Open
- **File**: `lib/actions/approve-action.ts:49-51`
- **Category**: Data flow integrity
- **Impact**: Dashboard shows correct budget, but proxy enforces old limit during sync gap

**Description**: After budget increase approval, `invalidateProxyCache()` is fire-and-forget with 2 retries. If both fail, the Durable Object still enforces the old budget limit until natural 60s cache expiry. Scenario: User approves $100→$200, dashboard shows $200, but proxy blocks at $100 for up to a minute.

**Fix options**:
1. Await `invalidateProxyCache()` before returning approval response (adds latency)
2. Accept the 60s window and document it
3. Have the SDK poll policy endpoint to confirm sync before retrying

---

### P1-5. Mandate cache race — 120s stale window

- **Status**: [ ] Open
- **File**: `apps/proxy/src/lib/api-key-auth.ts:39-43`
- **Category**: Enforcement edge cases
- **Impact**: Model restrictions can be bypassed for up to 2 minutes after update

**Description**: API key auth cache TTL is 120 seconds (with jitter). If a mandate update (allowedModels/allowedProviders) happens and the invalidation call fails, stale mandates persist. A now-blocked model could still be used until cache expires.

**Fix**: Reduce mandate-specific cache TTL to 30-60s, or make invalidation blocking with retry.

---

### P1-6. SDK can't distinguish proxy 429 denial types

- **Status**: [ ] Open
- **File**: `packages/sdk/src/tracked-fetch.ts:156-183`
- **Category**: SDK/proxy parity
- **Impact**: SDK consumers using proxy can't programmatically handle different denial types

**Description**: SDK only intercepts `budget_exceeded` 429s from the proxy. Velocity (`velocity_exceeded`), session limit (`session_limit_exceeded`), and tag budget (`tag_budget_exceeded`) 429s pass through as generic responses. SDK consumers can't distinguish them from upstream provider 429s (rate limiting).

**Fix**: Extend the proxy 429 interception block to check for all four NullSpend error codes:
```typescript
if (error.code === "velocity_exceeded") throw new VelocityExceededError(...)
if (error.code === "session_limit_exceeded") throw new SessionLimitExceededError(...)
if (error.code === "tag_budget_exceeded") throw new TagBudgetExceededError(...)
```

---

### P1-7. SDK DenialReason type incomplete

- **Status**: [ ] Open
- **File**: `packages/sdk/src/types.ts`
- **Category**: SDK/proxy parity
- **Impact**: `onDenied` callback can't represent velocity or tag budget denials

**Description**: The `DenialReason` discriminated union has `budget`, `mandate`, and `session_limit` variants but is missing `velocity` and `tag_budget`.

**Fix**: Add:
```typescript
| { type: "velocity"; retryAfterSeconds: number; limit?: number; window?: number; current?: number }
| { type: "tag_budget"; tagKey: string; tagValue: string; remaining: number; limit: number }
```

---

### P1-8. Audit log not wired into critical paths

- **Status**: [ ] Open
- **Files**: `lib/actions/approve-action.ts`, `lib/actions/reject-action.ts`, various API routes
- **Category**: Data flow integrity / compliance
- **Impact**: Action approvals, rejections, budget changes not auditable

**Description**: The audit logging infrastructure exists (`lib/audit/log.ts`) but `logAuditEvent()` is not called from:
- Action approval path (`approve-action.ts`)
- Action rejection path (`reject-action.ts`)
- API key creation/revocation
- Budget creation/modification
- Webhook config changes

**Fix**: Wire `logAuditEvent()` calls into all mutation endpoints that modify security-sensitive state.

---

### P1-9. Slack Web API fallback is silent

- **Status**: [ ] Open
- **File**: `lib/slack/notify.ts:134-142`
- **Category**: Data flow integrity
- **Impact**: User expects threaded replies for budget negotiation, gets single message instead

**Description**: If Slack Web API call fails (network, rate limit, config error), the code logs a warning and falls back to the incoming webhook. The user is not informed that threaded replies won't work, which breaks the budget negotiation UX (where approval/rejection appear as thread replies).

**Fix**: Either surface the fallback in the Slack message ("Note: threaded replies unavailable") or retry the Web API call before falling back.

---

### P1-10. Session limit not enforced mid-stream

- **Status**: [ ] Open — by design, needs documentation + test
- **Files**: `apps/proxy/src/durable-objects/user-budget.ts:329-359`
- **Category**: Enforcement edge cases
- **Impact**: Session spend can exceed limit by one full response

**Description**: Session limit is checked at request entry. If a streaming response is in progress and a concurrent request breaches the session limit, the current stream continues to completion. The overshoot equals the cost of one full response. This is by design (can't abort upstream), but:
1. No test explicitly covers this scenario
2. Not documented

**Fix**: Add test: first request streams, second hits session limit. Verify second is denied, first completes, costs are tracked. Document the behavior in `docs/features/session-limits.md`.

---

### P1-11. Unresolved DO reservation on upstream error

- **Status**: [ ] Open
- **File**: `apps/proxy/src/routes/openai.ts:245-251`
- **Category**: Enforcement edge cases
- **Impact**: Budget appears exhausted when no cost was incurred

**Description**: If upstream fetch throws an unexpected error and the queued reconciliation also fails (e.g., queue send error in `waitUntil`), the reservation persists in the DO until alarm cleanup (15-60 min). During this time, the reserved amount reduces available budget.

**Fix**: Add explicit reservation cleanup in the error handler. Ensure `reconcileBudgetQueued` failure triggers a synchronous fallback reconciliation.

---

### P1-12. `/v1/responses` endpoint documented but not implemented

- **Status**: [ ] Open
- **File**: `open-source/README.md`
- **Category**: Documentation drift
- **Impact**: Users expect OpenAI Responses API to work through proxy

**Description**: The open-source README lists `POST /v1/responses` as a supported endpoint. It's not implemented — requests return 404. The proxy only handles `/v1/chat/completions`, `/v1/messages`, and MCP routes.

**Fix**: Remove from README, or implement the endpoint.

---

### P1-13. Budget policy docs show wrong enum value

- **Status**: [ ] Open
- **File**: `docs/api-reference/budgets-api.md`
- **Category**: Documentation drift
- **Impact**: API clients copying examples get validation errors

**Description**: Documentation examples use `"policy": "enforce"`. Actual allowed values are `"strict_block" | "soft_block" | "warn"`.

**Fix**: Update all examples in budgets-api.md to use `"strict_block"` (or whichever is the intended default).

---

### P1-14. Security advisories in dev dependencies

- **Status**: [ ] Open
- **Category**: Dependency health
- **Impact**: Dev-only, no production exposure

| Advisory | Package | Via | Severity |
|---|---|---|---|
| GHSA-25h7-pfq9-p65f | flatted <3.4.0 | eslint → flat-cache | High (DoS) |
| GHSA-f269-vfmq-vjvj | undici <7.24.0 | wrangler → miniflare | High (crash) |
| Unbounded memory | undici <7.24.0 | wrangler → miniflare | High (memory) |

**Fix**: Update wrangler and eslint when new versions that pull patched transitive deps are available. No production risk.

---

## P2 — Nice to Fix

### P2-1. 23 ESLint errors

- **Status**: [ ] Open
- **Category**: Code quality

**Key items**:
- `apps/proxy/src/routes/shared.ts:3` — unused `errorResponse` import
- `app/api/budgets/[id]/route.ts:73` — `budget` assigned but never read (used for SELECT FOR UPDATE lock)
- `components/dashboard/dashboard-header.tsx:4` — unused `PageTitle` import
- `components/usage/recent-activity.tsx:3` — unused `Check` import from lucide-react
- `lib/budgets/increase.ts` — 7x `no-explicit-any` (needs proper typing)
- `app/api/actions/[id]/result/route.ts:81` — `no-explicit-any`
- `app/api/cost-events/sessions/route.test.ts:1` — unused `beforeEach`
- `app/api/policy/route.test.ts:1` — unused `beforeEach`
- `lib/budgets/update-spend.test.ts:1` — unused `beforeEach`
- `packages/sdk/src/client.test.ts:2212` — unused `warmResponse`
- `scripts/seed-all-pages.js` — `no-require-imports` (CommonJS in ESM project)

---

### P2-2. Duplicate webhook secret expiry logic

- **Status**: [ ] Open
- **File**: `lib/webhooks/dispatch.ts` lines 123-147 and 517-541
- **Category**: Dead code / code smell

**Description**: Identical lazy secret rotation expiry cleanup code exists in both `dispatchToEndpoints` and `dispatchCostEventToEndpoints`. Extract to a shared helper.

---

### P2-3. SDK session spend not persisted across restarts

- **Status**: [ ] Open — by design
- **File**: `packages/sdk/src/tracked-fetch.ts:40-47`
- **Category**: SDK/proxy parity

**Description**: SDK tracks session spend in-memory. Process restart resets counter to 0, giving a fresh session budget. Proxy uses DO SQLite (durable). This is by design for short-lived SDK processes but should be documented.

---

### P2-4. Durable Object fails closed — not configurable

- **Status**: [ ] Open — intentional security decision
- **File**: `apps/proxy/src/routes/openai.ts:113-136`
- **Category**: Enforcement edge cases

**Description**: When the DO is unavailable, proxy returns 503. This is correct and secure, but not configurable per-customer. Some tracking-only users might prefer fail-open behavior.

---

### P2-5. `@nullspend/db` package.json export condition ordering

- **Status**: [ ] Open
- **File**: `packages/db/package.json`
- **Category**: Build config

**Description**: `"types"` condition appears after `"import"` and `"require"` in the exports field, making it unreachable. Produces build warnings. Functional but messy.

**Fix**: Move `"types"` before `"import"` in the exports conditions.

---

### P2-6. Outdated dependencies (major versions available)

- **Status**: [ ] Open
- **Category**: Dependency health

| Package | Current | Latest | Risk |
|---|---|---|---|
| stripe | 20.4.1 | 22.0.0 | Major — breaking changes likely |
| recharts | 2.15.4 | 3.8.1 | Major — pinned exact via overrides |
| typescript | 5.9.3 | 6.0.2 | Major — new type checking rules |
| eslint | 9.39.4 | 10.1.0 | Major — config format changes |
| next | 16.1.6 | 16.2.2 | Patch — safe to update |
| @supabase/supabase-js | 2.98.0 | 2.101.1 | Patch — safe to update |
| @sentry/nextjs | 10.43.0 | 10.47.0 | Patch — safe to update |
| vitest | 4.1.0 | 4.1.2 | Patch — safe to update |

**Fix**: Update patch versions immediately. Schedule major version upgrades individually with testing.

---

### P2-7. Missing edge case tests

- **Status**: [ ] Open
- **Category**: Test coverage

| Missing test | File to add to |
|---|---|
| Mandate cache invalidation race with concurrent requests | `apps/proxy/src/__tests__/api-key-auth.test.ts` |
| Session limit reached during active stream | `apps/proxy/src/__tests__/session-limits.test.ts` |
| SDK proxy 429 interception for velocity/session/tag codes | `packages/sdk/src/tracked-fetch.test.ts` |
| Batch cost events with heterogeneous tags + tag budgets | `app/api/cost-events/batch/route.test.ts` |

---

### P2-8. Webhook dispatch silently drops on KV cache lookup failure

- **Status**: [ ] Open
- **File**: `apps/proxy/src/routes/shared.ts:287-288`
- **Category**: Data flow integrity

**Description**: If KV cache lookup for webhook endpoints fails, the entire webhook dispatch is skipped silently. Endpoints may be available in Postgres.

**Fix**: Fall through to Postgres query on KV failure.

---

### P2-9. Dead export: `closeDbConnection()`

- **Status**: [ ] Open
- **File**: `lib/db/client.ts:28-35`
- **Category**: Dead code

**Description**: Exported but never imported or called anywhere. In Next.js runtime, closing the singleton connection pool mid-request would break subsequent requests.

**Fix**: Remove or mark as `@internal` test-only.

---

### P2-10. 3 React Hook warnings

- **Status**: [ ] Open
- **Category**: Code quality

| File | Warning |
|---|---|
| `components/marketing/animated-hero-bg.tsx:36` | Missing dep `displayValue` |
| `components/marketing/feature-sections.tsx:504` | Missing dep `tags` |
| `components/marketing/feature-sections.tsx:629` | Missing dep `toolCalls` |

---

## Architecture Positives (Confirmed Sound)

These are the things that are working correctly and should be preserved:

- **Fail-closed on DO error** — proxy returns 503, never passes untracked requests
- **Serialized budget checks** — SQLite `transactionSync` prevents races
- **$0 budget blocks all requests** — stress-tested with 25-50 concurrent requests
- **Velocity window reset is atomic** — within same DO transaction
- **Queue-first cost events** — falls back to direct DB write on queue failure
- **Async webhooks in proxy** — enqueued with exponential backoff + DLQ
- **Auth coverage complete** — all 55 API routes have proper auth
- **No SQL injection** — 100% Drizzle ORM parameterized queries
- **Timing-safe comparison** — everywhere (API keys, sessions, Slack signatures)
- **No IDOR** — all queries scoped by `orgId`
- **No error leakage** — standardized error format, no stack traces
- **Cross-package enum sync** — verified by `cross-package.test.ts`
- **Cost calculation parity** — SDK and proxy produce identical results for OpenAI + Anthropic
- **Mandate enforcement parity** — SDK and proxy both enforce, same semantics
- **Budget enforcement parity** — SDK pre-checks + proxy reserves, consistent
- **Session limit parity** — both enforce, SDK in-memory + proxy in DO

---

## Quick Reference

| Severity | Count | Summary |
|---|---|---|
| P0 | 7 | Tag budget over-counting, 4 failing tests, 3 schema drifts, 2 SDK parity gaps |
| P1 | 14 | 5 TS errors, fire-and-forget gaps, sync races, missing audit log, doc drift |
| P2 | 10 | Lint errors, code duplication, outdated deps, missing tests, dead code |
| **Total** | **31** | |

### Suggested fix order

1. P0-2 — Fix failing tests (unblocks CI)
2. P0-3 — Add "custom" to event_type CHECK constraint (unblocks SDK users)
3. P0-1 — Fix tag budget over-counting (financial correctness)
4. P0-5 — Add "yearly" to validation (5-line fix)
5. P0-4 — Clean up entityType enum (remove "agent"/"team" from TS type for now)
6. P1-1 — Fix 5 TypeScript errors (unblocks typecheck in CI)
7. P1-13 — Fix budget policy doc examples (prevents user confusion)
8. P1-12 — Remove /v1/responses from README (prevents user confusion)
9. P0-6, P0-7, P1-6, P1-7 — SDK parity: document gaps + extend 429 interception
10. Everything else in priority order
