# Deep Technical Research Document

## Topic

**Claude Agent SDK Adapter for NullSpend (`@nullspend/claude-agent`)**

NullSpend needs a way for developers using the Claude Agent SDK to route their agent's LLM calls through NullSpend's proxy for cost tracking and budget enforcement. This is the #1 integration play — Claude's market position makes it the highest-value onboarding path.

The adapter must be trivially simple to use, survive SDK version changes, and provide real-time budget enforcement without wrapping or monkey-patching the Agent SDK.

## Executive Summary

**The Claude Agent SDK spawns a subprocess.** This is the critical architectural finding that reshapes every design decision. The SDK runs the Claude Code CLI as a child process — you cannot inject a custom HTTP client, wrap API calls, or monkey-patch internals. The only integration points are:

1. **`ANTHROPIC_BASE_URL` env var** — routes all LLM API calls through a proxy
2. **`ANTHROPIC_CUSTOM_HEADERS` env var** — injects custom headers into outbound requests (needs validation)
3. **Hooks** — `PreToolUse`/`PostToolUse` fire around tool execution (not LLM calls)
4. **`ResultMessage.total_cost_usd`** — cumulative cost per `query()` call

**Recommended approach:** A config-transformer function (`withNullSpend()`) that merges NullSpend env vars into the SDK's `Options` object. ~50 lines of code, one function, one interface. No wrapping, no class inheritance, no monkey-patching.

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";
import { withNullSpend } from "@nullspend/claude-agent";

for await (const message of query({
  prompt: "Fix the auth module",
  options: withNullSpend({ apiKey: "ns_live_sk_..." }),
})) {
  if (message.type === "result") console.log(`Cost: $${message.total_cost_usd}`);
}
```

**Two critical blockers must be validated before building:**
1. Does `ANTHROPIC_CUSTOM_HEADERS` actually inject headers into CLI subprocess requests? (Enables `x-nullspend-key` auth without proxy-side changes)
2. Does the CLI retry NullSpend's budget `429` responses or surface them as errors? (Determines if budget enforcement is safe in agent loops)

**Competitive position:** Every competitor (LiteLLM, Portkey, Helicone) uses the same `ANTHROPIC_BASE_URL` pattern because it's the only integration point. NullSpend's differentiator is real-time budget enforcement (pre-request blocking) — no competitor does this for agent SDKs.

## Research Method

Seven specialized agents conducted parallel research:

1. **Documentation Research** — Claude Agent SDK APIs (TS + Python), subprocess architecture, hooks, cost tracking, `ANTHROPIC_BASE_URL` behavior, Anthropic Messages API usage reporting
2. **Competitive / Platform Patterns** — LiteLLM, Portkey, Helicone, Langfuse, Braintrust, OpenAI Agents SDK, Vercel AI SDK, AgentBudget integration approaches
3. **Open Source / Repo Research** — Claude Agent SDK repos (TS: 989 stars, Python: 5,600 stars), AgentBudget, TokenCost, Laminar, proxy integration examples
4. **Architecture** — Five options compared (base URL, thin wrapper, client wrapper, callbacks, hybrid), compound key schemes, key relay patterns
5. **DX / Product Experience** — Config-transformer pattern, naming, error handling, competitive LoC comparison, TypeScript vs Python priority
6. **Frontier / Emerging Patterns** — AgentBudget.dev, SatGate/L402, TrueFoundry Agent Gateway, Stripe ACP, MCP cost semantics, Agent Contracts paper, Coinbase agent wallets
7. **Risk / Failure Modes** — 25 risks across version coupling, proxy compatibility, mid-loop budget denial, session propagation, cost accuracy, distribution, fail-open/closed

---

## Official Documentation Findings

### Claude Agent SDK Architecture

The SDK is a **wrapper around the Claude Code CLI binary**. Both the TypeScript (`@anthropic-ai/claude-agent-sdk`, v0.2.80) and Python (`claude-agent-sdk`) packages bundle the CLI. The SDK communicates with the subprocess via JSON-over-stdio.

This means:
- The agent loop (LLM call → tool execution → LLM call → ...) runs inside the CLI process, opaque to application code
- You cannot directly intercept API calls, inject a custom Anthropic client, or wrap the HTTP transport
- The only way to redirect API traffic is via `ANTHROPIC_BASE_URL` environment variable

### Cost Tracking: `total_cost_usd`

Available on `SDKResultMessage` (TypeScript) / `ResultMessage` (Python) — the last message from every `query()` call:

```typescript
{
  type: "result";
  subtype: "success";
  total_cost_usd: number;
  usage: { input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens };
  modelUsage: { [modelName: string]: { costUSD, inputTokens, outputTokens, ... } };
  duration_ms: number;
  num_turns: number;
  session_id: string;
}
```

Key behaviors:
- Cumulative within a single `query()` call only — no cross-session accumulation
- Computed inside the CLI process (not injectable/configurable)
- TypeScript has per-model breakdown via `modelUsage`; Python only has cumulative totals
- Built-in `maxBudgetUsd` option enforced internally by CLI (per-query only)

### Hooks System

Six hook events: `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `Stop`, `SessionStart`, `SessionEnd`, `SubagentStart`, `SubagentStop`, `Notification`, `UserPromptSubmit`.

**Critical limitation:** Hooks fire around **tool execution**, NOT around LLM API calls. There is no `onLLMCall` or `onLLMResponse` hook. Budget enforcement via hooks can only block tool usage, not the LLM inference itself.

### `ANTHROPIC_BASE_URL`

Documented, stable env var. Routes **sampling requests only** (LLM calls) through the specified URL. Other traffic (MCP servers, tool HTTP calls, telemetry) goes direct. Passed via the SDK's `env` option:

```typescript
query({ prompt: "...", options: { env: { ANTHROPIC_BASE_URL: "https://proxy.nullspend.com" } } })
```

**Known issue:** GitHub issue #144 reports this stopped working via the `env` option in SDK v0.2.8+. May need to set at process level instead. Must validate.

### `ANTHROPIC_CUSTOM_HEADERS`

The DX agent found this env var as a potential mechanism to inject `x-nullspend-key` and other headers. **Must be validated empirically** — if it works, it solves the header injection problem without any proxy-side changes.

---

## Modern Platform and Ecosystem Patterns

### Competitive Integration Approaches

| Platform | Approach | LoC | Cost Tracking | Budget Enforcement |
|---|---|---|---|---|
| **LiteLLM** | `ANTHROPIC_BASE_URL` env var | 3 | Yes (100+ models) | Yes (per-key/team) |
| **Portkey** | `ANTHROPIC_BASE_URL` + custom headers | 12 | Yes | Yes (dashboard) |
| **Helicone** | `ANTHROPIC_BASE_URL` + `Helicone-Auth` | 5 | Yes | No |
| **Langfuse** | OTel instrumentation (4 packages) | 8 | Yes (post-hoc) | No |
| **AgentBudget** | Monkey-patching (`init("$5.00")`) | 2 | Yes (USD) | Yes (hard limit) |
| **NullSpend** | `withNullSpend()` config transformer | **3** | Yes (per-request) | **Yes (real-time)** |

### Key Insight

Every competitor uses the same underlying mechanism (`ANTHROPIC_BASE_URL`) because that's the only integration point. The differentiation is in what sits behind the proxy URL. NullSpend's differentiator is **pre-request budget enforcement** — the proxy checks budgets before forwarding, blocking requests that would exceed limits. No competitor does this for agent SDKs.

### AgentBudget — Closest Competitor

AgentBudget (`agentbudget.dev`, 32 GitHub stars) provides in-process budget enforcement via monkey-patching. Two-line integration: `agentbudget.init("$5.00")`. Three-tier protection: soft limit warning, hard limit exception, loop detection.

**Fundamental limitations vs NullSpend:**
- In-process only — no distributed/cross-process budgets
- Cannot work with Claude Agent SDK (API calls happen in subprocess)
- No dashboard, no webhooks, no HITL approval
- Python only, no TypeScript
- No per-entity budgets (org/project/key)

AgentBudget validates the market exists but can't scale. NullSpend is the infrastructure-grade version.

### OpenAI Agents SDK — Future Opportunity

The OpenAI Agents SDK has `RunHooks` with `on_llm_start`/`on_llm_end` hooks — much better extension points than Claude's tool-only hooks. A `@nullspend/openai-agents` adapter implementing `RunHooks` would be the cleanest integration. Deferred until after the Claude adapter ships.

### Vercel AI SDK — `wrapLanguageModel` Pattern

The Vercel AI SDK's middleware pattern (`wrapLanguageModel`) is the gold standard for TypeScript model wrapping. A `withNullSpend(model)` wrapper is achievable and would be provider-agnostic. Deferred — different integration surface from the Agent SDK.

---

## Relevant Repos, Libraries, and Technical References

### Claude Agent SDK

| Property | TypeScript | Python |
|---|---|---|
| Repo | `anthropics/claude-agent-sdk-typescript` | `anthropics/claude-agent-sdk-python` |
| Stars | ~989 | ~5,600 |
| Latest version | v0.2.80 (Mar 19, 2026) | 0.1.x |
| Releases | 65 | Many (374 commits) |
| npm/PyPI | `@anthropic-ai/claude-agent-sdk` | `claude-agent-sdk` |

### Laminar (YC S24)

Proves the `ANTHROPIC_BASE_URL` proxy pattern works with Claude Agent SDK in production. Their lightweight Rust proxy (<1.5MB) intercepts API calls, captures prompts/tools/latency, re-streams tokens back to the CLI subprocess with negligible overhead. Observability only (no budget enforcement).

### NullSpend's Existing Packages

- `@nullspend/sdk` (`packages/sdk/`) — `NullSpend` client with `reportCost()`, `checkBudget()`, `proposeAndWait()` HITL flow
- `@nullspend/mcp-server` (`packages/mcp-server/`) — MCP tools for `propose_action` and `check_action`
- `@nullspend/mcp-proxy` (`packages/mcp-proxy/`) — MCP proxy with tool-call-level gating + cost tracking

---

## Architecture Options

### Option A: Base URL Only (Zero-Package)

Set `ANTHROPIC_BASE_URL` env var. No adapter package needed.

- **Lines to integrate:** 2 env vars
- **Budget enforcement:** Blocked — CLI can't send `x-nullspend-key` header, proxy returns 401
- **Survives SDK changes:** Excellent
- **Verdict:** Foundation layer, but unusable alone without solving auth

### Option B: Thin Wrapper (Wrap `query()`)

Wrap the SDK's `query()` async generator to capture `ResultMessage.total_cost_usd`.

- **Lines to integrate:** 5-8
- **Budget enforcement:** Blocked — same header injection problem
- **Survives SDK changes:** Fragile — depends on `ResultMessage` shape and `query()` return type
- **Verdict:** Adds value for cost aggregation but can't solve enforcement alone

### Option C: Client Wrapper (Wrap Anthropic Client)

**Eliminated.** The Claude Agent SDK does NOT accept an injected Anthropic client. The CLI manages its own client internally.

### Option D: Callback/Hook-Based

Register `PreToolUse`/`PostToolUse` hooks for cost tracking and tool-level budget enforcement.

- **Lines to integrate:** 10
- **Budget enforcement:** Tool-level only (not LLM calls)
- **Survives SDK changes:** Poor — hook API is new and evolving
- **Verdict:** Complementary to proxy-based enforcement, not a replacement

### Option E: Config Transformer (Recommended)

`withNullSpend()` merges NullSpend env vars into SDK options. Sets `ANTHROPIC_BASE_URL`, `ANTHROPIC_CUSTOM_HEADERS` (for `x-nullspend-key` and context headers), and optionally `ANTHROPIC_AUTH_TOKEN`.

- **Lines to integrate:** 3 (import + one function call)
- **Budget enforcement:** Yes — proxy-level, real-time, per-request
- **Survives SDK changes:** Excellent — relies only on `env` option and env vars, not SDK internals
- **Implementation:** ~50 lines, one function, one interface
- **Verdict:** Best option. Composes cleanly with all SDK features (hooks, subagents, MCP servers).

---

## Recommended Approach for Our Platform

### Ship: Config Transformer (`withNullSpend()`)

```typescript
// @nullspend/claude-agent — entire public API

export function withNullSpend(options: NullSpendAgentOptions & Options): Options;

export interface NullSpendAgentOptions {
  apiKey: string;                    // Required: NullSpend API key
  sessionId?: string;                // Optional: session-level budget tracking
  tags?: Record<string, string>;     // Optional: cost attribution
  traceId?: string;                  // Optional: W3C trace correlation
  actionId?: string;                 // Optional: HITL action correlation
  proxyUrl?: string;                 // Default: "https://proxy.nullspend.com"
}
```

**Implementation:**

```typescript
export function withNullSpend(options: NullSpendAgentOptions & Options): Options {
  const { apiKey, sessionId, tags, traceId, actionId,
          proxyUrl = "https://proxy.nullspend.com", ...sdkOptions } = options;

  const customHeaders: string[] = [`x-nullspend-key: ${apiKey}`];
  if (sessionId) customHeaders.push(`x-nullspend-session: ${sessionId}`);
  if (tags) customHeaders.push(`x-nullspend-tags: ${JSON.stringify(tags)}`);
  if (traceId) customHeaders.push(`x-nullspend-trace-id: ${traceId}`);
  if (actionId) customHeaders.push(`x-nullspend-action-id: ${actionId}`);

  return {
    ...sdkOptions,
    env: {
      ...sdkOptions.env,
      ANTHROPIC_BASE_URL: proxyUrl,
      ANTHROPIC_CUSTOM_HEADERS: customHeaders.join("\n"),
    },
  };
}
```

### Why This Wins

1. **3 lines to integrate** — simplest in the market
2. **Zero wrapping** — pure config transformation, composes with everything
3. **Survives SDK updates** — relies only on `env` option, the most stable API surface
4. **Real-time budget enforcement** — proxy blocks requests before they reach Anthropic
5. **Full NullSpend feature set** — sessions, tags, traces, HITL actions, velocity limits, webhooks
6. **TypeScript first** — matches NullSpend's stack, ~50 LoC, ship in a day

### What NOT to Build

- No class wrapper around `Agent` or `ClaudeSDKClient`
- No monkey-patching of the Anthropic client
- No hook-based budget enforcement (hooks don't fire on LLM calls)
- No Python package yet (defer until customer demand)
- No fail-open mode in v1 (fail-closed is correct for FinOps)

---

## Frontier and Emerging Patterns

### Agent Contracts Paper (January 2026, arXiv:2601.08815)

**What:** Formal framework defining conservation laws for multi-agent budget delegation — aggregate child consumption must not exceed parent allocation. 90% token reduction, zero conservation violations.
**Maturity:** Academic.
**Action:** Design for later. NullSpend's per-key budgets support the basic pattern; hierarchical delegation is a future feature.

### TrueFoundry Agent Gateway — Per-Request Micro-Budget

**What:** Each request carries a budget grant. Gateway deducts as the agent works. At limit, returns 402. Agent stops gracefully.
**Maturity:** Production.
**Action:** Study architecture. NullSpend already has the primitives (session budgets, velocity limits).

### MCP Cost Semantics Gap

**What:** MCP has no concept of "you've spent too much." No budget, quota, or cost primitives in the spec. The 2026 roadmap mentions billing only as a "long-term discussion item."
**Maturity:** Gap, not a pattern.
**Action:** Adopt now — add `check_budget` and `get_spend_summary` MCP tools to `@nullspend/mcp-server`. Enables agent self-regulation.

### Stripe ACP (Agentic Commerce Protocol)

**What:** Open standard for AI agents to make purchases. SharedPaymentToken for credentials, native MCP transport.
**Maturity:** Production (fourth release, brands onboarded).
**Action:** Design for later. Different problem (commerce vs LLM cost), but NullSpend's `eventType: "custom"` could represent ACP transactions for unified cost views.

### AgentBudget.dev — Direct Competitor

**What:** In-process Python budget enforcement via monkey-patching. Sub-budget delegation for multi-agent systems.
**Maturity:** Shipping product, 32 GitHub stars.
**Action:** Study. NullSpend's moat is infrastructure-level enforcement (proxy + dashboard + HITL). AgentBudget can't do server-side enforcement, can't work with Claude Agent SDK's subprocess architecture, has no dashboard.

---

## Opportunities to Build Something Better

### 1. Only Budget Enforcer for Claude Agent SDK

No competitor enforces budgets at the proxy level for Claude Agent SDK. AgentBudget can't (subprocess architecture). LiteLLM/Portkey track costs but enforcement is dashboard-configured, not real-time per-request blocking. NullSpend's proxy checks budget before forwarding — this is structurally unique.

### 2. Typed Config Transformer vs Raw Env Vars

Every competitor requires manual env var construction with string concatenation for headers. `withNullSpend()` provides TypeScript autocomplete, validation, and composition. Eliminates a class of integration bugs (malformed headers, missing auth, wrong URL).

### 3. MCP Budget Query Tools

No agent framework lets agents query their own budget. Adding `check_budget` and `get_spend_summary` to `@nullspend/mcp-server` enables agent self-regulation: "I have $2.30 remaining, I'll use a cheaper model." This is genuinely novel.

### 4. Pre-Flight Cost Estimation

NullSpend's proxy already does `estimateMaxCost` before forwarding requests — no competitor does pre-flight estimation. The adapter could expose this: "This agent run is estimated to cost $3.40, your remaining budget is $5.00."

---

## Risks, Gaps, and Edge Cases

### Critical Blockers (Must Validate Before Building)

| # | Risk | Severity | Validation |
|---|---|---|---|
| 1 | `ANTHROPIC_CUSTOM_HEADERS` env var — does it work? | **Critical** | Test empirically: set the env var, check if CLI subprocess sends the custom headers to the proxy |
| 2 | CLI retry behavior on budget `429` | **Critical** | Test: configure $0.01 budget, run agent, observe if CLI retries the 429 or surfaces the error |
| 3 | `env` option bug (GitHub #144) — does `ANTHROPIC_BASE_URL` via `env` work in v0.2.80? | **High** | Test: pass via `options.env`, verify proxy receives requests |

### High Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 4 | Pre-1.0 SDK with no semver guarantee — `ResultMessage` shape could change | High | Runtime type validation, wide peer dep range, integration tests |
| 5 | Dual cost calculation divergence (SDK vs proxy) | High | NullSpend proxy is authoritative; SDK `total_cost_usd` is advisory only |
| 6 | Agent loops trigger velocity limits (rapid sequential LLM calls) | High | Document agent-specific velocity profiles; allow `source=agent-sdk` tag for different rate policies |
| 7 | Mid-loop budget denial — sunk cost on partially completed agent runs | High | Document that budget enforcement may stop agents mid-task; offer `checkBudget()` pre-flight check |
| 8 | Proxy downtime = total agent downtime (fail-closed) | High | Invest in proxy reliability; no fail-open in v1 |

### Medium Risks

| # | Risk | Severity |
|---|---|---|
| 9 | No session/trace correlation if custom headers don't work | Medium |
| 10 | 1MB proxy body limit may be too small for large-context agents | Medium |
| 11 | CLI may call endpoints proxy doesn't support (404) | Medium |
| 12 | Peer dependency version conflicts with rapid SDK releases | Medium |
| 13 | Python adapter maintenance doubles surface area | Medium |

---

## Recommended Technical Direction

### Design Pattern
Config transformer — pure function that merges NullSpend env vars into SDK options.

### Architecture
```
Developer code → withNullSpend({ apiKey, sessionId, tags })
    ↓ (merges env vars into Options)
Claude Agent SDK → query({ prompt, options })
    ↓ (spawns CLI subprocess with env vars)
Claude Code CLI → ANTHROPIC_BASE_URL + ANTHROPIC_CUSTOM_HEADERS
    ↓ (sends x-nullspend-key via custom header)
NullSpend Proxy → auth, budget check, cost tracking, forward to Anthropic
    ↓
Anthropic API → response streamed back through proxy → CLI → SDK → developer
```

### What to Do Now
1. **Validate blockers** — test `ANTHROPIC_CUSTOM_HEADERS`, `env` option, and 429 behavior
2. **Build `@nullspend/claude-agent`** — ~50 LoC, one function, one interface, TypeScript only
3. **Add `check_budget` MCP tool** — enables agent self-regulation
4. **Write integration smoke test** — real proxy, real SDK, real budget, verify enforcement

### What to Defer
- Python adapter (wait for customer demand)
- Hook-based cost reporting (hooks don't fire on LLM calls)
- `withNullSpend(model)` for Vercel AI SDK (different integration surface)
- OpenAI Agents SDK adapter (wait for them to add hooks)
- Fail-open mode
- Agent-to-agent budget delegation

### What to Avoid
- Wrapping the Agent or `query()` function
- Monkey-patching the Anthropic client
- Building a Python package before TypeScript is validated
- Key escrow (storing user's Anthropic key server-side)
- Compound key schemes (fragile parsing, security risks)

---

## Open Questions

1. **Does `ANTHROPIC_CUSTOM_HEADERS` work?** This is the #1 blocker. If it doesn't, we need a proxy-side auth fallback (composite token or path-based key extraction).

2. **Does `env` option work in SDK v0.2.80?** GitHub issue #144 suggests it broke in v0.2.8+. If broken, users must set `process.env.ANTHROPIC_BASE_URL` directly.

3. **How does the CLI handle non-Anthropic 429 responses?** Does it retry with backoff (treating it as a rate limit) or surface the error? This determines if budget enforcement is safe or dangerous in agent loops.

4. **Should `withNullSpend()` also set `maxBudgetUsd`?** The SDK's built-in budget cap could serve as a client-side safety net in addition to proxy-level enforcement. But it creates a dual-budget problem.

5. **Should we add `check_budget` to the MCP server now?** The types already exist (`BudgetStatus`, `BudgetEntity`). It would let agents self-regulate their spend. Low effort, high differentiation.

---

## Sources and References

### Official Documentation
- [Claude Agent SDK — Cost Tracking](https://platform.claude.com/docs/en/agent-sdk/cost-tracking)
- [Claude Agent SDK — Hooks](https://platform.claude.com/docs/en/agent-sdk/hooks)
- [Claude Agent SDK — Configuration](https://platform.claude.com/docs/en/agent-sdk/sdk-configuration)
- [Anthropic Messages API — Usage](https://docs.anthropic.com/en/api/messages)
- [Anthropic TypeScript SDK — Client Configuration](https://github.com/anthropics/anthropic-sdk-typescript)
- [MCP 2026 Roadmap](http://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/)

### Platform and Product References
- [LiteLLM — Claude Agent SDK Tutorial](https://docs.litellm.ai/docs/tutorials/claude_agent_sdk)
- [LiteLLM — Agent SDKs](https://docs.litellm.ai/docs/agent_sdks)
- [Portkey — Claude Agent SDK Integration](https://portkey.ai/docs/integrations/agents/claude-agent-sdk)
- [Portkey — OpenAI Agents SDK](https://portkey.ai/docs/integrations/agents/openai-agents)
- [Helicone — Gateway Overview](https://docs.helicone.ai/gateway/overview)
- [Langfuse — Claude Agent SDK JS](https://langfuse.com/integrations/frameworks/claude-agent-sdk-js)
- [OpenAI Agents SDK — Usage & Lifecycle](https://openai.github.io/openai-agents-python/usage/)
- [Vercel AI SDK — Middleware](https://ai-sdk.dev/docs/ai-sdk-core/middleware)
- [AgentBudget.dev](https://agentbudget.dev)
- [TrueFoundry — FinOps for Autonomous Systems](https://www.truefoundry.com/blog/agent-gateway-series-part-4-of-7-finops-for-autonomous-systems)
- [Stripe — Agentic Commerce Protocol](https://docs.stripe.com/agentic-commerce/protocol)
- [Stripe — Machine Payments Protocol](https://stripe.com/blog/machine-payments-protocol)

### Repositories and Code References
- [anthropics/claude-agent-sdk-typescript](https://github.com/anthropics/claude-agent-sdk-typescript) — 989 stars, v0.2.80
- [anthropics/claude-agent-sdk-python](https://github.com/anthropics/claude-agent-sdk-python) — 5,600 stars
- [sahiljagtap08/agentbudget](https://github.com/sahiljagtap08/agentbudget) — 32 stars, Apache 2.0
- [AgentOps-AI/tokencost](https://github.com/AgentOps-AI/tokencost) — 2,000 stars, Python token pricing
- [lmnr-ai/lmnr](https://github.com/lmnr-ai/lmnr) — Laminar, YC S24, proven ANTHROPIC_BASE_URL proxy pattern
- [SatGate-io/satgate-proxy](https://github.com/SatGate-io/satgate-proxy) — L402 macaroon budget enforcement for MCP
- [agentic-commerce-protocol/agentic-commerce-protocol](https://github.com/agentic-commerce-protocol/agentic-commerce-protocol) — Stripe ACP

### Issue Trackers
- [Claude Agent SDK TS #144](https://github.com/anthropics/claude-agent-sdk-typescript/issues/144) — `ANTHROPIC_BASE_URL` via `env` option may be broken in v0.2.8+
- [Claude Agent SDK TS #38](https://github.com/anthropics/claude-agent-sdk-typescript/issues/38) — Zod v3→v4 peer dependency upgrade
- [Anthropic SDK TS #864](https://github.com/anthropics/anthropic-sdk-typescript/issues/864) — Missing `@anthropic-ai/sdk` dependency re-export

### Academic Papers
- [Agent Contracts (arXiv:2601.08815, January 2026)](https://arxiv.org/abs/2601.08815) — Conservation laws for multi-agent budget delegation

### Internal Codebase References
- `apps/proxy/src/routes/anthropic.ts` — Existing Anthropic proxy route handler
- `apps/proxy/src/lib/auth.ts` — `x-nullspend-key` header authentication
- `apps/proxy/src/lib/anthropic-headers.ts` — Anthropic header forwarding (`x-api-key`, `anthropic-version`)
- `apps/proxy/src/index.ts:232-243` — RequestContext building (sessionId, traceId, tags from headers)
- `packages/sdk/src/client.ts` — NullSpend SDK client (`reportCost()`, `checkBudget()`)
- `packages/sdk/src/types.ts:208-221` — `BudgetStatus` and `BudgetEntity` types
- `packages/mcp-server/src/tools.ts` — MCP tools (`propose_action`, `check_action`)
- `packages/mcp-proxy/src/cost-tracker.ts` — MCP proxy cost tracking
