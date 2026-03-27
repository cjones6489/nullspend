# Agent Wallet Strategy: Financial Awareness API for Autonomous Agents

**Date:** 2026-03-26
**Status:** Strategy — ready for architecture planning
**Related research:**
- `research/agent-wallet-implementations-technical-deep-dive.md` — technical analysis of Skyfire, Payman, Coinbase, Crossmint, Stripe Issuing, agent framework patterns
- `research/agent-financial-infrastructure-landscape-2026.md` — competitive landscape, market sizing, developer sentiment, white space analysis
- `vision-agent-financial-infrastructure.md` — long-term vision (7 primitives)
- `stripe-spt-integration-strategy.md` — Stripe SPT integration plan (blocked on partnership)

---

## The Insight

The white space isn't "agents holding money." It's **"agents understanding their financial context."**

Every agent framework — LangChain, Claude Agent SDK, OpenAI Agents SDK, CrewAI — has the same gap: no built-in financial awareness. They can track cost after the fact, but no agent can answer "can I afford this?" before acting. There's no `max_budget` parameter. No abort-on-budget-exceeded. No way for the agent itself to make financially-aware decisions.

NullSpend already enforces budgets at the proxy layer — the agent gets a 429 when it's out of budget. But the agent doesn't *know* it's running low. It doesn't know it has $12 left and should switch to a cheaper model. It doesn't know this next tool call will cost $3 and push it over.

**The wallet isn't a bank account. It's a financial awareness API for agents.**

---

## Market Evidence

### The Gap Is Real

- **57% of surveyed professionals already have agents in production** (LangChain survey, 1,340 respondents)
- **Production agent costs: $3,200-$13,000/month** per company
- **Documented $47K runaway bill** from an 11-day agent loop (LangChain incident)
- **Zero agent frameworks have built-in budget enforcement** — all do tracking only
- AgentBudget (open-source): only 1,300 PyPI installs, client-side only, has race conditions
- Cycles SDK: best pattern found (`@cycles` decorator with reserve-commit), but client-side library, not infrastructure

### What Developers Do Today

No framework has built-in financial controls:

| Framework | Cost Tracking | Budget Enforcement |
|---|---|---|
| LangChain | `OpenAICallbackHandler` (tracking) | No `max_budget` parameter |
| Claude Agent SDK | `total_cost_usd` reporting | No abort-on-budget-exceeded |
| OpenAI Agents SDK | Guardrails API | Write your own budget check |
| CrewAI | Token budget concepts | Cooperative only, no enforcement |
| Devin | Per-task spend visibility | Hard limit exists, no pre-execution estimate |
| Manus/Replit | Credit systems | No hard caps on individual tasks |

**Common hacks:** Environment variable budget limits. Custom middleware that counts tokens. Manual monitoring and killing processes. None of these are infrastructure-level, concurrent-safe, or cross-provider.

### $150M+ Invested in Agent Payments, ~$0 in Agent Cost Governance

The market is funding agents *spending* money (Skyfire, Crossmint, Coinbase, Stripe SPTs). Nobody is funding agents *understanding* their financial position. The cost governance layer is dramatically underbuilt.

---

## Competitive Positioning

| | LLM Cost Enforcement | Agent Financial Awareness | Commerce/Payments |
|---|---|---|---|
| **NullSpend** | **Yes** (proxy, real-time, atomic) | **The build** | Future (Stripe SPTs) |
| **LiteLLM/Portkey** | Tracking only, no real-time enforcement | No | No |
| **Helicone/Langfuse** | Tracking only | No | No |
| **Skyfire** | No | Wallet balance API | Yes (crypto) |
| **Crossmint** | No | Card limit checks | Yes (virtual cards) |
| **AgentBudget** | Client-side, race conditions | Basic balance check | No |
| **Cycles SDK** | Client-side decorator | Reserve-commit pattern | No |

**NullSpend's unique position:** The only platform with infrastructure-level LLM cost enforcement (Durable Objects, reserve-execute-commit) that can also expose an agent-facing financial awareness API. The enforcement already works. The missing piece is the agent-facing interface.

---

## What to Build

### The Core API: Three Endpoints

The wallet is a view into the existing budget system with an agent-facing API. No new money flow, no Stripe funding, no regulatory complexity.

#### 1. `GET /v1/wallet/balance`

The agent checks its financial position.

**Request:**
```
GET /v1/wallet/balance
Headers:
  X-NullSpend-Key: ns_key_xxx
  X-NullSpend-Session: session_abc  (optional — for session-scoped balance)
```

**Response:**
```json
{
  "balances": [
    {
      "entityType": "api_key",
      "entityId": "key_xxx",
      "remaining": 14730,
      "limit": 50000,
      "currency": "usd",
      "resetInterval": "monthly",
      "resetsAt": "2026-04-01T00:00:00Z",
      "burnRate": {
        "last1h": 230,
        "last24h": 4100
      },
      "projectedRunway": {
        "hours": 86,
        "basedOn": "last24h"
      }
    },
    {
      "entityType": "tag",
      "entityId": "env=prod",
      "remaining": 89200,
      "limit": 100000,
      "currency": "usd",
      "resetInterval": "monthly",
      "resetsAt": "2026-04-01T00:00:00Z"
    }
  ],
  "velocity": {
    "currentRate": 230,
    "limit": 50000,
    "windowSeconds": 3600,
    "status": "ok"
  },
  "session": null
}
```

**Why it matters:** The agent can make informed decisions. "I have $147.30 left and 86 hours of runway at current rate. I should use Haiku, not Opus."

#### 2. `POST /v1/wallet/estimate`

The agent asks "what will this cost?" before committing.

**Request:**
```json
{
  "provider": "openai",
  "model": "gpt-4o",
  "estimatedInputTokens": 5000,
  "estimatedOutputTokens": 2000
}
```

Or, for a raw request body:
```json
{
  "provider": "openai",
  "model": "gpt-4o",
  "requestBody": { "messages": [...], "max_tokens": 2000 }
}
```

**Response:**
```json
{
  "estimatedCost": 85,
  "currency": "usd",
  "breakdown": {
    "input": 25,
    "output": 60,
    "cached": 0
  },
  "canAfford": true,
  "remainingAfter": 14645,
  "alternatives": [
    { "model": "gpt-4o-mini", "estimatedCost": 8, "savings": 77 },
    { "model": "claude-haiku-4-5", "estimatedCost": 5, "savings": 80 }
  ]
}
```

**Why it matters:** The agent can optimize. "GPT-4o costs $0.85 for this request. GPT-4o-mini costs $0.08 and saves 91%. The quality difference doesn't matter for this task."

#### 3. `POST /v1/wallet/authorize`

The agent requests pre-authorization for an expensive operation.

**Request:**
```json
{
  "amount": 8500,
  "currency": "usd",
  "description": "Multi-step research task with tool calls",
  "ttlSeconds": 3600
}
```

**Response (approved):**
```json
{
  "status": "authorized",
  "authorizationId": "auth_xxx",
  "reserved": 8500,
  "remainingBalance": 6230,
  "expiresAt": "2026-03-26T17:00:00Z"
}
```

**Response (denied):**
```json
{
  "status": "denied",
  "reason": "insufficient_balance",
  "requested": 8500,
  "available": 3200,
  "suggestion": "Reduce scope or switch to cheaper models. Estimated cost with gpt-4o-mini: 850"
}
```

**Response (needs approval):**
```json
{
  "status": "pending_approval",
  "authorizationId": "auth_xxx",
  "approvalRequired": true,
  "reason": "Amount exceeds auto-approve threshold ($50.00)",
  "pollUrl": "/v1/wallet/authorize/auth_xxx"
}
```

**Why it matters:** The agent can plan expensive operations. "I need to do a 10-step research task that might cost $85. Let me get authorization first instead of hitting a 429 on step 7."

---

### MCP Tools (Phase 2)

Expose the wallet as MCP tools so any MCP-compatible agent gets financial awareness natively. NullSpend's `@nullspend/mcp-server` package already exists — these are new tools on the existing server.

```
Tool: check_budget
  Description: Check your remaining budget and spending rate
  Returns: Available balance, burn rate, projected runway, reset date

Tool: estimate_cost
  Description: Estimate the cost of an LLM call before making it
  Input: provider, model, estimated tokens (or request body)
  Returns: Estimated cost, whether you can afford it, cheaper alternatives

Tool: request_approval
  Description: Request human approval for an expensive operation
  Input: amount, description
  Returns: Approved/denied/pending with reason
```

**Why MCP matters:** The research found that Stripe, CardForAgent, MoonPay, and others are all exposing financial operations as MCP tools. This is the integration surface the market is converging on. An agent using Claude Desktop or Cursor that has the NullSpend MCP server connected automatically gets financial awareness — zero code changes.

### SDK Integration (Phase 3)

Wrappers for popular frameworks that make financial awareness automatic:

```typescript
// Claude Agent SDK — already have @nullspend/claude-agent
const agent = withNullSpend(client, {
  apiKey: "ns_key_xxx",
  budgetAware: true,       // agent receives balance info in system prompt
  fallbackModel: "claude-haiku-4-5",  // auto-switch when budget is low
  warnThreshold: 0.2,      // warn agent when 20% budget remaining
  degradeThreshold: 0.1,   // switch to fallback at 10%
});

// Future: LangChain wrapper
const model = new ChatOpenAI({ ... })
  .withNullSpendBudget({
    warnAt: 0.2,
    degradeAt: 0.1,
    fallback: "gpt-4o-mini",
  });
```

---

## How It Maps to the Existing System

### What's Reused (already in production)

| Existing Primitive | How It's Used |
|---|---|
| Budget enforcement (DO) | Balance/remaining calculation, authorization holds |
| Budget entities | The "wallet" IS the budget — balance = limit - spend |
| Velocity limits | Exposed in `/v1/wallet/balance` response |
| Session limits | Scoped balance check when session header present |
| Cost estimation | Already exists in proxy (`estimateMaxCost`) — exposed via API |
| HITL approvals | Authorization endpoint triggers approval flow for large amounts |
| Cost engine | Model pricing catalog used for `/v1/wallet/estimate` alternatives |
| MCP server | Existing package, add new tools |
| Claude Agent adapter | Existing package, add `budgetAware` option |

### What's New

| Component | Effort | Description |
|---|---|---|
| `/v1/wallet/balance` endpoint | Small | Query budget state for authenticated key. Mostly reads from existing budget tables/DO. |
| `/v1/wallet/estimate` endpoint | Small | Wrap existing cost estimation functions. Add "alternatives" using pricing catalog. |
| `/v1/wallet/authorize` endpoint | Medium | Pre-authorization with reservation. Similar to existing budget check but initiated by agent, not proxy. |
| Burn rate calculation | Small | Aggregate recent cost_events to compute spend rate. |
| MCP tools (3 tools) | Small | Wire wallet endpoints into existing MCP server. |
| SDK `budgetAware` mode | Medium | System prompt injection with balance context. Model fallback logic. |
| Dashboard: wallet view | Medium | Balance overview, burn rate chart, authorization history. |

### Estimated total: ~2 weeks for Phase 1 (API), ~1 week each for Phase 2 (MCP) and Phase 3 (SDK)

---

## Evolution Path

```
Phase 1 (NOW):
  Wallet = agent-facing view of existing budget system
  Balance = budget limit - current spend
  No new money flow. No funding. No regulatory complexity.

Phase 2 (NEXT):
  MCP tools for financial awareness
  SDK wrappers with auto-degradation
  Agent frameworks get NullSpend integration

Phase 3 (WHEN STRIPE ACCESS ARRIVES):
  Wallet funds real purchases via Stripe SPTs
  Company loads balance via Stripe checkout
  Purchase authorization draws from wallet

Phase 4 (LONG-TERM):
  Consolidated API billing (NullSpend resells API credits)
  Agent-to-agent settlement via ledger transfers
  Financial intelligence (ROI, anomaly detection)
  The wallet becomes a real treasury
```

Each phase is independently valuable. Phase 1 ships value immediately — agents become financially aware. Each subsequent phase adds a new capability without requiring the previous phases to change.

---

## The Positioning

**What we say:** "Give your agents financial awareness. Three API calls — check balance, estimate cost, get authorization. Works with any framework."

**What it means for the developer:** Instead of agents blindly making API calls until they hit a 429, agents can check their balance, estimate costs, choose the right model, and request approval for expensive operations. Same NullSpend proxy, same budgets — now the agent is in the loop.

**What it means for the company:** Agents that self-optimize for cost. Fewer surprise bills. Graceful degradation instead of hard failures. Complete audit trail of financial decisions.

**What it means for the market:** NullSpend is the financial awareness layer for autonomous agents. Not just enforcement (blocking after the fact) but awareness (informing before the action).

---

## Key Decisions (To Be Made)

1. **Balance source:** Is the wallet balance derived from budgets (limit - spend) or is it a separate funded balance? Phase 1 uses budgets. Future phases may add real funding.

2. **Authorization holds:** Should `/v1/wallet/authorize` create a reservation in the DO (same as the proxy's budget check), or is it advisory-only? If it creates a reservation, the agent's authorization and the proxy's budget check need to coordinate.

3. **Estimate accuracy:** How accurate do estimates need to be? The proxy's existing `estimateMaxCost` is a worst-case estimate. Should the wallet API also offer a "likely" estimate based on historical averages?

4. **Alternatives engine:** How sophisticated should the "cheaper alternatives" suggestion be? Simple (same provider, smaller model) vs. smart (cross-provider, quality-aware)?

5. **MCP tool granularity:** Three tools (check_budget, estimate_cost, request_approval) or one composite tool (financial_advisor) that the agent can query conversationally?

6. **SDK auto-degradation:** When the SDK switches to a cheaper model, should it inform the agent (system prompt update) or silently swap? Transparency is better for debugging but adds complexity.
