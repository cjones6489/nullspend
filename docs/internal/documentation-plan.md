# NullSpend Documentation Plan

**Created:** 2026-03-21
**Status:** Working document — tracks all documentation needs and progress
**Goal:** Developer-friendly documentation modeled on Stripe, Supabase, Vercel, and Resend patterns

---

## Design Principles

Derived from auditing docs at Stripe, Supabase, Vercel, and Resend:

1. **Task-first, not API-first.** Lead with "what do you want to do?" not "here are our endpoints." Every top-level entry should be a developer goal.
2. **Show the diff.** For a proxy product, the integration is a base URL change. Show before/after code, not just the after.
3. **Delegate to upstream docs.** Don't rewrite the OpenAI/Anthropic API spec. Document only what NullSpend adds or changes (headers, enforcement, webhooks).
4. **Headers are the API surface.** The custom headers reference is our most important API page — it's the primary way developers interact with the proxy.
5. **Errors are documentation.** Every error response should include a `doc_url` pointing to its documentation page (Stripe pattern). Self-service resolution.
6. **Webhooks deserve their own section.** Not a subsection — a top-level section with event catalog, payload reference, security, retries, best practices (Stripe pattern).
7. **3 quickstarts, not 13.** Start with OpenAI, Anthropic, Claude Code. Add more when users ask.
8. **Pricing is documentation.** Developers want exact per-model rates with the formula. Auto-generate from pricing-data.json.

---

## Site Structure

```
docs/
├── overview.md                          # What NullSpend does, 30-second pitch
│
├── quickstart/
│   ├── openai.md                        # 3-step: create key, set env vars, verify
│   ├── anthropic.md                     # 3-step: same pattern
│   └── claude-code.md                   # @nullspend/claude-agent adapter
│
├── guides/
│   ├── openai-python.md                 # Full OpenAI Python integration
│   ├── openai-node.md                   # Full OpenAI Node/TS integration
│   ├── anthropic-python.md              # Full Anthropic Python integration
│   ├── anthropic-node.md                # Full Anthropic Node/TS integration
│   ├── claude-agent-sdk.md              # @nullspend/claude-agent deep dive
│   ├── mcp-tools.md                     # MCP proxy/server setup
│   ├── direct-http.md                   # cURL / any language via HTTP
│   └── migrating-from-helicone.md       # Competitive migration (exists, needs update)
│
├── features/
│   ├── cost-tracking.md                 # How costs are calculated, what's tracked
│   ├── budgets.md                       # Types, enforcement behavior, 429 responses
│   ├── velocity-limits.md               # Sliding window, cooldown, circuit breaker
│   ├── session-limits.md                # Per-session cost caps
│   ├── tags.md                          # X-NullSpend-Tags, filtering, attribution
│   ├── tracing.md                       # W3C traceparent, request correlation
│   ├── human-in-the-loop.md             # HITL approval flow
│   └── dashboard.md                     # Analytics, activity log, settings
│
├── webhooks/
│   ├── overview.md                      # What, when, why
│   ├── event-types.md                   # Complete catalog with descriptions
│   ├── payloads.md                      # Full JSON for each event, thin vs full
│   ├── security.md                      # HMAC verification code (TS + Python)
│   ├── delivery.md                      # Retry schedule, failure handling
│   └── best-practices.md               # Idempotency, async processing, dedup
│
├── api-reference/
│   ├── authentication.md                # API key creation, header format
│   ├── proxy-endpoints.md               # What we proxy, base URLs, added headers
│   ├── custom-headers.md                # Every X-NullSpend-* header — THE key page
│   ├── response-headers.md              # What we add to responses
│   ├── errors.md                        # Every error code with fix guidance
│   ├── rate-limits.md                   # Limits, headers, retry guidance
│   ├── budgets-api.md                   # CRUD + status endpoints
│   ├── api-keys-api.md                  # CRUD endpoints
│   ├── cost-events-api.md               # Query, single, batch, summary
│   ├── webhooks-api.md                  # Endpoint CRUD, test, rotate
│   ├── actions-api.md                   # HITL CRUD endpoints
│   └── versioning.md                    # NullSpend-Version header, changelog
│
├── sdks/
│   ├── javascript.md                    # @nullspend/sdk
│   ├── claude-agent.md                  # @nullspend/claude-agent
│   ├── mcp-server.md                    # @nullspend/mcp-server
│   └── mcp-proxy.md                     # @nullspend/mcp-proxy
│
└── reference/
    ├── supported-models.md              # Full pricing table (auto-gen from pricing-data.json)
    ├── architecture.md                  # How the proxy works (trust/transparency)
    └── changelog.md                     # Version history
```

---

## Page Specifications

Each page below lists: what it must contain, source files to reference, and status.

### Overview (`overview.md`)

**Content:**
- One-sentence pitch: "NullSpend is a FinOps proxy for AI agents — add cost tracking and budget enforcement without changing your code."
- Three-bullet value prop: track costs in real time, enforce hard budget limits, get webhook alerts
- Architecture diagram: `Your App -> NullSpend Proxy -> OpenAI/Anthropic`
- "The proxy never modifies your requests or responses" trust statement
- BYOK: provider API keys stay with the developer
- "Get started in 2 minutes" CTA -> quickstart
- Feature grid: cost tracking, budgets, velocity limits, session limits, tags, tracing, webhooks, HITL, dashboard

**Sources:** `docs/guides/show-hn-draft.md`, `docs/finops-pivot-roadmap.md` (positioning section)
**Status:** Not started

---

### Quickstart: OpenAI (`quickstart/openai.md`)

**Content:**
- Prerequisites: NullSpend account, existing OpenAI app
- Step 1: Create API key (dashboard screenshot path)
- Step 2: Set env vars — show before/after diff:
  ```
  # Before (standard OpenAI)
  OPENAI_BASE_URL=https://api.openai.com/v1

  # After (with NullSpend)
  OPENAI_BASE_URL=https://proxy.nullspend.com/v1
  ```
- Step 3: Add auth header — TypeScript + Python examples
- Step 4: Run agent, verify costs appear in dashboard
- Next steps: set a budget, add tags, configure webhooks

**Sources:** `docs/guides/quickstart.md` (exists, needs restructuring), `docs/guides/provider-setup-openai.md`
**Status:** Partial — quickstart.md exists but combines OpenAI + Anthropic

---

### Quickstart: Anthropic (`quickstart/anthropic.md`)

**Content:** Same pattern as OpenAI but with:
- `ANTHROPIC_BASE_URL=https://proxy.nullspend.com/anthropic`
- Anthropic SDK examples (Python + TypeScript)
- Note on cache token tracking (cache read/write priced separately)

**Sources:** `docs/guides/quickstart.md`, `docs/guides/provider-setup-anthropic.md`
**Status:** Partial — exists combined in quickstart.md

---

### Quickstart: Claude Code (`quickstart/claude-code.md`)

**Content:**
- Prerequisites: Claude Code installed, NullSpend account
- Step 1: Install adapter: `npm install @nullspend/claude-agent`
- Step 2: Configure with `withNullSpend()`:
  ```typescript
  import { withNullSpend } from "@nullspend/claude-agent";
  const options = withNullSpend({
    apiKey: process.env.NULLSPEND_API_KEY,
    budgetSessionId: "my-session",
    tags: { project: "my-project" },
  });
  ```
- Step 3: Run, verify costs in dashboard
- Tags, session limits, trace correlation explained

**Sources:** `packages/claude-agent/src/with-nullspend.ts`, `packages/claude-agent/src/types.ts`
**Status:** Not started

---

### Feature: Cost Tracking (`features/cost-tracking.md`)

**Content:**
- How costs are calculated: `cost = (input_tokens / 1M * input_rate) + (output_tokens / 1M * output_rate)`
- What's tracked per request: provider, model, input/output/cached/reasoning tokens, cost in microdollars, duration, request ID
- Cached token pricing (OpenAI + Anthropic cache semantics)
- Reasoning token handling (subset of output tokens, displayed separately)
- Cost event sources: `proxy` (automatic), `api` (SDK/HTTP), `mcp` (tool calls)
- Cost event tags for attribution
- Where to see costs: dashboard analytics, activity log, API queries
- How the proxy calculates cost asynchronously (never adds latency)

**Sources:** `apps/proxy/src/lib/cost-calculator.ts`, `apps/proxy/src/lib/anthropic-cost-calculator.ts`, `packages/cost-engine/src/pricing-data.json`
**Status:** Not started

---

### Feature: Budgets (`features/budgets.md`)

**Content:**
- What a budget is: spending ceiling on a user account or API key
- How enforcement works: pre-request estimation -> reservation -> post-response reconciliation
- Budget entity types: `user`, `api_key` (and `tag` when tag budgets ship)
- Enforcement policies: `strict_block` (hard stop, 429)
- Reset intervals: daily, weekly, monthly, or manual
- What happens when a budget is exceeded: 429 response with `budget_exceeded` code
- Example 429 response body with all fields
- Configurable threshold alerts: default [50, 80, 90, 95], webhook notifications
- Creating budgets via dashboard and API
- Budget status endpoint for programmatic queries

**Sources:** `lib/validations/budgets.ts`, `apps/proxy/src/durable-objects/user-budget.ts`, `docs/guides/budget-configuration.md`
**Status:** Partial — `budget-configuration.md` exists, needs restructuring

---

### Feature: Velocity Limits (`features/velocity-limits.md`)

**Content:**
- What velocity limits do: cap spend rate over a sliding time window
- Configuration: limit amount, window duration (10-3600s), cooldown duration (10-3600s)
- How it works: sliding window counter, circuit breaker triggers cooldown on breach
- 429 response with `velocity_exceeded` code and `Retry-After` header
- Recovery: `velocity.recovered` webhook fires when cooldown expires
- Example: "$10/minute limit with 60s cooldown"
- Dashboard configuration UI

**Sources:** `apps/proxy/src/durable-objects/user-budget.ts` (velocity logic), `docs/research/velocity-limits-deep-research.md`
**Status:** Not started

---

### Feature: Session Limits (`features/session-limits.md`)

**Content:**
- What session limits do: cap cumulative spend per session ID
- How to set a session ID: `X-NullSpend-Session` header (max 256 chars)
- Configuration: `sessionLimitMicrodollars` on a budget entity
- 429 response with `session_limit_exceeded` code
- Session spend tracked in Durable Object, cleaned up after 24h inactivity
- Use case: limit each agent conversation to $5

**Sources:** `apps/proxy/src/durable-objects/user-budget.ts`, `docs/research/session-level-budget-aggregation.md`
**Status:** Not started

---

### Feature: Tags & Attribution (`features/tags.md`)

**Content:**
- What tags do: arbitrary key-value labels for cost allocation
- How to send: `X-NullSpend-Tags: {"project": "search", "env": "prod"}`
- Validation rules: max 10 keys, key pattern `[a-zA-Z0-9_-]+` (max 64 chars), value max 256 chars
- Reserved prefix: `_ns_` (system tags, user tags with this prefix silently dropped)
- Querying by tags: `GET /api/cost-events?tag.project=search`
- Dashboard: tag breakdown in analytics
- Tag budget enforcement (when shipped): budget per tag value

**Sources:** `apps/proxy/src/lib/tags.ts`, proxy route handlers
**Status:** Not started

---

### Feature: Tracing (`features/tracing.md`)

**Content:**
- W3C `traceparent` header: auto-extracted, forwarded to upstream
- Custom `X-NullSpend-Trace-Id` header: 32-char hex string
- Auto-generated trace ID when neither header is present
- `X-NullSpend-Trace-Id` response header for correlation
- Querying by trace: `GET /api/cost-events?traceId=abcdef...`
- Use case: group all LLM calls in an agent task by trace ID, see total cost

**Sources:** `apps/proxy/src/lib/trace-context.ts`
**Status:** Not started

---

### Feature: Human-in-the-Loop (`features/human-in-the-loop.md`)

**Content:**
- What HITL does: agent proposes an action, human approves/rejects in dashboard
- Action types: `send_email`, `http_post`, `http_delete`, `shell_command`, `db_write`, `file_write`, `file_delete`
- Lifecycle: created -> pending -> approved/rejected/expired -> executing -> executed/failed
- SDK usage: `client.proposeAndWait()` — creates action and polls for decision
- Dashboard: Inbox (pending actions), History (completed actions)
- Webhook events: `action.created`, `action.approved`, `action.rejected`, `action.expired`
- Expiration: configurable TTL (up to 30 days)
- Cost attribution: link actions to cost events via `X-NullSpend-Action-Id` header

**Sources:** `lib/actions/`, `packages/sdk/src/client.ts`, `app/api/actions/`
**Status:** Not started

---

### Webhooks: Overview (`webhooks/overview.md`)

**Content:**
- What webhooks are: real-time HTTP POST notifications for cost events and budget alerts
- When to use: Slack bots, PagerDuty alerts, internal accounting, custom dashboards
- Quick setup: create endpoint in dashboard, verify with test ping
- Payload modes: full (complete event data) vs thin (reference only, fetch back via API)
- Signing: HMAC-SHA256 with signing secret for verification
- Delivery: via QStash with 5 retries

**Sources:** `apps/proxy/src/lib/webhook-events.ts`, `apps/proxy/src/lib/webhook-dispatch.ts`
**Status:** Not started

---

### Webhooks: Event Types (`webhooks/event-types.md`)

**Content:** Full catalog table:

| Event Type | Fires When | Criticality |
|---|---|---|
| `cost_event.created` | Every tracked LLM/tool call completes | Informational |
| `budget.threshold.warning` | Spend crosses a warning threshold (< 90%) | Warning |
| `budget.threshold.critical` | Spend crosses a critical threshold (>= 90%) | Critical |
| `budget.exceeded` | Request blocked due to budget exhaustion | Critical |
| `budget.reset` | Budget resets on period boundary | Informational |
| `velocity.exceeded` | Spend rate exceeds velocity limit | Critical |
| `velocity.recovered` | Velocity cooldown expired, requests resume | Informational |
| `session.limit_exceeded` | Session spend exceeds session limit | Critical |
| `request.blocked` | Request blocked (budget, rate limit, or policy) | Critical |
| `action.created` | HITL action created | Informational |
| `action.approved` | HITL action approved by human | Informational |
| `action.rejected` | HITL action rejected by human | Informational |
| `action.expired` | HITL action expired without decision | Warning |
| `test.ping` | Test event for webhook verification | Informational |

Each event type gets: description, when it fires, full JSON payload example, field-by-field description.

**Sources:** `apps/proxy/src/lib/webhook-events.ts` (all builder functions)
**Status:** Not started

---

### Webhooks: Payloads (`webhooks/payloads.md`)

**Content:**
- Full event structure (full mode): `{ id, type, api_version, created_at, data: { object: {...} } }`
- Thin event structure: `{ id, type, api_version, created_at, related_object: { id, type, url } }`
- Full JSON example for every event type
- Thin event: how to fetch back the full data via the `related_object.url`
- Payload mode configuration: per-endpoint `payloadMode: "full" | "thin"`
- Only `cost_event.created` supports thin mode; all other events always deliver full payloads

**Sources:** `apps/proxy/src/lib/webhook-events.ts`
**Status:** Not started

---

### Webhooks: Security (`webhooks/security.md`)

**Content:**
- Signing algorithm: HMAC-SHA256
- Headers: `X-NullSpend-Signature` (format: `t=<timestamp>,v1=<hex>`), `X-NullSpend-Webhook-Id`, `X-NullSpend-Webhook-Timestamp`
- Verification code examples in TypeScript + Python
- Secret rotation: dual-signing during 24h window, old secret automatically cleaned up
- Replay protection: verify timestamp is within acceptable window (e.g., 5 minutes)
- SSRF protection: webhook URLs must be HTTPS, no private/reserved IPs

**Sources:** `apps/proxy/src/lib/webhook-signer.ts`, `lib/webhooks/signer.ts`
**Status:** Not started

---

### Webhooks: Delivery & Retries (`webhooks/delivery.md`)

**Content:**
- Delivery via QStash (Upstash managed queue)
- 5 automatic retries with exponential backoff
- Expected response: return 2xx within 5 seconds
- What happens on failure: retries, then dropped (no DLQ for webhook delivery)
- Delivery log: viewable in dashboard under webhook endpoint detail

**Sources:** `apps/proxy/src/lib/webhook-dispatch.ts`
**Status:** Not started

---

### Webhooks: Best Practices (`webhooks/best-practices.md`)

**Content (modeled on Stripe's 12 practices):**
1. Return 2xx quickly — process the event asynchronously
2. Verify the signature before processing
3. Handle duplicate events idempotently (use `event.id` for dedup)
4. Don't rely on event ordering
5. Use event type filtering to reduce noise
6. Consider thin mode for high-volume cost events
7. Monitor your endpoint's error rate
8. Test with `test.ping` before going live
9. Rotate signing secrets periodically (dashboard supports this)
10. Log webhook payloads for debugging

**Status:** Not started

---

### API Reference: Custom Headers (`api-reference/custom-headers.md`)

**THIS IS THE MOST IMPORTANT API PAGE.** For a proxy product, custom headers are the primary developer-facing API surface.

**Content:** Full table of every NullSpend header:

| Header | Direction | Required | Format | Example | Purpose |
|---|---|---|---|---|---|
| `X-NullSpend-Key` | Request | Yes | `ns_live_sk_*` | `ns_live_sk_abc123...` | Authentication |
| `X-NullSpend-Tags` | Request | No | JSON object | `{"project":"search"}` | Cost attribution |
| `X-NullSpend-Session` | Request | No | String (max 256) | `session-abc` | Session budget grouping |
| `X-NullSpend-Trace-Id` | Request | No | 32-char hex | `abcdef01...` | Custom trace ID |
| `X-NullSpend-Action-Id` | Request | No | `ns_act_<UUID>` | `ns_act_550e...` | Link to HITL action |
| `X-NullSpend-Upstream` | Request | No | URL | `https://api.openai.com` | Override upstream |
| `NullSpend-Version` | Request | No | Version string | `2026-04-01` | API version override |
| `traceparent` | Request | No | W3C format | `00-abcd...-1234...-01` | W3C trace context |
| `X-NullSpend-Trace-Id` | Response | Always | 32-char hex | `abcdef01...` | Trace correlation |
| `NullSpend-Version` | Response | Always | Version string | `2026-04-01` | API version used |
| `x-nullspend-overhead-ms` | Response | Always | Integer | `3` | Proxy overhead (ms) |
| `Server-Timing` | Response | Always | W3C format | `nullspend;dur=3.2` | W3C timing |

Each header gets: description, validation rules, examples, what happens if omitted.

**Sources:** `apps/proxy/src/lib/tags.ts`, `apps/proxy/src/lib/trace-context.ts`, `apps/proxy/src/lib/headers.ts`, `apps/proxy/src/index.ts`
**Status:** Not started

---

### API Reference: Errors (`api-reference/errors.md`)

**Content (Resend pattern — code, status, message, suggested fix):**

| Code | HTTP Status | Message | Fix |
|---|---|---|---|
| `unauthorized` | 401 | Invalid or missing API key | Check your `X-NullSpend-Key` header contains a valid, non-revoked key |
| `budget_exceeded` | 429 | Estimated cost exceeds remaining budget | Increase your budget limit or wait for the reset period |
| `velocity_exceeded` | 429 | Spending rate exceeds velocity limit | Wait for the cooldown period (check `Retry-After` header) |
| `session_limit_exceeded` | 429 | Session spend exceeds session limit | Start a new session or increase the session limit |
| `rate_limited` | 429 | Too many requests | Reduce request rate or wait for the rate limit window to reset |
| `invalid_model` | 400 | Model not in allowed list | Check supported models at /reference/supported-models |
| `bad_request` | 400 | Malformed request | Check request body is valid JSON with required fields |
| `payload_too_large` | 413 | Request body exceeds 1MB | Reduce request body size |
| `budget_unavailable` | 503 | Budget service temporarily unavailable | Retry after a brief delay |
| `upstream_error` | 502 | Provider returned an error | Check provider status; the error is forwarded from OpenAI/Anthropic |
| `not_found` | 404 | Resource not found | Check the ID and endpoint path |
| `validation_error` | 400 | Request validation failed | Check the `details.issues` array for specific field errors |
| `limit_exceeded` | 409 | Resource limit reached | You've hit the max (e.g., 10 webhook endpoints, 20 API keys) |

**Error response format:**
```json
{
  "error": {
    "code": "budget_exceeded",
    "message": "Request blocked: estimated cost exceeds remaining budget",
    "details": null
  }
}
```

**Sources:** `apps/proxy/src/lib/errors.ts`, `lib/utils/http.ts`
**Status:** Not started

---

### API Reference: Dashboard API endpoints

**For each endpoint page, include (Resend pattern):**
- HTTP method + path
- Authentication method
- Request body parameters (name, type, required, description)
- Request examples in TypeScript + Python + cURL
- Response example with full JSON
- Error cases specific to this endpoint

**Endpoints to document:**

| Page | Endpoints |
|---|---|
| `budgets-api.md` | GET/POST/PUT/DELETE `/api/budgets`, `/api/budgets/[id]`, `/api/budgets/status` |
| `api-keys-api.md` | GET/POST/DELETE `/api/keys`, `/api/keys/[id]` |
| `cost-events-api.md` | GET `/api/cost-events` (list), GET `/api/cost-events/[id]`, POST `/api/cost-events` (single), POST `/api/cost-events/batch`, GET `/api/cost-events/summary` |
| `webhooks-api.md` | GET/POST `/api/webhooks`, GET/PUT/DELETE `/api/webhooks/[id]`, POST `/api/webhooks/[id]/test`, POST `/api/webhooks/[id]/rotate-secret`, GET `/api/webhooks/[id]/deliveries` |
| `actions-api.md` | POST/GET `/api/actions`, GET `/api/actions/[id]`, POST `approve`/`reject`/`result` |

**Sources:** `app/api/` route files, `lib/validations/` schemas
**Status:** Not started

---

### SDK: JavaScript (`sdks/javascript.md`)

**Content:**
- Installation: `npm install @nullspend/sdk`
- Configuration: `NullSpendConfig` with all options
- Methods: `createAction`, `proposeAndWait`, `reportCost`, `reportCostBatch`, `getBudgetStatus`
- Cost reporting: auto-batching (batch size, flush interval, queue)
- Error handling: `NullSpendError`, `TimeoutError`, `RejectedError`
- Retry configuration

**Sources:** `packages/sdk/src/client.ts`, `packages/sdk/src/types.ts`
**Status:** Not started

---

### SDK: Claude Agent (`sdks/claude-agent.md`)

**Content:**
- Installation: `npm install @nullspend/claude-agent`
- Usage: `withNullSpend(options)` config transformer
- Options: `apiKey`, `budgetSessionId`, `tags`, `traceId`, `actionId`, `proxyUrl`
- How it works: sets env vars + headers, routes through proxy
- Client-side validation: actionId format, traceId format, tag key pattern, newline injection prevention

**Sources:** `packages/claude-agent/src/with-nullspend.ts`, `packages/claude-agent/src/types.ts`
**Status:** Not started

---

### SDK: MCP Server (`sdks/mcp-server.md`)

**Content:**
- What it does: MCP server exposing NullSpend tools to AI agents
- Tools: `nullspend_check_budget`, `nullspend_report_cost`, `nullspend_list_actions`, etc.
- Configuration: `NULLSPEND_API_KEY`, `NULLSPEND_URL`
- Use case: agent checks budget before expensive operations

**Sources:** `packages/mcp-server/src/tools.ts`, `packages/mcp-server/src/config.ts`
**Status:** Not started

---

### SDK: MCP Proxy (`sdks/mcp-proxy.md`)

**Content:**
- What it does: stdio MCP proxy that wraps upstream MCP servers with cost tracking + budget enforcement
- Configuration: `UPSTREAM_COMMAND`, `GATED_TOOLS`, `BUDGET_ENFORCEMENT_ENABLED`, etc.
- How it works: intercepts tool calls, checks budget, tracks cost, forwards to upstream
- Tool cost overrides: `TOOL_COST_OVERRIDES_*` env vars

**Sources:** `packages/mcp-proxy/src/proxy.ts`, `packages/mcp-proxy/src/config.ts`
**Status:** Not started

---

### Reference: Supported Models (`reference/supported-models.md`)

**Content:**
- Auto-generated table from `packages/cost-engine/src/pricing-data.json`
- Columns: Provider, Model, Input $/1M tokens, Output $/1M tokens, Cached Input $/1M tokens
- Cost formula: `cost_microdollars = (input_tokens * input_rate / 1M) + (output_tokens * output_rate / 1M) + (cached_tokens * cached_rate / 1M)`
- Note: "Prices last updated: [date]. If a model isn't listed, the proxy returns 400 `invalid_model`."
- OpenAI: 14 models (gpt-4o, gpt-4o-mini, gpt-4.1 family, o3, o4-mini, gpt-4-turbo, gpt-3.5-turbo)
- Anthropic: 22 models (claude-sonnet-4, claude-opus-4, claude-3.5 family, claude-3 family, dated variants)

**Sources:** `packages/cost-engine/src/pricing-data.json`
**Status:** Not started

---

## Existing Docs Requiring Updates

| File | What needs updating |
|---|---|
| `docs/guides/quickstart.md` | Split into per-provider quickstarts; remove "platform key" language; add tags/webhooks/velocity in "what's next" |
| `docs/guides/migrating-from-helicone.md` | Remove "Kill receipts (coming soon)"; update feature mapping table with tags, velocity, session limits, webhooks, traceparent; update "custom properties" FAQ to mention tags; replace "platform key" with "API key" |
| `docs/guides/provider-setup-openai.md` | Verify model prices are current; add section on custom headers (tags, sessions, traces) |
| `docs/guides/provider-setup-anthropic.md` | Same as OpenAI; add cache token pricing details |
| `docs/guides/budget-configuration.md` | Add velocity limits, session limits, threshold configuration sections |
| `docs/guides/show-hn-draft.md` | Update feature list; remove "platform key"; add competitive angle |

---

## Implementation Priority

**Phase 1 — Launch blockers (do first):**
1. `overview.md` — the front door
2. `quickstart/openai.md` — primary onboarding path
3. `quickstart/anthropic.md` — second provider
4. `api-reference/custom-headers.md` — the core API surface
5. `api-reference/errors.md` — self-service debugging
6. Update `migrating-from-helicone.md` — competitive capture

**Phase 2 — Core feature docs (do next):**
7. `features/cost-tracking.md`
8. `features/budgets.md`
9. `features/tags.md`
10. `webhooks/overview.md` + `event-types.md` + `security.md`
11. `reference/supported-models.md`

**Phase 3 — Complete coverage (after launch):**
12. Remaining feature pages (velocity, sessions, tracing, HITL)
13. Full API reference (all endpoint pages)
14. SDK docs (all 4 packages)
15. Remaining webhook pages (payloads, delivery, best practices)
16. Integration guides (per-language deep dives)

---

## Technical Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Docs format | Markdown files in `docs/` | Simple, version-controlled, works with any static site generator |
| Hosting (initial) | GitHub README links | Zero overhead; upgrade to docs site when users ask |
| Hosting (future) | Nextra or Fumadocs | Next.js-native, MDX support, search built-in |
| Code examples | TypeScript + Python + cURL | Covers 90%+ of users; add more languages on demand |
| API reference style | Resend pattern (params table + code + response JSON) | Focused, maintainable for small team |
| Model pricing table | Auto-generated from pricing-data.json | Stays in sync automatically |
| Error `doc_url` | Add to error response bodies | Stripe pattern; turns every error into documentation |
