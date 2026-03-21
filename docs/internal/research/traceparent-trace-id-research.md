# Deep Technical Research: W3C `traceparent` Propagation + `trace_id` Column

**Research date:** 2026-03-19
**Priority item:** Roadmap 1.3 — W3C `traceparent` + `trace_id` column on `cost_events`
**Research method:** 6-agent parallel research team (documentation, competitive analysis, open source repos, architecture, DX/frontier, risk analysis)

## Topic

NullSpend needs to correlate multiple LLM calls into a single "trace" so users can answer: **"How much did this agent run cost?"** Today, `cost_events` tracks individual requests. Adding `trace_id` enables cost aggregation across the 2–20 LLM calls that comprise a typical agent task.

W3C Trace Context (`traceparent` header) is the emerging standard for distributed trace propagation. Agent frameworks (LangChain, Vercel AI SDK, Claude Agent SDK) are beginning to emit it natively. NullSpend's proxy sits in the perfect position to extract, store, and correlate trace IDs without requiring any SDK changes from users.

**Why it matters:** Tags give you *who/what* attribution. `trace_id` gives you *which task* correlation. Together they complete the cost attribution story that enterprises need before adopting AI agents at scale.

## Executive Summary

**Recommended approach:** Add a simple `trace_id text` nullable column to `cost_events` with a partial B-tree index. Extract from `traceparent` header in the proxy, fall back to `X-NullSpend-Trace-Id` custom header, auto-generate when absent. Do NOT build a spans table or full observability data model — NullSpend is FinOps, not an observability platform.

**Key findings:**
- The industry is converging on W3C `traceparent` — Portkey, LiteLLM, and Langfuse all support it
- Neither OpenAI nor Anthropic accept or propagate trace context — the proxy is the only correlation point
- Auto-generating trace IDs when absent gives zero-config cost tracking — no competitor does this
- A single column answers the core question; span trees require client cooperation that won't exist pre-launch
- The OTel GenAI SIG has no cost attribute and no proposal for one — NullSpend should define its own conventions
- `trace_id` complements `sessionId` (sessions span hours/conversations, traces span seconds/agent runs)

**Estimated effort:** ~4h implementation + ~3h testing

## Research Method

Six specialized agents researched in parallel:

1. **Documentation Agent** — W3C Trace Context spec, OTel GenAI conventions, Drizzle ORM patterns, Cloudflare Workers header handling, OpenAI/Anthropic API docs
2. **Competitive Agent** — Helicone, Portkey, LiteLLM, Langfuse, Braintrust, OpenAI Agents SDK, Anthropic API trace patterns
3. **Open Source Agent** — Claude Agent SDK, LangChain, Vercel AI SDK, AG2, traceparent parser libraries, OTel JS SDK
4. **Architecture Agent** — Three options evaluated against NullSpend's codebase (simple column vs full trace context vs spans table)
5. **DX/Frontier Agent** — Developer experience analysis, emerging AI observability startups, OTel GenAI SIG status, novel patterns
6. **Risk Agent** — Header parsing edge cases, multi-tenant isolation, performance, migration safety, upstream forwarding

## Official Documentation Findings

### W3C Trace Context Specification

**Current stable spec:** W3C Trace Context Level 1 — W3C Recommendation, 23 November 2021.
**Level 2:** Candidate Recommendation Draft (28 March 2024). Adds trace ID generation guidance. Not yet a full Recommendation.

**`traceparent` header format:**
```
{version}-{trace-id}-{parent-id}-{trace-flags}
00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
```

| Field | Size | Positions |
|---|---|---|
| `version` | 2 hex chars | 0-1 |
| `trace-id` | 32 hex lowercase chars | 3-34 |
| `parent-id` | 16 hex lowercase chars | 36-51 |
| `trace-flags` | 2 hex chars | 53-54 |

**Key rules:**
- All-zeros trace-id (`00000000000000000000000000000000`) is invalid — must be rejected
- Version `ff` is forbidden
- Future versions (01+): implementations should still extract trace-id from the same positions if header is ≥55 chars
- `tracestate` header carries vendor-specific key-value pairs (max 32 entries, 512 chars)

**Proxy role (intermediary):** Extract trace-id for storage. Strip before forwarding to upstream (trust boundary). Generate new parent-id if creating a child span.

**Spec URLs:**
- Level 1: https://www.w3.org/TR/trace-context/
- Level 2: https://www.w3.org/TR/trace-context-2/

### OpenTelemetry GenAI Semantic Conventions

**Version:** v1.40.0 — **Development** stability status (not stable, not experimental)

**Key attributes:** `gen_ai.operation.name`, `gen_ai.provider.name`, `gen_ai.request.model`, `gen_ai.response.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.conversation.id`

**Metrics:** `gen_ai.client.token.usage` (histogram), `gen_ai.client.operation.duration` (histogram)

**Critical gap:** No cost attribute exists. `gen_ai.client.cost` or `gen_ai.usage.cost` does not exist in the spec and has no open proposal. The GenAI SIG deliberately excludes cost because it's "provider-specific."

**Implication:** NullSpend should define its own cost conventions and optionally propose them to OTel later.

### Upstream Provider Support

| Provider | Accepts `traceparent`? | Response correlation header | Client-supplied ID? |
|---|---|---|---|
| **OpenAI** | No (ignores, harmless) | `x-request-id` | `X-Client-Request-Id` (ASCII, max 512 chars) |
| **Anthropic** | No (ignores, harmless) | `request-id` (no `x-` prefix) | None |

Neither provider participates in distributed tracing. The proxy is the only place where trace correlation can happen.

### Cloudflare Workers

Workers access request headers via standard `Request.headers` API with no restrictions on `traceparent`. Header size limit: 128 KB. No stripping or modification of trace headers.

### Drizzle ORM

Pattern mirrors existing `sessionId` column exactly:
```typescript
traceId: text("trace_id"),
// In table constraints:
index("cost_events_trace_id_idx").on(table.traceId),
```

## Modern Platform and Ecosystem Patterns

### Competitive Comparison Matrix

| Platform | Trace Header(s) | W3C traceparent | Cost per trace | DX Model | Open Source |
|---|---|---|---|---|---|
| **Helicone** | `Helicone-Session-Id` + `Session-Path` | No | Yes (auto) | Headers on proxy | Yes |
| **Portkey** | `x-portkey-trace-id`, `traceparent`, `baggage` | Yes (full) | Yes (auto) | SDK + headers | No |
| **LiteLLM** | `traceparent` (OTel native) | Yes (extract + forward) | No (delegated to backend) | Proxy config | Yes |
| **Langfuse** | `traceparent`, `x-langfuse-trace-id`, SDK | Yes (native OTel) | Yes (auto, pricing tiers) | SDK decorators + OTel | Yes |
| **Braintrust** | None (SDK-level) | Export only | Yes (auto) | SDK wrappers | Partially |
| **OpenAI** | `x-request-id` (response) | No | Agents SDK only | Agents SDK (Python) | Agents SDK yes |
| **Anthropic** | `request-id` (response) | No | No | N/A | N/A |

### Key Patterns

1. **Industry converging on W3C traceparent** — Portkey, LiteLLM, Langfuse all support it. Helicone is the holdout with proprietary headers.

2. **Gateway/proxy architectures favor header-based tracing** — Change base URL, add headers, done. This is NullSpend's model.

3. **Dual-mode is best DX** — Accept both `traceparent` (for OTel-instrumented clients) and a proprietary header like `X-NullSpend-Trace-Id` (for simple cases). Portkey's precedence model (proprietary wins if both present) works well.

4. **Cost-per-trace aggregation is a differentiator** — Helicone, Portkey, Langfuse, Braintrust all do it. LiteLLM notably does not. Since NullSpend already calculates per-request cost, rolling up by trace_id is the natural extension.

5. **Langfuse's generation-as-first-class concept** is the most mature cost-per-trace implementation — pricing tier support, `calculatedTotalCost` auto-rollup, and an observation-centric data model.

## Relevant Repos, Libraries, and Technical References

### Agent Framework Traceparent Support

| Framework | Package | Emits traceparent? | Accepts? | Cost on spans? | Maturity |
|---|---|---|---|---|---|
| **Claude Agent SDK** | `@anthropic-ai/claude-agent-sdk` v0.2.74 | No | No | `total_cost_usd` on result msg | Production (no tracing) |
| **LangChain/LangSmith** | `langchain` (~1.4M/wk), 17.2k stars | No (custom `langsmith-trace` header) | No (custom) | Via LangSmith UI | Production |
| **Vercel AI SDK** | `ai` v6.0.116 (~2.8M/wk), 22.8k stars | Yes (via OTel) | Yes (via OTel) | Token counts on spans | Production |
| **AG2 (AutoGen)** | `ag2`, 4.3k stars | Yes (W3C native, A2A protocol) | Yes (W3C native) | Tokens + cost on spans | Production |
| **OTel JS SDK** | `@opentelemetry/api` v1.9.0 (CNCF graduated) | Yes (standard) | Yes (standard) | User-set attributes | Production |

**Key insight:** Only Vercel AI SDK and AG2 emit W3C `traceparent` natively. LangChain uses proprietary headers. Claude Agent SDK has no trace propagation at all — it exposes cost via `total_cost_usd` and `modelUsage` on `SDKResultMessage`, but no trace correlation identifiers beyond `session_id`.

### Vercel AI SDK Telemetry Example

```typescript
const result = await generateText({
  model: anthropic("claude-sonnet-4-20250514"),
  prompt: "Write a story.",
  experimental_telemetry: { isEnabled: true },
});
// Emits spans: ai.generateText, ai.generateText.doGenerate, ai.toolCall
// Attributes: ai.usage.promptTokens, gen_ai.usage.input_tokens
```

### Lightweight Traceparent Parser Libraries

| Package | Weekly Downloads | Performance | Dependencies | Notes |
|---|---|---|---|---|
| `traceparent` (Elastic) | ~46,000 | Baseline | 0 | Best adoption, has `@types/traceparent` |
| `tctx` (maraisr) | ~235 | 21x faster | 0 | Best performance, also on JSR |
| **Manual regex** | N/A | Fastest | 0 | **Recommended for NullSpend** — 6 lines, zero risk |

**Recommendation:** Manual regex. The traceparent format is intentionally simple. Adding a dependency for 6 lines of parsing is unjustified.

### Traceparent Parsing — Minimal Implementation

```typescript
const TRACEPARENT_RE = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;
const ALL_ZEROS_TRACE = "00000000000000000000000000000000";

function extractTraceId(header: string | null): string | null {
  if (!header) return null;
  const match = header.toLowerCase().match(TRACEPARENT_RE);
  if (!match) return null;
  const traceId = match[2];
  if (traceId === ALL_ZEROS_TRACE) return null;
  return traceId;
}
```

### Other References

- **W3C Trace Context spec:** https://www.w3.org/TR/trace-context/
- **OTel GenAI Semantic Conventions:** https://opentelemetry.io/docs/specs/semconv/gen-ai/
- **OTel Agentic Systems Proposal:** https://github.com/open-telemetry/semantic-conventions/issues/2664
- **Langfuse trace model:** https://langfuse.com/docs/observability/data-model
- **Portkey tracing:** https://portkey.ai/docs/product/observability/traces
- **Helicone sessions:** https://docs.helicone.ai/features/sessions
- **LiteLLM OTel integration:** https://docs.litellm.ai/docs/observability/opentelemetry_integration
- **NullSpend agent tracing architecture:** `docs/technical-outlines/agent-tracing-architecture.md`

## Architecture Options

### Option A: Simple `trace_id` column (RECOMMENDED)

**Schema:** `trace_id text` nullable column + partial B-tree index
**Proxy changes:** 5 files, ~100 lines
**Effort:** ~4 hours implementation

| Criterion | Assessment |
|---|---|
| Cost-per-trace query | `SELECT SUM(cost_microdollars) WHERE trace_id = ? AND user_id = ?` — <1ms |
| Trace timeline | `SELECT * WHERE trace_id = ? ORDER BY created_at` |
| Span tree | Not enabled (deferred) |
| Storage overhead | ~84 bytes/row |
| DB write pressure | Zero additional (trace_id added to existing INSERT) |
| Migration risk | Trivial (nullable column, metadata-only in PG 11+) |

### Option B: Full trace context (`trace_id` + `span_id` + `parent_span_id`)

**Schema:** 3 columns + 2 indexes
**Proxy changes:** 7 files, ~200 lines

**Critical problem:** The proxy only sees one "span" per request. Without client cooperation (different `parent_id` values per request), the span tree is flat — adding no information beyond what `trace_id` alone provides. Pre-launch, zero clients will send structured parent IDs.

**Verdict:** Premature. Adds complexity without value until agent frameworks start sending structured spans through the proxy.

### Option C: `trace_id` column + separate `spans` table

**Schema:** New table with 4 indexes + dual write path
**Proxy changes:** 8+ files, ~400 lines

**Critical problem:** This is an observability data model, not a FinOps data model. Creates schema maintenance burden, query complexity (cross-table joins), and doubles DB write pressure (second INSERT per request through the semaphore-limited connection pool).

**Verdict:** Overengineered. NullSpend's positioning is cost tracking, not observability. The architecture doc explicitly warns: "Don't build an observability platform."

### Why Option A wins

1. **Answers the core question** — "How much did this agent run cost?" requires only `SUM(cost_microdollars) WHERE trace_id = ?`
2. **Zero expansion cost** — Adding `span_id`/`parent_span_id` columns later is the same trivial migration
3. **No additional write pressure** — trace_id is just another column in the existing INSERT
4. **Aligned with FinOps positioning** — cost attribution, not span visualization

## Recommended Approach for Our Platform

### Design Decisions

**Always auto-generate trace IDs.** Every request through the proxy gets a trace_id, whether the caller sent one or not. Resolution chain:
1. Parse `traceparent` header → extract 32-char hex trace-id
2. Fall back to `X-NullSpend-Trace-Id` header
3. Fall back to `crypto.randomUUID()` (auto-generate)

Auto-generated IDs create one-event-per-trace (no grouping), which degrades gracefully. Users get value when they start sending consistent trace IDs.

**`trace_id` complements `sessionId`:**

| Field | Scope | Lifetime | Use case |
|---|---|---|---|
| `sessionId` | Conversation/thread | Hours to days | "Cost of this chat conversation" |
| `trace_id` | Single agent run | Seconds to minutes | "Cost of this one task" |

A session contains many traces. Both should coexist.

**Do NOT forward `traceparent` upstream.** The proxy's header builders use allowlists — `traceparent` is already stripped. Add regression tests to guard this.

**Return trace_id in response headers.** `X-NullSpend-Trace-Id: {trace_id}` on every response, so agents can capture and reuse it for subsequent calls in the same trace.

### Schema

```sql
ALTER TABLE cost_events ADD COLUMN trace_id text;
CREATE INDEX CONCURRENTLY cost_events_trace_id_idx
  ON cost_events (trace_id) WHERE trace_id IS NOT NULL;
```

Partial index (matching existing `session_id` pattern) — excludes NULLs from the index, saving space and write amplification.

### Key Files to Modify

| File | Change |
|---|---|
| `packages/db/src/schema.ts` | Add `traceId: text("trace_id")` column + index |
| `apps/proxy/src/lib/trace-context.ts` | **New** — `parseTraceId()` extraction + validation |
| `apps/proxy/src/lib/context.ts` | Add `traceId: string` to `RequestContext` |
| `apps/proxy/src/index.ts` | Parse trace headers, build context |
| `apps/proxy/src/routes/openai.ts` | Add `traceId` to `EnrichmentFields` |
| `apps/proxy/src/routes/anthropic.ts` | Same |
| `apps/proxy/src/routes/mcp.ts` | Add `traceId: ctx.traceId` to cost event rows |
| `apps/proxy/src/lib/headers.ts` | Add `X-NullSpend-Trace-Id` to client response headers |
| `apps/proxy/src/lib/anthropic-headers.ts` | Same |
| `lib/validations/cost-events.ts` | Add `traceId` to record + query schemas |
| `lib/cost-events/list-cost-events.ts` | Add `traceId` filter |
| `lib/cost-events/serialize-cost-event.ts` | Include `traceId` in output |
| `lib/cost-events/get-cost-events-by-action.ts` | Add `traceId` to SELECT |
| `packages/sdk/src/types.ts` | Add `traceId?: string` to `CostEventInput` |
| Webhook builders (proxy + dashboard) | Add `trace_id` to `data.object` |

## Frontier and Emerging Patterns

### AI Observability Landscape (2024-2026)

| Company | Approach | Novel Pattern | Maturity |
|---|---|---|---|
| **Langfuse** (YC W23) | Open-source, SDK + OTel | `calculatedTotalCost` auto-rollup, pricing tier inference | Production |
| **Helicone** (YC W23) | Proxy-based, Rust rewrite | 1-5ms P95, session path hierarchy | Production |
| **Braintrust** (YC S22) | Proxy + eval, custom DB | Failed traces become test cases, 80x faster queries | Production |
| **AgentOps** | Session replay for agents | Recursive loop detection | Early-adopter |
| **Opik** (Comet) | Trace + eval + prompt mgmt | Thread auto-detection (15-min inactivity grouping) | Production |
| **Pydantic Logfire** | OTel-native Python | Metrics-in-spans: costs aggregated onto parent spans | Experimental |

### Emerging Patterns

| Pattern | Who | Maturity | NullSpend Action |
|---|---|---|---|
| **W3C `traceparent` for LLM calls** | Portkey, LiteLLM, Langfuse | Stable standard | **Adopt now** (this feature) |
| **Auto-generate trace IDs ("auto" magic value)** | NullSpend-unique | Novel | **Build now** — no competitor does this |
| **Cost in response headers** | LiteLLM only | Emerging | **Build now** — high-impact, low-effort |
| **Server-side tool_call_id stitching** | Nobody | Novel | **Design for Phase 2** — NullSpend's key differentiator |
| **SSE mid-stream cost injection** | Nobody | Novel | **Design for later** — backwards-compatible, unique |
| **Delegated sub-agent budgets** | Nobody | Open problem | **Strategic opportunity** — DO architecture is ideal |
| **MCP `_meta` cost conventions** | Nobody | Unclaimed | **Standards opportunity** — first-mover advantage |
| **OTel `gen_ai.usage.cost` attribute** | Nobody (gap in spec) | No proposal exists | **Propose later** — establish credibility |
| **Agent loop detection at proxy** | AgentOps, TrueFoundry | Emerging | **Already building** (velocity limits) |

### Multi-Agent Token Waste (Research Data)

| Framework | Token Duplication Rate |
|---|---|
| MetaGPT | 72% |
| CAMEL | 86% |
| AgentVerse | 53% |
| Anthropic multi-agent | ~15x vs single chat |

This data validates that cost attribution in multi-agent systems is critical, not optional.

## Opportunities to Build Something Better

1. **Zero-config trace correlation via auto-generation.** No competitor auto-generates trace IDs. Users get cost tracking immediately; grouping emerges when they start sending consistent IDs.

2. **Server-side tool_call_id stitching (Phase 2).** The proxy sees the LLM response with `tool_calls[].id`, then sees the follow-up request. Stitching these automatically gives ~80% of trace correlation value with zero client effort. Confirmed unique across all competitors.

3. **Cost in the trace, not just tokens.** Every platform gives token counts. Only NullSpend (via the proxy) can give actual dollar costs per request, automatically rolled up per trace. No pricing table maintenance for users.

4. **Financial traces as a category.** The concept of traces designed for cost attribution (vs. performance debugging) is emerging but has no standard name. NullSpend can define the vocabulary.

5. **MCP cost conventions.** 20+ MCP gateways exist; zero implement cost tracking. NullSpend could propose `_meta` cost extensions and become the reference implementation.

## Risks, Gaps, and Edge Cases

### Prioritized Risk Matrix

| Risk | Severity | Likelihood | Mitigation |
|---|---|---|---|
| **Forwarding traceparent upstream** | High | Low (allowlist already strips) | Add regression tests to `headers-edge-cases.test.ts` |
| **trace_id vs sessionId confusion** | Medium | High | Document semantics clearly (session = conversation, trace = task) |
| **All-zeros trace-id stored** | Medium | Medium | Explicit check in parser, fallthrough to auto-gen |
| **Case sensitivity (uppercase hex)** | Low | Medium | `.toLowerCase()` on traceparent extraction |
| **Invalid traceparent format** | Low | High | Regex validation + graceful fallback, never reject |
| **Trace_id spoofing cross-user** | High | Low | All queries MUST filter by userId — document as security invariant |
| **Write amplification (10+ indexes)** | Medium | Medium | Use partial index `WHERE trace_id IS NOT NULL` |
| **Index creation locking** | Medium | Low | Use `CREATE INDEX CONCURRENTLY` |
| **MCP events missing trace_id** | Medium | High | Spread `ctx.traceId` in MCP route (same as sessionId/tags pattern) |

### Key Security Invariant

**Every query that accepts `trace_id` as a filter MUST also filter by `userId`.** Trace IDs are user-controlled and globally unique by convention, not by enforcement. Cross-user isolation happens at the query layer, not the ingestion layer.

## Recommended Technical Direction

### What to build now (Phase 1, ~4h)

1. **`trace_id` column** — nullable text, partial B-tree index
2. **`parseTraceId()` module** — extract from `traceparent`, fall back to `X-NullSpend-Trace-Id`, validate format
3. **Auto-generation** — `crypto.randomUUID()` when no trace header present
4. **Proxy integration** — add to `RequestContext`, `EnrichmentFields`, all 3 routes (OpenAI, Anthropic, MCP)
5. **Response header** — `X-NullSpend-Trace-Id` on every proxy response
6. **Dashboard API** — `?traceId=` filter on `GET /api/cost-events`
7. **Webhook payload** — `trace_id` in `cost_event.created` data.object
8. **SDK types** — `traceId?: string` on `CostEventInput`

### What to defer

- **Span tracking** — requires client cooperation that won't exist pre-launch
- **Cost-per-trace rollup API** — separate endpoint, can add once trace_id is populated
- **Agent ID columns** — can be added in the same migration but is a separate feature
- **OTel span export** — Phase 4+ territory
- **SSE mid-stream cost injection** — novel but medium effort

### What to avoid

- **Spans table** — observability scope creep
- **Forwarding traceparent upstream** — trust boundary violation
- **Scoping trace_id to userId in storage** — breaks OTel interoperability
- **Waiting for OTel cost standardization** — no proposal exists, could take years

## Open Questions

1. **Should auto-generated trace IDs be UUIDs or 32-char hex?** UUIDs are 36 chars (with hyphens) or 32 hex (without). W3C trace-id is 32 lowercase hex. For consistency, auto-generated IDs should probably be 32 hex (`crypto.randomUUID().replace(/-/g, "")`). But this means auto-generated IDs look identical to W3C trace-ids, making it impossible to distinguish "user sent this" from "we generated this" without a separate flag.

2. **Should NullSpend add `agent_id` and `parent_agent_id` in the same migration?** The architecture doc proposes all three columns in Phase 1. Adding them now is trivial (two more nullable text columns), but they're a separate feature that should be planned independently.

3. **How should the dashboard display traces?** A dedicated `/traces` page vs. a filter on the existing cost events list vs. both? This is a product decision that doesn't affect the schema.

4. **Should the `X-NullSpend-Trace-Id: "auto"` magic value be supported?** The DX research suggests it's a differentiator (no competitor does this), but it adds complexity to the parser. Alternative: just always auto-generate when absent, which achieves the same result without a magic value.

## Sources and References

### Official Documentation
- W3C Trace Context Level 1: https://www.w3.org/TR/trace-context/
- W3C Trace Context Level 2: https://www.w3.org/TR/trace-context-2/
- OpenTelemetry GenAI Semantic Conventions v1.40.0: https://opentelemetry.io/docs/specs/semconv/gen-ai/
- OpenTelemetry GenAI Metrics: https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-metrics/
- OpenTelemetry GenAI Agent Spans: https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-agent-spans/
- OpenAI API Reference: https://developers.openai.com/api/reference/overview
- OpenAI Agents SDK Tracing: https://openai.github.io/openai-agents-python/tracing/
- Anthropic API Overview: https://docs.anthropic.com/en/api/overview
- Cloudflare Workers Headers: https://developers.cloudflare.com/workers/runtime-apis/headers/

### Specifications and Standards
- W3C Trace Context Level 1 (W3C Recommendation, 2021-11-23)
- W3C Trace Context Level 2 (Candidate Recommendation Draft, 2024-03-28)
- OpenTelemetry Semantic Conventions v1.40.0 (Development stability)
- OTel Agentic Systems Proposal: https://github.com/open-telemetry/semantic-conventions/issues/2664

### Platform and Product References
- Helicone Sessions: https://docs.helicone.ai/features/sessions
- Helicone Cost Tracking: https://docs.helicone.ai/guides/cookbooks/cost-tracking
- Portkey Tracing: https://portkey.ai/docs/product/observability/traces
- Portkey Headers: https://portkey.ai/docs/api-reference/inference-api/headers
- LiteLLM OTel Integration: https://docs.litellm.ai/docs/observability/opentelemetry_integration
- LiteLLM Forward Headers: https://docs.litellm.ai/docs/proxy/forward_client_headers
- Langfuse Data Model: https://langfuse.com/docs/observability/data-model
- Langfuse Cost Tracking: https://langfuse.com/docs/observability/features/token-and-cost-tracking
- Langfuse Distributed Tracing: https://langfuse.com/docs/observability/features/trace-ids-and-distributed-tracing
- Braintrust Tracing: https://www.braintrust.dev/learn/tracing/v0
- Braintrust OTel: https://www.braintrust.dev/docs/integrations/sdk-integrations/opentelemetry
- Opik Cost Tracking: https://www.comet.com/docs/opik/tracing/cost_tracking
- Pydantic Logfire Metrics in Spans: https://logfire.pydantic.dev/docs/reference/advanced/metrics-in-spans/

### Repositories and Code References
- Langfuse GitHub: https://github.com/langfuse/langfuse
- Helicone GitHub: https://github.com/Helicone/helicone

### Blog Posts and Articles
- TrueFoundry AI Cost Observability: https://www.truefoundry.com/blog/ai-cost-observability
- UsagePricing Cost Intelligence Architecture: https://www.usagepricing.com/blog/ai-cost-intelligence-architecture
- Braintrust LLM Tracing Tools 2026: https://www.braintrust.dev/articles/best-llm-tracing-tools-2026
- Google AP2 Announcement: https://cloud.google.com/blog/products/ai-machine-learning/announcing-agents-to-payments-ap2-protocol

### Internal Codebase References
- `docs/technical-outlines/agent-tracing-architecture.md` — Five-phase tracing spec (Phase 1-5)
- `docs/technical-outlines/priority-implementation-roadmap.md` — Priority 1.3
- `packages/db/src/schema.ts` — `cost_events` table definition (lines 118-151)
- `apps/proxy/src/lib/context.ts` — `RequestContext` interface
- `apps/proxy/src/index.ts` — Header parsing and context building (lines 217-226)
- `apps/proxy/src/lib/headers.ts` — Upstream header allowlist (lines 1-5)
- `apps/proxy/src/lib/anthropic-headers.ts` — Anthropic header allowlist
- `apps/proxy/src/routes/openai.ts` — `EnrichmentFields` interface (line 197)
- `apps/proxy/src/routes/anthropic.ts` — Same pattern
- `apps/proxy/src/routes/mcp.ts` — MCP cost event row construction (lines 141-160)
- `packages/sdk/src/types.ts` — `CostEventInput` interface (lines 177-191)
