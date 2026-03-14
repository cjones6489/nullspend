# Unified Policy Engine: Technical Specification

> **Status:** Draft. This document defines the architecture for unifying
> NullSpend's LLM proxy (cost tracking + budget enforcement) with its approval
> system (human-in-the-loop gating) into a single policy-driven platform.
>
> **The simplicity rule still applies.** The default developer experience
> remains: change your base URL, see your costs, set a budget. Policy tiers
> are opt-in escalation — developers only encounter complexity when they
> explicitly choose more control.
>
> **Reference documents:**
> - `docs/finops-pivot-roadmap.md` — Master roadmap
> - `docs/claude-research/nullspend-fintech-patterns-research.md` — Fintech patterns
> - `docs/frontend-gap-analysis.md` — Dashboard phase breakdown

---

## 1. Problem Statement

NullSpend currently has two independent systems that serve related but
disconnected purposes:

```
System 1: LLM Proxy (apps/proxy/)
  What it does:  Intercepts LLM API calls, tracks costs, enforces budgets
  Decision:      Binary — pass or block (429)
  Integration:   Change your base URL (zero code changes)
  Human input:   None

System 2: Approval SDK (packages/sdk/)
  What it does:  Gates risky actions behind human approval
  Decision:      Human approves or rejects
  Integration:   Install SDK, wrap actions in proposeAndWait()
  Human input:   Required for every gated action
```

These systems share infrastructure (Postgres, auth, API keys) but have no
shared decision-making. A developer who wants cost tracking uses the proxy.
A developer who wants approval gating uses the SDK. A developer who wants
both must integrate both independently.

The gap: there is no way to say "auto-approve cheap LLM calls but require
human approval for expensive ones." The proxy can block but cannot hold
for approval. The SDK can hold for approval but doesn't integrate with the
proxy's cost estimation.

---

## 2. Design Principles

### 2.1 Simplicity is non-negotiable

The developer experience for the common case (cost tracking + hard budget caps)
must remain a single environment variable change. Policy tiers are additive —
each tier adds capability without changing the integration for simpler tiers.

```
Tier 0 (observe):       Change base URL                    → see costs
Tier 1 (strict_block):  Change base URL + set budget       → see costs + hard cap
Tier 2 (approve_above): Change base URL + set budget       → see costs + approval for expensive calls
                         + configure policy in dashboard       (agent must handle 202 response)
Tier 3 (approve_all):   Change base URL + set budget       → every call needs approval
                         + configure policy in dashboard       (agent must handle 202 response)
Tier 4 (webhook):       Change base URL + set budget       → customer's endpoint decides per-call
                         + configure webhook URL               (agent must handle 202 response)
```

**Key rule:** Tiers 0 and 1 require zero agent code changes. This is where
80%+ of users will start and many will stay. Tiers 2-4 require the agent to
handle a `202 Accepted` response, which is an explicit opt-in to more control.

### 2.2 One decision point, not two

Today, budget enforcement and approval gating are separate decision points with
separate code paths. The unified architecture has a single **Policy Decision
Point (PDP)** that every request flows through. The PDP evaluates the budget's
`policy` field and returns one of three outcomes: pass, block, or hold.

### 2.3 Reuse everything

The approval pipeline (actions table, Inbox UI, approve/reject flow, Slack
integration, timeline, CostCard) already works. The policy engine triggers
it — it doesn't replace it. The schema changes are minimal: a few new values
for `budgets.policy` and one or two new columns.

---

## 3. Architecture

### 3.1 Current Flow (Two Independent Systems)

```
Developer's Agent
  │                                    │
  │ LLM calls (base URL)              │ Risky actions (SDK)
  ▼                                    ▼
┌──────────────────┐          ┌──────────────────┐
│    LLM PROXY     │          │    SDK / API     │
│                  │          │                  │
│  auth            │          │  createAction    │
│  budget check ──►│ pass     │  waitForDecision │
│                  │ or 429   │  execute         │
│  forward to LLM  │          │  markResult      │
│  log cost        │          │                  │
└──────────────────┘          └──────────────────┘
        │                             │
     OpenAI                     Dashboard Inbox
```

### 3.2 Unified Flow (Single Policy Decision Point)

```
Developer's Agent
  │
  │ All LLM calls go through the proxy (base URL change)
  ▼
┌─────────────────────────────────────────────────────────┐
│                    LLM PROXY                             │
│                                                         │
│  1. Auth (x-nullspend-auth)                             │
│  2. Estimate cost (existing cost estimator)              │
│  3. Look up budget + policy (existing budget lookup)     │
│  4. ┌─────────────────────────────────────────────┐     │
│     │         POLICY DECISION POINT               │     │
│     │                                             │     │
│     │  evaluate(policy, estimatedCost, budget)    │     │
│     │    → PASS | BLOCK | HOLD_FOR_APPROVAL       │     │
│     └──────┬──────────────┬──────────────┬────────┘     │
│            │              │              │               │
│         ┌──┴──┐      ┌────┴───┐    ┌─────┴──────┐      │
│         │PASS │      │ BLOCK  │    │   HOLD     │      │
│         └──┬──┘      │ (429)  │    └─────┬──────┘      │
│            │         └────────┘          │               │
│            │                             │               │
│            │                    ┌────────┴────────┐     │
│            │                    │ Create action   │     │
│            │                    │ Return 202 +    │     │
│            │                    │ { actionId,     │     │
│            │                    │   status,       │     │
│            │                    │   retryAfter }  │     │
│            │                    └─────────────────┘     │
│            │                                            │
│  5. Forward to provider                                 │
│  6. Log cost event                                      │
│  7. Reconcile budget                                    │
└─────────────────────────────────────────────────────────┘
```

### 3.3 The HOLD Flow (Tiers 2-4)

When the PDP returns HOLD_FOR_APPROVAL, the proxy:

1. Creates an action in the `actions` table with:
   - `actionType: "llm_call"`
   - `status: "pending"`
   - `payloadJson`: the sanitized request body (model, message count, estimated cost)
   - `metadataJson`: attribution (api_key_id, estimated_cost, model)

2. Returns `202 Accepted` to the caller:

```json
{
  "status": "pending_approval",
  "action_id": "550e8400-...",
  "estimated_cost_microdollars": 750000,
  "message": "Request requires approval. Estimated cost: $0.75",
  "poll_url": "/api/actions/550e8400-.../status",
  "retry_after_seconds": 5
}
```

3. The request appears in the Dashboard Inbox alongside SDK-originated actions.
   A human approves or rejects it.

4. The agent handles the 202:

```typescript
// Minimal agent-side handling for approval-gated calls
const response = await fetch(proxyUrl + "/v1/chat/completions", {
  method: "POST",
  headers: { "Content-Type": "application/json", ...authHeaders },
  body: JSON.stringify({ model: "gpt-4o", messages }),
});

if (response.status === 202) {
  const { action_id, poll_url } = await response.json();

  // Poll until approved (or use NullSpend SDK helper)
  const approved = await waitForApproval(poll_url);
  if (!approved) throw new Error("LLM call rejected");

  // Re-submit with approval token
  const retryResponse = await fetch(proxyUrl + "/v1/chat/completions", {
    headers: { ...authHeaders, "x-nullspend-approval": action_id },
    body: JSON.stringify({ model: "gpt-4o", messages }),
  });
  return retryResponse;
}

// Normal 200 response — no approval needed
return response;
```

5. On re-submission with the approval token, the proxy:
   - Validates the action exists, is approved, and belongs to this user
   - Skips the policy check (already approved)
   - Forwards to the provider
   - Links the cost event to the action via `actionId`

### 3.4 SDK Helper for 202 Handling

For developers who don't want to write the 202 handling manually, the SDK
provides a wrapper:

```typescript
import { withApproval } from "@nullspend/sdk";

// Wraps fetch to automatically handle 202 → poll → retry
const safeFetch = withApproval(fetch, {
  apiKey: "ask_...",
  pollIntervalMs: 3000,
  timeoutMs: 300000,
});

// Use exactly like normal fetch — transparent unless approval is needed
const response = await safeFetch(proxyUrl + "/v1/chat/completions", {
  method: "POST",
  body: JSON.stringify({ model: "gpt-4o", messages }),
});
```

This maintains the simplicity principle: developers who want approval gating
add one wrapper. Developers who don't want it change nothing.

---

## 4. Policy Tiers

### 4.1 Tier 0: Observe

```
Policy value:    "observe"
Behavior:        Log all costs. Never block. Never hold.
Budget enforced: No (spend is tracked but not capped)
Agent changes:   None (transparent proxy)
Use case:        "I just want to see what my agents cost"
Dashboard:       Full cost visibility, no enforcement UI
```

Implementation: This is the implicit behavior when no budget exists. Could
also be an explicit policy for users who want a budget dashboard without
enforcement (track spend vs a target without blocking).

### 4.2 Tier 1: Strict Block

```
Policy value:    "strict_block"
Behavior:        Pass if under budget. Block (429) if over.
Budget enforced: Yes (hard cap)
Agent changes:   None (transparent proxy, 429 is standard HTTP)
Use case:        "Stop my agent from spending more than $50/day"
Dashboard:       Cost visibility + budget progress + blocked request count
```

Implementation: **Already fully implemented.** This is the current default.

### 4.3 Tier 2: Approve Above Threshold

```
Policy value:    "approve_above"
Behavior:        Auto-pass if estimated cost < threshold.
                 Hold for approval if estimated cost >= threshold.
                 Block (429) if over total budget (regardless of approval).
Budget enforced: Yes (hard cap + approval gate)
Agent changes:   Must handle 202 response (or use SDK helper)
Use case:        "Auto-approve cheap calls, review expensive ones"
Dashboard:       Cost visibility + budget + approval inbox shows LLM calls
```

New schema fields on `budgets`:
- `approvalThresholdMicrodollars` — calls estimated above this trigger approval

Decision flow:

```
estimated_cost >= budget_remaining?
  → BLOCK (429, over budget)

estimated_cost >= approval_threshold?
  → HOLD_FOR_APPROVAL (202, create action)

else
  → PASS (forward to provider)
```

### 4.4 Tier 3: Approve All

```
Policy value:    "approve_all"
Behavior:        Every request requires human approval.
                 Block (429) if over total budget.
Budget enforced: Yes
Agent changes:   Must handle 202 response (or use SDK helper)
Use case:        "I want to approve every LLM call"
Dashboard:       Every call appears in approval inbox
```

Implementation: Same as Tier 2 with `approvalThresholdMicrodollars = 0`.
Could be a separate policy value for clarity, or just Tier 2 with threshold
set to zero. Separate value is clearer for the UI.

### 4.5 Tier 4: Webhook (Future)

```
Policy value:    "webhook"
Behavior:        Proxy calls customer's endpoint with request context.
                 Customer responds: approve, deny, or modify.
Budget enforced: Yes (budget check happens before webhook call)
Agent changes:   Must handle 202 response if webhook returns "hold"
Use case:        "I want my own logic to decide per-call"
Dashboard:       Webhook configuration + audit log of decisions
```

New schema fields on `budgets`:
- `webhookUrl` — customer's policy decision endpoint
- `webhookTimeoutMs` — max time to wait for response (default: 5000)

This is the Marqeta JIT authorization pattern adapted for LLM calls. The
webhook receives:

```json
{
  "type": "authorization_request",
  "agent_id": "research-agent",
  "model": "gpt-4o",
  "estimated_cost_microdollars": 152000,
  "budget_remaining_microdollars": 4653000,
  "session_total_microdollars": 347000,
  "api_key_id": "key-abc",
  "timestamp": "2026-03-10T22:14:33Z"
}
```

Customer responds with:

```json
{ "decision": "approve" }
// or
{ "decision": "deny", "reason": "Outside business hours" }
// or
{ "decision": "modify", "override_model": "gpt-4o-mini" }
```

**Deferred to post-launch.** Requires webhook infrastructure, retry logic,
timeout handling, and signature verification. High value but not v1.

---

## 5. Schema Changes

### 5.1 Budgets Table

```sql
-- Existing columns (unchanged)
policy              text NOT NULL DEFAULT 'strict_block'

-- New columns
approval_threshold  bigint       -- microdollars; used by "approve_above"
webhook_url         text         -- used by "webhook" policy (future)
webhook_timeout_ms  integer      -- default 5000 (future)
```

The `policy` column accepts: `observe`, `strict_block`, `approve_above`,
`approve_all`, `webhook`.

### 5.2 Actions Table

No schema changes needed. The existing `actions` table already supports
everything the HOLD flow needs:

- `actionType`: add `"llm_call"` to ACTION_TYPES
- `payloadJson`: stores the sanitized request body
- `metadataJson`: stores estimated cost, model, attribution
- `status`: uses existing lifecycle (pending → approved/rejected → ...)

### 5.3 Cost Events Table

No changes needed. The `actionId` column from Phase 3B already links cost
events to actions. When a held request is approved and re-submitted with
the approval token, the proxy sets `actionId` automatically.

### 5.4 Drizzle Schema

```typescript
// packages/db/src/schema.ts

export const BUDGET_POLICIES = [
  "observe",
  "strict_block",
  "approve_above",
  "approve_all",
  "webhook",
] as const;

export type BudgetPolicy = (typeof BUDGET_POLICIES)[number];

// Add to ACTION_TYPES
export const ACTION_TYPES = [
  "send_email",
  "http_post",
  "http_delete",
  "shell_command",
  "db_write",
  "file_write",
  "file_delete",
  "llm_call",       // ← new
] as const;

// Add to budgets table
export const budgets = pgTable("budgets", {
  // ... existing columns ...
  policy: text("policy").$type<BudgetPolicy>().notNull().default("strict_block"),
  approvalThreshold: bigint("approval_threshold", { mode: "number" }),
  webhookUrl: text("webhook_url"),
  webhookTimeoutMs: integer("webhook_timeout_ms"),
  // ...
});
```

---

## 6. Proxy Changes

### 6.1 Policy Decision Point

New module: `apps/proxy/src/lib/policy.ts`

```typescript
export type PolicyDecision =
  | { action: "pass" }
  | { action: "block"; reason: string; remaining: number; estimated: number }
  | { action: "hold"; reason: string; estimated: number };

export function evaluatePolicy(
  policy: BudgetPolicy,
  estimatedCost: number,
  budgetRemaining: number,
  approvalThreshold: number | null,
): PolicyDecision {
  // Budget exhausted — always block regardless of policy
  if (policy !== "observe" && estimatedCost > budgetRemaining) {
    return {
      action: "block",
      reason: "budget_exceeded",
      remaining: budgetRemaining,
      estimated: estimatedCost,
    };
  }

  switch (policy) {
    case "observe":
      return { action: "pass" };

    case "strict_block":
      return { action: "pass" };
      // Budget check already happened above; if we reach here, under budget

    case "approve_above":
      if (approvalThreshold !== null && estimatedCost >= approvalThreshold) {
        return {
          action: "hold",
          reason: "estimated_cost_above_threshold",
          estimated: estimatedCost,
        };
      }
      return { action: "pass" };

    case "approve_all":
      return {
        action: "hold",
        reason: "policy_requires_approval",
        estimated: estimatedCost,
      };

    case "webhook":
      // Future: call webhook URL, await response
      return { action: "pass" }; // fallback until implemented

    default:
      return { action: "pass" };
  }
}
```

### 6.2 Integration into openai.ts

The policy check slots into the existing flow between budget lookup and
request forwarding:

```
Current flow:
  auth → model check → budget lookup → check-and-reserve → forward → log

Unified flow:
  auth → model check → estimate cost → budget lookup → POLICY CHECK
    → pass:  check-and-reserve → forward → log
    → block: return 429
    → hold:  create action → return 202
```

The key change is that `evaluatePolicy()` is called BEFORE `checkAndReserve()`.
If the policy says HOLD, we skip the reservation and forward entirely.

### 6.3 Approval Token Validation

When a re-submitted request includes `x-nullspend-approval`:

```typescript
const approvalToken = request.headers.get("x-nullspend-approval");
if (approvalToken) {
  // Validate: action exists, status = "approved", belongs to this user
  // Skip policy check (already approved)
  // Set actionId for cost correlation
  // Proceed to check-and-reserve → forward → log
}
```

This is a lightweight check — one DB read to validate the action status.

---

## 7. Dashboard Changes

### 7.1 Budget Creation/Edit

The budget creation dialog gains a policy selector:

```
┌─────────────────────────────────────────┐
│  Create Budget                          │
│                                         │
│  Entity:     [API Key: prod-key-1  ▼]  │
│  Limit:      [$50.00              ]     │
│  Interval:   [Monthly             ▼]   │
│                                         │
│  Policy:     [Strict Block        ▼]   │
│              ┌─────────────────────┐    │
│              │ Observe             │    │
│              │ Strict Block ✓     │    │
│              │ Approve Above...   │    │
│              │ Approve All        │    │
│              └─────────────────────┘    │
│                                         │
│  ┌─── Only shown for "Approve Above" ──┐│
│  │  Approval threshold: [$0.50       ] ││
│  │  Calls above this amount require   ││
│  │  human approval before executing.  ││
│  └──────────────────────────────────────┘│
│                                         │
│  [Cancel]                    [Create]   │
└─────────────────────────────────────────┘
```

### 7.2 Inbox

The Inbox already displays pending actions. With policy-triggered actions,
LLM call actions appear alongside SDK-originated actions. The UI
distinguishes them by `actionType`:

- `send_email`, `http_post`, etc. → "Agent wants to send an email"
- `llm_call` → "Agent wants to call gpt-4o (est. $0.75)"

The payload viewer shows: model, estimated cost, message count (not full
prompt content — that stays in the agent's memory, not our DB).

### 7.3 Budgets Page

The budgets page shows the active policy for each budget:

```
┌──────────────────────────────────────────────────────┐
│  prod-key-1                                          │
│  ████████████░░░░░░░░  $34.20 / $50.00  (68%)       │
│  Policy: Approve above $0.50  ·  Monthly  ·  18d    │
│  3 calls held for approval this period               │
└──────────────────────────────────────────────────────┘
```

---

## 8. Developer Experience by Tier

### Tier 0-1: Zero Code Changes

```bash
# .env
OPENAI_BASE_URL=https://proxy.nullspend.com/v1
```

The agent's existing OpenAI SDK calls work identically. Budget enforcement
is transparent — a 429 is a standard HTTP error that any well-written agent
already handles with retry logic or error reporting.

**This is the experience for the vast majority of users.**

### Tier 2-3: Handle 202 (Two Options)

**Option A: SDK helper (recommended)**

```typescript
import { withApproval } from "@nullspend/sdk";

const safeFetch = withApproval(fetch, { apiKey: "ask_..." });

// Drop-in replacement for fetch — handles 202 transparently
const response = await safeFetch(proxyUrl + "/v1/chat/completions", {
  method: "POST",
  body: JSON.stringify({ model: "gpt-4o", messages }),
});
```

**Option B: Manual handling**

```typescript
const response = await fetch(proxyUrl + "/v1/chat/completions", { ... });

if (response.status === 202) {
  const { action_id } = await response.json();
  // Poll, wait, re-submit — developer's choice
}
```

**Option C: OpenAI SDK with custom fetch (cleanest)**

```typescript
import OpenAI from "openai";
import { withApproval } from "@nullspend/sdk";

const client = new OpenAI({
  baseURL: "https://proxy.nullspend.com/v1",
  fetch: withApproval(fetch, { apiKey: "ask_..." }),
});

// Completely standard OpenAI SDK usage
const completion = await client.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Hello" }],
});
```

### Tier 4: Webhook (Future)

No agent-side changes beyond Tier 2-3. The webhook is configured in the
dashboard. The proxy calls it server-side — the agent never knows about
the webhook.

---

## 9. Competitive Analysis

| Capability | Helicone | LiteLLM | Portkey | BudgetGuard | **NullSpend** |
|---|---|---|---|---|---|
| Cost tracking | Yes | Yes | Yes | Yes | **Yes** |
| Hard budget cap | No | Yes (buggy) | Enterprise | Yes | **Yes** |
| Rate limiting | Yes | Yes | Enterprise | Yes | Future |
| Model routing | No | Yes | Yes | Yes | Future |
| OPA/Rego policies | No | No | No | Yes | Future (Tier 4) |
| **Approval gating** | No | No | No | No | **Yes (unique)** |
| **Cost-based approval** | No | No | No | No | **Yes (Tier 2)** |
| **Human-in-the-loop** | No | No | No | No | **Yes** |

**NullSpend's unique position:** The only platform that offers human-in-the-loop
approval at the proxy level. Every competitor treats the proxy as a pass/block
gate. NullSpend adds a third option: hold for human decision. This is the
Marqeta model applied to LLM calls.

---

## 10. Implementation Sequence

### Phase A: Policy Infrastructure (schema + PDP)

Estimated effort: 1-2 days

- Add `BUDGET_POLICIES` type and `approvalThreshold` column to schema
- Add `"llm_call"` to `ACTION_TYPES`
- Create `evaluatePolicy()` function
- Integrate into proxy flow (between budget lookup and check-and-reserve)
- Add policy selector to budget create/edit dialog
- `pnpm db:push`

**Acceptance criteria:**
- `observe` policy logs costs but never blocks
- `strict_block` works exactly as before (no regression)
- `approve_above` and `approve_all` return 202 with action details

### Phase B: 202 Response + Re-submission

Estimated effort: 2-3 days

- Define the 202 response schema
- Implement action creation in the proxy for HOLD decisions
- Implement `x-nullspend-approval` header validation on re-submission
- Auto-link cost events to the action via `actionId`
- Update Inbox to display `llm_call` actions with estimated cost

**Acceptance criteria:**
- A request to a proxy with `approve_above` policy triggers 202
- The action appears in the Dashboard Inbox
- Approving the action allows re-submission with the approval token
- The re-submitted request is forwarded to the provider
- Cost events are linked to the action

### Phase C: SDK Helper

Estimated effort: 1 day

- Implement `withApproval(fetch, options)` in `@nullspend/sdk`
- Handles 202 → poll → re-submit transparently
- Works as a drop-in for OpenAI SDK's custom `fetch` option
- Add examples and tests

**Acceptance criteria:**
- `withApproval(fetch)` handles the 202 flow without developer intervention
- Works with the OpenAI Node.js SDK's `fetch` option
- Backwards-compatible (does nothing for 200 responses)

### Phase D: Webhook Policy (Post-launch)

Estimated effort: 3-5 days

- Add `webhookUrl` and `webhookTimeoutMs` to budgets schema
- Implement webhook caller in proxy with timeout, retry, signature verification
- Dashboard UI for configuring webhook URL
- Webhook event schema and documentation

---

## 11. The Async Problem: Why Not Hold the Connection?

The proxy runs on Cloudflare Workers. Workers have a ~30 second request
timeout. Human approval can take minutes. This rules out holding the HTTP
connection open while waiting for approval.

**Alternatives considered:**

| Approach | Pros | Cons | Verdict |
|---|---|---|---|
| Hold connection (sync) | Transparent to agent | 30s CF timeout; impractical | Rejected |
| Durable Objects + WebSocket | Transparent; no timeout | Duration charges; complex; requires WS upgrade | Deferred |
| Return 202 + poll (async) | Simple; works with CF Workers; matches SDK pattern | Agent must handle 202 | **Chosen** |

The 202 approach is consistent with how the SDK already works (`proposeAndWait`
polls until approval). The `withApproval` SDK helper makes this transparent
for developers who want it.

**Future option:** If demand exists for truly transparent approval (no agent
code changes), Cloudflare Durable Objects with WebSocket hibernation could
hold the connection. The DO would wake when the action is approved, forward
the request, and stream the response back over the WebSocket. This adds cost
(DO duration charges) and complexity, but eliminates the need for 202 handling.
Track as a future enhancement based on user demand.

---

## 12. Security Considerations

### Approval Token Validation

The `x-nullspend-approval` header contains an action ID. The proxy validates:

1. Action exists in the database
2. Action status is `approved`
3. Action `ownerUserId` matches the authenticated user
4. Action `actionType` is `llm_call`
5. Action was created within a reasonable time window (prevents stale approvals)

This prevents:
- Replay attacks (action can only be used once — status transitions to executing)
- Cross-user attacks (ownership check)
- Type confusion (must be an llm_call action)

### Payload Privacy

When the proxy creates an action for HOLD, the payload stored in the `actions`
table does NOT include the full prompt content. It stores:

- Model name
- Estimated cost
- Message count
- Max tokens requested

The full prompt stays in the agent's memory and is re-submitted with the
approval token. This avoids storing sensitive prompt content in the database.

---

## 13. What Does NOT Change

- The LLM proxy's core flow (auth → forward → log) is unchanged for Tier 0-1
- The SDK's `proposeAndWait` API is unchanged — it still works for risky actions
- The MCP proxy is unchanged (separate concern, tracked in finops roadmap Phase 4)
- Budget enforcement via Redis Lua scripts is unchanged
- Cost calculation and logging is unchanged
- Dashboard auth, navigation, and component library are unchanged

---

## 14. Relationship to Existing Roadmap

```
finops-pivot-roadmap.md phases:

Phase 0: Foundation            ✓ Complete
Phase 1: OpenAI Proxy          ✓ Complete
Phase 2: Budget Enforcement    ✓ Complete
Phase 3: Anthropic Provider    Not started (independent)
Phase 4: MCP Tool Cost Proxy   Not started (independent)
Phase 5: Dashboard & API       Phases 3A-3B complete, 3C-3D pending

This spec (Policy Engine):
  → Slots in as Phase 5B or Phase 6 (after dashboard is solid)
  → Phase A (schema + PDP) can start anytime
  → Phase B (202 flow) depends on Phase A
  → Phase C (SDK helper) depends on Phase B
  → Phase D (webhook) is post-launch
```

The policy engine is the bridge between the "FinOps proxy" identity and the
"approval layer" identity. It doesn't replace either — it unifies them under
a single decision framework that the developer controls via a dashboard
dropdown.
