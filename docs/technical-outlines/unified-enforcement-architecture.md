# NullSpend Unified Enforcement Architecture — Technical Outline

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
                    │  │  2. Budget Check (Redis Lua)      │ │
                    │  │  3. Approval Gate (optional)      │ │
                    │  │  4. Webhook Dispatch (QStash)     │ │
                    │  │  5. Cost Event Logging (Postgres) │ │
                    │  └─────────────────────────────────┘ │
                    │                                      │
                    │  Shared state: Redis + Postgres       │
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
events in Postgres, budget state in Redis, actions in Postgres) **and
consume the same configuration** (budgets, policies, webhook endpoints,
approval rules). The developer picks their entry point based on their
architecture, not based on which features they need.

### What Each Entry Point Does

**LLM Proxy (automatic, transparent)**
- Best for: LLM API calls (OpenAI, Anthropic, OpenAI-compatible)
- Integration: change one URL, add one header
- Enforcement: budget check runs in the proxy before forwarding
- Tracking: cost calculated from token usage, logged automatically
- Approval: NOT supported (LLM calls are too latency-sensitive for
  human-in-the-loop; use policies for automated decisions instead)

**MCP Proxy (automatic, wrapping)**
- Best for: MCP tool calls (Claude Desktop, Cursor, Claude Code)
- Integration: wrap the upstream MCP server command
- Enforcement: budget check via HTTP to Workers, approval gate via SDK
- Tracking: duration measured, cost estimated, logged via batcher
- Approval: SUPPORTED — gated tools pause for human approve/reject

**SDK (manual, embedded)**
- Best for: custom agent frameworks, non-MCP tools, approval-only
  workflows, any code that can't route through a proxy
- Integration: `npm install @nullspend/sdk`, call methods in code
- Enforcement: developer calls `sdk.checkBudget()` before their action
- Tracking: developer calls `sdk.reportCost()` after their action
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

// --- Approval workflow (existing, keep as-is) ---

// Gate a high-risk action
const result = await ns.proposeAndWait({
  actionType: "deploy_to_production",
  payload: { service: "payments", version: "2.1.0" },
  timeoutMs: 300_000, // 5 minutes for human to approve
  onApproved: async () => {
    await deployService("payments", "2.1.0");
    return { deployed: true };
  },
  onRejected: () => {
    console.log("Deployment rejected by reviewer");
  },
});

// --- Cost reporting (new, for non-proxied calls) ---

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

// --- Budget check (new, for pre-flight validation) ---

// Check budget before starting an expensive operation
const budget = await ns.checkBudget();
if (budget.remaining_microdollars < 5_000_000) { // less than $5 left
  console.log("Budget low, skipping expensive analysis");
  return fallbackResult;
}
```

The SDK provides three capabilities:

1. **Approval workflows** (existing) — `createAction()`,
   `waitForDecision()`, `proposeAndWait()`. These create actions in
   Postgres, poll for decisions, and report results. Already built and
   working.

2. **Cost reporting** (new) — `reportCost()`. For LLM calls or tool
   executions that don't go through the proxy. The SDK sends a cost event
   to the NullSpend API, which logs it to the same `cost_events` table.
   Same data, same dashboard, same webhooks — just a different ingestion
   path.

3. **Budget checking** (new) — `checkBudget()`. A lightweight read-only
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
   → If denied, return immediately. No Redis call. No DB call.

2. BudgetCheck (Redis Lua, 10-20ms)
   - Atomic check-and-reserve against budget entities
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

budgets
  - Dashboard creates: user configures budget limits
  - LLM proxy reads:   hasBudgets flag → Redis enforcement
  - MCP proxy reads:   hasBudgets flag → HTTP budget check
  - SDK reads:         checkBudget() → API call

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
  constructor(config: { apiKey: string; baseUrl?: string });

  // === Approval Workflows (existing) ===
  createAction(input: CreateActionInput): Promise<{ id: string }>;
  getAction(id: string): Promise<ActionRecord>;
  waitForDecision(id: string, timeoutMs: number): Promise<ActionRecord>;
  markResult(id: string, result: ActionResult): Promise<void>;
  proposeAndWait<T>(options: ProposeAndWaitOptions<T>): Promise<T>;

  // === Cost Reporting (new) ===
  reportCost(event: CostEventInput): Promise<void>;
  reportCostBatch(events: CostEventInput[]): Promise<void>;

  // === Budget Queries (new) ===
  checkBudget(): Promise<BudgetStatus>;

  // === Enforcement (new, optional) ===
  // For developers who want SDK-based enforcement without the proxy
  enforce(context: EnforcementContext): Promise<EnforcementResult>;
}

interface CostEventInput {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
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
The proxy calls the enforcement pipeline directly (in-process). The SDK
calls it via HTTP. Same pipeline, same checks, same result.

### How to Avoid Confusion: Documentation Structure

The documentation should NOT have three separate sections for "Proxy,"
"MCP Proxy," and "SDK." Instead:

```
Getting Started
  → Quick Start (change one URL, see your costs)

Integration Guides
  → LLM Cost Tracking (proxy — for OpenAI/Anthropic/compatible)
  → MCP Tool Tracking (MCP proxy — for Claude Desktop/Cursor)
  → Custom Integration (SDK — for everything else)

Features (same for all integrations)
  → Cost Analytics
  → Budget Enforcement
  → Approval Workflows
  → Spend Alerts & Webhooks
  → Policies (model allowlists, cost caps)
```

The features section is integration-agnostic. Budget enforcement works
the same whether you're using the proxy or the SDK. Approval workflows
work the same whether you're using the MCP proxy or the SDK. The
developer learns the features once and applies them through whichever
integration they chose.

### Implementation Priority

**Phase 1 (pre-launch, already done):**
- LLM proxy with cost tracking + budget enforcement ✓
- MCP proxy with tool tracking + budget checks + approval gating ✓
- SDK with approval workflows ✓
- Webhook event stream ✓

**Phase 2 (weeks 1-2 post-launch):**
- SDK `reportCost()` endpoint + method
- SDK `checkBudget()` endpoint + method
- Unified sidebar (FinOps / Control / Account)
- Documentation restructure (integration guides, not product sections)

**Phase 3 (weeks 3-4 post-launch):**
- Enforcement pipeline interface (`EnforcementCheck`)
- PolicyCheck implementation (model allowlist, cost cap, tool limit)
- SDK `enforce()` endpoint + method
- Approval webhook events (`action.pending`, `action.resolved`)

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
- LLM proxy core (CF Workers — routes, parsers, cost calculators)
- MCP proxy core (Node.js — gate logic, cost tracker, event batcher)
- SDK core (TypeScript — client, types, polling)
- Cost engine (pricing data, shared types)
- Enforcement pipeline interface (`EnforcementCheck`)
- Webhook types + signing library
- DB schema (Drizzle)

**Proprietary SaaS:**
- Dashboard (Next.js — analytics, budgets, inbox, settings, webhooks)
- QStash webhook delivery integration
- Stripe billing integration
- Managed Redis (Upstash) for budget state
- Managed Postgres (Supabase) for event storage
- Hosted proxy at `gateway.nullspend.com`

A self-hoster gets the proxy, MCP proxy, and SDK with full enforcement
capabilities. They bring their own Redis, Postgres, and dashboard. The
hosted version adds managed infrastructure, the dashboard, and managed
webhook delivery.
