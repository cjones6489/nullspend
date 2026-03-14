# NullSpend technical build spec: trust-first AI agent FinOps proxy

**NullSpend requires a proxy that intercepts LLM API calls and MCP tool invocations, enforces budgets atomically, and tracks costs with sub-cent accuracy across every major provider.** This spec covers the exact API response formats, known bugs to avoid, protocol details, and architecture patterns needed to build it. Every field name, pricing multiplier, and edge case documented below has been verified against official provider documentation and real-world implementations as of March 2026.

The competitive landscape reveals a critical gap: LiteLLM's budget enforcement has **at least 5 documented bypass vulnerabilities** rooted in architectural flaws. Helicone and Portkey solve observability but not proactive budget enforcement. Google's BATS framework demonstrates that budget-aware agents outperform budget-blind ones by 22%, but it operates at the prompt level with no infrastructure-layer enforcement. NullSpend can own the intersection — a proxy that enforces hard budget ceilings while enabling BATS-style budget awareness in the agent's context.

---

## 1. LLM API response formats and cost calculation

### OpenAI Chat Completions API usage object

Every non-streaming response includes a `usage` object. The **exact fields** as of GPT-5 and o-series models:

```json
{
  "usage": {
    "prompt_tokens": 19,
    "completion_tokens": 10,
    "total_tokens": 29,
    "prompt_tokens_details": {
      "cached_tokens": 0,
      "audio_tokens": 0
    },
    "completion_tokens_details": {
      "reasoning_tokens": 0,
      "audio_tokens": 0,
      "accepted_prediction_tokens": 0,
      "rejected_prediction_tokens": 0
    }
  }
}
```

**Critical semantics**: `cached_tokens` is a **subset** of `prompt_tokens`, not additive. `reasoning_tokens` is a **subset** of `completion_tokens`. The cost formula is:

```
cost = (prompt_tokens - cached_tokens) × input_rate
     + cached_tokens × cached_input_rate
     + completion_tokens × output_rate
```

The newer **Responses API** uses different field names (`input_tokens`, `output_tokens`, `input_tokens_details`, `output_tokens_details`) but identical semantics.

### Anthropic Messages API usage object

```json
{
  "usage": {
    "input_tokens": 2095,
    "output_tokens": 503,
    "cache_creation_input_tokens": 2095,
    "cache_read_input_tokens": 0
  }
}
```

**This is the #1 source of bugs across the ecosystem.** Anthropic's `input_tokens` represents ONLY uncached tokens. Total input = `input_tokens` + `cache_creation_input_tokens` + `cache_read_input_tokens`. This is the opposite of OpenAI, where `cached_tokens` is a subset of `prompt_tokens`. The cost formula:

```
cost = input_tokens × base_input_rate
     + cache_creation_input_tokens × (1.25 × base_input_rate)  // 5-min TTL
     + cache_read_input_tokens × (0.1 × base_input_rate)       // 90% discount
     + output_tokens × output_rate
```

For **1-hour TTL cache writes**, the multiplier is **2.0×** instead of 1.25×. Anthropic also introduced a `cache_creation` sub-object breaking down ephemeral TTLs:

```json
"cache_creation": {
  "ephemeral_5m_input_tokens": 456,
  "ephemeral_1h_input_tokens": 100
}
```

### Google Gemini usageMetadata

```json
{
  "usageMetadata": {
    "promptTokenCount": 100,
    "candidatesTokenCount": 250,
    "totalTokenCount": 350,
    "cachedContentTokenCount": 80,
    "thoughtsTokenCount": 50
  }
}
```

Python SDK uses `snake_case` equivalents. `thoughtsTokenCount` is billed as output tokens. Implicit caching (automatic on Gemini 2.5+) gives **90% discount** on cached tokens with no storage cost. Explicit caching has a configurable TTL with storage charges of **$1.00–$4.50/MTok/hour** depending on model.

### AWS Bedrock Converse API

```json
{
  "usage": {
    "inputTokens": 30,
    "outputTokens": 628,
    "totalTokens": 658
  },
  "metrics": { "latencyMs": 1275 }
}
```

Uses **camelCase** (not snake_case). Cache fields appear in invocation logs: `cacheReadInputTokenCount`, `cacheWriteInputTokenCount`. When calling Claude via Bedrock's native InvokeModel (not Converse), the response uses Anthropic's native snake_case format.

### Azure OpenAI

Identical to standard OpenAI except Azure may return `null` instead of `0` for unused detail fields. For Provisioned deployments, cached tokens get up to **100% discount**.

### Streaming usage data handling

**OpenAI** requires `stream_options: {"include_usage": true}`. Usage arrives in the **final SSE chunk** before `data: [DONE]`, with an empty `choices` array:

```
data: {"id":"chatcmpl-xxx","choices":[],"usage":{"prompt_tokens":23,"completion_tokens":34,"total_tokens":57,"completion_tokens_details":{"reasoning_tokens":0},"prompt_tokens_details":{"cached_tokens":0}}}
```

**Anthropic** splits usage across two events. Input counts arrive in `message_start`; output counts arrive in `message_delta`. The `message_delta` values are **cumulative**, not incremental — this is the root cause of double-counting bugs across the ecosystem. A proxy must use ONLY the `message_start` for input tokens and ONLY the final `message_delta` for output tokens, never summing them.

**Bedrock ConverseStream** sends usage in a final `metadata` event after `messageStop`.

### Reasoning tokens (o1, o3, o4-mini)

Reasoning tokens appear inside `completion_tokens_details.reasoning_tokens`. They are **included within** `completion_tokens` (not additive), billed at the output token rate, and **invisible** in the response content. A simple prompt can generate **192 hidden reasoning tokens** for 22 visible output tokens. Control with `reasoning_effort` ("low"/"medium"/"high") or `max_completion_tokens`. Gemini's equivalent is `thoughtsTokenCount`; Anthropic's extended thinking produces visible `{"type": "thinking"}` content blocks billed as output.

### Cache token double-counting bugs to avoid

Five documented bugs that NullSpend must not replicate:

- **Langfuse #12306**: OTel semantic convention defines `gen_ai.usage.input_tokens` as total input. Tools like pydantic-ai correctly sum Anthropic's three fields to get total. Langfuse then adds cache counts again on top, producing **2× the real cost**.
- **LangChain.js #10249**: Anthropic streaming sends cache counts in both `message_start` and cumulative `message_delta`. LangChain's `mergeInputTokenDetails` adds them: `output.cache_read = (a?.cache_read ?? 0) + (b?.cache_read ?? 0)`, yielding **exactly double**.
- **LiteLLM #5443**: Only counted non-cached `input_tokens`, completely missing cache read/write costs.
- **LiteLLM #6575**: Calculated cache write cost as `base_cost + surcharge` instead of `cache_write_rate × tokens`, overcharging.
- **Cline #4346**: Treated cumulative `message_delta` cache fields as incremental deltas.

### Current pricing reference table (per MTok, March 2026)

| Model | Input | Cached Input | Output | Cache Write |
|-------|-------|-------------|--------|-------------|
| GPT-5 | $1.25 | $0.125 (90% off) | $10.00 | — |
| GPT-4.1 | $2.00 | $0.50 (75% off) | $8.00 | — |
| GPT-4o | $2.50 | $1.25 (50% off) | $10.00 | — |
| o3 | $2.00 | $0.50 (75% off) | $8.00 | — |
| o4-mini | $1.10 | $0.275 (75% off) | $4.40 | — |
| Claude Sonnet 4.6 | $3.00 | $0.30 (read) | $15.00 | $3.75 (5m) / $6.00 (1h) |
| Claude Opus 4.6 | $5.00 | $0.50 (read) | $25.00 | $6.25 (5m) / $10.00 (1h) |
| Claude Haiku 4.5 | $1.00 | $0.10 (read) | $5.00 | $1.25 (5m) / $2.00 (1h) |
| Gemini 2.5 Pro ≤200K | $1.25 | $0.31 | $10.00 | — |
| Gemini 2.5 Flash | $0.30 | $0.03 | $2.50 | — |

OpenAI has **no cache write surcharge**. Anthropic charges 1.25× base for 5-min writes and 2.0× for 1-hour writes. Anthropic long context (>200K input) doubles all rates. Batch API is 50% discount across all providers.

---

## 2. LiteLLM budget enforcement bugs and architectural lessons

### Issue #11083: end-user budgets via `user` header are never enforced

When a budget is set for an end-user identified by the `user` field in the request body, LiteLLM's `UserAPIKeyAuth` object never populates `max_budget` from `LiteLLM_BudgetTable` for that end-user. The authentication middleware in `user_api_key_auth.py` authenticates the **key** but treats end-user budget checking as a secondary step that was never properly wired. A community PR (#9658) attempted to fix this but was closed without merge. **Root cause**: end-user identity is decoupled from key identity, and budget enforcement only runs for the primary auth entity.

### Issue #12977: AzureOpenAI client library bypasses all budgets

The `openai.AzureOpenAI` client sends requests to Azure-formatted paths (`/openai/deployments/{model}/chat/completions?api-version=2023-05-15`) instead of `/v1/chat/completions`. LiteLLM's budget enforcement uses **route matching** against `LiteLLMRoutes.llm_api_routes.value` — a hardcoded list that doesn't include Azure-formatted routes. The proxy still processes the request correctly, but budget middleware is completely skipped. One user reported **$764.78 spend on a $50 budget** (15× overspend) using this bypass. **Root cause**: budget enforcement tied to URL pattern matching rather than authentication identity.

### Issue #12905: team membership nullifies user budgets

In `auth_checks.py`, function `common_checks()`, the budget check has an explicit condition that **skips user budget enforcement** when the key belongs to a team:

```python
if (
    user_object is not None
    and user_object.max_budget is not None
    and (team_object is None or team_object.team_id is None)  # ← BUG
):
```

A user with `max_budget: 10.0` and `spend: 15.0` passes the budget check if their key is team-associated. Duplicate issue #11962 confirms. Issue #14097 proposes the fix: check ALL entities independently and enforce the **most restrictive** budget.

### Issue #13882: Bedrock passthrough routes skip budget middleware

Passthrough routes (`/bedrock`, `/anthropic`, `/vertex-ai`) use a different code path that bypasses the middleware stack. The route matching in `user_api_key_auth.py` line 1001 used **exact string matching** instead of wildcard matching. PR #15805 (merged October 2025) partially fixed this by switching to proper wildcard route matching, but coverage of all passthrough paths remains uncertain.

### Additional bugs discovered

- **PR #9329**: Budget reset cron job silently failed due to `isinstance(result, LiteLLM_TeamTable)` not matching Prisma's `prisma.LiteLLM_TeamTable`. Budgets were never reset.
- **Issue #14266**: Race condition in budget reset — `budget_reset_at` timestamp updates but `spend` doesn't zero for random keys. Non-atomic operation.
- **Issue #14004**: Exceeding budget blocks ALL models including zero-cost on-premises models. Budget check runs before model cost evaluation.
- **Issue #20324**: Soft budget alerts never fire for virtual keys because `LiteLLM_BudgetTable` is loaded for end-users and teams but **not** for `LiteLLM_VerificationToken`.

### Architectural patterns to avoid

Five root cause patterns emerge from LiteLLM's bugs:

1. **Route-based budget enforcement**: Any budget check tied to URL pattern matching will be bypassed by new route formats. Budget must be **identity-based** — attached to the authenticated key/user, checked before any routing.
2. **Mutually exclusive entity hierarchy**: Checking only one entity (key OR user OR team) creates shadow bypasses. Check ALL applicable entities and enforce the most restrictive.
3. **Post-hoc cost tracking without pre-request reservation**: LiteLLM tracks costs after response but checks stale spend values before requests. Concurrent requests can all pass budget checks simultaneously.
4. **Passthrough endpoints as escape hatches**: Any endpoint forwarding requests to paid providers must have budget enforcement. No exceptions.
5. **Non-atomic budget operations**: Budget resets, spend updates, and state transitions must be transactional.

---

## 3. MCP protocol details for proxy interception

### JSON-RPC 2.0 message formats

**tools/list request:**
```json
{"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {"cursor": "optional-cursor"}}
```

**tools/list response:**
```json
{
  "jsonrpc": "2.0", "id": 1,
  "result": {
    "tools": [{
      "name": "get_weather",
      "title": "Weather Provider",
      "description": "Get weather for a location",
      "inputSchema": {
        "type": "object",
        "properties": {"location": {"type": "string", "description": "City name"}},
        "required": ["location"]
      },
      "outputSchema": {"type": "object", "properties": {"temperature": {"type": "number"}}},
      "annotations": {}
    }],
    "nextCursor": "next-page"
  }
}
```

Tool name constraints: **1–128 chars**, case-sensitive, pattern `[A-Za-z0-9_\-\.]`.

**tools/call request:**
```json
{
  "jsonrpc": "2.0", "id": 2, "method": "tools/call",
  "params": {
    "name": "get_weather",
    "arguments": {"location": "New York"},
    "_meta": {"progressToken": "abc123"}
  }
}
```

**tools/call success response:**
```json
{
  "jsonrpc": "2.0", "id": 2,
  "result": {
    "content": [{"type": "text", "text": "Temperature: 72°F"}],
    "structuredContent": {"temperature": 72},
    "isError": false
  }
}
```

**Critical distinction**: Tool execution failures use `isError: true` in a normal `result` object — NOT the JSON-RPC `error` field. Protocol errors (unknown tool, malformed request) use the `error` field with standard codes: `-32700` (Parse Error), `-32600` (Invalid Request), `-32601` (Method Not Found), `-32602` (Invalid Params), `-32603` (Internal Error). MCP-specific codes: `-32800` (Request Cancelled), `-32801` (Content Too Large).

Content types in results: `text`, `image` (base64 + mimeType), `audio`, `resource_link` (URI), `resource` (embedded).

### Message type detection rules for the proxy parser

- Has `method` + `id` → **Request** (expects response)
- Has `result` or `error` + `id` → **Response**
- Has `method` but NO `id` → **Notification** (fire-and-forget)

### Transport layers and interception strategies

**stdio** (most common): Messages are newline-delimited JSON. Proxy spawns as a wrapper process — client spawns proxy, proxy spawns real server. Parse each `\n`-delimited line as JSON-RPC, inspect/modify/block, then forward. Server may write logging to stderr (not protocol).

**Streamable HTTP** (current standard, spec version 2025-03-26): Single endpoint supporting POST and GET. Client POSTs JSON-RPC messages; server responds with either `Content-Type: application/json` (single response) or `Content-Type: text/event-stream` (SSE stream with interleaved progress notifications and final response). Session managed via `Mcp-Session-Id` header assigned at initialization, required on all subsequent requests. Server returns **404** when session expires. Client terminates session with HTTP DELETE. Supports JSON-RPC batch arrays. Resumability via SSE `id` field and `Last-Event-ID` header.

**SSE** (deprecated in 2025-03-26 but still used): Two endpoints — GET `/sse` for persistent stream, POST to URL received in `endpoint` event.

### Proxy architecture pattern

```
Client (MCP Host) ←stdio/HTTP→ NullSpend Proxy ←stdio/HTTP→ Real MCP Server
```

The proxy is an **MCP server** to the client and an **MCP client** to the real server. Key interception points:

1. **`initialize`**: Identify server, modify capabilities if needed
2. **`tools/list` response**: Filter or annotate available tools, inject cost metadata
3. **`tools/call` request**: Inspect tool name + arguments, apply budget/policy checks, allow/block/modify
4. **`tools/call` response**: Inspect results, redact sensitive data, log execution
5. **`notifications/progress`**: Forward transparently (references client-created `progressToken`)
6. **`notifications/tools/list_changed`**: Forward transparently

### Initialization handshake (must be proxied faithfully)

```json
// Client → Proxy → Server
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{
  "protocolVersion":"2025-03-26",
  "capabilities":{"roots":{"listChanged":true},"sampling":{}},
  "clientInfo":{"name":"my-client","version":"1.0.0"}
}}

// Server → Proxy → Client
{"jsonrpc":"2.0","id":1,"result":{
  "protocolVersion":"2025-03-26",
  "capabilities":{"tools":{"listChanged":true},"resources":{"listChanged":true}},
  "serverInfo":{"name":"FileSystemServer","version":"2.5.1"}
}}

// Client → Proxy → Server (notification, no id)
{"jsonrpc":"2.0","method":"notifications/initialized"}
```

Known protocol versions: `"2024-11-05"`, `"2025-03-26"`.

### Existing MCP proxy implementations to reference

- **mcpwall** (github.com/behrensd/mcpwall): YAML-based rule engine for stdio, supports deny/allow/redact actions with regex matching on tool names and arguments
- **mcp-proxy** (github.com/sparfenyuk/mcp-proxy): Python transport bridge between stdio and SSE/Streamable HTTP
- **agent-wall** (agent-wall.github.io): Security firewall with rate limiting, secret detection, browser dashboard
- **mcproxy** (github.com/team-attention/mcproxy): Tool filtering via `.mcproxy.json` config to reduce token consumption

---

## 4. Proxy architecture patterns and latency targets

### Helicone's Cloudflare Workers architecture

Helicone runs five services: **Worker** (Cloudflare Workers edge proxy), **Jawn** (Express+Tsoa log server), **Web** (NextJS), **Supabase** (app DB + auth), and **ClickHouse** (OLAP analytics). The critical-path proxy is a Cloudflare Worker that forwards requests to the LLM provider, streams the response back, and then uses `ctx.waitUntil()` to asynchronously ship logs to **Upstash Kafka** (30 partitions, 7-day retention, HTTP-based producer since Workers can't do TCP). ECS consumers (5 tasks × 3 consumers = 15 consumers for 30 partitions) batch-process logs into ClickHouse and Supabase. Large request/response bodies go to **S3/Minio** with Kafka messages containing only metadata + S3 references.

Key resilience feature: `ctx.passThroughOnException()` ensures that if the Worker throws, the request falls through directly to the origin LLM API. Their newer Rust-based gateway achieves **~8ms P50 latency overhead**.

### Portkey's control plane / data plane separation

Portkey's gateway caches ALL configuration objects locally (API keys, virtual keys, configs, prompts, guardrails) with **7-day TTL** and `volatile-lru` eviction. Delta invalidation runs every **60 seconds** to fetch changed items from the control plane. The gateway continues operating even if disconnected from the control plane. Built in TypeScript/Node.js (chosen for DX, V8 JIT optimizations, and open-source accessibility over Rust). Gateway binary is **122KB**. Independent benchmarks show Kong achieving 65% lower latency than Portkey at high RPS — GC pauses in V8 become visible under extreme load.

### Edge platform comparison for proxy workloads

| Platform | Cold Start | CPU Limit | Memory | Max Request Body | Streaming |
|----------|-----------|-----------|--------|------------------|-----------|
| **Cloudflare Workers** | <1ms (V8 isolates) | 30s (paid) | 128MB | 100MB (500MB enterprise) | Full TransformStream API |
| **Vercel Edge Functions** | Minimal (V8 Edge Runtime) | 60s (Pro) | 128–3008MB | **5MB** | Supported with caveats |
| **Fastly Compute** | ~35μs (Wasm) | Per-execution limits | Per-execution | Varies | Wasm streaming APIs |

**Cloudflare Workers is the clear winner** for an AI proxy. The 5MB request body limit on Vercel is disqualifying for AI workloads (image inputs, long contexts). Cloudflare's `waitUntil()` for async post-response work, `passThroughOnException()` for automatic failover, and 330+ global PoPs are purpose-built for this use case. The 128MB memory limit means you **must stream** — never buffer full response bodies.

### Streaming proxy pattern (Cloudflare Workers)

```typescript
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    ctx.passThroughOnException();

    const body = await request.json();
    body.stream = true;
    body.stream_options = { include_usage: true }; // Inject for OpenAI

    const upstream = await fetch(providerUrl, {
      method: "POST",
      headers: { "Authorization": request.headers.get("Authorization")!, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    // Tee the stream: one leg for client, one for async processing
    const [clientStream, logStream] = upstream.body!.tee();

    ctx.waitUntil((async () => {
      const reader = logStream.getReader();
      const decoder = new TextDecoder();
      let usageData = null;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const line of decoder.decode(value, { stream: true }).split("\n")) {
          if (line.startsWith("data: ") && line !== "data: [DONE]") {
            try {
              const parsed = JSON.parse(line.slice(6));
              if (parsed.usage) usageData = parsed.usage;
            } catch {}
          }
        }
      }
      // Calculate cost, update budget, log to Kafka
      await updateBudgetAndLog(env, usageData, body.model);
    })());

    return new Response(clientStream, {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" },
    });
  }
};
```

### Layered failover architecture

```
Layer 1: passThroughOnException() in CF Worker    → instant, automatic
Layer 2: Client SDK with opossum circuit breaker  → millisecond response
Layer 3: DNS failover via Cloudflare Load Balancing → 30-60s, last resort
```

For the client SDK circuit breaker, use **opossum** (Red Hat-maintained, 70K+ weekly downloads) with: `timeout: 5000`, `errorThresholdPercentage: 50`, `resetTimeout: 30000`, `volumeThreshold: 10`. Fallback calls the LLM provider directly.

### API key security model

Two modes, following Helicone's proven pattern:

**BYOK (pass-through)**: User sends `Authorization: Bearer {PROVIDER_KEY}` + `X-NullSpend-Auth: Bearer {PLATFORM_KEY}`. The provider key passes through the proxy, is **hashed with SHA-256** for account matching, and is never persisted. The V8 isolate provides per-request memory isolation; the key exists only during request processing.

**Vault mode**: Provider keys stored with **XChaCha20 encryption** + nonce at rest. Users interact via virtual keys that map to encrypted provider keys at runtime. Virtual keys can be rotated/revoked without touching provider keys.

---

## 5. Budget enforcement architecture

### The hybrid pre-request + post-response pattern

Neither pre-request-only nor post-response-only is sufficient. The correct architecture:

1. **Pre-request**: Count input tokens locally, estimate output cost using `max_tokens` as upper bound, atomically reserve estimated cost from budget via Redis Lua script
2. **Forward request**: Send to LLM provider
3. **Post-response**: Calculate actual cost from response `usage` metadata, release unused reservation or debit additional if estimate was low

### Atomic budget check-and-reserve (Redis Lua script)

This script executes atomically on Redis — no interleaving possible. Solves the race condition where two concurrent requests both pass budget checks:

```lua
-- KEYS[1] = "budget:remaining:{entity_id}"
-- KEYS[2] = "budget:reservations:{entity_id}"
-- ARGV[1] = estimated_cost (integer, microdollars for precision)
-- ARGV[2] = request_id
-- ARGV[3] = reservation_ttl_seconds
-- Returns: {status, remaining, request_id}

local remaining_key = KEYS[1]
local reservations_key = KEYS[2]
local cost = tonumber(ARGV[1])
local request_id = ARGV[2]
local ttl = tonumber(ARGV[3])

-- Clean expired reservations
local now = redis.call('TIME')
local now_ms = tonumber(now[1]) * 1000 + math.floor(tonumber(now[2]) / 1000)
redis.call('ZREMRANGEBYSCORE', reservations_key, '-inf', now_ms)

-- Get current remaining budget
local remaining = tonumber(redis.call('GET', remaining_key) or '0')

-- Sum outstanding reservations
local reserved = 0
local all = redis.call('ZRANGE', reservations_key, 0, -1, 'WITHSCORES')
for i = 1, #all, 2 do
    local idx = string.find(all[i], ':')
    if idx then reserved = reserved + tonumber(string.sub(all[i], idx + 1)) end
end

local effective = remaining - reserved
if effective < cost then return {0, effective, ''} end

-- Reserve atomically
redis.call('ZADD', reservations_key, now_ms + (ttl * 1000), request_id .. ':' .. cost)
return {1, effective - cost, request_id}
```

**Why not WATCH/MULTI**: Redis WATCH/MULTI can't branch on intermediate results — you can't read budget and conditionally decrement in the same transaction. Under high concurrency, WATCH causes excessive retries (thundering herd). Lua scripts provide both atomicity and conditional logic.

### The "last request" problem — configurable policies

When budget has $0.50 remaining but a request might cost $2.00:

| Policy | Behavior | Use Case |
|--------|----------|----------|
| `STRICT_BLOCK` | Block if `estimated_max_cost > remaining` | Financial compliance |
| `SOFT_CAP` | Allow overspend up to configurable % (e.g., 10%) | Production with grace |
| `CAP_MAX_TOKENS` | Set `max_tokens = remaining / output_price_per_token` | Bounded overspend |
| `DRAIN_MODE` | Allow only cheap models when budget < threshold | Graceful degradation |

The **`CAP_MAX_TOKENS`** approach is the most elegant: if $0.50 remains and output costs $0.03/1K tokens, cap `max_tokens` to ~16,600. This transforms an unknown-cost request into a bounded-cost request.

### Budget state storage architecture

```
┌───────────────────┐     ┌─────────────────┐     ┌──────────────────┐
│  Proxy Workers    │────▶│  Redis Primary   │────▶│  PostgreSQL      │
│  (CF Workers)     │     │  (Lua scripts,   │     │  (Append-only    │
│  In-memory only   │     │   reservations)  │     │   ledger, config,│
│  during request   │     │  Sync: real-time │     │   audit log)     │
└───────────────────┘     └─────────────────┘     └──────────────────┘
```

Redis is the primary budget state store (fast, distributed, atomic Lua scripts). PostgreSQL is the authoritative ledger (all spend events logged immutably). On cold start, load budget state from PostgreSQL if Redis is empty. Periodic reconciliation compares Redis against PostgreSQL ledger sums. LiteLLM's DualCache (in-memory + Redis synced every 0.01s) measured **at most 10 requests of drift at 100 RPS across 3 instances**.

### Streaming budget enforcement

The hard truth: **you cannot reliably stop a streaming response mid-stream and avoid charges**. The provider has already generated tokens server-side. OpenRouter's docs confirm: "Cancellation only works for streaming requests with supported providers." The reliable approach:

1. **Pre-request**: Estimate max cost using `max_tokens`, only allow if budget can absorb worst case
2. **Inject `max_tokens` cap**: If budget is tight, reduce `max_tokens` to bound the cost
3. **Mid-stream monitoring** (defense in depth): Count tokens as they stream, close connection if approaching limit — the provider may still charge, but you stop transmitting to the client
4. **Post-stream reconciliation**: Use usage data from final chunk to update actual spend

### Budget enforcement hierarchy

Check ALL of these independently for every request and enforce the **most restrictive**:

```
Key budget      → checked first (fastest, key is already authenticated)
User budget     → checked always (regardless of team membership)
Team budget     → checked if key belongs to team
Org budget      → checked if team belongs to org
End-user budget → checked if user field present in request body
```

This avoids LiteLLM's #12905 bug where team presence nullifies user budgets.

---

## 6. Token counting and cost estimation

### tiktoken model-to-encoding mapping

| Encoding | Models |
|----------|--------|
| `o200k_base` | gpt-5, gpt-4.1, gpt-4.5, gpt-4o, gpt-4o-mini, o1, o3, o4-mini |
| `cl100k_base` | gpt-4, gpt-3.5-turbo, text-embedding-3-small/large |
| `o200k_harmony` | gpt-oss-* models |

```python
import tiktoken
enc = tiktoken.encoding_for_model("gpt-4o")  # resolves to o200k_base
tokens = len(enc.encode(text))
```

### Message overhead constants (empirically verified against API)

For gpt-4o, gpt-4o-mini, gpt-3.5-turbo-0125, gpt-4-0613: each message adds **3 tokens** overhead + every reply is primed with **3 tokens** (`<|start|>assistant<|message|>`). If a `name` field is present, add **1 token**. These constants produce **exact matches** with the API's `prompt_tokens` for plain-text messages.

### Tool definition token counting

OpenAI transforms tool definitions into an internal format before injection. The Cookbook's `num_tokens_for_tools()` uses model-specific magic constants:

```python
# For gpt-4o, gpt-4o-mini:
func_init = 7      # per function start
prop_init = 3      # properties section start
prop_key = 3       # per property key
enum_init = -3     # enum presence adjustment
enum_item = 3      # per enum value
func_end = 12      # per function end
```

A simple tool with one parameter costs **~30–40 tokens**. Each additional parameter adds **~10–15 tokens** depending on description length. Verified accurate: gpt-4o counts 101 tokens locally = 101 from API.

### Server-side token counting APIs (for exact pre-request counts)

**OpenAI Responses API**:
```python
response = client.responses.input_tokens.count(
    model="gpt-5", tools=[...], input="What is the weather?"
)
# response.input_tokens → exact count including tools, images, files
```

**Anthropic** (free, subject to RPM limits):
```python
response = client.messages.count_tokens(
    model="claude-sonnet-4-6", system="...", messages=[...], tools=[...]
)
# response.input_tokens → exact count (slight estimation caveat in docs)
```

**Google Gemini** (free, 3000 RPM):
```python
response = client.models.count_tokens(model="gemini-2.5-flash", contents="...")
# response.total_tokens
```

**Anthropic does not provide a local tokenizer for Claude 3+ models.** The deprecated `@anthropic-ai/tokenizer` NPM package is inaccurate for Claude 3+. The server-side `count_tokens` API is the only accurate method.

### Model pricing databases

**LiteLLM's `model_prices_and_context_window.json`** is the most comprehensive (hundreds of models, all providers). Format:
```json
{
  "gpt-4o": {
    "input_cost_per_token": 0.0000025,
    "output_cost_per_token": 0.00001,
    "cache_read_input_token_cost": 0.00000125,
    "litellm_provider": "openai",
    "max_input_tokens": 128000,
    "source": "https://openai.com/pricing"
  }
}
```
Auto-syncable via `LITELLM_MODEL_COST_MAP_URL` env var or `POST /reload/model_cost_map`.

**AgentOps tokencost** (MIT, 1.9k stars): Uses tiktoken + anthropic SDK under the hood. **GitHub Actions daily auto-update** keeps prices current. Key API: `calculate_prompt_cost(prompt, model)` returns `Decimal` USD.

**Portkey models API**: 2,300+ models, prices in **cents per token** (not dollars). Public REST API: `GET https://api.portkey.ai/model-configs/pricing/{provider}/{model}`. Includes `thinking_token`, `web_search`, and multimodal unit pricing.

**Helicone @helicone/cost**: TypeScript, 300+ models, O(1) Map-based lookups. Provider matching via regex. `costOfPrompt({provider, model, promptTokens, completionTokens})`.

### Cost estimation formula for pre-request budget checks

```
estimated_input_cost = input_tokens × input_cost_per_token
estimated_cache_savings = cached_tokens × (input_rate - cached_rate)  // deduct if caching expected
estimated_max_output_cost = max_tokens × output_cost_per_token
total_reservation = estimated_input_cost + estimated_max_output_cost × 1.1  // 10% safety margin
```

For reasoning models, budget `max_completion_tokens` worth of output tokens, since reasoning tokens can consume the entire allocation with minimal visible output.

---

## 7. Open source strategy and trust architecture

### License and split patterns from the ecosystem

| Company | Core License | Enterprise Gate | Primary Revenue |
|---------|-------------|-----------------|-----------------|
| **LiteLLM** | MIT | `enterprise/` directory, separate commercial license ($250/mo basic, $30K/yr premium) | Cloud + enterprise |
| **Langfuse** | MIT | `/ee` directories only (SCIM, audit, RBAC) | Cloud (all product features are OSS) |
| **Helicone** | Apache 2.0 (main) + GPL v3 (gateway) | SOC 2 infra, dedicated support | Cloud + enterprise |
| **Portkey** | OSS gateway | Full platform (observability, governance, vault) | SaaS + enterprise private cloud |

### Recommended licensing for NullSpend

**Proxy/gateway**: **Apache 2.0** — permissive enough for maximum adoption, patent grant gives enterprise confidence, slightly more protective than MIT against wholesale copying without attribution. Following Helicone's model.

**Enterprise features** (SSO, SCIM, advanced RBAC, audit logs): Separate commercial license in clearly demarcated `/enterprise` or `/ee` directory. Following the Langfuse/LiteLLM pattern.

**Dashboard/analytics**: Proprietary SaaS. This is the primary monetization vehicle.

### What to open source vs. keep proprietary

**Open source** (adoption driver): Core proxy, budget enforcement engine, cost calculation library, provider integrations, basic CLI/dashboard, MCP proxy, self-hosting capability.

**Proprietary** (monetization): Managed cloud service, enterprise security features, advanced analytics/attribution dashboards, team management, SOC 2/HIPAA compliance infrastructure, priority support.

### Trust architecture principles

- **BYOK mode as default**: API keys pass through and are never stored. Hash with SHA-256 for matching only.
- **Data minimization**: Log metadata (model, tokens, cost, latency, status) by default. Prompt content logging is opt-in and can be disabled per-key or per-team.
- **Self-hosted option**: All data stays within customer's infrastructure. Same codebase, no feature restrictions (except enterprise gate).
- **V8 isolate memory isolation**: Each request's API key exists only in its isolate's memory, destroyed on completion.

---

## 8. Google's BATS framework and budget-aware agents

### What BATS is

**Paper**: "Budget-Aware Tool-Use Enables Effective Agent Scaling" (arXiv 2511.17006, November 2025, Google/UCSB/NYU). Two innovations:

**Budget Tracker** is a zero-training prompt-level module that injects real-time budget status after every tool response:

```
<budget>
Query Budget Used: 7, Query Budget Remaining: 93
URL Budget Used: 2, URL Budget Remaining: 98
</budget>
```

Includes policy guidelines: HIGH (≥70% remaining) → 3–5 diverse queries; MEDIUM (30–70%) → 2–3 precise queries; LOW (10–30%) → 1 focused query; CRITICAL (<10%) → avoid tool use.

**BATS framework** adds adaptive planning (dynamic tree-structured plans with `[ ]`/`[x]`/`[!]`/`[~]` checklists), verification (clause-by-clause evidence checking), trajectory compression (57% cache token reduction every 10 steps), and early stopping. Results: **+22% accuracy** over standard ReAct at the same budget. Same accuracy with **40.4% fewer search calls** and **31.3% lower total cost**.

### How BATS complements proxy-based enforcement

BATS and proxy-based budget enforcement are **complementary, not competing**:

- **BATS** makes agents spend wisely — adapting search strategy as budget depletes, pruning plan branches, stopping early when evidence is sufficient. It operates at the prompt level with no infrastructure requirements.
- **Proxy-based enforcement** provides hard budget ceilings, multi-tenant governance, audit trails, and cost attribution. It operates at the infrastructure layer.

NullSpend can integrate both: the proxy enforces hard budget limits and tracks costs, while optionally injecting BATS-style budget awareness into the agent's context (e.g., adding a `<budget>` block to system prompts showing remaining budget, informing the agent to be more conservative as budget depletes). This is a unique differentiator — no existing tool combines infrastructure-level enforcement with agent-level budget awareness.

BATS is currently a **research paper only**, not integrated into any Google production platform (Vertex AI, ADK, Agent Builder). NullSpend can be first to productize this pattern.

---

## Implementation priority matrix

| Component | Priority | Complexity | Key Dependencies |
|-----------|----------|------------|------------------|
| Cost calculation engine (all providers) | P0 | Medium | Pricing DB, provider usage format parsers |
| Streaming proxy (CF Workers) | P0 | High | TransformStream, tee(), waitUntil() |
| Redis Lua budget enforcement | P0 | Medium | Redis, Lua scripts, reservation pattern |
| OpenAI/Anthropic/Gemini provider adapters | P0 | Medium | Usage field parsing per provider |
| MCP stdio proxy | P1 | Medium | JSON-RPC parser, process spawning |
| MCP Streamable HTTP proxy | P1 | High | SSE proxying, session management |
| Budget hierarchy (key→user→team→org) | P1 | Medium | Entity resolution, most-restrictive enforcement |
| Pre-request token estimation | P1 | Medium | tiktoken, provider count_tokens APIs |
| BATS-style budget injection | P2 | Low | System prompt modification |
| Dashboard/analytics | P2 | High | ClickHouse, async pipeline |
| Vault mode (encrypted key storage) | P2 | Medium | XChaCha20/AES-256-GCM |
| Self-hosted deployment | P2 | Medium | Docker Compose, Helm charts |