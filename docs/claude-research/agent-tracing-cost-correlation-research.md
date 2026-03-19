# Agent Tracing & Cost Correlation Research

> **Date:** 2026-03-18
> **Method:** 10 parallel research agents covering competitors, standards, frameworks, cloud providers, emerging platforms, MCP spec, proxy architectures, multi-agent patterns, streaming/billing infrastructure.
> **Purpose:** Inform NullSpend's tracing architecture. See `docs/technical-outlines/agent-tracing-architecture.md` for the buildout plan.

---

## Table of Contents

1. [The Fundamental Problem](#1-the-fundamental-problem)
2. [Competitor Proxy Platforms](#2-competitor-proxy-platforms)
3. [Observability Platforms](#3-observability-platforms)
4. [Cloud Provider Tracing](#4-cloud-provider-tracing)
5. [Standards & Specifications](#5-standards--specifications)
6. [Agent Framework Internals](#6-agent-framework-internals)
7. [Multi-Agent Cost Attribution](#7-multi-agent-cost-attribution)
8. [Streaming & Real-Time Cost](#8-streaming--real-time-cost)
9. [Proxy Architecture Patterns](#9-proxy-architecture-patterns)
10. [Billing Infrastructure](#10-billing-infrastructure)
11. [Strategic Analysis](#11-strategic-analysis)
12. [References](#12-references)

---

## 1. The Fundamental Problem

A proxy sees isolated HTTP request/response pairs. An agent loop (LLM call -> tool execution -> LLM call) happens client-side. The proxy cannot determine:

| Blind Spot | Minimum Cooperation Needed |
|---|---|
| Which tool call triggered this LLM request | `traceparent` or `X-Trace-Id` header |
| Agent identity in multi-agent systems | `X-Agent-Id` header |
| Tool execution cost/duration | Separate reporting endpoint |
| Session boundaries | `X-Session-Id` header |

**Universal finding across all 10 research agents:** No proxy-only platform solves this without client cooperation. The minimum cooperation is one header per request.

---

## 2. Competitor Proxy Platforms

### 2.1 Portkey.ai

**Headers-only tracing** with `x-portkey-` prefix:

| Header | Purpose |
|---|---|
| `x-portkey-trace-id` | Groups related calls |
| `x-portkey-span-id` | Unique operation ID |
| `x-portkey-span-name` | Human label |
| `x-portkey-metadata` | JSON metadata (string values, max 128 chars) |

Also accepts W3C `traceparent`. Returns `x-portkey-trace-id` in response (auto-generated if not provided). Cost computed server-side, **not** in response headers. Open-source gateway at `github.com/Portkey-AI/gateway` (Hono/TypeScript), tracing UI is proprietary.

### 2.2 LiteLLM

**Metadata-in-body** approach with response cost headers:

```json
{ "metadata": { "trace_id": "abc", "generation_name": "step-3", "tags": ["agent:research"] } }
```

| Response Header | Purpose |
|---|---|
| `x-litellm-response-cost` | Cost in USD (e.g., `2.85e-05`) |
| `x-litellm-key-spend` | Cumulative key spend |
| `x-litellm-call-id` | Request UUID |

OTel integration with priority chain: explicit parent span > `traceparent` header > active context. Pluggable callbacks (`langfuse`, `s3_v2`, `otel`, `sentry`). Virtual keys with hierarchical budget: Org -> Team -> User -> Key.

### 2.3 Helicone

**Path-based hierarchy** — no native span model:

| Header | Purpose | Example |
|---|---|---|
| `Helicone-Session-Id` | Groups requests | UUID |
| `Helicone-Session-Path` | Defines tree position | `/agent/turn1/tool` |
| `Helicone-Session-Name` | Human label | "Research Agent" |

Tool logging requires separate `POST /custom/v1/log` API call. Rebuilt in Rust (mid-2025): 1-5ms P95, ~64MB memory. Developer manually constructs path hierarchy.

### 2.4 Comparison

| Capability | Portkey | LiteLLM | Helicone | NullSpend (current) |
|---|---|---|---|---|
| Trace propagation | Headers | Body metadata | Session paths | `sessionId` only |
| Cost in response | No | Yes | No | **No** |
| Tool execution tracking | Implicit | Implicit | Custom API | MCP proxy only |
| OTel compat | `traceparent` accepted | Full export | OpenLLMetry | **No** |
| Budget enforcement | No | Virtual keys | No | DO-based |

---

## 3. Observability Platforms

### 3.1 Langfuse (Open Source, SDK-Based)

**Data model:** `Session 1:N Trace 1:N Observation` with `parentObservationId` tree.

Observation types: `GENERATION | SPAN | EVENT | AGENT | TOOL | CHAIN | RETRIEVER | EVALUATOR | EMBEDDING | GUARDRAIL`. All share same schema — type is a UI label.

**Cost tracking:** Per-observation `usageDetails` + `costDetails`, automatic trace-level rollup via `calculatedTotalCost`. Priority: ingested values > inferred from pricing table > inferred from tokenizer.

**OTel mapping:** `gen_ai.request.model` -> `observation.model`, `gen_ai.usage.input_tokens` -> `usageDetails.input`, span with `model` attribute -> auto-typed as GENERATION.

### 3.2 Arize Phoenix / OpenInference

Span kinds: `LLM | EMBEDDING | CHAIN | RETRIEVER | RERANKER | TOOL | AGENT | GUARDRAIL | EVALUATOR | PROMPT`. Uses flattened attribute naming with zero-based indices:

```
llm.output_messages.0.message.tool_calls.0.tool_call.function.name = "get_weather"
```

### 3.3 Braintrust

**Span types:** `llm`, `score`, `function`, `eval`, `task`, `tool`, `review`. Cross-service correlation via `x-bt-parent` header. **Brainstore** — custom Rust DB with 80x faster queries on AI log data (individual spans can exceed 1MB).

### 3.4 Humanloop

Core primitive is the **Log** with `prompt_cost` and `completion_cost` in USD. Decorator-based: `@flow` creates root trace, `@prompt`/`@tool` auto-nest as children. `.agent` file format with YAML frontmatter for version-controlled agent configs.

### 3.5 Weights & Biases Weave

`@weave.op` decorator with automatic nesting. **Op versioning** — captures and hashes function source code for tracking which version caused cost changes. Costs in `call.summary["weave"]["costs"]` with per-model breakdown.

### 3.6 Pydantic Logfire

**OTel-native from the ground up.** Most notable feature: **metric-in-span aggregation**:

```python
logfire.configure(metrics=logfire.MetricsOptions(collect_in_spans=True))
```

Outer spans get `logfire.metrics` containing aggregated costs from all child spans. Double-count prevention via `gen_ai.aggregated_usage.*` attributes. SQL-queryable via PostgreSQL-compatible interface (Apache DataFusion).

### 3.7 Opik (by Comet)

**Thread concept** — groups related traces into conversations with 15-min auto-inactivity detection. Backend: ClickHouse (sub-second analytics). Dedicated `"guardrail"` span type. Thread-level human feedback scores.

### 3.8 AgentOps

**Recursive loop detection** — identifies cyclic agent patterns and alerts/pauses. Session hierarchy: `SESSION > AGENT > OPERATION > LLM/TOOL`. Time-travel session replay. Auto-instrumentation via monkey-patching.

### 3.9 Novel Patterns Summary

| Pattern | Platform | NullSpend Relevance |
|---|---|---|
| Metric-in-span aggregation | Logfire | Auto cost rollup without post-processing |
| Recursive loop detection | AgentOps | Prevent runaway agent costs |
| Thread-level conversations | Opik | Multi-turn budget tracking |
| `x-bt-parent` cross-service header | Braintrust | Trace correlation through HTTP |
| Op versioning via code capture | Weave | Track which prompt version caused cost changes |
| Double-count prevention | Logfire | `aggregated_usage.*` vs `usage.*` attributes |
| Custom DB for AI logs | Braintrust | 1MB+ spans need different storage than web logs |

---

## 4. Cloud Provider Tracing

### 4.1 OpenAI Agents SDK

**11 span types:** `agent`, `generation`, `function`, `handoff`, `guardrail`, `response`, `custom`, `mcp_list_tools`, `transcription`, `speech`, `speech_group`.

`TracingProcessor` interface (6 methods): `on_trace_start`, `on_trace_end`, `on_span_start`, `on_span_end`, `shutdown`, `force_flush`. `BatchTraceProcessor`: 8192-item queue, flushes at 70% capacity or 5s interval, 128 items per batch. Exports to `POST /v1/traces/ingest`.

**HandoffSpanData** records `from_agent` and `to_agent` for multi-agent transfers. `TraceState` enables persistence/resumption across processes via `from_json()` / `ReattachedTrace`.

### 4.2 AWS Bedrock Agents

**7 trace types:** `preProcessingTrace`, `orchestrationTrace`, `postProcessingTrace`, `customOrchestrationTrace`, `routingClassifierTrace`, `failureTrace`, `guardrailTrace`. Per-step `inputTokens`/`outputTokens` but **no dollar costs**.

Cost attribution via **Application Inference Profiles (AIPs)**: wrap a model ARN, apply cost allocation tags (`project_id`, `agent_name`, `tenant_id`), tags flow to AWS Cost Explorer and CUR. AgentCore emits native OTel via auto-instrumentation.

### 4.3 Google Vertex AI / ADK

OTel `gen_ai.*` semantic conventions. Agent Engine provides Cloud Trace + Cloud Monitoring. No per-request cost field — token counts only. Known attribution bug: all sub-agent calls labeled as `adk_agent_name = "root_agent"`.

### 4.4 Google A2A Protocol

Core proto has **zero cost/trace fields**. `metadata` (string map) and `extensions` (Struct) are generic escape hatches. Cost and token usage exist ONLY in a non-normative traceability extension with `Step.cost` and `Step.token_usage`.

### 4.5 Universal Gap

**Nobody puts dollar costs in traces.** Every provider gives token counts and expects external multiplication by pricing tables. This is the exact gap NullSpend fills at the proxy layer.

---

## 5. Standards & Specifications

### 5.1 OpenTelemetry GenAI Semantic Conventions

**Status:** "Development" stability, v1.40.0. Active GenAI SIG since April 2024.

**Standard span hierarchy:**

```
invoke_agent {agent_name}         # gen_ai.operation.name = "invoke_agent"
  ├── chat {model}                # gen_ai.operation.name = "chat"
  ├── execute_tool {tool_name}    # gen_ai.operation.name = "execute_tool"
  └── chat {model}                # Second LLM call with tool results
```

**Key attributes:**

| Attribute | Purpose |
|---|---|
| `gen_ai.operation.name` | `chat`, `invoke_agent`, `execute_tool`, `embeddings` |
| `gen_ai.tool.call.id` | Correlation key between request and execution |
| `gen_ai.tool.call.arguments` / `.result` | Full round-trip data |
| `gen_ai.agent.id` / `.name` / `.version` | Agent identity |
| `gen_ai.conversation.id` | Session grouping |
| `gen_ai.usage.input_tokens` / `.output_tokens` | Token counts |

Content moved to OTel Log events (v1.38.0+): `gen_ai.content.prompt`, `gen_ai.content.completion`.

**MCP conventions** (merged January 2026, PR #2083): `mcp.method.name`, `mcp.session.id`, bridges to `gen_ai.*` via `gen_ai.operation.name = "execute_tool"`.

**NOT standardized:** cost/billing attributes, streaming observability, agentic tasks/teams/artifacts (Issue #2664).

**Adoption:** Datadog, New Relic, Sentry, Kong AI Gateway, Traceloop/OpenLLMetry, Arize/OpenInference.

### 5.2 MCP Specification

**Zero cost tracking primitives.** Tool annotations: `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint` — no cost hints.

**`_meta` extensibility** — reverse-DNS keys (e.g., `com.nullspend/cost`). Reserved for `traceparent`, `tracestate`, `baggage` (SEP-414, finalized).

**SEP-2007 (Draft):** Per-invocation payments via X402/blockchain. Fixed pricing per call, not usage-based.

**Gateway ecosystem:** 20+ open-source, 10+ commercial. Almost none implement cost tracking. IBM ContextForge claims cost metrics (sparse details), Zuplo mentions "hierarchical cost controls."

### 5.3 OWASP Agent Observability Standard (AOS)

Step types: `toolCallRequest`, `toolCallResult`, `memoryContextRetrieval`, `mcpProtocol`, `agentToAgent`. Each step has a `reasoning` field capturing **why** the agent acted. `toolCallRequest` has `can_modify: true, can_deny: true` — directly relevant to NullSpend's HITL actions.

---

## 6. Agent Framework Internals

### 6.1 How Frameworks Pass Trace Context

| Framework | Mechanism | Minimum Cooperation |
|---|---|---|
| Vercel AI SDK | `experimental_telemetry: { metadata }` | One config line |
| LangChain | `RunnableConfig.metadata` | Dict in config |
| AutoGen 0.4 | Native OTel `tracer_provider` | Provider injection |
| LiteLLM | `extra_body.metadata` | Body field |
| Claude Agent SDK | Hooks (`session_id`, `tool_use_id`) | Built-in |
| OpenAI Agents SDK | `TracingProcessor` interface | Custom processor |
| CrewAI | Defers to Portkey/Langfuse | Integration config |

### 6.2 Cost Tracking by Framework

| Framework | Built-in Cost | Granularity |
|---|---|---|
| OpenAI Agents SDK | Token counts per `Runner.run()` | Per-run aggregate; per-agent via `RunHooks` delta |
| Claude Agent SDK | `total_cost_usd` + `modelUsage` map | Per-`query()`, per-model breakdown |
| AutoGen 0.2 | `gather_usage_summary(agents)` | Per-agent, per-model |
| CrewAI | `crew.usage_metrics` | Flat aggregate only |
| Vercel AI SDK | `result.usage` + `result.steps` | Per-step tokens, no dollars |

### 6.3 Key Design Insight

LangChain's `CallbackManager` uses `inheritable_handlers` — tracing propagates to child runs automatically via `parent_run_id`. Vercel AI SDK's `steps` array captures every round-trip with `onStepFinish` callback. Both confirm: the trace tree mirrors the call stack.

---

## 7. Multi-Agent Cost Attribution

### 7.1 Attribution Models

| Model | How It Works | Who Uses It |
|---|---|---|
| **Caller Pays** | Top-level entity charged for all costs | OpenAI, Claude, LangGraph |
| **Per-Agent Attribution** | Each agent's costs tracked separately (informational) | AutoGen, Claude `modelUsage` |
| **Delegated Budget** | Parent allocates budget to child | **Nobody** (open problem) |

### 7.2 Token Waste in Multi-Agent Systems

| Framework | Token Duplication Rate |
|---|---|
| MetaGPT | 72% |
| CAMEL | 86% |
| AgentVerse | 53% |
| Anthropic multi-agent | ~15x vs single chat |

### 7.3 Hierarchical Budget Patterns

**Bifrost (Maxim AI)** — 4-tier hierarchy: Customer -> Team -> Virtual Key -> Provider Config. When any tier exceeded, requests blocked.

**Recommended check order:** Leaf to root (API Key -> Agent -> User -> Team -> Org). Deny on first exceeded entity. **Inheritance model** preferred over isolation (prevents oversubscription).

**NullSpend's position:** `budgets` table already supports `user | agent | api_key | team` entity types. Missing: `parent_budget_id` for inheritance and leaf-to-root check order.

### 7.4 Session-Level Cost Boundaries

| Framework | Run Boundary | Cost Scope |
|---|---|---|
| OpenAI Agents SDK | `Runner.run()` | All tokens in that run |
| Claude Agent SDK | `query()` call | Single query |
| LangGraph | Graph invocation | All nodes executed |
| AutoGen | `initiate_chat()` | All messages |
| CrewAI | `crew.kickoff()` | All tasks |

**Gap:** "Run" is too granular for budget enforcement, too coarse for cost attribution. Need session-level cost limits (e.g., "this agent session can spend at most $X").

### 7.5 Agent Identity

**Microsoft Entra Agent ID** — most sophisticated: OAuth 2.0 On-Behalf-Of (OBO) flow with delegation chains. Agent tokens include `xms_act_fct` (actor) and `xms_sub_fct` (subject). This is where enterprise multi-agent auth is heading.

**MCP:** Uses OAuth 2.1 with PKCE. `authInfo` identifies the user, NOT the agent. Multi-agent MCP sessions share auth context.

---

## 8. Streaming & Real-Time Cost

### 8.1 Provider Streaming Usage

**OpenAI:** Usage ONLY in final chunk (before `[DONE]`). Requires `stream_options: {"include_usage": true}`. No mid-stream reporting.

**Anthropic:** Input tokens in `message_start`, output tokens cumulative in `message_delta`. Partial mid-stream info (input known early) but output finalized only at end.

### 8.2 Mid-Stream Cost Estimation

| Technique | Accuracy | Latency | Viable in CF Worker? |
|---|---|---|---|
| Character counting (`chars / 4`) | ~70-80% | <1ms | Yes |
| Tiktoken WASM | 99%+ (OpenAI) | 5-15ms | No (WASM size) |
| Anthropic token counting API | 100% | 50-100ms | Yes (adds latency) |

### 8.3 SSE Cost Injection (Novel)

Inject custom SSE events mid-stream — clients ignore unknown event types:

```
event: token
data: {"content": "Hello"}

event: nullspend:usage
data: {"tokens_so_far": 150, "estimated_cost_microdollars": 3000}

event: token
data: {"content": " world"}
```

Backwards-compatible with OpenAI/Anthropic client SDKs. Nobody does this today.

### 8.4 Adaptive Estimation

Replace static 1.1x safety margin with learned multiplier:

```typescript
// Key: model + request shape hash
// Value: rolling stats of actual/estimated ratio
// Use p95 of ratio distribution for 95% coverage reservation
const p95Ratio = history.mean + 1.645 * history.stddev;
return Math.round(baseEstimate * p95Ratio);
```

Trains on historical `cost_events` data NullSpend already collects.

### 8.5 Cost Anomaly Detection

**Tier 1:** Fixed thresholds (NullSpend already has webhook thresholds at 50/80/90/95%).

**Tier 2:** Rate-of-spend detection — sliding window velocity with alerting.

**Tier 3:** EWMA (Exponentially Weighted Moving Average) — detects gradual cost creep:

```
ewma = alpha * costPerMinute + (1 - alpha) * ewma
zScore = residual / sqrt(ewmaVariance)
isAnomaly = |zScore| > sigma  (2-3 sigma threshold)
```

### 8.6 Runaway Agent Detection

An organization lost **$47K over 11 days** from an undetected agent loop. Detection heuristics a proxy can implement:

1. Same tool called >5x with similar arguments in a session
2. Each successive request more expensive than the last (growing context)
3. Session exceeds 30 min active requests
4. Cumulative input tokens grow linearly while output stays low

---

## 9. Proxy Architecture Patterns

### 9.1 AI Gateway Landscape

| Gateway | Key Innovation | Overhead |
|---|---|---|
| **Kong** | Per-model token rate limiting, OTel `gen_ai.*` emission | Plugin-based |
| **Envoy AI** | Endpoint Picker (real-time metrics routing), MCP routing, OpenInference tracing | CNCF/K8s-native |
| **Cloudflare** | Unified billing (preview), edge rate limiting | Managed service |
| **Traefik** | Proactive token estimation pre-request, semantic cache, LLM Guard | Composable pipeline |
| **MLflow** | Every gateway request auto-becomes a trace | Part of tracking server |
| **Bifrost** | 11 microsecond overhead at 5K RPS, MCP gateway | Go, pre-spawned workers |
| **Helicone** | Rebuilt in Rust, 1-5ms P95 at 10K RPS | Single binary |

### 9.2 Proxy-Side Intelligence (No Client Cooperation)

**Agent loop detection:**
- Request frequency anomaly (>10 req/min sustained for >30 min)
- Tool call count per session (>50 tool calls)
- Content similarity in last N messages
- Token accumulation rate (>1M tokens per session)

**Session boundary inference:**
- Timing gaps (>5 min between requests = new session)
- Context window resets (messages array drops to 1-2)
- Model switches (same key, different model = new task)

**Proactive rejection:** Traefik estimates token count from request body, blocks abusive requests before they reach the provider. NullSpend's `estimateMaxCost` already does this.

### 9.3 SSE Protocol for Cost Reporting

SSE `event` field enables multiplexing data types on one stream. Custom events (e.g., `event: nullspend:cost`) are ignored by standard clients. HTTP/2 eliminates SSE's 6-connection limit. Built-in reconnection via `Last-Event-ID`. NullSpend's reservation system correctly handles dropped connections.

### 9.4 Semantic Caching

| Platform | Approach | Hit Rate | Cost Savings |
|---|---|---|---|
| Portkey | SHA-256 exact match (KV) + vector similarity (Pinecone, 0.95 threshold) | ~20% at 99% accuracy | Varies |
| Helicone | Redis in-memory or S3 persistent | >90% for repetitive workloads | Significant |
| Traefik | Vector DB (Redis Stack/Weaviate/Milvus), `X-Cache-Status`/`X-Cache-Distance` headers | N/A | 40-70% |

**Cache-aware cost tracking:** Cached responses should NOT count toward spend but should be tracked separately with `cache_hit`, `tokens_saved`, `estimated_cost_if_not_cached` fields.

### 9.5 Cost-Aware Routing

Route to cheapest model meeting quality threshold. OpenRouter's `model:floor` suffix routes to lowest-price provider. Swfte reports 60% savings using dynamic Haiku/Sonnet/Opus routing.

### 9.6 Circuit Breaker Patterns

**Per-session cost:** Block when session exceeds threshold.
**Exponential back-pressure:** Progressive delay at 80/90/95/100% budget.
**Provider-level:** Track 5xx rate per upstream, mark unhealthy at >20% in 60s, cooldown 30s.

---

## 10. Billing Infrastructure

### 10.1 Stripe Token Billing (Preview)

Dedicated LLM billing product. Auto-creates meters for `input_tokens`, `output_tokens`, `cached_tokens`, segmented by model. Meter Events API v1: 1K events/sec. v2 Streams: 10K events/sec (200K with enterprise).

### 10.2 Lago (Open Source)

Event-driven: raw events with idempotency keys, ClickHouse pipeline, aggregation via COUNT/SUM/MAX/custom SQL. 15K events/sec throughput.

### 10.3 Orb

Query-based billing: all events in columnar OLAP store, billing = deterministic SQL query. Late-arriving events or pricing changes: re-run query. Opposite of NullSpend's real-time DO approach, but validates raw `cost_events` as the right foundation.

### 10.4 OpenMeter (Open Source)

Go + Kafka + ClickHouse. CloudEvents format, 1-minute tumbling windows in ClickHouse materialized views. Scales to millions of events/sec.

---

## 11. Strategic Analysis

### 11.1 NullSpend's Unique Position (After Tracing Implementation)

| Capability | NullSpend | Everyone Else |
|---|---|---|
| Dollar costs in traces | **Yes (first)** | Nobody — all give tokens only |
| Proxy + MCP tool tracking | **Yes** | Proxy OR SDK, not both |
| Budget enforcement + tracing | **Yes** | Enforcement OR tracing, not both |
| HITL approval gate | **Yes** | AgentOps has loop detection, not approval |
| Cost in response headers | **Planned** | Only LiteLLM |
| MCP `_meta` cost conventions | **Opportunity** | Nobody has claimed this |

### 11.2 Unclaimed Standards Opportunities

1. **OTel cost/billing attributes** — No specification standardizes dollar costs. NullSpend could propose `gen_ai.usage.cost` or similar.
2. **MCP `_meta` cost conventions** — `com.nullspend/cost_microdollars`, `com.nullspend/budget_remaining`. Nobody has proposed these.
3. **Delegated budget for sub-agents** — No framework implements parent-allocates-budget-to-child. Open problem.

### 11.3 Highest-Impact Features (Priority Order)

| Feature | Effort | Impact | Competitive Advantage |
|---|---|---|---|
| Accept `traceparent` + return cost headers | ~4h | High | Matches LiteLLM, exceeds Portkey/Helicone |
| Agent loop detection / session circuit breakers | ~6h | High | Only AgentOps has this; NullSpend's DO is ideal |
| Tool call stub extraction | ~6h | Medium | Proxy-side correlation without SDK |
| Cost rollup per trace API | ~4h | Medium | Dashboard "this run cost $X" |
| Adaptive estimation | ~4h | Medium | Better reservation accuracy, novel approach |
| MCP `_meta` cost conventions | ~3h | High (strategic) | First mover in unclaimed standard |
| Mid-stream SSE cost injection | ~4h | Medium | Nobody does this; differentiator |
| Hierarchical budget inheritance | ~8h | High (enterprise) | Bifrost-style, enterprise readiness |

---

## 12. References

### Standards & Specifications

- [OTel GenAI Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/) | [Client Spans](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/) | [Agent Spans](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-agent-spans/) | [Events](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-events/) | [Metrics](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-metrics/) | [MCP](https://opentelemetry.io/docs/specs/semconv/gen-ai/mcp/)
- [OTel GenAI Attribute Registry](https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/) | [MCP Registry](https://opentelemetry.io/docs/specs/semconv/registry/attributes/mcp/)
- [OTel Agentic Systems Proposal (Issue #2664)](https://github.com/open-telemetry/semantic-conventions/issues/2664) | [MCP PR #2083](https://github.com/open-telemetry/semantic-conventions/pull/2083)
- [OTel Blog: AI Agent Observability](https://opentelemetry.io/blog/2025/ai-agent-observability/) | [GenAI 2024](https://opentelemetry.io/blog/2024/otel-generative-ai/)

### MCP Specification

- [MCP Spec 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25) | [Tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools) | [Schema](https://github.com/modelcontextprotocol/specification/blob/main/schema/2025-11-25/schema.ts)
- [SEP-414: OTel Trace Context](https://modelcontextprotocol.io/community/seps/414-request-meta) | [SEP-2007: Payments](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/2008)
- [Discussion #1125: MCP fees](https://github.com/modelcontextprotocol/modelcontextprotocol/discussions/1125) | [Issue #711: Annotations](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/711)

### OWASP

- [AOS](https://aos.owasp.org/) | [Events](https://aos.owasp.org/spec/trace/events/) | [OTel Extension](https://aos.owasp.org/spec/trace/extend_opentelemetry/) | [MCP Instrumentation](https://aos.owasp.org/spec/instrument/extend_mcp/)

### Competitors

- [Portkey Gateway (GitHub)](https://github.com/Portkey-AI/gateway) | [LiteLLM (GitHub)](https://github.com/BerriAI/litellm) | [LiteLLM Cost Tracking](https://docs.litellm.ai/docs/proxy/cost_tracking) | [LiteLLM Budgets](https://docs.litellm.ai/docs/proxy/users)
- [Helicone Sessions](https://docs.helicone.ai/features/sessions) | [Helicone Custom Logging](https://docs.helicone.ai/getting-started/integration-method/custom)

### Observability Platforms

- [Langfuse (GitHub)](https://github.com/langfuse/langfuse) | [Langfuse Tracing](https://langfuse.com/docs/tracing) | [Langfuse OTel](https://langfuse.com/docs/integrations/opentelemetry) | [Langfuse Cost](https://langfuse.com/docs/model-usage-and-cost)
- [Arize Phoenix (GitHub)](https://github.com/Arize-ai/phoenix) | [OpenInference Spec](https://arize-ai.github.io/openinference/spec/)
- [Traceloop OpenLLMetry](https://github.com/traceloop/openllmetry) | [OpenLLMetry-JS](https://github.com/traceloop/openllmetry-js)
- [Braintrust Custom Tracing](https://www.braintrust.dev/docs/instrument/custom-tracing) | [Brainstore Architecture](https://www.braintrust.dev/blog/brainstore)
- [Humanloop Log API](https://humanloop.com/docs/v5/api-reference/prompts/log) | [.agent Files](https://humanloop.com/docs/reference/serialized-files)
- [W&B Weave Tracing](https://docs.wandb.ai/weave/guides/tracking/tracing) | [Weave Costs](https://docs.wandb.ai/weave/guides/tracking/costs)
- [Logfire AI Observability](https://logfire.pydantic.dev/docs/ai-observability/) | [Metrics in Spans](https://logfire.pydantic.dev/docs/reference/advanced/metrics-in-spans/)
- [Opik Tracing](https://www.comet.com/docs/opik/tracing/concepts) | [Opik Cost](https://www.comet.com/docs/opik/tracing/cost_tracking)
- [AgentOps Core Concepts](https://docs.agentops.ai/v2/concepts/core-concepts) | [AgentOps Spans](https://docs.agentops.ai/v2/concepts/spans)
- [Sentry AI Agents Module](https://develop.sentry.dev/sdk/telemetry/traces/modules/ai-agents/)
- [Datadog OTel GenAI](https://www.datadoghq.com/blog/llm-otel-semantic-convention/)

### Cloud Providers

- [OpenAI Agents SDK (GitHub)](https://github.com/openai/openai-agents-python) | [OpenAI Agents Tracing](https://openai.github.io/openai-agents-python/tracing/)
- [AWS Bedrock Trace Events](https://docs.aws.amazon.com/bedrock/latest/userguide/trace-events.html) | [Bedrock CloudWatch](https://docs.aws.amazon.com/bedrock/latest/userguide/monitoring-agents-cw-metrics.html)
- [AWS Bedrock Cost Attribution](https://aws.amazon.com/blogs/machine-learning/track-allocate-and-manage-your-generative-ai-cost-and-usage-with-amazon-bedrock/)
- [AgentCore Observability](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/observability.html)
- [Google A2A Protocol (GitHub)](https://github.com/a2aproject/A2A) | [A2A Traceability Extension](https://a2aprotocol.ai/docs/guide/traceability-extension-analysis)
- [Claude Agent SDK Hooks](https://platform.claude.com/docs/en/agent-sdk/hooks) | [Claude Agent SDK Cost](https://platform.claude.com/docs/en/agent-sdk/python)
- [Anthropic Usage & Cost API](https://platform.claude.com/docs/en/build-with-claude/usage-cost-api) | [Anthropic Pricing](https://platform.claude.com/docs/en/about-claude/pricing)

### Agent Frameworks

- [LangChain RunTree](https://reference.langchain.com/python/langsmith/observability/sdk/run_trees/) | [LangChain Callbacks](https://python.langchain.com/api_reference/core/callbacks/langchain_core.callbacks.base.BaseCallbackHandler.html)
- [AutoGen Usage Tracking](https://docs.ag2.ai/latest/docs/use-cases/notebooks/notebooks/agentchat_cost_token_tracking/) | [AutoGen OTel](https://microsoft.github.io/autogen/stable//user-guide/core-user-guide/framework/telemetry.html)
- [CrewAI AgentOps](https://docs.crewai.com/how-to/agentops-observability) | [CrewAI Enterprise Traces](https://docs.crewai.com/en/enterprise/features/traces)
- [Vercel AI SDK Telemetry](https://ai-sdk.dev/docs/ai-sdk-core/telemetry) | [Vercel AI SDK Tools](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling)

### AI Gateways

- [Kong AI Gateway](https://developer.konghq.com/ai-gateway/) | [Kong OTel](https://developer.konghq.com/ai-gateway/llm-open-telemetry/)
- [Envoy AI Gateway v0.3](https://aigateway.envoyproxy.io/blog/v0.3-release-announcement/) | [Envoy MCP](https://aigateway.envoyproxy.io/blog/mcp-in-envoy-ai-gateway/)
- [Cloudflare AI Gateway](https://developers.cloudflare.com/ai-gateway/)
- [Traefik AI Gateway](https://doc.traefik.io/traefik-hub/ai-gateway/overview) | [Traefik Semantic Cache](https://doc.traefik.io/traefik-hub/ai-gateway/middlewares/semantic-cache)
- [MLflow AI Gateway](https://mlflow.org/ai-gateway) | [Bifrost (GitHub)](https://github.com/maximhq/bifrost)
- [awesome-mcp-gateways](https://github.com/e2b-dev/awesome-mcp-gateways)

### Billing Infrastructure

- [Stripe Token Billing](https://docs.stripe.com/billing/token-billing) | [Stripe Meter Events](https://docs.stripe.com/api/billing/meter-event) | [Stripe v2 Streams](https://docs.stripe.com/api/v2/billing-meter-stream)
- [Lago Event Ingestion](https://getlago.com/docs/guide/events/ingesting-usage)
- [Orb Query-Based Billing](https://docs.withorb.com/architecture/query-based-billing)
- [OpenMeter ClickHouse Architecture](https://openmeter.io/blog/how-openmeter-uses-clickhouse-for-usage-metering)

### Streaming & Cost

- [OpenAI Streaming Usage Stats](https://community.openai.com/t/usage-stats-now-available-when-using-streaming-with-the-chat-completions-api-or-completions-api/738156)
- [Anthropic Streaming Messages](https://docs.anthropic.com/en/api/messages-streaming)
- [Token-Budget-Aware LLM Reasoning (ACL 2025)](https://aclanthology.org/2025.findings-acl.1274/)
- [SSE as LLM Streaming Backbone 2026](https://procedure.tech/blogs/the-streaming-backbone-of-llms-why-server-sent-events-(sse)-still-wins-in-2025)
- [Circuit Breaker Pattern for AI Agents](https://dev.to/tumf/ralph-claude-code-the-technology-to-stop-ai-agents-how-the-circuit-breaker-pattern-prevents-3di4)
