# NullSpend Domination Playbook
## Distribution, Growth, and Competitive Warfare

Last updated: 2026-03-31

---

## Strategic Context

Our real competitor isn't Cordum or Cycles. It's **"I'll deal with cost management later."** Both direct competitors have near-zero traction (463 and 18 GitHub stars). The market hasn't been won yet. The winner will be whoever **becomes the default** — the thing developers reach for when they realize they need agent cost controls.

NullSpend becomes the default through: three integration surfaces (proxy for zero-code, SDK for any HTTP call, MCP server for agent self-governance), framework integrations (distribution), open-source cost engine (infrastructure adoption), content authority (SEO/thought leadership), and developer experience (time-to-first-value under 2 minutes).

---

## Part 1: Framework Integration Blitz

Ship one integration per week. Each package is a permanent distribution channel. Three integration patterns across all frameworks:

1. **Proxy-based (zero-code):** Route API calls through `proxy.nullspend.com`. Works with any framework. No SDK needed. Mandatory enforcement.
2. **SDK-based (`createTrackedFetch`):** Wrap any HTTP call with cost tracking and enforcement. Works with direct API calls AND non-AI services (SaaS, vendors, commerce). Cooperative enforcement.
3. **Hook-based (framework integration):** Instrument framework lifecycle hooks to capture token usage and POST cost events. Lightest-touch integration.

All three patterns should be supported in every adapter package where applicable. The SDK path is increasingly important as NullSpend expands beyond compute to universal spending authorization.

### Priority 1: Vercel AI SDK (`@nullspend/vercel-ai`)

**Stats:** 10.3M weekly npm downloads, 23.1k GitHub stars, 602+ contributors.

**Integration point:** Language Model Middleware via `wrapLanguageModel`. Intercepts every `doGenerate` and `doStream` call. Sees full params (model, messages, tools) and full result (text, tokens, usage). Composable and distributable as an npm package.

```typescript
import { LanguageModelV3Middleware, wrapLanguageModel } from 'ai';

export const nullspendMiddleware: LanguageModelV3Middleware = {
  wrapGenerate: async ({ doGenerate, params }) => {
    const start = Date.now();
    const result = await doGenerate();
    await reportCostEvent(params, result, Date.now() - start);
    return result;
  },
  wrapStream: async ({ doStream, params }) => {
    const { stream, ...rest } = await doStream();
    const transformStream = new TransformStream({ /* accumulate usage from final chunk */ });
    return { stream: stream.pipeThrough(transformStream), ...rest };
  },
};

// User applies it:
const model = wrapLanguageModel({
  model: openai('gpt-4o'),
  middleware: nullspendMiddleware({ apiKey: 'ns_...' }),
});
```

Also supports `TelemetryIntegration` interface with `onStart`, `onStepFinish`, `onToolCallFinish`, `onFinish` callbacks.

**How to get into their docs:** Axiom already has a `wrapAISDKModel` wrapper documented on the AI SDK observability page. Submit a PR to `vercel/ai` adding NullSpend as an observability provider alongside Axiom, Langfuse, and SigNoz.

**Effort:** 2-3 days | **Impact:** Very High

### Priority 2: LangChain / LangGraph (`nullspend-langchain`)

**Stats:** 52M+ weekly PyPI downloads, 1M+ weekly npm downloads, 90k+ GitHub stars.

**Integration point:** Callback system. Implement `BaseCallbackHandler` with `on_llm_end` (receives `response.llm_output` with `token_usage`).

```python
from langchain_core.callbacks import BaseCallbackHandler

class NullSpendHandler(BaseCallbackHandler):
    def on_llm_end(self, response, **kwargs):
        usage = response.llm_output.get("token_usage", {})
        # POST to NullSpend API

# Usage:
handler = NullSpendHandler(api_key="ns_...")
model = ChatOpenAI(callbacks=[handler])
# LangGraph:
graph.invoke(input, config={"callbacks": [handler]})
```

**How to get into their docs:** Langfuse built a LangChain callback handler and became the recommended tracing solution. Submit a community integration to `langchain-ai/langchain`. The callback handler pattern is standard — acceptance is straightforward.

**Effort:** 2-3 days | **Impact:** Very High

### Priority 3: OpenAI Agents SDK (`@nullspend/openai-agents`)

**Stats:** Python: 19k GitHub stars. JS/TS: 478k weekly npm downloads.

**Integration points:**
- `RunHooks` / `AgentHooks` lifecycle callbacks (`on_agent_start`, `on_agent_end`, `on_tool_start`, `on_tool_end`)
- `TracingProcessor` custom trace backend (how Langfuse integrates)
- Model provider override for intercepting all API calls

```typescript
import { RunHooks, addTraceProcessor } from '@openai/agents';

export function withNullSpend(config: NullSpendConfig): {
  hooks: RunHooks;
  tracingProcessor: TracingProcessor;
} {
  return {
    hooks: new NullSpendRunHooks(config),
    tracingProcessor: new NullSpendTracer(config),
  };
}

// Usage:
const { hooks, tracingProcessor } = withNullSpend({ apiKey: 'ns_...' });
addTraceProcessor(tracingProcessor);
const result = await run(agent, input, { hooks });
```

**How to get into their docs:** Langfuse has a cookbook page in the OpenAI Agents docs. Submit a PR to `openai/openai-agents-python` and `openai/openai-agents-js` adding NullSpend as an observability integration example.

**Effort:** 2-3 days | **Impact:** High

### Priority 4: CrewAI (`nullspend-crewai`)

**Stats:** 44.6k GitHub stars, 12M+ monthly PyPI downloads, 450M monthly workflow executions.

**Integration point:** LLM Call Hooks — `@before_llm_call` and `@after_llm_call` decorators with `LLMCallHookContext`.

```python
import nullspend_crewai

nullspend_crewai.init(api_key="ns_...")  # Registers hooks globally

# That's it — all LLM calls are now tracked
crew = Crew(agents=[...], tasks=[...])
result = crew.kickoff()
```

**How to get into their docs:** CrewAI has a dedicated AgentOps monitoring page. Submit a PR adding a `nullspend` monitoring guide alongside it. Users are actively asking about per-customer cost tracking on their community forum.

**Effort:** 1-2 days | **Impact:** High

### Priority 5: Pydantic AI (`nullspend-pydantic-ai`)

**Stats:** 1,840 GitHub stars (growing fast, backed by the Pydantic team).

**Integration point:** AbstractCapability system — the richest hook architecture of any framework. Has `wrap_model_request` which lets you **swap models mid-request**.

```python
from pydantic_ai.capabilities import AbstractCapability

class NullSpendCapability(AbstractCapability):
    async def wrap_model_request(self, ctx, *, request_context, handler):
        if self.budget_low(ctx):
            request_context.model = 'gpt-4o-mini'  # Auto-downgrade when budget is low
        response = await handler(request_context)
        await self.report_cost(ctx, request_context, response)
        return response

# Usage:
agent = Agent(
    'openai:gpt-4o',
    capabilities=[NullSpendCapability(api_key="ns_...", auto_downgrade=True)],
)
```

**Killer feature:** Auto model downgrade when budget is low. Nobody else does this. NullSpend automatically switches to cheaper models to extend budget life.

**How to get into their docs:** Pydantic AI's capabilities system is new and the team is actively soliciting community capabilities. Submit a PR to `pydantic/pydantic-ai`.

**Effort:** 2-3 days | **Impact:** Medium-High

### Priority 6: Mastra (`@nullspend/mastra`)

**Stats:** 22.4k GitHub stars, 621k weekly npm downloads. YC W25, $13M funding.

**Integration point:** OTel exporter pattern (like their existing `ArizeExporter`).

```typescript
import { NullSpendExporter } from '@nullspend/mastra';

const mastra = new Mastra({
  observability: new Observability({
    exporters: [new NullSpendExporter({ apiKey: 'ns_...' })],
  }),
});
```

**How to get into their docs:** Mastra already has integration pages for Arize, Langfuse, and PostHog. Submit a PR. Team is active on Discord (4,800 members).

**Effort:** 1-2 days | **Impact:** Medium

### Priority 7: n8n (`n8n-nodes-nullspend`)

**Stats:** 181k GitHub stars, massive self-hosted automation community.

**Integration point:** Community node with NullSpend action (check budget, log cost) and trigger (budget alert, threshold crossed).

```
n8n-nodes-nullspend/
  nodes/NullSpend/NullSpend.node.ts        # Cost check + log actions
  nodes/NullSpend/NullSpendTrigger.node.ts  # Webhook triggers
  credentials/NullSpendApi.credentials.ts
```

Publish to npm with `n8n-community-node-package` keyword.

**Effort:** 2-3 days | **Impact:** Medium

### Priority 8: AutoGen / AG2 / Microsoft Agent Framework

**Stats:** 50.4k GitHub stars (AutoGen). In transition to Microsoft Agent Framework (RC Feb 2026).

**Integration point:** AG2's `OpenAIWrapper` monkey-patch or AgentOps-style `init()` call. Wait for Microsoft Agent Framework GA for the long-term integration.

**Effort:** 2-3 days | **Impact:** Medium (declining as framework transitions)

### Priority 9: Claude Agent SDK (extend existing)

Already have `@nullspend/claude-agent`. Extend with:
- MCP server as built-in budget awareness tool
- `PreToolUse` shell hook for cost-based tool gating
- Budget-aware subagent spawning with per-subagent isolation

**Effort:** 1-2 days | **Impact:** Medium (already shipping)

---

## Part 2: Open Source Strategy

### Open-Source the Cost Engine

**Package:** `@nullspend/cost-engine` (already exists at `packages/cost-engine/`)

**What to open source (developer features):**
- Pricing catalog (38+ models, all providers)
- Cost calculation functions (`calculateOpenAICost`, `calculateAnthropicCost`, etc.)
- Token cost estimation
- Model pricing data

**What stays proprietary (manager/executive features):**
- Dashboard and analytics UI
- Team management, SSO, RBAC
- Webhook management and alerting
- Budget enforcement (Durable Objects)
- Audit logs and compliance export
- HITL approval workflows

**License:** MIT (no restrictions, maximum adoption).

**Why this wins:**
- Cordum is BUSL-1.1 (not truly open source — converts to Apache 2.0 in 2029)
- Cycles is Apache 2.0 but requires self-hosting a Java server
- An MIT cost engine with zero infrastructure requirements beats both
- Every developer who `npm install @nullspend/cost-engine` becomes aware of the hosted platform
- PostHog (29K stars), Langfuse (acquired by ClickHouse), Supabase (99K stars) all prove: open source is the most powerful distribution channel for developer tools

### Also Open Source

- `@nullspend/sdk` (if not already — the client SDK)
- `@nullspend/docs` MCP server (already built, ready to publish)
- All framework integration packages
- The ASAP protocol spec and reference implementation

---

## Part 3: Content & SEO Warfare

### Kill Shot Blog Posts

**1. "The Sidecar Problem: Why Voluntary Budget Checks Don't Work for AI Agents"**
- Technical argument: agents are autonomous. If enforcement is opt-in, misbehaving agents bypass it.
- Analogy: "You wouldn't build a firewall that requires each application to voluntarily check if its traffic is allowed."
- Include runnable demo: agent ignores sidecar → unlimited spend. Same agent hits proxy → blocked.
- Open-source demo repo: `nullspend/budget-bypass-demo`
- Never name Cycles. Attack the architecture pattern. Readers connect the dots.

**2. "You Don't Need 6 Services to Track AI Costs"**
- Technical argument: NATS + Redis + 6 microservices for cost tracking is massive overhead.
- Show NullSpend architecture (proxy + dashboard) vs the alternative.
- Frame as "complexity budget" — the cost of your cost tracker shouldn't exceed the costs it's tracking.
- Don't name Cordum. Describe the pattern.

**3. "Real Cost Calculation for AI APIs: Why Approximate Isn't Good Enough"**
- Deep-dive into per-token cost calculation with model-specific pricing, cached token discounts, reasoning token multipliers.
- Show the pricing-data.json catalog and calculation logic.
- Contrast with approaches that don't do actual cost calculation.

**4. "We Tracked What Happens When AI Agents Run Unsupervised for a Week"**
- The Show HN post. Lead with the problem, not the product.
- Real data from internal testing or early users.
- Numbers are compelling: "$2,400 in API costs from a 3-agent system in 7 days. Here's how we fixed it."

### SEO Content Cluster

Own these keywords (nobody does yet):

| Keyword | Content | Intent |
|---|---|---|
| "how much do ai agents cost to run" | Comprehensive guide with calculator | High intent, low competition |
| "ai agent budget enforcement" | Architecture comparison (proxy vs sidecar vs middleware) | Direct product tie-in |
| "langchain cost tracking" | Tutorial: LangChain + NullSpend | Framework-specific |
| "openai api cost per agent session" | Technical breakdown with real numbers | High intent |
| "ai agent runaway cost prevention" | Fear-based + solution | High intent |
| "ai agent cost optimization" | Pillar page with model comparison data | Comprehensive |
| "crewai cost tracking" | Tutorial: CrewAI + NullSpend | Framework-specific |
| "vercel ai sdk cost" | Tutorial: Vercel AI SDK + NullSpend | Framework-specific |
| "ai finops" | Category definition page | Category ownership |
| "cordum alternative" | Comparison page | Competitor keyword |
| "runcycles alternative" | Comparison page | Competitor keyword |

### Comparison Pages

**nullspend.com/vs/cordum**
- Lead: "Real cost calculation vs. job scheduling dressed as FinOps"
- Rows: per-token cost tracking, proxy enforcement (not bypassable), dashboard, webhooks, HITL, zero infrastructure
- Hammer the complexity angle: show their 6-service architecture diagram vs our one-URL setup

**nullspend.com/vs/runcycles**
- Lead: "Budget enforcement agents can't bypass"
- Rows: proxy enforcement, dashboard UI, webhook alerts, session limits, automatic cost calculation, managed hosting
- The sidecar bypass is the kill shot

### Framework-Specific Landing Pages

- `nullspend.com/for/langchain`
- `nullspend.com/for/vercel-ai`
- `nullspend.com/for/openai-agents`
- `nullspend.com/for/crewai`
- `nullspend.com/for/pydantic-ai`
- `nullspend.com/for/mastra`
- `nullspend.com/for/n8n`

Each shows framework-specific setup (3 lines of code), use cases, and live code examples. Sentry has `/for/nextjs/`, `/for/react/`, etc. These rank for "[framework] cost tracking" queries.

---

## Part 4: Developer Experience Weapons

### `npx create-nullspend` CLI Wizard

Auto-detect framework → ask for API key → inject integration → show working cost event in 60 seconds.

Sentry's `npx @sentry/wizard` and Stripe's "Collison Installation" prove: zero-friction setup is a growth multiplier. Time-to-first-value under 2 minutes.

### Interactive AI Cost Calculator

Web tool at `nullspend.com/calculator`:
- Input: which models, estimated tokens per session, number of agents
- Output: projected monthly cost, cost per agent session, budget recommendations
- CTA: "Set up automatic budget enforcement with NullSpend"
- Ranks for "ai agent cost calculator", "openai api cost estimator"

Twilio's phone number lookup tool drives massive SEO traffic with this pattern.

### Stripe-Quality Documentation

- Interactive code examples that run in the browser
- Auto-populated API keys for logged-in users
- Copy-paste examples for every framework integration
- Language switching (TypeScript ↔ Python ↔ cURL)
- "Time to first cost event" under 3 minutes

Cordum has basic docs with 404s. Cycles has a protocol spec but no interactive docs. World-class docs become a moat.

---

## Part 5: Distribution Channels

### MCP Server Directories

Register on all of them:
- Glama (20,249 servers indexed) — add `glama.json` to repo
- Smithery
- mcp.run
- registry.modelcontextprotocol.io (official)

Both docs MCP server and budget governance MCP server should be listed.

### Package Registries

**npm packages to publish:**
- `@nullspend/sdk` (exists)
- `@nullspend/cost-engine` (exists, open source it)
- `@nullspend/docs` (built, ready to publish)
- `@nullspend/vercel-ai`
- `@nullspend/openai-agents`
- `@nullspend/mastra`
- `n8n-nodes-nullspend`
- `create-nullspend` (CLI wizard)

**PyPI packages to publish:**
- `nullspend` (Python SDK — already exists at `packages/sdk-python/`)
- `nullspend-langchain`
- `nullspend-crewai`
- `nullspend-pydantic-ai`
- `nullspend-ag2`

### Cloud Marketplaces (after launch)

- AWS Marketplace
- Vercel Marketplace
- Cloudflare Apps

### Accelerator Credits

- YC portfolio credits
- a16z portfolio credits
- Other AI-focused accelerators

If every AI startup in YC's current batch uses NullSpend from day one, you win the cohort. Stripe Atlas playbook.

---

## Part 6: Community & Social Warfare

### Forums & Communities

**Where to be present:**
- r/LangChain, r/LocalLLaMA, r/MachineLearning, r/artificial
- LangChain Discord, CrewAI Discord, AutoGen Discord, Mastra Discord (4,800 members)
- Hacker News (build 2-3 months of authentic engagement before launch)
- Stack Overflow — answer "how to track AI agent costs" questions
- AI agent framework GitHub issue trackers — comment on cost tracking issues

**The rule:** Answer genuine questions with helpful information that happens to mention NullSpend. Always disclose affiliation. Never astroturf. If you'd be proud of the contribution regardless of whether it mentions NullSpend, it's fine.

### Ship in Public

- Public changelog page, updated weekly
- Tweet every feature with technical details, not marketing fluff
- "How We Built X in 48 Hours" posts — demonstrates velocity
- Rapid response to competitor features — ship your version or explain why your architecture already handles it

Speed is a signal. Seeing 3-5 updates per week from NullSpend vs silence from solo-dev competitors sends a clear message.

### Show HN Launch

Cycles' Show HN: 1 point, 2 comments (both from the founder). A failed launch. Do it right:
- Lead with the problem, not the product
- Write as a fellow builder
- Be available to respond to every comment within minutes
- Pre-build 2-3 months of authentic HN engagement first
- Supabase hit the HN front page and grew from 80 to 800 users overnight

---

## Part 7: Pricing as a Weapon

### Free Tier Strategy

Cordum free tier: 3 workers, limited features. Cycles: free but self-hosted only.

NullSpend free tier should make both look restrictive:
- **Free forever:** Unlimited cost tracking, up to $1,000/month in tracked AI spend, 3 budgets, 10 keys
- **No credit card required**
- **Gate manager features, not developer features:** SSO, audit logs, team management, SIEM export are paid. Cost tracking, budget enforcement, API access are free.

Cloudflare playbook: 50%+ of Pro users upgraded from free. The free tier is marketing, not charity.

### Usage-Based Alignment

- Charge per-governed-dollar above the free threshold
- Or charge per-event above a generous free tier
- The pricing should scale with the value delivered — if NullSpend saves you $X, pay a fraction of $X

---

## Part 8: Standards & Ecosystem Control

### Propose AI Cost Event Standard

Define a schema for AI cost events (we already have one). Publish as an RFC or spec document. If NullSpend's cost event format becomes the standard, every competing tool has to be compatible.

### Contribute to OpenTelemetry for AI

Active work on AI/LLM observability in the OTel community. If NullSpend contributes to defining cost/budget semantic conventions, our implementation becomes the reference. This is what Honeycomb did — contributed to OTel and became the natural destination for OTel data.

### Build for Framework Authors

Reach out to LangChain, CrewAI, AutoGen, Anthropic Claude SDK teams. Offer to build and maintain the cost tracking integration for their framework. If they endorse or include it, NullSpend becomes the default.

---

## Part 9: Competitive Neutralization

### Content Attacks (Architecture, Not Companies)

Attack architectures and approaches, not companies. The best technical teardowns let readers draw their own conclusions.

| Post | Target Architecture | NullSpend Advantage |
|---|---|---|
| "The Sidecar Problem" | Voluntary budget checks (Cycles) | Proxy enforcement is mandatory |
| "You Don't Need 6 Services" | Heavy orchestration infra (Cordum) | One URL, zero infrastructure |
| "Why Approximate Costs Don't Work" | No cost calculation (both) | 38+ model pricing catalog |
| "Budget Enforcement That Actually Enforces" | SDK-only enforcement | Proxy can't be bypassed |

### Migration Guides

**"Switching from Cordum to NullSpend":**
- Their 6-service docker-compose.yml → our single `npm install @nullspend/sdk` + one env var
- Time estimate: "Migration takes under 10 minutes"

**"Switching from Cycles to NullSpend":**
- Their sidecar model → our proxy model
- Their lack of dashboard → our dashboard screenshots
- Code diff: their SDK call → our SDK call (make it near-identical)

### Speed as Demoralization

Both competitors are solo devs. Ship faster:
- One framework integration per week
- Weekly changelog
- Respond to their features with "we've had this for months" or ship your version within days
- Cloudflare does this routinely — when AWS announces a feature, Cloudflare responds immediately

---

## Execution Priority

If you can only do 5 things:

| Priority | Tactic | Why |
|---|---|---|
| 1 | LangChain + CrewAI framework adapters (Python SDK exists) | Unlocks 90% of the agent market |
| 2 | Vercel AI SDK middleware | Unlocks Next.js AI apps (10M downloads/week) |
| 3 | "The Sidecar Problem" blog post | Establishes architectural authority, kills Cycles' narrative |
| 4 | Open-source cost-engine | Distribution channel that makes NullSpend infrastructure |
| 5 | Show HN launch | One-time high-impact event |

---

## Appendix: Framework Integration Summary

| Framework | Downloads | Integration Point | Package Name | Effort |
|---|---|---|---|---|
| Vercel AI SDK | 10.3M/wk npm | `wrapLanguageModel` middleware | `@nullspend/vercel-ai` | 2-3 days |
| LangChain | 52M/wk PyPI | `BaseCallbackHandler` | `nullspend-langchain` | 2-3 days |
| OpenAI Agents | 478k/wk npm | `RunHooks` + `TracingProcessor` | `@nullspend/openai-agents` | 2-3 days |
| CrewAI | 12M/mo PyPI | `@before_llm_call` / `@after_llm_call` | `nullspend-crewai` | 1-2 days |
| Pydantic AI | Growing | `AbstractCapability` (auto downgrade!) | `nullspend-pydantic-ai` | 2-3 days |
| Mastra | 622k/wk npm | OTel exporter | `@nullspend/mastra` | 1-2 days |
| n8n | 181k GH stars | Community node | `n8n-nodes-nullspend` | 2-3 days |
| Claude Agent SDK | Existing | Extend `@nullspend/claude-agent` | Already built | 1-2 days |
| AutoGen/AG2 | 50k GH stars | `OpenAIWrapper` monkey-patch | `nullspend-ag2` | 2-3 days |
