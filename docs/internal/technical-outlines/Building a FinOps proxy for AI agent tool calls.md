# Building a FinOps proxy for AI agent tool calls

**The real cost of AI agent workflows hides in tool calls, not tokens.** In a typical enterprise loan origination, LLM tokens cost ~$0.30 while the credit report costs $35–$75, identity verification $2–$5, and fraud scoring $1–$3 — making tokens less than 1% of total spend. Building an effective FinOps proxy requires intercepting tool calls at both the LLM API layer and the MCP protocol layer, tracking external API costs alongside token consumption, and enforcing budgets in real time. This document provides the complete technical foundation for building such a system, covering the MCP protocol wire format, LLM provider tool call representations, existing platform approaches, proxy architecture patterns, cost estimation techniques, and the latest specification details as of March 2026.

---

## 1. MCP protocol mechanics: the JSON-RPC wire format

The Model Context Protocol operates on **JSON-RPC 2.0** over UTF-8, with three message types: requests (with `id`, expecting a response), responses (mirroring the request `id`), and notifications (no `id`, fire-and-forget). The current specification version is **`2025-11-25`**, released on the one-year anniversary of MCP going public.

### Tool discovery: `tools/list`

A client discovers available tools by sending a `tools/list` request. The server responds with an array of tool definitions, each containing a name (1–128 characters, `[A-Za-z0-9_.-]`, case-sensitive), a human-readable description, an `inputSchema` conforming to JSON Schema 2020-12, and optional `outputSchema`, `annotations`, and `icons`:

```json
// Request
{"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {"cursor": "optional-cursor"}}

// Response
{"jsonrpc": "2.0", "id": 1, "result": {
  "tools": [{
    "name": "get_weather",
    "title": "Weather Provider",
    "description": "Get current weather for a location",
    "inputSchema": {
      "type": "object",
      "properties": {"location": {"type": "string"}},
      "required": ["location"]
    },
    "outputSchema": {
      "type": "object",
      "properties": {"temperature": {"type": "number"}, "conditions": {"type": "string"}},
      "required": ["temperature", "conditions"]
    },
    "annotations": {
      "readOnlyHint": true, "destructiveHint": false,
      "idempotentHint": true, "openWorldHint": true
    }
  }],
  "nextCursor": "next-page-cursor"
}}
```

Pagination is supported via cursors. Servers that support dynamic tool registration declare `"tools": {"listChanged": true}` in their capabilities and emit `notifications/tools/list_changed` when the tool set changes.

### Tool invocation: `tools/call`

The client invokes a tool by sending a `tools/call` request with the tool `name` and `arguments` object. The server returns a `content` array (text, image, audio, or resource items) and an optional `structuredContent` object (introduced in spec version `2025-06-18`):

```json
// Request
{"jsonrpc": "2.0", "id": 2, "method": "tools/call",
 "params": {"name": "get_weather", "arguments": {"location": "New York"}}}

// Success response
{"jsonrpc": "2.0", "id": 2, "result": {
  "content": [{"type": "text", "text": "Temperature: 72°F, Partly cloudy"}],
  "structuredContent": {"temperature": 22.5, "conditions": "Partly cloudy"},
  "isError": false
}}

// Error response (tool execution failed)
{"jsonrpc": "2.0", "id": 4, "result": {
  "content": [{"type": "text", "text": "Invalid date: must be in the future"}],
  "isError": true
}}

// Protocol error (unknown tool)
{"jsonrpc": "2.0", "id": 3, "error": {"code": -32602, "message": "Unknown tool: bad_name"}}
```

The `isError` field distinguishes tool-level failures (the tool ran but produced an error) from protocol-level errors (JSON-RPC error object). Content items support audience annotations (`"user"`, `"assistant"`) and priority values (0.0–1.0), which a proxy can use to filter what gets logged.

### The complete tool call lifecycle

The flow spans both the MCP protocol and the LLM API, with the MCP client serving as orchestrator:

1. **Discovery** — Client sends `tools/list` to each connected MCP server, collects tool schemas
2. **Schema injection** — Client converts MCP tool schemas into the LLM provider's format (OpenAI `tools` parameter, Anthropic `tools` parameter) and includes them in the LLM API request
3. **LLM decision** — The LLM returns a tool call request (OpenAI `tool_calls` array, Anthropic `tool_use` block)
4. **Invocation** — Client sends `tools/call` to the appropriate MCP server
5. **Result injection** — Client takes the MCP tool result and sends it back to the LLM as a tool result message (OpenAI `role: "tool"`, Anthropic `tool_result` block)
6. **Continuation** — LLM processes the result and either makes another tool call or produces a final response

**This dual-layer architecture is why a FinOps proxy needs to intercept at both layers.** The LLM layer reveals token costs and model decisions; the MCP layer reveals external tool execution costs and timing.

### Transports: stdio vs Streamable HTTP

MCP supports exactly two official transports as of the `2025-11-25` spec:

**stdio** launches the MCP server as a subprocess. The client writes JSON-RPC to stdin and reads from stdout, with newline delimiters. Best for local integrations (Claude Desktop, Cursor). Serves exactly one client. Proxying requires spawning the proxy as the child process, which then spawns the actual server as its own child.

**Streamable HTTP** (introduced `2025-03-26`, replacing the deprecated HTTP+SSE transport) uses a single HTTP endpoint for all communication. The client sends JSON-RPC messages as POST requests; the server responds with either `application/json` (single response) or `text/event-stream` (SSE stream for multiple messages). Session management uses the `Mcp-Session-Id` header. Clients can also open GET connections for server-initiated messages. Security requirements include Origin header validation and binding to `127.0.0.1` for local servers.

The transport choice affects proxy architecture significantly. stdio proxying requires process management and is inherently single-client. HTTP proxying supports standard middleware patterns, connection pooling, and horizontal scaling — making it the preferred transport for production FinOps proxies.

---

## 2. How tool calls appear in LLM API requests and responses

Understanding the exact wire format at the LLM layer is essential for intercepting and costing tool calls.

### OpenAI: the `tool_calls` array

OpenAI's Chat Completions API accepts tool definitions in a `tools` array, where each tool is wrapped in `{"type": "function", "function": {...}}`. When the model decides to invoke a tool, the assistant message contains a `tool_calls` array:

```json
// Assistant response with tool calls
{"role": "assistant", "content": null, "tool_calls": [
  {"id": "call_DdmO9pD3xa9XTPNJ32zg2hcA", "type": "function",
   "function": {"name": "get_weather", "arguments": "{\"location\": \"Paris\"}"}}
]}
```

**The `arguments` field is a JSON string, not a parsed object** — a common source of bugs. Tool results are sent back as messages with `role: "tool"` and a `tool_call_id` matching the original call. OpenAI supports parallel tool calls: multiple tool calls in a single response, each with a unique ID.

During streaming, tool calls arrive as deltas with `delta.tool_calls[index].function.arguments` containing partial JSON strings that must be accumulated and parsed on `finish_reason: "tool_calls"`.

### Anthropic: content block architecture

Anthropic uses a fundamentally different structure. Tool definitions use `input_schema` (not `parameters`), with no wrapping `function` object. The assistant response contains `tool_use` content blocks alongside text blocks:

```json
{"role": "assistant", "content": [
  {"type": "text", "text": "I'll check the weather for you."},
  {"type": "tool_use", "id": "toolu_01A09q90qw90lq917835lq9",
   "name": "get_weather", "input": {"location": "San Francisco, CA"}}
], "stop_reason": "tool_use"}
```

**The `input` field is a parsed JSON object, not a string** — the opposite of OpenAI's format. Tool results use `tool_result` content blocks within user messages, referencing the `tool_use_id`. Anthropic streams tool calls via `content_block_start` (name and ID), `content_block_delta` with `input_json_delta` (partial JSON), and `content_block_stop`.

### Token counting and billing for tool calls

**Both providers bill tool definitions as input tokens on every request.** In multi-turn conversations, tool schemas are resent and re-billed each turn unless cached. This is the single largest hidden cost in tool-heavy workflows.

**OpenAI's token overhead** follows specific constants documented in the official cookbook: each function adds **7 tokens** base overhead (GPT-4o/mini), each property adds **3 tokens**, each enum item adds **3 tokens**, plus **12 tokens** at the end of all function definitions. A typical tool definition with 5 parameters consumes ~100–500 tokens. There is no separate billing rate — tool tokens are charged at standard input/output rates. OpenAI provides no dedicated token counting endpoint; use `tiktoken` with the model's encoding plus the overhead constants.

**Anthropic's token overhead** is more transparent. When tools are provided, Anthropic injects an automatic system prompt consuming **346 tokens** (Claude 4.x models with `tool_choice: auto`) or **313 tokens** (with `tool_choice: any/tool`) in addition to the tokens for the tool schemas themselves. Anthropic provides a **free `/v1/messages/count_tokens` endpoint** that accepts the full request payload and returns exact token counts — the recommended approach for pre-flight cost estimation. Anthropic's prompt caching with `cache_control` on tool definitions reduces repeat costs by **90%** on cache hits.

**Tool call arguments** in model responses count as output tokens. **Tool results** sent back count as input tokens on the next request. A 10KB API response injected as a tool result can consume thousands of input tokens. The three billing categories in 2026 are input tokens (what you send), output tokens (what the model returns), and reasoning tokens (internal "thinking" in models like GPT-5.2 and Claude 4 Opus, priced at or above output rates).

---

## 3. How existing platforms track tool call costs

The observability landscape reveals a critical gap: most platforms track tokens well but ignore external tool costs.

### LiteLLM: configurable per-tool pricing

LiteLLM operates as both a Python SDK and AI Gateway proxy, with the most mature MCP cost tracking among open-source platforms. It tracks LLM-level tool calls in the standard `tool_calls` response field and MCP tool calls through a dedicated `/mcp` endpoint. Cost calculation uses a community-maintained model cost map (`model_prices_and_context_window.json`) for token-based costs, plus configurable per-tool pricing for MCP calls:

```yaml
# LiteLLM config.yaml
mcp_server_cost_info:
  default_cost_per_query: 0.01
  tool_name_to_cost_per_query:
    send_email: 0.05
    credit_check: 35.00
    identity_verify: 2.00
```

For dynamic pricing, a `CustomLogger` subclass with `async_post_mcp_tool_call_hook()` receives tool name, server name, start/end times, and allows setting custom costs. The limitation is that MCP cost tracking relies entirely on manual configuration — there is no auto-discovery of external tool costs.

### Langfuse: hierarchical trace model

Langfuse provides the most sophisticated data model with explicit observation types: `span`, `generation`, `agent`, `tool`, `chain`, `retriever`, `evaluator`. Tool calls are represented as `tool` observations nested within agent and generation spans, enabling rich hierarchical tracing. Cost is calculated using ingested token counts (highest priority) or inferred from model definitions with built-in tokenizers. However, **tool observations don't have inherent cost** — cost is attributed to the LLM generation that triggered the call. External tool execution costs must be manually added via `langfuse.update_current_span()`.

### Portkey: gateway-level MCP logging

Portkey's AI Gateway captures every request passing through, with a dedicated MCP Gateway that logs all tool calls with user, parameters, response, and latency. It maintains pricing for **2,300+ models** across 40+ providers, auto-updating in SaaS deployments. MCP tool call costs track only the LLM interaction cost, not external service fees. Budget limits can be enforced per provider/model with configurable spending thresholds.

### Revenium: the external cost problem solved

Revenium's Tool Registry, generally available since March 3, 2026, is the only platform that natively tracks external tool invocation costs alongside token costs. Its core thesis: **tokens are the smallest line item in enterprise AI**. The registry lets organizations register any cost source — REST APIs, MCP servers, SaaS platforms, internal compute, and even human review time — with per-call or tiered pricing. Every invocation is metered back to the specific agent, workflow, trace, and customer that triggered it. Uniquely, Revenium offers **circuit breakers** that halt execution when per-trace or per-workflow cost ceilings are reached, enforcing during execution rather than reporting after the fact. The attribution hierarchy flows from organization → product → agent → customer → workflow → trace → tool invocation.

### The platform comparison at a glance

| Platform | Token costs | External tool costs | MCP support | Budget enforcement |
|----------|------------|-------------------|-------------|-------------------|
| **LiteLLM** | ✅ Token pricing map | ✅ Config-based per-tool | ✅ `/mcp` endpoint | ✅ Hard caps |
| **Langfuse** | ✅ Model definitions + tokenizers | ⚠️ Manual span updates | ✅ MCP Tracing feature | ❌ Reporting only |
| **Portkey** | ✅ 2,300+ model pricing | ⚠️ LLM costs only | ✅ MCP Gateway | ✅ Budget limits |
| **Revenium** | ✅ SDK middleware | ✅ Core differentiator | ✅ `revenium-mcp` repo | ✅ Circuit breakers |
| **AgentOps** | ✅ Token-based | ⚠️ API monitoring only | ❌ | ✅ Cost alerts |
| **Helicone** | ✅ Model Registry v2 | ⚠️ LLM costs only | ❌ | ❌ |

The industry is converging on **OpenTelemetry** as the standard telemetry protocol. Langfuse, Portkey, AgentOps, and the OpenClaw ecosystem all support or are built on OTEL, enabling interoperability between platforms.

---

## 4. MCP proxy architecture for tool call interception

An MCP proxy interposes between clients and servers, intercepting all JSON-RPC messages. The fundamental architecture:

```
[MCP Client] ←transport→ [MCP Proxy] ←transport→ [MCP Server(s)]
```

### Interception points and patterns

The proxy must handle these critical JSON-RPC methods: `initialize`/`initialized` (lifecycle), `tools/list` (discovery — where schemas can be modified or cached), `tools/call` (execution — the primary cost-tracking point), and `notifications/tools/list_changed` (dynamic updates). Four architectural patterns emerge from existing implementations:

**Transport Bridge** (sparfenyuk/mcp-proxy, Python): Converts between stdio and SSE/Streamable HTTP. The proxy spawns as a child process for stdio-based clients, connects to remote HTTP servers, enabling Claude Desktop to reach remote MCP servers.

**Aggregation Gateway** (MetaMCP, tbxark/mcp-proxy in Go): Multiple upstream servers appear as one to the client. Routes `tools/call` to the correct backend. Essential for managing dozens of MCP servers.

**Plugin Middleware** (mcp-proxy-wrapper, TypeScript): The most relevant pattern for FinOps. Provides `beforeToolCall` and `afterToolCall` hooks through a plugin interface:

```typescript
interface ProxyPlugin {
  beforeToolCall?(context: PluginContext): Promise<void | ToolCallResult>;
  afterToolCall?(context: PluginContext, result: ToolCallResult): Promise<ToolCallResult>;
  onError?(error: PluginError): Promise<void | ToolCallResult>;
}
```

This enables timing measurement, cost attribution, rate limiting (fixed window, sliding window, token bucket), caching, and audit logging without modifying original server code.

**Intelligent Router** (mcpproxy-go, Go): Uses BM25 search to return only the top-K relevant tools per query, achieving **~99% token reduction** in tool schema overhead with 43% accuracy improvement. Includes security quarantine for new/changed MCP servers.

### LLM proxy layer vs MCP proxy layer

These serve fundamentally different purposes. An **LLM API proxy** (Portkey, LiteLLM, Helicone) intercepts HTTP calls to OpenAI/Anthropic, seeing the full conversation context, token usage, and model decisions — but not the external tool execution. An **MCP proxy** intercepts JSON-RPC between client and server, seeing tool invocations and results — but not the LLM conversation that triggered them. **A production FinOps system needs both layers**, unified through a shared trace ID propagated across both proxies.

### Timeout, retry, and error handling

MCP defines error code `-32001` for request timeouts (commonly 60 seconds default). Retry strategies vary by transport: for HTTP, standard exponential backoff with jitter; for stdio, the server process may need restart. The critical caveat is that **`tools/call` with side effects should not be retried blindly** — the `idempotentHint` annotation indicates whether safe retries are possible. Circuit breaker patterns (Closed → Open → Half-Open) are implemented in IBM's mcp-context-forge and the MCP Go SDK.

### Open-source implementations worth examining

The most relevant open-source projects for a FinOps proxy: **mcp-plugins/mcp-proxy-wrapper** (TypeScript, plugin-based with `beforeToolCall`/`afterToolCall` hooks), **smart-mcp-proxy/mcpproxy-go** (Go, intelligent routing with security quarantine), **Portkey Gateway** (open-source core, enterprise MCP control plane), and **Gravitee 4.10** (MCP-method-aware caching, rate limiting, and payload transformation). For cloud-specific needs, **aws/mcp-proxy-for-aws** handles SigV4 authentication.

---

## 5. Security considerations for MCP proxying

**Tool poisoning is the most critical MCP vulnerability class**, first described by Invariant Labs in early 2025. Malicious instructions embedded in tool descriptions, parameter names, or any JSON schema field are processed by the LLM but typically hidden from users. Research shows **5.5% of public MCP servers** contain tool poisoning vulnerabilities and **43% contain command injection flaws**. The MCPTox benchmark found attack success rates exceeding **60%** for models like GPT-4o-mini and o1-mini, with more capable models often being more vulnerable due to better instruction-following.

Real-world incidents include WhatsApp message history exfiltration via poisoned tool descriptions, GitHub MCP prompt injection through malicious public issues, and **CVE-2025-6514** (CVSS 9.6) — a critical OS command injection in `mcp-remote` affecting 437,000+ downloads where server-provided OAuth endpoints were passed to the system shell without validation.

**"Rug pull" attacks** exploit MCP's dynamic nature: tools can mutate their definitions after installation, presenting benign descriptions initially and switching to malicious ones later. OWASP published the **MCP Top 10 for 2025**, with tool poisoning (MCP01) and supply chain attacks (MCP04) leading the list.

A proxy mitigates these risks through tool description hashing (detecting rug pulls), output sanitization (filtering suspicious patterns), access control (per-tool permissions), and audit logging. The `mcpproxy-go` project implements automatic security quarantine for new or changed servers. Snyk Agent Scan (formerly `mcp-scan`) detects 15+ risk types including poisoning, shadowing, and toxic flows.

---

## 6. Cost estimation: from token counting to unified budgets

### Tool schema overhead is a constant tax

With **10 tools × 500 tokens each = 5,000 tokens of base overhead per request** — before any user content — tool schema overhead compounds rapidly in multi-turn conversations. For OpenAI, use `tiktoken` with the model's encoding (`o200k_base` for GPT-4o) plus the documented overhead constants (7 base + 3 per property + 12 terminal). For Anthropic, the `/v1/messages/count_tokens` endpoint gives exact counts. The `mcpproxy-go` approach of returning only top-K relevant tools per query achieves ~99% token reduction — a critical optimization when tools number in the dozens.

Prompt caching dramatically reduces repeat costs. Anthropic's explicit `cache_control` on tool definitions yields **90% savings** on cache hits. OpenAI's automatic prefix caching applies to matching tool definition prefixes. For a FinOps proxy, tracking cache hit rates per tool set is essential for accurate cost attribution.

### The BATS framework: budget-aware tool scheduling

Google's **BATS (Budget-Aware Test-time Scaling)** framework, published December 2025, is the first systematic study of budget-constrained tool-use agents. Its key innovation is a **Budget Tracker** — a lightweight plug-in that injects remaining budget information into the agent's reasoning loop after every tool response:

```
<budget>
Query Budget Used: 7, Query Budget Remaining: 93
URL Budget Used: 2, URL Budget Remaining: 98
</budget>
```

The core finding: standard agents hit a "performance ceiling" where they feel "satisfied" after ~30 calls and stop early, leaving ~70 calls unused. Simply increasing the budget doesn't help without explicit budget awareness. With BATS, Gemini-2.5-Pro achieves equivalent accuracy with **40.4% fewer search calls, 19.9% fewer browse calls, and 31.3% lower total cost**.

BATS formalizes a **unified cost metric**: `Total Cost = Σ(token costs) + Σ(tool_call_count × price_per_call)`. Its budget-adaptive strategy allocates effort based on remaining resources: diverse exploration at high budget, precise targeting at medium, focused queries at low, and answering with existing information at critical levels. This framework provides the mathematical foundation for a FinOps proxy's budgeting system.

### External API cost tracking: the 99% problem

Revenium's launch crystallizes what many enterprise teams discovered independently: **tokens are often less than 1% of total workflow cost**. The FinOps proxy must track three categories:

- **Token costs**: LLM input, output, and reasoning tokens at provider-specific rates
- **Tool execution costs**: Fixed per-call costs (credit reports at $35), variable costs (database queries based on data volume), and delayed costs (background jobs invoiced monthly)
- **Human-in-the-loop costs**: Review time, approval cycles, escalation handling

A **tool cost registry** is the core data structure — a mapping from tool names to pricing models. LiteLLM implements this as `mcp_server_cost_info` in YAML config. Revenium provides a full registry with per-call and tiered pricing. Moesif offers per-JSON-RPC-method billing with payload-size-based pricing for variable costs.

For delayed costs, the pattern is estimation at execution time (using registry defaults) followed by reconciliation when vendor invoices arrive, with gap analysis between estimated and actual spend per workflow.

---

## 7. Design patterns for a production FinOps proxy

### Dual-layer interception architecture

The recommended architecture intercepts at both layers with a shared trace context:

```
[Agent/LLM Client]
    ↓ (LLM API calls)
[LLM Proxy Layer] ── token tracking, model routing, caching
    ↓ (traces with trace_id)
[MCP Client/Orchestrator]
    ↓ (JSON-RPC)  
[MCP Proxy Layer] ── tool cost tracking, rate limiting, security
    ↓
[MCP Servers] → [External APIs: Stripe, Equifax, Google Maps...]
```

The LLM proxy layer handles token counting, model routing, prompt caching (20–30% cost reduction), and failover. The MCP proxy layer handles external API cost attribution, tool-level rate limiting, security scanning, and execution timing. Both layers emit traces to a unified observability backend (Langfuse, Revenium, or a custom OTEL collector) keyed by a shared trace ID.

### Unified budget management

The BATS unified cost metric provides the formal model: `Total_Cost = Σ(input_tokens × price_per_input_token) + Σ(output_tokens × price_per_output_token) + Σ(tool_calls × price_per_tool_call)`. Implementation requires:

- **Pre-execution estimation**: Use tiktoken/countTokens for token costs, tool cost registry for tool costs, BATS planning module for step-level estimates
- **Runtime enforcement**: Hard dollar limits (AgentBudget library: `agentbudget.init("$5.00")`), velocity-based circuit breakers (detect $1.00 in 10 seconds vs normal $1.00 over 10 minutes), and budget injection into agent context (BATS pattern)
- **Post-execution reconciliation**: Match vendor invoices to trace IDs, compute actual vs estimated costs, flag anomalies

**Tiered enforcement** works best: soft limits inject warnings into the agent's context, hard limits reject requests, and velocity-based circuit breakers catch runaway loops automatically. IDC found that **92% of organizations** implementing agentic AI reported higher-than-expected costs, making circuit breakers non-negotiable.

### Handling variable and delayed costs

For tools with variable costs (database queries where cost depends on data volume), the proxy should meter by bytes transferred or payload size at the MCP layer, then map to pricing tiers. Different tools within a single MCP server can use different pricing models — Moesif supports mixing per-call, per-byte, and per-outcome billing.

For tools with delayed cost feedback (background jobs, monthly-invoiced SaaS), the proxy records an estimated cost at execution time using registry defaults, then supports post-hoc reconciliation when actual costs arrive. Revenium supports async cost attribution where external vendor invoices are reconciled back to specific traces after the fact.

### The critical metrics

A production FinOps proxy should track six core metrics:

- **Cost per agent session** (tokens + tools + external APIs, unified)
- **Cost velocity** (dollars per minute during execution — the best runaway detector)
- **Tool schema overhead ratio** (tool definition tokens vs useful content tokens)
- **Cache hit rate** (for both prompt caching and tool result caching)
- **Tool call efficiency** (necessary vs redundant calls, measured by BATS-style budget utilization)
- **Cost per business outcome** (e.g., cost per resolved ticket, cost per completed loan application)

---

## 8. Latest MCP specification details (2025-11-25)

The `2025-11-25` release added several features relevant to FinOps proxies:

**Tasks** (experimental) allow any request to return a task handle for async "call-now, fetch-later" patterns. Tools declare `taskSupport` as `"forbidden"`, `"optional"`, or `"required"`. Task states include `working`, `input_required`, `completed`, `failed`, and `cancelled`. This is relevant for tools that trigger long-running background jobs — the proxy can track task lifecycle and attribute costs when tasks complete.

**Tool annotations** (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) provide behavioral hints that a proxy can use for policy decisions: read-only tools may be safely cached, idempotent tools may be safely retried, and destructive tools should require confirmation. These annotations are **untrusted unless from a trusted server** — a proxy should verify rather than blindly trust them.

**Structured tool output** (`outputSchema` + `structuredContent`) enables typed tool responses. A proxy can validate structured outputs against the schema and extract specific fields for cost-relevant metrics (e.g., a tool returning `{"api_calls_made": 3, "bytes_processed": 50000}` enables variable cost calculation).

**OAuth 2.1 authorization** uses Authorization Code with PKCE for Streamable HTTP transport. MCP servers are classified as OAuth Resource Servers (RFC 9728) with mandatory Resource Indicators (RFC 8707) to prevent token misuse. The `2025-11-25` spec added Client Credentials flow for machine-to-machine auth — relevant for automated FinOps proxies that need to authenticate without human interaction. Token passthrough is prohibited; MCP servers must not forward tokens downstream.

The **2026 roadmap** (published March 2026) focuses on evolving Streamable HTTP for stateless horizontal scaling and decoupling sessions from the transport layer — both of which simplify proxy deployment at scale.

---

## Conclusion: building the FinOps proxy

The architecture for an effective AI agent FinOps proxy is now well-defined. **Intercept at both the LLM API and MCP protocol layers**, unified by shared trace IDs. Use the MCP proxy layer's `beforeToolCall`/`afterToolCall` hooks (following the mcp-proxy-wrapper pattern) for timing, cost attribution, and security scanning. Maintain a tool cost registry with per-tool pricing models — fixed, variable, and tiered — following LiteLLM's config approach for simple cases and Revenium's registry pattern for enterprise complexity.

The most impactful insight from Google's BATS research is that **budget awareness alone reduces costs by 31%+** with no accuracy loss. Injecting remaining budget information into the agent's context after each tool call is a low-effort, high-reward optimization. Combine this with velocity-based circuit breakers (not just total caps) to catch runaway loops in seconds rather than hours.

The market is moving fast: Revenium's Tool Registry, Google's BATS, and AgentBudget all launched in the last four months. The convergence on OpenTelemetry as the standard telemetry protocol, the maturation of MCP proxy patterns, and the growing awareness that tokens represent less than 1% of enterprise AI costs together create a clear opportunity for purpose-built FinOps tooling. The proxy that wins will be the one that unifies token costs, tool costs, and human costs into a single, actionable budget — tracked in real time, enforced at execution time, and reconciled against actual vendor invoices.