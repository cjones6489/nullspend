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

## Implementation Phases

### Phase 1: Non-streaming body capture (~2-3 hours)
- Add R2 binding to wrangler.jsonc
- Capture request body (from `ctx.bodyText`) + JSON response body
- Write to R2 in `waitUntil` keyed by `request_id`
- Org-level `requestLoggingEnabled` flag
- Skip if body exceeds 256KB size cap

### Phase 2: Streaming body capture (~2 hours)
- Extend SSE parser TransformStream to accumulate raw chunks
- Size cap (256KB) — stop accumulating after limit
- Write accumulated response to R2 in existing `waitUntil` handler

### Phase 3: Dashboard UI (~3-4 hours)
- Click cost event row → fetch body from R2 by request_id
- Display prompt messages and response in expandable view
- Lazy loading (don't fetch body until user clicks)
- Add request_logging_enabled toggle to org settings

### Phase 4: Retention & compliance (~2 hours)
- R2 lifecycle rules for auto-deletion by age
- Configurable retention per org tier
- Bulk delete API for GDPR right-to-erasure
- Optional PII masking pipeline (deferred until customer demand)

---

## Open Questions

1. **R2 read latency** — benchmark "click row → fetch from R2 → display" latency. If >500ms, consider a KV cache for recently-viewed bodies.
2. **Body size distribution** — what's the P99 prompt size in production? Affects size cap decision.
3. **Encryption** — R2 encrypts at rest by default. Per-org application-level encryption is enterprise scope.
4. **Search** — full-text search across prompts requires a search index (deferred). Start with filter-by-model/tags.

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
