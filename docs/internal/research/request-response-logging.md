# Request/Response Logging — Research Summary

**Date:** 2026-03-25
**Status:** Research complete, ready for implementation planning

---

## Decision: Architecture

**Three-tier storage:**
- **Postgres** — cost event metadata (tokens, cost, model, latency, tags). Already exists.
- **Cloudflare R2** — request/response bodies. Keyed by `request_id`. Opt-in per org.
- **ClickHouse** — deferred. Postgres is fine for current scale. Design schemas to be migration-friendly.

**Why not Postgres for bodies:** JSONB values >2KB hit TOAST performance cliff (2-10x slower queries). LLM prompts are 10-200KB typical. Helicone and Langfuse both started on Postgres and had to migrate when dashboard queries exceeded 30 seconds.

**Why not Queues for bodies:** Cloudflare Queue messages capped at 128KB. Bodies must write directly to R2 from the Worker.

---

## Decision: Capture Strategy

**Request body:** Already available as `ctx.bodyText` in the proxy (stored for upstream forwarding).

**Non-streaming response:** Capture from the JSON parse that already happens for usage extraction.

**Streaming response:** Accumulate raw SSE chunks in the existing TransformStream with a 256KB size cap. Write to R2 in `waitUntil` after stream completes. Do NOT use `response.body.tee()` — creates backpressure that throttles the client stream.

**`waitUntil` priority order:** cost event > budget reconciliation > body storage. All share a 30s window.

---

## Decision: Privacy & Compliance

- **Opt-in per org** — bodies not captured unless explicitly enabled (matches OTel convention, GDPR-safe)
- **Configurable retention** — auto-delete R2 objects via lifecycle rules (7d free, 30d Pro, 90d Enterprise)
- **PII redaction** — deferred to later phase. Start with "don't store unless asked."
- **Data deletion API** — needed for GDPR right-to-erasure. Bulk delete by org/date range.

---

## Decision: Pricing

| Tier | What's included |
|------|----------------|
| **Free** | Cost events only (tokens, cost, latency, model) — 7d retention. Already exists. |
| **Pro ($49/mo)** | + request/response body capture, 30d retention, detail view in dashboard |
| **Enterprise** | + 90d+ retention, PII redaction, FOCUS export, audit log signing |

Request logging is a **Pro upgrade trigger**, not a free feature. The insight that justifies the cost: "see exactly what your agents are sending and receiving."

---

## Competitive Landscape

| Platform | Storage | Bodies | DX | Free Tier |
|----------|---------|--------|-----|-----------|
| Helicone | ClickHouse + S3 + Postgres | Always on | One-line proxy URL | 100K req/mo |
| Langfuse | ClickHouse + S3 + Postgres | SDK opt-in | SDK decorators + OTLP | 50K obs/mo |
| Braintrust | Custom Brainstore (S3 + Tantivy) | Always on, masking | OTel SDKs | 1M spans/mo |
| Portkey | Closed source | Configurable | Proxy + SDK | 10K logs/mo |
| LiteLLM | Postgres + S3 cold storage | Opt-in flag (buggy) | Proxy + callbacks | Self-hosted |
| Datadog | Proprietary | Auto-captured + SDS | Zero-code auto-instrument | $800/mo min |
| **NullSpend (planned)** | **Postgres + R2** | **Opt-in per org** | **Zero-code (proxy)** | **Cost events free** |

---

## Industry Trends

1. **Flat over hierarchical** — Langfuse V4 is demoting traces, moving to observation-centric flat model. Simpler is better.
2. **OTel `gen_ai.*` conventions** — becoming the standard attribute naming. Align NullSpend field names.
3. **Tiered logging** — metrics always, bodies sampled/opt-in. Industry consensus.
4. **FOCUS spec** — FinOps standard expanding to AI costs. Design for future export compatibility.
5. **Privacy-first default** — OTel spec mandates no content capture by default. Bodies must be opt-in.

---

## Implementation Phases (revised after codebase review)

### Phase 1: Non-streaming body capture (~3-4 hours)
- Add R2 binding (`BODY_STORAGE`) to `wrangler.jsonc` and `worker-configuration.d.ts`
- Create `apps/proxy/src/lib/body-storage.ts` — R2 write helper
- Capture request body (from `ctx.bodyText`) + JSON response body (from existing parse in `openai.ts:367`, `anthropic.ts:375`)
- Write to R2 in `waitUntil` keyed by `request_id` — priority: cost event > reconciliation > body storage
- Gate via tier: add `requestLogging: boolean` to `lib/stripe/tiers.ts` (false=free, true=pro/enterprise)
- Add `requestLoggingEnabled` to `AuthResult` in proxy auth, resolve from tier in `api-key-auth.ts`
- Add to `RequestContext` — proxy checks flag before writing to R2
- Use `ctx.bodyByteLength` for 256KB size cap check (already computed)
- Add proxy internal endpoint: `GET /internal/request-bodies/{requestId}` to read from R2

### Phase 2: Streaming body capture (~2 hours)
- Extend SSE parser `transform()` in `sse-parser.ts:45` and `anthropic-sse-parser.ts:75` to accumulate raw chunks in a parallel buffer
- Size cap (256KB via `bodyByteLength` tracking) — stop accumulating after limit
- Write accumulated response to R2 in existing `waitUntil` handler (after cost event)
- Do NOT use `response.body.tee()` — backpressure hazard

### Phase 3: Dashboard UI (~4-5 hours)
- **Dashboard cannot read R2 directly** (Vercel ≠ Cloudflare). Create `app/api/request-bodies/[id]/route.ts` that calls proxy internal endpoint via `PROXY_INTERNAL_URL` (same pattern as `velocity-status/route.ts`)
- Click cost event row → lazy fetch body via dashboard API → display prompt/response
- Display prompt messages (system/user/assistant) and response in expandable view
- Add `requestLogging` toggle to org general settings (tier-gated)
- Also update MCP route (`routes/mcp.ts`) for body capture if applicable

### Phase 4: Retention & compliance (~2 hours)
- R2 lifecycle rules for auto-deletion by age
- Configurable retention per org tier (7d free metadata, 30d Pro bodies, 90d Enterprise)
- Bulk delete API for GDPR right-to-erasure (delete R2 objects by org + date range)
- Optional PII masking pipeline (deferred until customer demand)

**Total revised estimate: ~12-13 hours**

---

## Codebase Review Findings (2026-03-25)

### Verified assumptions
- `ctx.bodyText` available for request capture (context.ts:6-7)
- Non-streaming JSON parse already happens (openai.ts:367-374, anthropic.ts:354-375)
- SSE TransformStream passes chunks through at sse-parser.ts:45 — hook point for accumulation
- `waitUntil` pattern established across multiple routes
- `request_id` exists as text column with composite unique index (schema.ts:136, 166)
- `organizations.metadata` JSONB exists for per-org settings (schema.ts:284)

### Corrections from review
1. **Dashboard → R2 bridge required.** Vercel cannot access Cloudflare R2 directly. Need proxy internal endpoint + dashboard API route. Pattern: same as `/api/budgets/velocity-status` → `PROXY_INTERNAL_URL`.
2. **Feature gating via tiers, not just org flag.** Add `requestLogging` to `TIERS` in `tiers.ts`. Proxy resolves from auth pipeline, not org metadata query.
3. **R2 key should be `requestId` only** (not `requestId:provider`). The requestId is already a UUID unique per request.

### Files that need changing

**Proxy (Cloudflare Worker):**
- `apps/proxy/wrangler.jsonc` — add `r2_buckets` binding
- `apps/proxy/src/worker-configuration.d.ts` — add `BODY_STORAGE: R2Bucket` to Env (or regenerate types)
- `apps/proxy/src/lib/context.ts` — add `requestLoggingEnabled: boolean`
- `apps/proxy/src/lib/auth.ts` — add `requestLoggingEnabled` to AuthResult
- `apps/proxy/src/lib/api-key-auth.ts` — resolve logging flag from subscription tier
- `apps/proxy/src/index.ts` — pass flag to context
- `apps/proxy/src/lib/body-storage.ts` — NEW: R2 write/read helpers
- `apps/proxy/src/routes/openai.ts` — add body capture in `waitUntil`
- `apps/proxy/src/routes/anthropic.ts` — same
- `apps/proxy/src/routes/internal.ts` — add GET endpoint for body retrieval
- `apps/proxy/src/lib/sse-parser.ts` — add chunk accumulation option
- `apps/proxy/src/lib/anthropic-sse-parser.ts` — same

**Dashboard (Next.js):**
- `lib/stripe/tiers.ts` — add `requestLogging` to tier definitions
- `app/api/request-bodies/[id]/route.ts` — NEW: dashboard-to-proxy bridge

**Tests:**
- `apps/proxy/src/__tests__/body-storage.test.ts` — NEW
- Existing route tests may need R2 binding mock

---

## Open Questions

1. **R2 read latency via proxy bridge** — two network hops (dashboard → proxy → R2). Benchmark end-to-end. If >1s, consider R2 public bucket with signed URLs.
2. **Body size distribution** — what's the P99 prompt size in production? Affects 256KB cap decision.
3. **Encryption** — R2 encrypts at rest by default. Per-org application-level encryption is enterprise scope.
4. **Search** — full-text search across prompts requires a search index (deferred). Start with filter-by-model/tags.
5. **Auth for body retrieval** — should the internal endpoint require the org to match? Currently internal endpoints use `INTERNAL_SECRET` only. Consider adding orgId validation.

---

## Sources

### Competitor architecture
- Helicone: ClickHouse migration blog, self-hosting docs, GitHub
- Langfuse: V4 architecture blog, data model docs, ClickHouse acquisition
- Braintrust: Brainstore blog, architecture docs, benchmarks
- Portkey: AI gateway features, PII protection docs
- LiteLLM: Logging spec, DB schema, GitHub issues

### Technical foundations
- Cloudflare R2: Worker bindings, size limits, lifecycle rules
- Cloudflare Workers: waitUntil, memory limits, TransformStream
- Postgres TOAST: performance characteristics for large JSONB
- Cloudflare Queues: 128KB message limit

### Standards & compliance
- OpenTelemetry gen_ai semantic conventions (experimental)
- FOCUS spec 1.3 (AI costs on roadmap)
- GDPR requirements for LLM logging
- SOC 2 audit trail requirements

### Pricing benchmarks
- Helicone: $25/mo Pro (unlimited requests)
- Langfuse: $29.99/mo Core
- Braintrust: $249/mo Pro
- Datadog: $800/mo minimum
- Cloudflare AI Gateway: included in Workers plan
