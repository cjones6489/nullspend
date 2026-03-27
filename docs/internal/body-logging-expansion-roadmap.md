# Body Logging Expansion Roadmap

**Date:** 2026-03-27
**Status:** Feature ideas — needs prioritization and planning
**Foundation:** Phase 1 (non-streaming) and Phase 2 (streaming) body capture shipped and deployed

---

## What We Have Today

Every request flowing through the proxy captures:
- **Request body** — full JSON (model, messages, tools, system prompt, etc.)
- **Response body** — full JSON (non-streaming) or raw SSE text (streaming)
- **Cost event** — tokens, cost, model, duration, tags, session ID, trace ID
- **Storage** — R2, keyed by `{orgId}/{requestId}/request.json` and `response.json` or `response.sse`
- **Viewing** — cost event detail page in dashboard, one request at a time
- **Gating** — Pro/Enterprise tiers only (requestLoggingEnabled flag)

---

## Strategy: Land with Proxy, Expand with SDK

**Proxy (automatic, zero code changes):** The developer changes one URL. Every request gets captured. This is how we get adoption — zero friction.

**SDK (opt-in, deeper integration):** Once a developer sees value from the proxy data, they add the SDK for more control — annotations, quality signals, custom grouping. The SDK makes proxy data more valuable.

---

## Land Features (Proxy — automatic)

### 1. Search Across Bodies

**What:** Full-text search across all captured request and response bodies for an org.

**Use case:** "Show me every request where the agent received a tool error." Developer types "database connection timeout" and gets back every request where that string appeared. Instantly find patterns — errors only happen between 2-4 AM, or only from one specific agent.

**Technical approach:**
- Option A: R2 objects are blobs — would need to index content at write time into a searchable store (Postgres full-text, or a search index)
- Option B: Stream bodies through a lightweight indexer in the cost event queue consumer, store searchable excerpts in Postgres alongside cost events
- Option C: On-demand search — fetch bodies from R2 for a filtered set of cost events (by time range, agent, model) and search client-side

**Priority:** HIGH — this is the feature that makes body logging 10x more useful than one-at-a-time viewing

### 2. Session Replay

**What:** Group all cost events by session ID, order chronologically, display the full multi-turn conversation — every request and response in sequence.

**Use case:** "What did Research Bot do during research-task-47?" Click a session and watch the agent's complete workflow: planning prompt → tool calls → retries → final answer. See where it went wrong step by step.

**Technical approach:**
- Query cost_events WHERE session_id = X, ORDER BY created_at
- Fetch bodies from R2 for each event
- Render as a conversation timeline in the dashboard
- Show cost accumulation through the session (running total)

**Dependencies:** Session ID already captured via `X-NullSpend-Session` header. Bodies already in R2. This is primarily a dashboard feature.

**Priority:** HIGH — this is the most intuitive way to understand agent behavior. Developers already think in sessions/conversations, not individual requests.

### 3. Cost-to-Quality Correlation

**What:** Compare expensive requests vs. cheap requests to identify optimization opportunities.

**Use case:** "Are the $0.50 GPT-4o requests producing better results than $0.02 GPT-4o-mini requests for the same kind of task?" Show side-by-side comparisons. Identify tasks where the cheaper model produces equivalent output.

**Technical approach:**
- Cluster requests by tag, agent, or prompt similarity
- For each cluster, show cost distribution and sample outputs from different models
- Highlight clusters where expensive models are used for simple tasks
- Surface as "optimization suggestions" in dashboard

**Priority:** MEDIUM — valuable but requires some ML/heuristics for clustering. Could start with manual comparison (pick two requests, see them side by side).

### 4. Anomaly Detection on Content

**What:** Detect when agent output patterns change — not just cost spikes, but behavioral changes visible in the response bodies.

**Use case:** Support agent normally responds in 2-3 sentences. Suddenly starts producing 500-word responses filled with apologies. The cost only went up 20%, but the behavior change is a 10x signal that something is wrong. Alert before customers complain.

**Technical approach:**
- Track response length distribution per agent (simple: character count from bodies)
- Track response structure patterns (contains tool calls? contains apologies? contains error messages?)
- Alert when distribution shifts significantly (z-score or similar)
- Could also detect: prompt injection attempts visible in bodies, repeated identical responses (caching bug), responses that don't match the expected language

**Priority:** MEDIUM-HIGH — high value but needs careful implementation to avoid false positives. Start with simple metrics (response length, error keyword detection) before going to ML-based approaches.

### 5. Prompt Optimization Suggestions

**What:** Analyze captured request bodies to identify cost-saving opportunities in how agents construct prompts.

**Use case:** "Your Research Bot sends 4,000 tokens of tool definitions on every request but only uses 2 of 8 tools. Removing unused tools would save $400/month." Or: "Your system prompt is 2,000 tokens and identical across all requests — enable prompt caching to save 90% on input costs."

**Technical approach:**
- Analyze request bodies for patterns:
  - Repeated identical system prompts (→ suggest caching)
  - Large tool definition arrays with low tool usage rate (→ suggest pruning)
  - Long conversation histories that could be summarized (→ suggest context window management)
  - Identical requests repeated frequently (→ suggest response caching)
- Cross-reference with cost data to quantify savings
- Surface as actionable recommendations in dashboard

**Priority:** MEDIUM — high perceived value ("NullSpend saved me $X/month") but requires analysis pipeline. Good differentiator from pure observability tools.

---

## Expand Features (SDK — opt-in)

### 6. Session Annotation

**What:** SDK allows developers to annotate sessions with business context.

**Example:**
```typescript
ns.session.annotate({
  sessionId: "research-task-47",
  metadata: {
    ticketId: "JIRA-4521",
    customer: "Acme Corp",
    intent: "dataset-discovery",
    priority: "high"
  }
});
```

**Value:** Session replay becomes dramatically more useful when you know WHY the session happened, not just WHAT happened. "This was a high-priority customer support conversation for Acme Corp" changes how you investigate a failure.

**Priority:** MEDIUM — only valuable after session replay exists

### 7. Quality Signals / Feedback Loop

**What:** SDK allows developers (or end users) to mark responses as good or bad.

**Example:**
```typescript
ns.feedback.submit({
  requestId: "req_xxx",
  rating: "negative",
  reason: "Agent gave outdated pricing information"
});
```

**Value:** Connects cost to quality. "We spent $2,100 on Research Bot this month. 94% of responses were rated positive. The 6% negative ones all involved the pricing database tool." Now you know exactly what to fix.

**Priority:** MEDIUM — this is the data that makes cost-to-quality correlation (feature #3) work at scale

### 8. Custom Grouping

**What:** SDK allows grouping requests beyond session ID — by task, workflow, pipeline, or any developer-defined concept.

**Example:**
```typescript
const task = ns.task.start({
  name: "quarterly-report-generation",
  tags: { department: "finance", quarter: "Q1-2026" }
});

// All subsequent requests are grouped under this task
const response = await openai.chat.completions.create({ ... });

task.end({ status: "completed" });
```

**Value:** See total cost and full body history for a logical unit of work that spans multiple sessions or agents.

**Priority:** LOW-MEDIUM — useful for complex multi-agent workflows but session ID covers most cases

### 9. Agent Framework Wrappers

**What:** Pre-built integrations for popular frameworks that auto-capture rich metadata.

**Examples:**
```typescript
// LangChain: auto-captures chain name, tool names, retriever sources
import { NullSpendCallbackHandler } from "@nullspend/langchain";
const handler = new NullSpendCallbackHandler({ apiKey: "ns_key_xxx" });

// CrewAI: auto-captures crew name, agent role, task description
import { NullSpendCrewMonitor } from "@nullspend/crewai";

// Vercel AI SDK: auto-captures tool results, step count
import { nullspendMiddleware } from "@nullspend/ai-sdk";
```

**Value:** Framework-specific metadata makes bodies even more useful. "This request was step 3 of a 5-step LangChain chain, using the SQL retriever tool, as part of the data-analyst crew." That context is invisible in raw bodies.

**Priority:** LOW near-term (need adoption first), HIGH long-term (this is how you become the default in each framework's ecosystem)

---

## Sequencing

### Phase 3: Search + Session Replay (next build)
- Search across bodies (the highest-leverage single feature)
- Session replay (the most intuitive way to use body data)
- These two together transform body logging from "view one request" to "understand agent behavior"

### Phase 4: Intelligence Layer
- Anomaly detection on content patterns
- Prompt optimization suggestions
- Cost-to-quality correlation (basic version — manual comparison)

### Phase 5: SDK Depth
- Session annotation
- Quality signals / feedback loop
- Custom grouping
- Framework wrappers

---

## How This Fits the Bigger Picture

Body logging expansion strengthens NullSpend's position as the **system of record for agent activity.** The more data flows through NullSpend and the more actionable it becomes, the harder it is to rip out.

Each expansion adds data gravity:
- Search → developers query NullSpend when debugging
- Session replay → developers watch agent behavior in NullSpend
- Anomaly detection → NullSpend alerts before anyone else notices problems
- Optimization suggestions → NullSpend saves money proactively
- Quality signals → NullSpend connects cost to business outcomes

This is the foundation for the long-term vision (agent financial infrastructure). When agents start making purchases and transacting with each other, the same body logging + search + replay + anomaly detection infrastructure applies to financial transactions, not just API calls.
