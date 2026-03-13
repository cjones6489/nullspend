# MCP tool cost tracking: complete implementation reference

**A local Node.js stdio proxy can intercept every MCP `tools/call` request, measure its duration, enforce budget limits via a Cloudflare Workers backend, and report cost events — all with under 100ms of added latency on warm connections.** This reference covers the full protocol surface, SDK patterns, proxy architecture, HTTP communication design, budget enforcement algorithms, client configuration, and production hardening needed to implement "Option C" in AgentSeam. The MCP TypeScript SDK (v1.27.1) provides all necessary primitives through its low-level `Server` and `Client` classes, though it lacks native middleware support (open issue #1238), requiring the dual Server+Client proxy architecture documented below.

---

## 1. MCP protocol: JSON-RPC tool call lifecycle

### tools/list request and response

The `tools/list` method uses cursor-based pagination. The request is straightforward:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list",
  "params": { "cursor": "optional-cursor-value" }
}
```

The response returns an array of `Tool` objects with an optional `nextCursor` for pagination:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "tools": [
      {
        "name": "get_weather",
        "title": "Weather Info",
        "description": "Get current weather for a location",
        "inputSchema": {
          "type": "object",
          "properties": { "location": { "type": "string" } },
          "required": ["location"]
        },
        "annotations": {
          "readOnlyHint": true,
          "openWorldHint": true
        }
      }
    ],
    "nextCursor": "next-page-cursor"
  }
}
```

The **Tool definition** includes these fields:

```typescript
interface Tool {
  name: string;                    // Unique ID, 1-128 chars [A-Za-z0-9_\-\.]
  title?: string;                  // Human-readable display name
  description?: string;            // Human-readable description
  inputSchema: object;             // JSON Schema (2020-12)
  outputSchema?: object;           // Optional structured output schema
  annotations?: ToolAnnotations;   // Behavioral hints
  execution?: ToolExecution;       // Task support config
}

interface ToolAnnotations {
  readOnlyHint?: boolean;          // Tool doesn't modify state
  destructiveHint?: boolean;       // Irreversible changes
  idempotentHint?: boolean;        // Same args = same effect
  openWorldHint?: boolean;         // Interacts with external entities
}
```

**The `annotations` field is critical for cost tracking** — `openWorldHint: true` signals tools that make external API calls (likely to incur cost), while `readOnlyHint: true` with no `openWorldHint` signals local operations (likely free).

### tools/call request and response

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "get_weather",
    "arguments": { "location": "New York" },
    "_meta": { "progressToken": "abc123" }
  }
}
```

The response uses a `content` array containing typed content blocks:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "content": [
      { "type": "text", "text": "Temperature: 72°F, Partly cloudy" }
    ],
    "structuredContent": { "temperature": 72, "conditions": "Partly cloudy" },
    "isError": false
  }
}
```

The TypeScript interfaces from the SDK:

```typescript
interface CallToolRequestParams {
  _meta?: { progressToken?: string | number };
  name: string;
  arguments?: Record<string, unknown>;
}

interface CallToolResult {
  content: (TextContent | ImageContent | AudioContent | EmbeddedResource)[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;   // Defaults to false if absent
}
```

Content types include `TextContent` (`type: "text"`, `text: string`), `ImageContent` (`type: "image"`, `data: string` base64, `mimeType: string`), `AudioContent` (`type: "audio"`, `data: string` base64), and `EmbeddedResource` (`type: "resource"`, wrapping text or blob data).

### Three distinct error paths

This distinction is essential for the proxy — each error path must be tracked differently for cost attribution:

**Path 1 — Tool execution error** (`isError: true`): The tool was found, invoked, and failed. This is a *successful* JSON-RPC response. The LLM receives actionable feedback and can retry. **The tool call consumed resources and should be billed.**

```json
{ "jsonrpc": "2.0", "id": 4, "result": {
    "content": [{ "type": "text", "text": "API rate limit exceeded" }],
    "isError": true
}}
```

**Path 2 — JSON-RPC protocol error**: The request was malformed or the tool doesn't exist. No tool execution occurred. **No cost should be attributed.**

```json
{ "jsonrpc": "2.0", "id": 3, "error": {
    "code": -32602, "message": "Unknown tool: invalid_tool"
}}
```

**Path 3 — Transport error**: Connection failure, broken pipe, timeout. No JSON-RPC message arrives. The proxy must handle this at the transport layer with appropriate timeout and reconnection logic.

The SDK uses these error codes: **-32700** (ParseError), **-32600** (InvalidRequest), **-32601** (MethodNotFound), **-32602** (InvalidParams — also used for unknown tool names), **-32603** (InternalError).

### Progress notifications and cancellation

Servers can send progress notifications during long-running tool calls:

```json
{ "jsonrpc": "2.0", "method": "notifications/progress",
  "params": { "progressToken": "abc123", "progress": 50, "total": 100, "message": "Processing..." }}
```

Cancellation is fire-and-forget:

```json
{ "jsonrpc": "2.0", "method": "notifications/cancelled",
  "params": { "requestId": "123", "reason": "User cancelled" }}
```

**The proxy must relay these bidirectionally** — both progress notifications from upstream and cancellation from downstream. The spec says implementations SHOULD enforce timeouts and SHOULD issue `notifications/cancelled` when a timeout occurs. There is no spec-defined timeout value; the SDK uses a **60-second default** client timeout.

### Initialize handshake

The proxy participates in the initialization flow. The client sends `initialize` with `protocolVersion` and `capabilities`, the server responds with its own capabilities and info, then the client sends `notifications/initialized`. **The proxy must forward capabilities faithfully** — particularly `tools: { listChanged: true }` to enable dynamic tool list updates. The latest released spec version is **2025-11-25**.

---

## 2. TypeScript SDK proxy architecture

### SDK version and package structure

The **latest stable version is `@modelcontextprotocol/sdk@1.27.1`** (published ~February 2026). A v2 restructuring into separate packages (`@modelcontextprotocol/server`, `@modelcontextprotocol/client`, `@modelcontextprotocol/core`) is anticipated for stable release in Q1 2026. **Use v1.x for production** — it will receive bug fixes for 6+ months after v2 ships. The peer dependency is `zod` (v3.25+ or v4).

### The dual Server+Client proxy pattern

The SDK has **no native middleware support** (issue #1238 is an open feature request). The proxy must create a `Server` instance facing downstream (the MCP client like Claude Desktop) and a `Client` instance facing upstream (the real MCP server). This is the established pattern used by every TypeScript MCP proxy:

```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  CallToolRequestSchema, ListToolsRequestSchema,
  McpError, ErrorCode,
} from "@modelcontextprotocol/sdk/types.js";

// UPSTREAM: Client connects to real MCP server
const upstreamTransport = new StdioClientTransport({
  command: "node",
  args: ["path/to/upstream-server.js"],
  env: { /* forwarded env vars */ },
});
const upstreamClient = new Client(
  { name: "agentseam-proxy", version: "1.0.0" },
  { capabilities: {} }
);
await upstreamClient.connect(upstreamTransport);

// DOWNSTREAM: Server faces Claude/Cursor/Claude Code
const server = new Server(
  { name: "agentseam-proxy", version: "1.0.0" },
  { capabilities: { tools: { listChanged: true } } }
);

// Intercept tools/list — forward from upstream
server.setRequestHandler(ListToolsRequestSchema, async () => {
  const result = await upstreamClient.listTools();
  return { tools: result.tools };
});

// Intercept tools/call — this is where cost tracking lives
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // >>> PRE-CALL: budget check, start timer <<<
  const startTime = performance.now();

  try {
    const result = await upstreamClient.callTool({ name, arguments: args });
    const durationMs = performance.now() - startTime;

    // >>> POST-CALL: record cost event, settle budget <<<
    return result;
  } catch (error) {
    const durationMs = performance.now() - startTime;
    // >>> ERROR PATH: release reservation, record failure <<<
    if (error instanceof McpError) throw error;
    throw new McpError(ErrorCode.InternalError, `Proxy error: ${error}`);
  }
});

const downstreamTransport = new StdioServerTransport();
await server.connect(downstreamTransport);
```

**Key SDK methods**: `server.setRequestHandler(schema, handler)` registers typed handlers. `client.callTool({ name, arguments })` forwards tool calls. `client.listTools()` retrieves the tool list. `server.connect(transport)` and `client.connect(transport)` establish connections. The `connect()` on the client side performs the initialize handshake automatically.

### StdioServerTransport and StdioClientTransport

`StdioServerTransport` takes no constructor parameters — it reads from `process.stdin` and writes to `process.stdout`. `StdioClientTransport` spawns a child process with configurable `command`, `args`, `env`, and `cwd`. When the transport is closed, the child process is automatically terminated. The transport interface is:

```typescript
interface Transport {
  start(): Promise<void>;
  close(): Promise<void>;
  send(message: JSONRPCMessage): Promise<void>;
  onmessage?: (message: JSONRPCMessage) => void;
  onclose?: () => void;
  onerror?: (error: Error) => void;
}
```

### Lifecycle and shutdown

```typescript
const shutdown = async () => {
  console.error("[agentseam] shutting down...");
  await upstreamClient.close();
  await server.close();
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
process.on("SIGHUP", shutdown);
process.stdin.on("close", shutdown);
process.stdin.on("end", shutdown);
```

---

## 3. Existing proxy implementations and lessons learned

Research identified **15+ MCP proxy projects** across TypeScript, Python, Go, and Rust. The most relevant patterns for AgentSeam:

**punkpeye/mcp-proxy** (TypeScript, 239 stars): The most popular TypeScript MCP proxy. Provides `proxyServer({ server, client, capabilities })` for transparent forwarding and `tapTransport()` for message observation. Operates at the transport level — does not provide tool-call-level middleware hooks.

**Docker MCP Gateway** (Go, official Docker project): Has the most mature interceptor system: `before:exec`, `before:http`, `after:exec`, `after:http` hooks. Logs duration per tool call (`Duration: 1.2s`). Runs MCP servers in isolated containers.

**FastMCP** (Python, 18k+ stars): Gold standard for middleware patterns with typed hooks (`on_call_tool`, `on_list_tools`) and a built-in `TimingMiddleware`. Its middleware pipeline (`Request → Middleware A → Middleware B → Handler → Middleware B → Middleware A → Response`) is the conceptual model to follow.

**agentgateway** (Rust, Linux Foundation): Enterprise-grade with built-in OpenTelemetry observability, RBAC, and structured logging with attributes like `mcp.method`, `mcp.tool.name`, `mcp.session.id`, `mcp.duration_ms`.

**mcpwall** (TypeScript): The closest analogy to AgentSeam's wrapping pattern. Uses `npx mcpwall -- <original command>` and provides `mcpwall init` for auto-detecting and wrapping existing MCP server configs. YAML-defined rules for blocking/allowing tool calls.

**Key lesson from all proxy implementations**: No existing TypeScript MCP proxy combines tool-call-level interception with timing measurement and external cost reporting. AgentSeam would be the first in this niche. The critical implementation patterns are: (1) use the low-level `Server` class with `setRequestHandler`, not `McpServer`; (2) track in-flight requests via `Map<requestId, metadata>`; (3) relay `notifications/progress` and `notifications/cancelled` bidirectionally; (4) handle `notifications/tools/list_changed` to invalidate cached tool lists.

---

## 4. Duration measurement and cost event schema

### Wall-clock timing

**Use `performance.now()`** — it is monotonic (cannot go backwards due to NTP adjustments), microsecond-precise, and correctly measures async operation elapsed time including network delays and event loop scheduling:

```typescript
const start = performance.now();
try {
  const result = await upstreamClient.callTool({ name, arguments: args });
  const durationMs = performance.now() - start;
  // durationMs captures full wall-clock time the user waited
  return { result, durationMs };
} catch (error) {
  const durationMs = performance.now() - start;
  throw Object.assign(error, { durationMs });
}
```

`Date.now()` is unsuitable — it can produce negative durations from NTP corrections. `process.hrtime.bigint()` works but returns BigInt, adding serialization complexity. `performance.now()` is the W3C standard and the right choice.

### Cost event schema

```typescript
interface ToolCallEvent {
  eventId: string;                     // UUID v4
  sessionId: string;                   // Groups related calls
  toolName: string;                    // MCP tool name
  serverName: string;                  // MCP server identifier
  startedAt: string;                   // ISO 8601 timestamp
  durationMs: number;                  // Wall-clock duration
  estimatedCostUsd: number;            // Pre-call reservation amount
  actualCostUsd: number | null;        // Post-call actual (null if unknown)
  status: "success" | "tool_error" | "protocol_error" | "timeout" | "budget_exceeded";
  isError: boolean;                    // From CallToolResult.isError
  errorMessage?: string;               // Error detail if applicable
  budgetRemainingUsd: number;          // After this call
  metadata?: Record<string, string>;   // Extensible
}
```

### How observability platforms track tool costs

**Langfuse** tracks tools as first-class observation types with `startObservation("name", input, { asType: "tool" })` but does not natively support tool cost — only LLM token-based costs. This is a gap AgentSeam fills. **LangSmith** has the most explicit support, categorizing costs into "Input" (prompt tokens), "Output" (response tokens), and **"Other"** (tool calls, retrieval) — with `usage_metadata.total_cost` on any run type including tools. **Helicone** supports cost-based rate limiting via headers: `Helicone-RateLimit-Policy: "100;w=3600;u=cost;s=user"`.

All platforms use async batched export — Langfuse configures `flushAt` (events per batch) and `flushInterval` (ms). None block the main execution path for telemetry.

---

## 5. Fire-and-forget telemetry with graceful shutdown

The telemetry buffer follows the OpenTelemetry `BatchSpanProcessor` pattern adapted for cost events:

```typescript
class EventBatcher {
  private queue: ToolCallEvent[] = [];
  private timer: NodeJS.Timeout | null = null;
  private inflight = new Set<Promise<void>>();
  private readonly maxBatch = 20;
  private readonly flushMs = 5_000;

  constructor(private sendBatch: (events: ToolCallEvent[]) => Promise<void>) {
    this.timer = setInterval(() => this.flush(), this.flushMs);
    this.timer.unref();  // Don't keep process alive
    process.on("beforeExit", () => this.flush());
    process.on("SIGTERM", () => this.gracefulShutdown());
    process.on("SIGINT", () => this.gracefulShutdown());
  }

  push(event: ToolCallEvent): void {
    this.queue.push(event);
    if (this.queue.length >= this.maxBatch) void this.flush();
  }

  async flush(): Promise<void> {
    if (this.queue.length === 0) return;
    const batch = this.queue.splice(0, this.maxBatch);
    const p = this.sendBatch(batch).catch(err => {
      console.error("[agentseam] flush failed:", err.message);
      if (this.queue.length < 4096) this.queue.unshift(...batch);
    });
    this.inflight.add(p);
    p.finally(() => this.inflight.delete(p));
  }

  async gracefulShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.flush();
    await Promise.allSettled([...this.inflight]);
    process.exit(0);
  }
}
```

**Critical patterns**: `timer.unref()` prevents the flush timer from keeping the process alive. `beforeExit` handles normal exit. `SIGTERM`/`SIGINT` handle graceful shutdown. The queue is bounded at **4096 events** — older events are dropped if the backend is unreachable for an extended period. Failed batches are re-queued (with the bound check) for retry on next flush. **Never await telemetry in the tool call hot path** — use `void this.push(event)`.

---

## 6. Budget enforcement: the reservation pattern

### Hybrid reserve-execute-settle algorithm

The budget system mirrors payment authorization holds. This is the pattern used by Stripe (7-day authorization window) and directly applicable to tool calls:

```
1. RESERVE → Check budget, decrement by estimated cost
2. EXECUTE → Forward tool call to upstream server
3. SETTLE  → Adjust reservation to actual cost (or RELEASE on failure)
```

### Local in-memory budget state

Node.js is single-threaded, so the synchronous `reserve()` call is inherently atomic — no Lua scripts needed for local enforcement:

```typescript
class LocalBudgetState {
  private remaining: number;
  private reservations = new Map<string, number>();

  constructor(totalBudget: number) { this.remaining = totalBudget; }

  reserve(amount: number): string | null {
    if (this.remaining < amount) return null;  // Atomic in single-threaded Node
    const id = crypto.randomUUID();
    this.remaining -= amount;
    this.reservations.set(id, amount);
    return id;
  }

  settle(id: string, actualAmount: number): void {
    const reserved = this.reservations.get(id);
    if (!reserved) return;
    this.reservations.delete(id);
    this.remaining += (reserved - actualAmount);  // Return overage
  }

  release(id: string): void {
    const reserved = this.reservations.get(id);
    if (!reserved) return;
    this.reservations.delete(id);
    this.remaining += reserved;
  }
}
```

### Tool cost tiers and configuration

```typescript
interface ToolCostConfig {
  tools: Record<string, {
    estimatedCostUsd: number;
    tier: "free" | "cheap" | "moderate" | "expensive";
  }>;
  defaults: {
    free: 0,           // filesystem, local operations
    cheap: 0.001,      // simple lookups
    moderate: 0.01,    // search, web requests
    expensive: 0.10,   // image generation, large compute
    unknown: 0.01,     // unclassified tools — safe default
  };
}
```

The `annotations` from the tool definition can drive automatic tier assignment: tools with `readOnlyHint: true` and no `openWorldHint` map to "free"; tools with `openWorldHint: true` map to "moderate"; tools with `destructiveHint: true` and `openWorldHint: true` map to "expensive".

### Edge case decisions

**Backend unreachable**: Default **fail-open** with local budget enforcement as primary. The local `BudgetState` is the source of truth during normal operation; the cloud backend is for persistence, cross-session enforcement, and dashboard reporting. Configurable `failMode: "open" | "closed"` for strict environments.

**Last tool call problem** (budget has $0.005, tool estimated at $0.01): **Block by default**. Configurable `allowOverage: true` with a max percentage (e.g., 10% of total budget).

**Concurrent tool calls**: Not a race condition in single-threaded Node.js — the synchronous `reserve()` call before the `await upstreamClient.callTool()` ensures sequential budget checks even with concurrent async tool calls.

### Redis Lua script for distributed enforcement

When the CF Workers backend handles budget checks, atomicity requires a Lua script:

```lua
local budget_key = KEYS[1]
local amount = tonumber(ARGV[1])
local remaining = tonumber(redis.call('GET', budget_key) or '0')
if remaining < amount then return -1 end
redis.call('DECRBY', budget_key, amount * 100) -- store as cents
return remaining - amount
```

---

## 7. HTTP communication from proxy to Cloudflare Workers

### HTTP client selection

**Use `undici.Pool`** for the budget-check hot path and native `fetch()` for fire-and-forget telemetry. Undici's `request()` method is **3.2× faster than axios** (~18,340 req/s vs ~5,708 req/s on Node 22). It powers Node's built-in `fetch()` but bypasses WHATWG spec overhead when called directly. Built-in connection pooling with keep-alive amortizes TLS handshake cost:

```typescript
import { Pool } from "undici";

const pool = new Pool(process.env.AGENTSEAM_BACKEND_URL!, {
  connections: 5,
  pipelining: 1,           // No pipelining for POST (non-idempotent)
  keepAliveTimeout: 30_000,
  connectTimeout: 5_000,
  allowH2: true,
});

async function postJSON<T>(path: string, body: unknown, timeoutMs = 3000): Promise<T> {
  const { statusCode, body: res } = await pool.request({
    path,
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${process.env.AGENTSEAM_API_KEY}`,
    },
    body: JSON.stringify(body),
    headersTimeout: timeoutMs,
    bodyTimeout: timeoutMs,
  });
  if (statusCode >= 400) throw new Error(`HTTP ${statusCode}: ${await res.text()}`);
  return await res.json() as T;
}
```

### Sync budget checks vs async telemetry

| Operation | Pattern | Blocking? | Timeout | Rationale |
|---|---|---|---|---|
| Budget pre-check | Synchronous `await` | Yes | **2s** | Must block tool call if over budget |
| Cost event reporting | Fire-and-forget queue | No | N/A | Never delays tool call response |
| Budget status query | Synchronous `await` | Yes | 5s | User-initiated, tolerates latency |

### Expected round-trip latencies

| Path | Cold (first request) | Warm (keep-alive) |
|---|---|---|
| Budget check (Redis read) | 150–300ms | **40–100ms** |
| Event batch POST | 150–300ms | 40–100ms |
| Budget status (Postgres read) | 200–500ms | 100–300ms |

CF Workers average **2.2ms CPU time** per request for simple JSON operations. Upstash Redis reads take **10–30ms** from nearby regions. Cloudflare's network delivers sub-30ms P95 TCP connection times to 44% of the top 1,000 networks globally.

### Circuit breaker with cached fallback

```typescript
class BudgetCheckCircuitBreaker {
  private failures = 0;
  private lastFailure = 0;
  private state: "closed" | "open" | "half-open" = "closed";
  private cache = new Map<string, { response: BudgetCheckResponse; ts: number }>();

  async check(req: BudgetCheckRequest): Promise<BudgetCheckResponse> {
    if (this.state === "open") {
      if (Date.now() - this.lastFailure > 30_000) this.state = "half-open";
      else return this.getCached(req.sessionId);
    }
    try {
      const res = await postJSON<BudgetCheckResponse>("/api/v1/budget/check", req, 2000);
      this.cache.set(req.sessionId, { response: res, ts: Date.now() });
      this.failures = 0;
      this.state = "closed";
      return res;
    } catch {
      this.failures++;
      this.lastFailure = Date.now();
      if (this.failures >= 5) this.state = "open";
      return this.getCached(req.sessionId);
    }
  }

  private getCached(sessionId: string): BudgetCheckResponse {
    const c = this.cache.get(sessionId);
    if (c && Date.now() - c.ts < 60_000) return { ...c.response, reason: "cached" };
    return { allowed: true, remainingBudget: -1, totalBudget: -1, costSoFar: -1, reason: "backend_unavailable" };
  }
}
```

---

## 8. Cloudflare Workers API endpoint design

### Three endpoints

**`POST /api/v1/budget/check`** — Hot path. Redis-only. Must respond in under 50ms CPU time.

```typescript
// Request
{ sessionId: string, toolName: string, estimatedCost: number }

// Response
{ allowed: boolean, remainingBudget: number, totalBudget: number, costSoFar: number, reason: string }
```

**`POST /api/v1/events`** — Respond immediately, write to Postgres via `ctx.waitUntil()`.

```typescript
// Request — batch submission
{ events: ToolCallEvent[] }  // 1–100 events per batch

// Response (immediate)
{ accepted: number, errors?: string[] }
```

**`GET /api/v1/budget/status?sessionId=X`** — Full query from Postgres via Hyperdrive.

### Workers implementation architecture

The critical design decision: **Redis on the hot path, Postgres writes async via `ctx.waitUntil()`**. The budget check reads from Upstash Redis and responds immediately. The events endpoint updates Redis counters atomically (`INCRBYFLOAT`), responds, then writes to Supabase Postgres asynchronously. `ctx.waitUntil()` extends execution by up to 30 seconds after the response is sent without blocking the client.

```typescript
// Budget check handler (hot path)
if (url.pathname === "/api/v1/budget/check") {
  const { sessionId, toolName, estimatedCost } = await request.json();
  const [total, spent] = await redis.mget(
    `budget:${sessionId}:total`,
    `budget:${sessionId}:spent`
  );
  const remaining = (total ?? 0) - (spent ?? 0);
  return Response.json({
    allowed: remaining >= estimatedCost,
    remainingBudget: remaining,
    totalBudget: total ?? 0,
    costSoFar: spent ?? 0,
  });
}

// Events handler (respond fast, write async)
if (url.pathname === "/api/v1/events") {
  const { events } = await request.json();
  const totalCost = events.reduce((s, e) => s + e.actualCostUsd, 0);
  await redis.incrbyfloat(`budget:${events[0].sessionId}:spent`, totalCost);
  const response = Response.json({ accepted: events.length });
  ctx.waitUntil(writeEventsToPostgres(env, events));  // Non-blocking
  return response;
}
```

### Authentication

**Static API key in `Authorization: Bearer <key>` header** — lowest latency (simple string comparison, no JWT decoding). Use constant-time comparison on the Worker side via `crypto.subtle.timingSafeEqual()` to prevent timing attacks.

---

## 9. Client configuration and developer experience

### Universal MCP config format

All major MCP clients use the same `mcpServers` JSON structure:

```json
{
  "mcpServers": {
    "<name>": {
      "command": "<executable>",
      "args": ["<arg1>", "<arg2>"],
      "env": { "KEY": "VALUE" }
    }
  }
}
```

Config file locations:

| Client | Path |
|---|---|
| Claude Desktop (macOS) | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Claude Desktop (Windows) | `%APPDATA%\Claude\claude_desktop_config.json` |
| Cursor (global) | `~/.cursor/mcp.json` |
| Cursor (project) | `.cursor/mcp.json` |
| Claude Code (user) | `~/.claude.json` |
| Claude Code (project) | `.mcp.json` |

### The wrapping pattern

The established convention (used by mcpwall and mcp-proxy) is to **replace the command/args with the proxy, passing the original as arguments after `--`**:

**Before** (direct connection):
```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "ghp_xxx" }
    }
  }
}
```

**After** (wrapped with AgentSeam):
```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "agentseam", "--", "npx", "-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "ghp_xxx",
        "AGENTSEAM_API_KEY": "as_xxx",
        "AGENTSEAM_BACKEND_URL": "https://api.agentseam.com"
      }
    }
  }
}
```

### CLI setup commands

Following mcpwall's proven pattern:

```bash
npx agentseam init                          # Auto-detect clients, wrap all servers
npx agentseam init --api-key as_xxx         # With pre-configured key
npx agentseam wrap github --client cursor   # Wrap specific server
npx agentseam unwrap github                 # Remove proxy wrapping
npx agentseam status                        # Check current state
```

The `init` command should: (1) detect installed MCP clients by checking known config paths, (2) read existing `mcpServers` entries, (3) prompt user to select servers to wrap, (4) modify configs (keeping backups), (5) merge agentseam env vars without overwriting existing ones, (6) print restart instructions.

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `AGENTSEAM_API_KEY` | Yes | Bearer token for CF Workers backend |
| `AGENTSEAM_BACKEND_URL` | Yes | Backend URL (e.g., `https://api.agentseam.com`) |
| `AGENTSEAM_SESSION_ID` | No | Group tool calls into a session |
| `AGENTSEAM_DEBUG` | No | Enable stderr debug logging |

Claude Code's `.mcp.json` supports `${VAR}` syntax for referencing shell environment variables, keeping secrets out of version control. Claude Desktop requires values inline in the JSON.

---

## 10. Testing patterns with InMemoryTransport

### Unit testing with the SDK's InMemoryTransport

The SDK provides `InMemoryTransport.createLinkedPair()` specifically for testing — it creates a linked pair of transports that communicate in memory without subprocess management:

```typescript
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";

const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
const client = new Client({ name: "test", version: "1.0.0" });
const server = new Server({ name: "test", version: "1.0.0" }, { capabilities: { tools: {} } });

// Register handlers BEFORE connecting
server.setRequestHandler(CallToolRequestSchema, async (req) => { /* ... */ });

await server.connect(serverTransport);
await client.connect(clientTransport);

// Now test tool calls
const result = await client.callTool({ name: "echo", arguments: { msg: "hello" } });
```

### Testing the proxy's timing accuracy

```typescript
it("should measure tool call duration accurately", async () => {
  // Register a tool with known delay
  server.setRequestHandler(CallToolRequestSchema, async () => {
    await new Promise(r => setTimeout(r, 100));
    return { content: [{ type: "text", text: "done" }] };
  });

  const events: ToolCallEvent[] = [];
  proxy.onEvent = (e) => events.push(e);

  await client.callTool({ name: "slow_tool", arguments: {} });

  expect(events).toHaveLength(1);
  expect(events[0].durationMs).toBeGreaterThan(90);
  expect(events[0].durationMs).toBeLessThan(200);
});
```

### Mocking the CF Workers backend

Use **msw** (Mock Service Worker) for intercepting HTTP calls:

```typescript
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

const mockBackend = setupServer(
  http.post("https://api.agentseam.com/api/v1/budget/check", () =>
    HttpResponse.json({ allowed: true, remainingBudget: 4.50, totalBudget: 5.00, costSoFar: 0.50 })
  ),
  http.post("https://api.agentseam.com/api/v1/events", () =>
    HttpResponse.json({ accepted: 1 })
  )
);

beforeAll(() => mockBackend.listen());
afterEach(() => mockBackend.resetHandlers());
afterAll(() => mockBackend.close());
```

### Testing budget exceeded behavior

```typescript
it("should block tool call when budget exceeded", async () => {
  mockBackend.use(
    http.post("*/budget/check", () =>
      HttpResponse.json({ allowed: false, remainingBudget: 0.002, totalBudget: 5.00, reason: "budget_exceeded" })
    )
  );

  const result = await client.callTool({ name: "expensive_tool", arguments: {} });
  expect(result.isError).toBe(true);
  expect(result.content[0].text).toContain("budget");
});
```

**Test runner**: Use **Vitest** — it is the community consensus for MCP TypeScript testing with native ESM support and fast execution. The `InMemoryTransport` approach avoids all subprocess/port management issues in CI.

---

## 11. Known issues and production hardening

### Critical SDK issues

**Issue #985 — TypeScript compilation OOM**: The SDK can consume 4GB+ memory during `tsc` compilation, causing OOM in CI. Workaround: use `tsc --noCheck` or `NODE_OPTIONS=--max-old-space-size=4096`.

**Issue #1238 — No native middleware support**: The most impactful gap for proxy implementations. Forces the dual Server+Client architecture rather than a simple `server.use()` interceptor. Open feature request with no timeline.

**Issue #1007 — Unbounded Maps in Protocol class**: Six `Map` instances (`_responseHandlers`, `_requestHandlerAbortControllers`, etc.) grow without bound during high concurrency. Relevant for long-running proxy processes — monitor memory usage.

### stdio transport: the stdout corruption trap

**The #1 cause of MCP proxy failures is stdout pollution.** Any output to stdout that isn't valid JSON-RPC corrupts the protocol stream. `console.log()` is forbidden — **all logging must use `console.error()` (stderr)**. Even imported libraries that inadvertently log to stdout can break the stream. The defensive pattern:

```typescript
const originalWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk: any, ...args: any[]) => {
  const str = typeof chunk === "string" ? chunk : chunk.toString();
  if (str.startsWith("{") && str.includes('"jsonrpc"')) {
    return originalWrite(chunk, ...args);
  }
  process.stderr.write(`[REDIRECTED] ${str}`);
  return true;
};
```

### Memory concerns with large tool results

Tool results containing images or files arrive as base64-encoded strings in JSON. A proxy that stores both the incoming and outgoing copies **doubles memory footprint**. For a 10MB image, that's 20MB of memory per in-flight tool call. The proxy should avoid cloning — pass the result object directly from `upstreamClient.callTool()` to the return value without deep copying.

### What happens when the upstream server crashes

The upstream `client.callTool()` will either throw a `McpError` with `ErrorCode.ConnectionClosed` or hang until the 60-second default timeout. The proxy must implement reconnection logic:

```typescript
try {
  return await upstreamClient.callTool({ name, arguments: args });
} catch (error) {
  if (error instanceof McpError && error.code === ErrorCode.ConnectionClosed) {
    await reconnectUpstream();
    return await upstreamClient.callTool({ name, arguments: args });
  }
  return { content: [{ type: "text", text: `Proxy error: ${error.message}` }], isError: true };
}
```

### Latency impact of budget checks

Adding a synchronous HTTP round-trip for budget enforcement adds **40–100ms on warm connections** (150–300ms cold). This is the cost of centralized budget enforcement. Mitigation strategies: (1) local in-memory budget as primary enforcement with async backend sync, (2) circuit breaker that falls back to local-only on backend failures, (3) aggressive 2-second timeout with cached fallback, (4) undici connection pooling to amortize TLS overhead.

### Production hardening checklist

- All logging to stderr, never stdout
- `SIGTERM`, `SIGINT`, `SIGHUP`, `stdin.close` signal handling with graceful shutdown
- `process.on("uncaughtException")` and `process.on("unhandledRejection")` handlers that log but don't crash
- `timer.unref()` on all background timers (telemetry flush, keepalive)
- Bounded event queue (4096 max) with drop-oldest on overflow
- Circuit breaker on backend HTTP calls (5 failures → open → 30s reset)
- Budget cache with 60-second TTL for backend-unavailable fallback
- Tools registered before `server.connect()` (silent failure otherwise)
- Child process cleanup on proxy exit (handled by `StdioClientTransport.close()`)
- Windows `cmd /c` wrapping for npx commands in config generation

## Conclusion

The implementation path is clear: a dual `Server`+`Client` architecture using the low-level SDK classes provides full interception of `tools/call` requests. The proxy measures duration with `performance.now()`, enforces budgets locally via a synchronous reservation pattern, and reports cost events asynchronously through a bounded in-memory queue flushed to CF Workers. The budget check adds **40–100ms** of latency on warm connections, mitigated by circuit breaking and local cache fallback. The `npx agentseam -- <original command>` wrapping pattern and `agentseam init` CLI align with established ecosystem conventions from mcpwall and mcp-proxy.

Three architectural insights emerged that weren't obvious before research: (1) Node.js single-threading makes local budget enforcement naturally atomic — no distributed locking needed for the common case; (2) the tool's `annotations.openWorldHint` field enables automatic cost tier classification without manual configuration; and (3) CF Workers' `ctx.waitUntil()` cleanly separates the hot path (Redis budget check → immediate response) from durable storage (async Postgres write), keeping budget check latency under 50ms of CPU time on the Worker side.