# NullSpend Unified Enforcement Architecture — Technical Outline

> **Revised: 2026-03-18.** Updated to reflect the current DO-based
> architecture (Durable Objects with SQLite replaced Redis Lua scripts),
> Cloudflare Queues reconciliation pipeline, and Phase 2A SDK completion
> (retry + idempotency). The strategic framing is unchanged — the technical
> implementation details now match the shipped codebase.

## The Problem

NullSpend currently has three integration paths that feel like separate
products:

1. **LLM Proxy** — transparent proxy at `gateway.nullspend.com`, handles
   cost tracking and budget enforcement for LLM API calls
2. **MCP Proxy** — local stdio wrapper, handles tool cost tracking, budget
   checks, AND human-in-the-loop approval gating
3. **SDK** — TypeScript client library (`@nullspend/sdk`), handles approval
   workflow creation, polling, and result reporting

These three paths use different auth patterns, different API surfaces, and
different mental models. A developer evaluating NullSpend sees three things
to learn instead of one platform with three integration points.

## The Insight from Research

Every successful platform with multiple integration paths solves this the
same way: **one control plane, multiple data planes.**

**LaunchDarkly**: SDK evaluates feature flags locally. Relay Proxy
evaluates flags as a shared cache. Both connect to the same flag delivery
network, same rules, same targeting. The developer picks their integration
based on their architecture, not based on which features they want.

**Lithic/Marqeta**: Auth Rules are managed enforcement (the platform
evaluates static rules on every transaction). ASA/Gateway JIT is custom
enforcement (the platform forwards the decision to the customer's system).
Both coexist on the same card, same transaction, same API. The customer
picks their enforcement style per use case.

**Stripe**: SDK handles client-side integration. Webhooks handle
server-side events. Dashboard handles configuration. All three talk to the
same Stripe API, same customers, same payment intents.

**The pattern**: the enforcement rules, budgets, policies, and approval
decisions are centralized in one control plane. How you integrate is
flexible. The proxy, the SDK, and the MCP wrapper are just different doors
into the same room.

## The Unified Architecture

### Core Principle: One Enforcement Pipeline, Multiple Entry Points

```
                    ┌─────────────────────────────────────┐
                    │      NullSpend Control Plane         │
                    │                                      │
                    │  ┌─────────────────────────────────┐ │
                    │  │   Enforcement Pipeline           │ │
                    │  │                                   │ │
                    │  │  1. Policy Check (in-memory)      │ │
                    │  │  2. Budget Check (DO SQLite)      │ │
                    │  │  3. Approval Gate (optional)      │ │
                    │  │  4. Webhook Dispatch (QStash)     │ │
                    │  │  5. Cost Event Logging (Postgres) │ │
                    │  └─────────────────────────────────┘ │
                    │                                      │
                    │  Budget state: UserBudgetDO (SQLite)  │
                    │  Ledger: Supabase Postgres            │
                    │  Reconciliation: CF Queues + DLQ      │
                    │  Shared identity: API key → userId    │
                    │  Shared config: budgets, policies,    │
                    │    approval rules, webhook endpoints  │
                    └──────┬──────────┬──────────┬─────────┘
                           │          │          │
              ┌────────────┘          │          └────────────┐
              ▼                       ▼                       ▼
    ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
    │   LLM Proxy      │  │   MCP Proxy      │  │   SDK            │
    │   (CF Workers)   │  │   (Local Node)   │  │   (In-process)   │
    │                  │  │                  │  │                  │
    │ Developer changes│  │ Developer wraps  │  │ Developer calls  │
    │ base URL         │  │ MCP server cmd   │  │ SDK methods in   │
    │                  │  │                  │  │ their code       │
    │ Automatic:       │  │ Automatic:       │  │                  │
    │ • Cost tracking  │  │ • Tool tracking  │  │ Manual:          │
    │ • Budget enforce │  │ • Budget enforce │  │ • Approval gates │
    │ • Tool detection │  │ • Approval gates │  │ • Cost reporting │
    │                  │  │                  │  │ • Action mgmt    │
    └──────────────────┘  └──────────────────┘  └──────────────────┘
```

The key insight: **all three entry points produce the same data** (cost
events in Postgres, budget state in Durable Objects, actions in Postgres)
**and consume the same configuration** (budgets, policies, webhook
endpoints, approval rules). The developer picks their entry point based on
their architecture, not based on which features they need.

### Current State: What's Built

| Component | Status | Budget enforcement | Cost tracking | Approval |
|---|---|---|---|---|
| LLM Proxy (CF Workers) | Shipped | DO check-and-reserve | SSE parsing + cost calc | No |
| MCP Proxy (stdio) | Shipped | HTTP call to proxy `/v1/mcp/budget/check` | Annotation-based estimation, batched to `/v1/mcp/events` | Yes (gated tools) |
| SDK | Shipped (partial) | Not yet | Not yet | Yes (`proposeAndWait`) |

**SDK Phase 2A (done):** Retry with exponential backoff + jitter, idempotency
key generation for mutating requests, `Retry-After` header support, configurable
retry limits and wall-time caps.

**SDK Phases 2B-2F (not started):** `reportCost()`, `reportCostBatch()`,
`checkBudget()`, `enforce()`, client-side event batching.

### What Each Entry Point Does

**LLM Proxy (automatic, transparent)**
- Best for: LLM API calls (OpenAI, Anthropic, OpenAI-compatible)
- Integration: change one URL, add one header
- Enforcement: DO budget check-and-reserve runs in the proxy before forwarding
- Tracking: cost calculated from token usage, logged async via `waitUntil()`
- Reconciliation: queued via CF Queues → consumer → DO reconcile + PG write-back
- Approval: NOT supported (LLM calls are too latency-sensitive for
  human-in-the-loop; use policies for automated decisions instead)

**MCP Proxy (automatic, wrapping)**
- Best for: MCP tool calls (Claude Desktop, Cursor, Claude Code)
- Integration: wrap the upstream MCP server command
- Enforcement: budget pre-check via HTTP to Workers (`/v1/mcp/budget/check`)
- Tracking: duration measured, cost estimated from tool annotations, batched
  to Workers (`/v1/mcp/events`) which logs to Postgres and reconciles reservations
- Approval: SUPPORTED — gated tools pause for human approve/reject via SDK

**SDK (manual, embedded)**
- Best for: custom agent frameworks, non-MCP tools, approval-only
  workflows, any code that can't route through a proxy
- Integration: `npm install @nullspend/sdk`, call methods in code
- Enforcement: developer calls `sdk.checkBudget()` before their action (planned)
- Tracking: developer calls `sdk.reportCost()` after their action (planned)
- Approval: SUPPORTED — `sdk.proposeAndWait()` for human gates

### Why the SDK Matters (and Why It's Not Confusing)

The concern about confusion is valid. Three integration paths CAN be
confusing if they feel like three separate products. But they're NOT
confusing if they're framed as three ways to access the same thing.

Think about how Stripe works. You can:
- Use Stripe.js (client-side SDK) to collect card details
- Use the Stripe API (server-side SDK) to create charges
- Use Stripe CLI to test webhooks locally
- Use the Stripe Dashboard to view payments

Nobody is confused by this because each tool has a clear use case and they
all operate on the same data (customers, payments, subscriptions). The
developer picks the tool for their context.

NullSpend should work the same way:

- Use the **proxy** when you want transparent cost tracking for LLM calls
  (zero code changes)
- Use the **MCP proxy** when you want tool cost tracking and approval
  gates for MCP servers (config change only)
- Use the **SDK** when you want programmatic control — approval workflows
  in custom code, cost reporting from non-proxied calls, or budget checks
  before expensive operations

The SDK is for developers who need fine-grained control. The proxy is for
developers who want zero-touch tracking. Both are valid. Both produce the
same data. Both enforce the same budgets.

### The SDK's Role in the Unified System

The SDK should NOT be a parallel implementation of the proxy's features.
It should be a thin client that talks to the same NullSpend API:

```typescript
import { NullSpend } from "@nullspend/sdk";

const ns = new NullSpend({
  apiKey: "ns_xxxxx",          // same key used by proxy
  baseUrl: "https://nullspend.com",
});

// --- Approval workflow (existing, shipped) ---

// Gate a high-risk action
const result = await ns.proposeAndWait({
  actionType: "deploy_to_production",
  payload: { service: "payments", version: "2.1.0" },
  timeoutMs: 300_000, // 5 minutes for human to approve
  execute: async () => {
    await deployService("payments", "2.1.0");
    return { deployed: true };
  },
});

// --- Cost reporting (planned, Phase 2C) ---

// Report a cost event from a direct API call that didn't go through
// the proxy (e.g., Bedrock via AWS SDK, or a custom tool)
await ns.reportCost({
  provider: "bedrock",
  model: "anthropic.claude-sonnet-4",
  inputTokens: 1500,
  outputTokens: 300,
  costMicrodollars: 12000,
  durationMs: 2400,
  sessionId: "data-pipeline-v3",
});

// --- Budget check (planned, Phase 2E) ---

// Check budget before starting an expensive operation
const budget = await ns.checkBudget();
if (budget.remaining_microdollars < 5_000_000) { // less than $5 left
  console.log("Budget low, skipping expensive analysis");
  return fallbackResult;
}
```

The SDK provides three capabilities:

1. **Approval workflows** (shipped) — `createAction()`,
   `waitForDecision()`, `proposeAndWait()`. These create actions in
   Postgres, poll for decisions, and report results. Already built and
   working. Retry + idempotency infrastructure complete (Phase 2A).

2. **Cost reporting** (planned) — `reportCost()`. For LLM calls or tool
   executions that don't go through the proxy. The SDK sends a cost event
   to the NullSpend API, which logs it to the same `cost_events` table.
   Same data, same dashboard, same webhooks — just a different ingestion
   path.

3. **Budget checking** (planned) — `checkBudget()`. A lightweight read-only
   query that returns the current budget state. The developer uses this
   to make decisions in their code: "if budget is low, use a cheaper
   model" or "if budget is exhausted, skip this step." This doesn't
   enforce — the proxy enforces. The SDK informs.

### How Approval Fits Into the Enforcement Pipeline

The approval workflow is currently implemented as a standalone system in
the MCP proxy. It should be reframed as one dimension of the enforcement
pipeline — alongside budgets and policies.

The enforcement pipeline evaluates checks in order of cost:

```typescript
interface EnforcementCheck {
  name: string;
  // Returns null if check passes, or a denial reason if blocked
  check(ctx: EnforcementContext): Promise<EnforcementDenial | null>;
}

interface EnforcementContext {
  userId: string;
  keyId: string;
  provider: string;
  model: string;
  estimatedCostMicrodollars: number;
  toolName?: string;        // for MCP tool calls
  actionType?: string;      // for SDK approval requests
  metadata?: Record<string, unknown>;
}

interface EnforcementDenial {
  check: string;            // "budget", "policy", "approval"
  reason: string;           // human-readable
  details: Record<string, unknown>;
}
```

The pipeline runs checks in order:

```
1. PolicyCheck (in-memory, sub-ms)
   - Model allowlist: is this model allowed for this key?
   - Cost cap: does the estimated cost exceed the per-request limit?
   - Tool limit: are there too many tool definitions?
   → If denied, return immediately. No DO call. No DB call.

2. BudgetCheck (DO RPC, 5-15ms on cache hit)
   - Atomic check-and-reserve in UserBudgetDO SQLite
   - Reserve → check headroom → approve/deny in transactionSync()
   - Period auto-reset with Postgres write-back via waitUntil()
   → If denied, return budget_exceeded with remaining amount.
   → If no budgets configured (hasBudgets: false), skip entirely.

3. ApprovalCheck (Postgres + polling, seconds to minutes)
   - Only for actions that require human approval
   - Creates an action record, waits for decision
   → If rejected or timed out, return approval_denied.
   → Only triggered when approval rules match (not on every request).
```

**For the LLM proxy:** checks 1 and 2 run. Check 3 (approval) does NOT
run — LLM calls are too latency-sensitive for human approval. If a
developer wants to gate expensive LLM calls, they use a policy (cost cap)
not an approval workflow.

**For the MCP proxy:** all three checks can run. Check 3 only runs for
tools marked as "gated" in the config. Ungated tools skip straight to
forwarding after checks 1 and 2.

**For the SDK:** the developer explicitly calls the checks they want.
`sdk.checkBudget()` runs check 2. `sdk.proposeAndWait()` runs check 3.
Policy checks are implicit in the proxy and MCP proxy but explicit in the
SDK if the developer wants them.

### How Budget Enforcement Works Today (DO Architecture)

The proxy's budget enforcement has been fully migrated from Redis Lua to
Cloudflare Durable Objects with SQLite storage:

```
Request lifecycle:
                                                  ┌────────────────────┐
                                                  │  Supabase Postgres │
  ┌──────────┐    ┌───────────────┐    lookup     │  (budgets table,   │
  │  Request  │───▶│ Budget        │──────────────▶│   cost_events,     │
  │  arrives  │    │ Orchestrator  │◀──────────────│   api_keys)        │
  └──────────┘    └───────┬───────┘  budget rows   └────────────────────┘
                          │
                 DO RPC   │  checkAndReserve(entities, estimate)
                          ▼
                ┌──────────────────┐
                │  UserBudgetDO    │   One instance per userId
                │  (SQLite)        │   (named by userId)
                │                  │
                │  budgets table   │   entity_type, entity_id,
                │  reservations    │   max_budget, spend, reserved,
                │  table           │   policy, reset_interval
                └──────────────────┘
                          │
                          │  On response complete:
                          ▼
                ┌──────────────────┐    ┌────────────────────┐
                │  CF Queue        │───▶│  Queue Consumer     │
                │  (reconcile)     │    │  reconcile()        │
                │                  │    │  + PG write-back    │
                │  max_retries: 3  │    └────────┬───────────┘
                │  retry_delay: 5s │             │ on failure
                └──────────────────┘             ▼
                                       ┌────────────────────┐
                                       │  DLQ Consumer       │
                                       │  best-effort retry  │
                                       │  + metrics + ack    │
                                       └────────────────────┘
```

**Key properties:**
- **Per-user isolation:** Each user gets their own DO instance (named by
  userId). Budget state is colocated — no cross-user contention.
- **Atomic operations:** `checkAndReserve`, `reconcile`, `syncBudgets`,
  `resetSpend` all use `transactionSync()` for atomic SQLite transactions.
- **Ghost budget purging:** `syncBudgets` RPC atomically UPSERTs budget
  rows from Postgres and deletes any DO rows not present in the Postgres
  list. Prevents permanently-enforced deleted budgets.
- **Period auto-reset:** Budget periods (daily/weekly/monthly/yearly) are
  reset atomically during `checkAndReserve` when the current period has
  elapsed. Postgres `period_start` is updated via `waitUntil()`.
- **Reservation cleanup:** `resetSpend` uses `json_each` to find matching
  reservations, decrements `reserved` on co-covered entities, and deletes
  reservation records — preventing the orphaned reservation over-approval
  window.
- **Reconciliation queue:** Cost reconciliation is decoupled from the
  request lifecycle via CF Queues. Consumer retries up to 3 times with
  5s delay, then DLQ consumer does best-effort retry + metrics + always acks.
- **DO lookup cache:** Module-level 60s TTL cache prevents redundant
  Postgres lookups. Empty results are never cached (so new budgets take
  effect immediately). Cache is invalidated on dashboard budget mutations
  via the internal endpoint.

### The Data Model Unification

All three entry points write to the same tables:

```
cost_events
  - LLM proxy writes: event_type='llm', provider='openai'/'anthropic'
  - MCP proxy writes: event_type='tool', provider='mcp'
  - SDK writes:       event_type='llm'/'tool'/'custom', provider=any

actions (approval workflow)
  - MCP proxy creates: when gated tool is called
  - SDK creates:       when developer calls proposeAndWait()
  - Dashboard reads:   Inbox shows pending, History shows completed
  - Slack notifies:    on action creation

budgets (Postgres: source of truth, DO: hot enforcement state)
  - Dashboard creates: user configures budget limits
  - LLM proxy reads:   hasBudgets flag → DO enforcement
  - MCP proxy reads:   hasBudgets flag → HTTP budget check → DO enforcement
  - SDK reads:         checkBudget() → API call (planned)
  - Dashboard mutates: invalidateProxyCache() → internal endpoint → DO

webhook_endpoints
  - Dashboard creates: user configures webhook URLs
  - LLM proxy fires:   cost events, budget thresholds, denials
  - MCP proxy fires:   cost events (via Workers endpoints)
  - SDK fires:         approval events (action.created, action.resolved)
```

### SDK API Surface (Minimal, Focused)

The SDK should be small. Not a reimplementation of the proxy, but a thin
client for the capabilities that only make sense in-process:

```typescript
class NullSpend {
  constructor(config: NullSpendConfig);

  // === Approval Workflows (shipped) ===
  createAction(input: CreateActionInput): Promise<{ id: string }>;
  getAction(id: string): Promise<ActionRecord>;
  waitForDecision(id: string, opts?: WaitForDecisionOptions): Promise<ActionRecord>;
  markResult(id: string, result: MarkResultInput): Promise<MutateActionResponse>;
  proposeAndWait<T>(options: ProposeAndWaitOptions<T>): Promise<T>;

  // === Cost Reporting (planned, Phase 2B-2C) ===
  reportCost(event: CostEventInput): Promise<{ id: string }>;
  reportCostBatch(events: CostEventInput[]): Promise<{ ids: string[] }>;

  // === Budget Queries (planned, Phase 2D-2E) ===
  checkBudget(): Promise<BudgetStatus>;

  // === Enforcement (planned, Phase 3F-3G) ===
  // For developers who want SDK-based enforcement without the proxy
  enforce(context: EnforcementContext): Promise<EnforcementResult>;
}

interface NullSpendConfig {
  baseUrl: string;
  apiKey: string;
  fetch?: typeof globalThis.fetch;
  requestTimeoutMs?: number;  // default: 30s
  maxRetries?: number;        // default: 3 (shipped, Phase 2A)
  retryBaseDelayMs?: number;  // default: 500 (shipped, Phase 2A)
  maxRetryTimeMs?: number;    // default: 0 (no cap)
  onRetry?: (info: RetryInfo) => void | boolean;
}

interface CostEventInput {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
  costMicrodollars: number;
  durationMs?: number;
  sessionId?: string;
  eventType?: "llm" | "tool" | "custom";
  toolName?: string;
  toolServer?: string;
  metadata?: Record<string, unknown>;
}

interface BudgetStatus {
  hasBudgets: boolean;
  entities: Array<{
    entityType: string;
    entityId: string;
    limitMicrodollars: number;
    spendMicrodollars: number;
    remainingMicrodollars: number;
  }>;
}

interface EnforcementResult {
  allowed: boolean;
  denial?: {
    check: string;
    reason: string;
  };
}
```

### New API Endpoints (for SDK)

The SDK needs these API endpoints on the dashboard (Next.js):

```
POST /api/cost-events          — Report a cost event (SDK ingestion)
POST /api/cost-events/batch    — Report multiple cost events
GET  /api/budgets/status       — Current budget state for authenticated key
POST /api/enforce              — Run enforcement pipeline, return allow/deny
```

These endpoints authenticate via `x-nullspend-key` (same as the proxy),
so the SDK uses the same API key the developer already has.

The enforcement endpoint (`POST /api/enforce`) is the unified entry point.
The proxy calls the enforcement pipeline directly (in-process via DO RPC).
The SDK calls it via HTTP. Same pipeline, same checks, same result.

**Architecture note:** The `POST /api/enforce` endpoint on the dashboard
(Next.js/Vercel) would need to reach the UserBudgetDO for budget checks.
Two options:

1. **Dashboard → proxy internal endpoint → DO** — route through the CF
   Workers proxy, which already has the DO binding. Add a new internal
   RPC like `POST /internal/budget/check`.
2. **Dashboard → Postgres only** — the dashboard reads budget state from
   Postgres directly (no real-time reservation tracking). This is
   sufficient for `checkBudget()` but not for `enforce()` with atomic
   reservation.

Option 1 is consistent with the existing internal endpoint pattern
(`/internal/budget/invalidate`) and gives the SDK the same atomic
enforcement the proxy uses.

### How to Avoid Confusion: Documentation Structure

The documentation should NOT have three separate sections for "Proxy,"
"MCP Proxy," and "SDK." Instead:

```
Getting Started
  -> Quick Start (change one URL, see your costs)

Integration Guides
  -> LLM Cost Tracking (proxy — for OpenAI/Anthropic/compatible)
  -> MCP Tool Tracking (MCP proxy — for Claude Desktop/Cursor)
  -> Custom Integration (SDK — for everything else)

Features (same for all integrations)
  -> Cost Analytics
  -> Budget Enforcement
  -> Approval Workflows
  -> Spend Alerts & Webhooks
  -> Policies (model allowlists, cost caps)
```

The features section is integration-agnostic. Budget enforcement works
the same whether you're using the proxy or the SDK. Approval workflows
work the same whether you're using the MCP proxy or the SDK. The
developer learns the features once and applies them through whichever
integration they chose.

### Implementation Priority

**Phase 1 (pre-launch — shipped):**
- LLM proxy with cost tracking + DO budget enforcement
- MCP proxy with tool tracking + budget checks + approval gating
- SDK with approval workflows + retry/idempotency (Phase 2A)
- Webhook event stream
- DO migration (Redis Lua → Durable Objects SQLite)
- Queue-based reconciliation with DLQ consumer
- Internal endpoint for dashboard → proxy cache invalidation
- Structured observability (Pino logging + Sentry breadcrumbs)

**Phase 2 (weeks 1-2 post-launch):**
- SDK `reportCost()` endpoint + method (2B, 2C)
- SDK `checkBudget()` endpoint + method (2D, 2E)
- SDK client-side event batching (2F)
- Documentation restructure (integration guides, not product sections)

**Phase 3 (weeks 3-4 post-launch):**
- Enforcement pipeline interface (`EnforcementCheck`) (3A)
- PolicyCheck implementation (model allowlist, cost cap, tool limit) (3B)
- BudgetCheck wrapper (adapt existing DO orchestrator) (3C, 3D)
- VelocityCheck (new — rate-based enforcement) (3E)
- SDK `enforce()` endpoint + method (3F, 3G)
- Conditional approval thresholds (3H)
- Config caching in Worker (3I)

**Phase 4 (months 2-3):**
- Dashboard Inbox shows approval context (which tool, estimated cost,
  which budget it would draw from)
- Kill receipts as first-class entities (link budget denials to the
  enforcement check that triggered them)
- Approval rules configuration in dashboard (which tools require
  approval, cost thresholds for auto-approve vs manual)

### What NOT to Unify

Some things should stay separate because unifying them adds complexity
without value:

**Don't make the proxy call the SDK for approvals.** The proxy handles
LLM calls that complete in seconds. Adding a human approval gate (minutes)
to the proxy would block the LLM call, consuming Workers CPU time and
potentially hitting timeout limits. Approval is for tools (via MCP proxy)
and custom actions (via SDK), not for LLM calls.

**Don't make the SDK replicate the proxy's SSE parsing.** The SDK reports
costs that the developer has already calculated. It doesn't parse LLM
responses. If the developer wants automatic cost tracking for LLM calls,
they use the proxy. If they want to report costs from calls they made
directly (Bedrock, custom models), they use `sdk.reportCost()`.

**Don't merge the MCP proxy into the LLM proxy.** They run in different
environments (local Node.js vs CF Workers), handle different protocols
(stdio vs HTTP), and serve different use cases. They share a backend but
they're architecturally distinct for good reasons.

**Don't build an "observe" SDK that wraps LLM clients.** This is what
Langfuse does (wrap the OpenAI client to capture telemetry). Our proxy
already does this without wrapping. An observe SDK would be a third way
to do the same thing, adding confusion without adding capability. If the
developer can route through the proxy, they should. If they can't (e.g.,
Bedrock via AWS SDK), they use `sdk.reportCost()` to send the data
manually.

**Don't bypass DO for SDK budget checks.** It's tempting to have the SDK
read budget state from Postgres directly (avoid the DO hop). But Postgres
doesn't track reservations — the DO does. A Postgres-only budget check
would show stale data when concurrent requests have outstanding
reservations. The SDK should route through the proxy's internal endpoint
to get the same atomic view the proxy uses.

### The Honest Assessment: Is This Too Complex?

Three integration paths is the right number for our use case. But it will
only avoid confusion if we follow two rules:

**Rule 1: The docs lead with the simplest path.** The quickstart shows
the proxy (change one URL). The MCP guide shows the wrapper (change one
command). The SDK is introduced as "for advanced use cases." Most
developers will never need the SDK — the proxy and MCP proxy cover 90%
of scenarios.

**Rule 2: The dashboard shows unified data regardless of source.** The
developer should never have to think about which integration generated a
cost event. The analytics page shows all costs together. The activity
feed shows LLM calls, tool calls, and SDK-reported events in one stream.
Budgets enforce across all sources. Webhooks fire for all event types.

If the dashboard makes it feel like one product, the multiple integration
paths feel like convenience, not complexity. If the dashboard makes it
feel like three products, we've failed.

### Open-Source Boundary

Following the PostHog model:

**Apache 2.0 (open source):**
- LLM proxy core (CF Workers — routes, parsers, cost calculators, DO budget enforcement)
- MCP proxy core (Node.js — gate logic, cost tracker, event batcher)
- SDK core (TypeScript — client, types, polling, retry)
- Cost engine (pricing data, shared types)
- Enforcement pipeline interface (`EnforcementCheck`)
- Webhook types + signing library
- DB schema (Drizzle)

**Proprietary SaaS:**
- Dashboard (Next.js — analytics, budgets, inbox, settings, webhooks)
- QStash webhook delivery integration
- Stripe billing integration
- Managed infrastructure (Supabase Postgres, CF Durable Objects, CF Queues)
- Hosted proxy at `gateway.nullspend.com`

A self-hoster gets the proxy, MCP proxy, and SDK with full enforcement
capabilities. They bring their own Postgres and Cloudflare account (for
Workers + DOs). The hosted version adds managed infrastructure, the
dashboard, and managed webhook delivery.

**Note on self-hosting:** The DO architecture simplifies self-hosting
compared to the previous Redis design. Redis required Upstash or a
self-hosted Redis with Lua script management. DOs are bundled with the
CF Workers deployment — `wrangler deploy` provisions everything. The
trade-off is CF lock-in for the proxy layer, but the proxy was already
CF Workers, so no new dependency is introduced.
