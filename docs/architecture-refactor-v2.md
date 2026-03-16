# NullSpend Architecture Refactor — Pre-Launch Technical Outline

## Context

NullSpend is a transparent LLM proxy that tracks costs and enforces budgets for
AI agents. The codebase currently supports OpenAI + Anthropic LLM proxying with
atomic Redis budget enforcement, MCP tool cost tracking, Stripe billing, and a
Next.js dashboard. This document outlines architecture changes to make before
launch — focused on simplification, performance, robustness, and extensibility.

**Core architectural principle:** One code path through the proxy. No separate
"tracking mode" vs "enforcement mode." Every request flows through the same
pipeline. When no budgets are configured, the budget check resolves instantly
(sub-ms) from cache. When budgets exist, the same check enforces atomically via
Redis Lua scripts. The developer doesn't choose a mode — they optionally
configure budgets and enforcement activates automatically.

**Stack reference:**
- Proxy: Cloudflare Workers (`apps/proxy/`)
- Budget state: Upstash Redis (Lua scripts in `apps/proxy/src/lib/budget.ts`)
- Persistent storage: Supabase Postgres via Hyperdrive
- Dashboard: Next.js on Vercel (`app/`)
- MCP proxy: Local Node.js stdio process (`packages/mcp-proxy/`)
- Cost engine: Shared pricing data (`packages/cost-engine/`)
- DB schema: Drizzle ORM (`packages/db/`)

---

## Change 1: Database Schema Migration (CRITICAL — do before any data exists)

### Why
The `cost_events` table currently stores LLM and MCP events with the same
columns. The `model` field is overloaded (`"gpt-4o"` for LLM, `"github/search"`
for MCP). Token columns are zero for MCP events. Adding columns after millions
of rows exist requires expensive backfills.

### Migration: `drizzle/0016_extend_cost_events.sql`

```sql
-- Event type discrimination
ALTER TABLE cost_events ADD COLUMN event_type TEXT NOT NULL DEFAULT 'llm'
  CHECK (event_type IN ('llm', 'tool'));

-- MCP tool fields (null for LLM events)
ALTER TABLE cost_events ADD COLUMN tool_name TEXT;
ALTER TABLE cost_events ADD COLUMN tool_server TEXT;

-- LLM tool call detection (tools the LLM requested in its response)
ALTER TABLE cost_events ADD COLUMN tool_calls_requested JSONB;

-- Hidden cost: tokens consumed by tool schema definitions in request
ALTER TABLE cost_events ADD COLUMN tool_definition_tokens INTEGER DEFAULT 0;

-- Precise proxy overhead measurement
ALTER TABLE cost_events ADD COLUMN upstream_duration_ms INTEGER;

-- Session grouping for multi-call workflows (Claude Code, agent loops)
ALTER TABLE cost_events ADD COLUMN session_id TEXT;

-- Indexes for new query patterns
CREATE INDEX cost_events_event_type_idx ON cost_events (event_type);
CREATE INDEX cost_events_session_id_idx ON cost_events (session_id)
  WHERE session_id IS NOT NULL;
CREATE INDEX cost_events_tool_server_name_idx
  ON cost_events (tool_server, tool_name)
  WHERE event_type = 'tool';
```

### Schema update: `packages/db/src/schema.ts`

Add to the `costEvents` table definition:

```typescript
eventType: text("event_type").notNull().default("llm"),
toolName: text("tool_name"),
toolServer: text("tool_server"),
toolCallsRequested: jsonb("tool_calls_requested"),
toolDefinitionTokens: integer("tool_definition_tokens").default(0),
upstreamDurationMs: integer("upstream_duration_ms"),
sessionId: text("session_id"),
```

### Downstream changes

- `apps/proxy/src/lib/cost-logger.ts` — accept new fields in event object
- `apps/proxy/src/routes/mcp.ts` — set `event_type: "tool"`, `tool_name`,
  `tool_server` instead of encoding in the `model` field
- `apps/proxy/src/routes/openai.ts` — set `event_type: "llm"`,
  `upstream_duration_ms`, extract `tool_calls_requested` from response
- `apps/proxy/src/routes/anthropic.ts` — same as openai
- `lib/cost-events/aggregate-cost-events.ts` — group by `event_type`
- Dashboard analytics components — separate LLM costs and tool activity

---

## Change 2: Remove Platform Key Auth (simplification)

### Why
The proxy currently supports two auth methods: API key (`x-nullspend-key`
header) and platform key (`x-nullspend-auth` + `x-nullspend-user-id` +
`x-nullspend-key-id`). Zero external users depend on platform key auth. Every
route handler has dual-path logic to handle both. Removing it simplifies every
route and eliminates a class of attribution bugs.

### Files to change

**`apps/proxy/src/lib/auth.ts`** — Remove `validatePlatformKey()`, remove
`AuthResult.method` field, remove platform key branch from
`authenticateRequest()`. The function should only check `x-nullspend-key`:

```typescript
export interface AuthResult {
  userId: string;
  keyId: string;
  hasBudgets: boolean; // NEW — see Change 3
}

export async function authenticateRequest(
  request: Request,
  connectionString: string,
): Promise<AuthResult | null> {
  const apiKey = request.headers.get("x-nullspend-key");
  if (!apiKey) return null;

  const identity = await authenticateApiKey(apiKey, connectionString);
  if (!identity) return null;

  return {
    userId: identity.userId,
    keyId: identity.keyId,
    hasBudgets: identity.hasBudgets,
  };
}
```

**`apps/proxy/src/lib/api-key-auth.ts`** — Add `hasBudgets` to
`ApiKeyIdentity`. The DB query becomes:

```sql
SELECT k.id, k.user_id,
  EXISTS(
    SELECT 1 FROM budgets b
    WHERE (b.entity_type = 'api_key' AND b.entity_id = k.id::text)
       OR (b.entity_type = 'user' AND b.entity_id = k.user_id)
  ) AS has_budgets
FROM api_keys k
WHERE k.key_hash = $1 AND k.revoked_at IS NULL
```

This adds the `hasBudgets` flag at auth time with zero additional queries. The
result is cached for 60s alongside the identity.

**`apps/proxy/src/routes/openai.ts`** — Remove `legacyAttribution` logic,
`auth.method` checks, and `extractAttribution()` calls. Attribution comes
directly from `auth.userId` and `auth.keyId`.

**`apps/proxy/src/routes/anthropic.ts`** — Same simplification.

**`apps/proxy/src/routes/mcp.ts`** — Same simplification.

**`apps/proxy/src/index.ts`** — Remove `env.PLATFORM_AUTH_KEY` from the
`authenticateRequest()` call.

**`apps/proxy/src/lib/request-utils.ts`** — Remove `extractAttribution()`.

### Test changes

- Delete or update all platform key test cases in auth tests
- Update route tests that use `x-nullspend-auth` header to use
  `x-nullspend-key` instead
- `apps/proxy/src/__tests__/api-key-auth.test.ts` — add `hasBudgets` assertion

---

## Change 3: `hasBudgets` Fast-Path (performance)

### Why
When no budgets are configured, the proxy should skip the Redis budget lookup
and Lua enforcement entirely. The `hasBudgets` flag from the auth cache (Change
2) enables this. Budget check resolves in sub-ms from the in-memory auth cache
instead of 10-20ms from Redis.

### Implementation

In each route handler (openai.ts, anthropic.ts), the budget section changes:

**Before:**
```typescript
const redis = Redis.fromEnv(env);
let reservationId: string | null = null;
let budgetEntities: BudgetEntity[] = [];

try {
  budgetEntities = await lookupBudgets(redis, connectionString, {
    keyId: attribution.apiKeyId,
    userId: attribution.userId,
  });
} catch {
  return Response.json(
    { error: "budget_unavailable", message: "Budget service unavailable" },
    { status: 503 },
  );
}

if (budgetEntities.length > 0) {
  // ... estimate, check, reserve
}
```

**After:**
```typescript
let redis: Redis | null = null;
let reservationId: string | null = null;
let budgetEntities: BudgetEntity[] = [];

if (auth.hasBudgets) {
  redis = Redis.fromEnv(env);
  try {
    budgetEntities = await lookupBudgets(redis, connectionString, {
      keyId: auth.keyId,
      userId: auth.userId,
    });
  } catch {
    return Response.json(
      { error: "budget_unavailable", message: "Budget service unavailable" },
      { status: 503 },
    );
  }

  if (budgetEntities.length > 0) {
    const estimate = estimateMaxCost(requestModel, body);
    const entityKeys = budgetEntities.map((e) => e.entityKey);
    const checkResult = await checkAndReserve(redis, entityKeys, estimate);
    if (checkResult.status === "denied") {
      return budgetExceededResponse(checkResult);
    }
    reservationId = checkResult.reservationId;
  }
}
```

Key: `Redis.fromEnv(env)` is never called when `hasBudgets` is false. No Redis
client instantiation, no Redis calls, no latency. The forwarding + async cost
logging happens regardless.

### Latency impact

```
No budgets:   auth cache hit (sub-ms) → forward → async log
              Total overhead: <5ms

With budgets: auth cache hit (sub-ms) → Redis lookup (10-20ms) →
              Redis Lua reserve (10-20ms) → forward → async reconcile + log
              Total overhead: 20-40ms
```

---

## Change 4: Unified Middleware Pipeline in index.ts (extensibility)

### Why
Currently index.ts is an if/else chain where each route block independently
applies rate limiting and body parsing. Adding new routes means copying
boilerplate. Auth is done inside each handler, not in the pipeline.

### New structure

```typescript
// Route registry
interface RouteHandler {
  (request: Request, env: Env, ctx: RequestContext): Promise<Response>;
}

interface RequestContext {
  body: Record<string, unknown>;
  auth: AuthResult;
  redis: Redis | null; // only instantiated when auth.hasBudgets is true
}

const routes = new Map<string, RouteHandler>();
routes.set("/v1/chat/completions", handleChatCompletions);
routes.set("/v1/messages", handleAnthropicMessages);
routes.set("/v1/mcp/budget/check", handleMcpBudgetCheck);
routes.set("/v1/mcp/events", handleMcpEvents);

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext) {
    // ... global flags setup ...

    const url = new URL(request.url);

    // Health checks (no auth, no parsing)
    if (url.pathname === "/health") {
      return Response.json({ status: "ok", service: "nullspend-proxy" });
    }
    if (url.pathname === "/health/ready") {
      // ... redis ping ...
    }

    // Route lookup
    const handler = request.method === "POST" ? routes.get(url.pathname) : null;
    if (!handler) {
      if (url.pathname.startsWith("/v1/")) {
        return errorResponse("not_found", "Endpoint not supported", 404);
      }
      return errorResponse("not_found", "Not found", 404);
    }

    // Shared middleware pipeline (runs once for all routes)
    const rateLimitResponse = await applyRateLimit(request, env);
    if (rateLimitResponse) return rateLimitResponse;

    const parseResult = await parseRequestBody(request);
    if (parseResult.error) return parseResult.error;

    const connectionString = env.HYPERDRIVE.connectionString;
    const auth = await authenticateRequest(request, connectionString);
    if (!auth) return unauthorizedResponse();

    const ctx: RequestContext = {
      body: parseResult.body,
      auth,
      redis: auth.hasBudgets ? Redis.fromEnv(env) : null,
    };

    return handler(request, env, ctx);
  },
};
```

### Handler signature change

Every route handler changes from:
```typescript
export async function handleChatCompletions(
  request: Request, env: Env, body: Record<string, unknown>
): Promise<Response>
```

To:
```typescript
export async function handleChatCompletions(
  request: Request, env: Env, ctx: RequestContext
): Promise<Response>
```

The handler no longer calls `authenticateRequest()` or `parseRequestBody()`.
It receives pre-authenticated, pre-parsed context. Body is `ctx.body`. Auth
identity is `ctx.auth`. Redis client is `ctx.redis` (null when no budgets).

---

## Change 5: OpenAI-Compatible Upstream Routing (provider coverage)

### Why
Many providers (Groq, Together AI, Fireworks, Mistral, Perplexity, Ollama)
implement the OpenAI `/v1/chat/completions` format. Supporting them requires
zero new parsing code — just routing to a different upstream URL.

### Implementation

Add an optional `x-nullspend-upstream` header. If present, the OpenAI route
handler forwards to that URL instead of `https://api.openai.com`.

In `apps/proxy/src/routes/openai.ts`:

```typescript
const upstreamBase = request.headers.get("x-nullspend-upstream")
  ?? OPENAI_BASE_URL;

// Validate upstream URL (only allow known provider domains or
// domains configured for this API key in the dashboard)
if (!isAllowedUpstream(upstreamBase)) {
  return errorResponse("invalid_upstream", "Upstream URL not allowed", 400);
}

const upstreamResponse = await fetch(
  `${upstreamBase}/v1/chat/completions`,
  { method: "POST", headers: upstreamHeaders, body: JSON.stringify(body), ... }
);
```

### Allowed upstream validation

Create `apps/proxy/src/lib/upstream-allowlist.ts`:

```typescript
const DEFAULT_ALLOWED = new Set([
  "https://api.openai.com",
  "https://api.groq.com/openai",
  "https://api.together.xyz",
  "https://api.fireworks.ai/inference",
  "https://api.mistral.ai",
  "https://api.perplexity.ai",
  "https://openrouter.ai/api",
]);

export function isAllowedUpstream(url: string): boolean {
  // Strip trailing slash for comparison
  const normalized = url.replace(/\/+$/, "");
  return DEFAULT_ALLOWED.has(normalized);
  // TODO: extend with per-key allowlist from dashboard config
}
```

### Cost calculation note

Pricing for non-OpenAI models needs entries in `pricing-data.json`. For unknown
models, the proxy should still track the request (duration, token counts from
response) and log `costMicrodollars: 0` rather than blocking. A dashboard
warning flags unpriced requests: "12 requests to groq/llama-3.1-70b had no
pricing data — costs shown as $0."

---

## Change 6: Tool Call Detection from LLM Responses (tracking depth)

### Why
The proxy already parses LLM responses for token usage. Extracting tool call
information from the same response provides unique analytics: which tools each
model invokes, tool definition token overhead, and the bridge between LLM costs
and tool execution.

### OpenAI extraction (in `apps/proxy/src/lib/sse-parser.ts`)

After the stream completes, check the accumulated message for tool_calls:

```typescript
// In the SSE parser result, add:
interface OpenAISSEResult {
  usage: { ... } | null;
  toolCalls: { name: string; id: string }[] | null;
  // ... existing fields
}

// During parsing, when processing the final message:
if (parsed.choices?.[0]?.message?.tool_calls) {
  capturedToolCalls = parsed.choices[0].message.tool_calls.map(
    (tc: { function: { name: string }; id: string }) => ({
      name: tc.function.name,
      id: tc.id,
    })
  );
}
```

### Anthropic extraction (in `apps/proxy/src/lib/anthropic-sse-parser.ts`)

```typescript
// Watch for content_block_start with type "tool_use"
if (eventType === "content_block_start" && parsed.content_block?.type === "tool_use") {
  if (!capturedToolCalls) capturedToolCalls = [];
  capturedToolCalls.push({
    name: parsed.content_block.name,
    id: parsed.content_block.id,
  });
}
```

### Tool definition token estimation

In each route handler, before forwarding, estimate tool definition overhead:

```typescript
const toolDefinitionTokens = body.tools
  ? Math.ceil(JSON.stringify(body.tools).length / 4) // rough estimate
  : 0;
```

Include in the cost event: `toolDefinitionTokens`, `toolCallsRequested`.

---

## Change 7: Upstream Duration Measurement (transparency)

### Why
We need to know our actual proxy overhead. Measuring `upstream_duration_ms`
separately from total `duration_ms` gives us `proxy_overhead = duration -
upstream_duration`.

### Implementation

In each route handler, wrap the upstream fetch:

```typescript
const startTime = performance.now();
const upstreamStart = performance.now();
const upstreamResponse = await fetch(upstreamUrl, { ... });
// For non-streaming: measure after response body is fully read
// For streaming: measure time-to-first-byte (when headers arrive)
const upstreamDurationMs = Math.round(performance.now() - upstreamStart);
```

For streaming responses, `upstreamDurationMs` captures time until the response
headers arrive (when `fetch()` resolves), not the full stream duration. The full
duration is measured by the existing `performance.now() - startTime` at the end
of the `waitUntil()` handler.

Include `upstreamDurationMs` in the cost event.

---

## Change 8: Session ID Header Support (agent workflow tracking)

### Why
Developers running Claude Code, multi-step agent workflows, or batch jobs need
to group related cost events into sessions. "How much did that refactoring task
cost?" requires grouping 200 individual API calls.

### Implementation

Extract optional header in each route handler:

```typescript
const sessionId = request.headers.get("x-nullspend-session") ?? null;
```

Include in the cost event: `sessionId`.

No validation needed — any string works. The developer passes whatever
identifier makes sense for their workflow. The dashboard groups and sums by
session when present.

### Developer usage

```bash
# Claude Code / Anthropic SDK
export ANTHROPIC_DEFAULT_HEADERS='{"x-nullspend-session":"refactor-auth"}'

# OpenAI SDK
export OPENAI_DEFAULT_HEADERS='{"x-nullspend-session":"data-pipeline-v2"}'
```

---

## Change 9: Batch Cost Event Inserts (performance under load)

### Why
Currently `logCostEvent()` creates a new `pg.Client`, connects, inserts one
row, and disconnects per event. Under load this will exhaust Postgres connection
limits and Hyperdrive's pool.

### Implementation

Replace the per-event insert with a batch accumulator in `waitUntil()`:

Create `apps/proxy/src/lib/cost-event-buffer.ts`:

```typescript
const buffer: CostEventInsert[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const MAX_BATCH = 25;
const FLUSH_INTERVAL_MS = 1000;

export function enqueueCostEvent(event: CostEventInsert): void {
  buffer.push(event);
  if (buffer.length >= MAX_BATCH) {
    flushNow();
  } else if (!flushTimer) {
    flushTimer = setTimeout(flushNow, FLUSH_INTERVAL_MS);
  }
}

async function flushNow(): Promise<void> {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  if (buffer.length === 0) return;
  const batch = buffer.splice(0, MAX_BATCH);
  await insertBatch(connectionString, batch);
}

async function insertBatch(
  connectionString: string,
  events: CostEventInsert[],
): Promise<void> {
  // Single connection, multi-row insert
  // Drizzle: db.insert(costEvents).values(events)
}
```

**Note:** CF Workers isolates may not persist module-level state across requests
in all configurations. If isolate reuse is not guaranteed, fall back to
per-request insert but use a single prepared statement. Test this behavior in
production before relying on cross-request batching.

**Safer approach for Workers:** Keep per-event inserts but switch from
creating a new `pg.Client` per event to using the connection already established
by the auth check or budget lookup within the same request. Share the
`connectionString` through the `RequestContext` and let `waitUntil()` create one
connection for all async work (cost event + budget reconciliation).

---

## Change 10: Standard Error Contract (DX consistency)

### Why
Error responses vary across routes. Some include `details`, some don't. Status
codes are inconsistent for similar errors. A standard contract makes the proxy
predictable for developers.

### Error response format

Create `apps/proxy/src/lib/errors.ts`:

```typescript
export interface NullSpendError {
  error: string;           // machine-readable: "budget_exceeded", "unauthorized"
  message: string;         // human-readable description
  details?: Record<string, unknown>;
}

export function errorResponse(
  error: string,
  message: string,
  status: number,
  details?: Record<string, unknown>,
): Response {
  const body: NullSpendError = { error, message };
  if (details) body.details = details;
  return Response.json(body, { status });
}
```

### Error codes

| Code | Status | When |
|------|--------|------|
| `unauthorized` | 401 | Missing or invalid API key |
| `bad_request` | 400 | Malformed body, missing fields |
| `invalid_model` | 400 | Model not in pricing database |
| `invalid_upstream` | 400 | Upstream URL not in allowlist |
| `budget_exceeded` | 429 | Request would exceed budget |
| `budget_unavailable` | 503 | Redis/Postgres unreachable for budget check |
| `rate_limited` | 429 | Too many requests |
| `payload_too_large` | 413 | Body exceeds 1MB |
| `upstream_error` | 502 | Provider returned error (sanitized) |
| `upstream_timeout` | 504 | Provider didn't respond in time |
| `internal_error` | 500 | Unhandled proxy error |
| `not_found` | 404 | Unknown endpoint |

Replace all ad-hoc `Response.json({ error: ... })` calls with `errorResponse()`.

---

## Change 11: Sidebar Reorder (UX)

### Why
The sidebar currently leads with "Approvals" (legacy). For a tracking/enforcement
product, the first thing a user sees should be their cost data.

### New order in `components/dashboard/sidebar.tsx`

```typescript
const navSections = [
  {
    label: "FinOps",
    items: [
      { href: "/app/analytics", label: "Analytics", icon: BarChart3 },
      { href: "/app/activity", label: "Activity", icon: Activity },
      { href: "/app/budgets", label: "Budgets", icon: DollarSign },
      { href: "/app/tool-costs", label: "Tool Costs", icon: Wrench },
    ],
  },
  {
    label: "Account",
    items: [
      { href: "/app/billing", label: "Billing", icon: CreditCard },
      { href: "/app/settings", label: "Settings", icon: Settings },
    ],
  },
];
```

Remove the "Approvals" section (Inbox + History) from the default sidebar.
If the approval workflow is kept as a feature, add it under a "Developer Tools"
section below Account.

---

## Change 12: MCP Proxy — Skip HTTP Calls When No Budgets

### Why
The MCP proxy currently makes an HTTP round-trip to the Workers proxy for every
tool call budget check (40-100ms overhead). When no budgets exist, this is
unnecessary. The same `hasBudgets` flag should apply.

### Implementation

On startup, the MCP proxy already introspects the API key via
`GET /api/auth/introspect`. Extend the introspect response to include
`hasBudgets`:

```typescript
// app/api/auth/introspect/route.ts
return NextResponse.json({
  userId: identity.userId,
  keyId: identity.keyId,
  hasBudgets: await checkBudgetsExist(identity.userId, identity.keyId),
});
```

In the MCP proxy's `CostTracker`, if `hasBudgets` is false:
- `checkBudget()` returns `{ allowed: true }` immediately (no HTTP call)
- `reportEvent()` still queues events to the batcher (tracking still works)

The MCP proxy periodically re-checks (every 60s) by calling introspect again
to pick up newly created budgets.

---

## Implementation Order

Recommended sequence to minimize conflicts and maximize safety:

1. **Schema migration** (Change 1) — must be first, before any data
2. **Remove platform key auth** (Change 2) — simplifies everything downstream
3. **`hasBudgets` on auth identity** (Change 3) — enables fast path
4. **Standard error contract** (Change 10) — apply while touching route files
5. **Middleware pipeline in index.ts** (Change 4) — refactor routing
6. **Route handler refactor** (Changes 3, 6, 7, 8 applied to each handler):
   - Update handler signatures to accept `RequestContext`
   - Add `hasBudgets` fast-path to budget section
   - Extract `tool_calls_requested` from SSE parser results
   - Add `upstream_duration_ms` timing
   - Extract `session_id` from header
   - Use `errorResponse()` for all errors
7. **OpenAI-compatible upstream** (Change 5) — new feature
8. **Sidebar reorder** (Change 11) — dashboard UX
9. **MCP proxy hasBudgets** (Change 12) — depends on introspect changes
10. **Batch inserts** (Change 9) — performance optimization, test carefully

**Estimated total effort: 5-7 days**

---

## What Is NOT Changing

- **Lua budget scripts** (`budget.ts`) — keep as-is, they're production-grade
- **SSE parsers** — keep the TransformStream passthrough pattern
- **Cost calculators** — keep per-provider with separate implementations
- **Cost engine** (`pricing-data.json`) — keep the JSON pricing lookup
- **CF Workers + Upstash Redis + Supabase Postgres** — keep the infrastructure
- **Stripe billing integration** — keep as-is
- **MCP proxy EventBatcher + circuit breaker** — keep as-is
- **DB semaphore** — keep the connection limiting pattern
- **Reservation/reconciliation pattern** — keep the atomic budget flow

---

## Post-Launch Additions (not in this refactor)

These are tracked separately and should NOT be mixed into this refactor:

- Programmable spend policies (YAML policy engine)
- Webhook event stream
- Kill receipts
- Provider health monitoring (derive from `upstream_duration_ms` data)
- Request deduplication (enforcement-only, Redis-based)
- Additional providers (Azure OpenAI, Bedrock, Gemini)
- Go binary for self-hosted deployment
- Reporting SDK for non-proxy traffic
