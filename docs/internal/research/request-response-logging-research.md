# Request/Response Logging Research

**Date:** 2026-03-25
**Scope:** Technical foundations for LLM request/response logging in a Cloudflare Workers proxy

---

## 1. Storage Strategy Research

### 1.1 Cloudflare Workers Constraints for Body Capture

**Memory:** 128 MB per isolate. The worker is not killed mid-request if it exceeds 128 MB, but the process exits after the response and a fresh isolate spawns. This means buffering entire request+response bodies in memory is dangerous for large payloads.

**CPU time:** 30 seconds on the paid plan (10 ms on free). NullSpend already uses the paid plan.

**`waitUntil` lifetime:** 30 seconds after the response is sent or client disconnects. This is shared across ALL `waitUntil` calls in a single request. If promises haven't settled after 30s, they are cancelled. This is the hard constraint for background logging work.

**Request body size:** ~100 MB practical limit (Workers request limit). NullSpend already enforces a 1 MB body limit in the proxy, so request bodies are bounded.

**Response body size:** No enforced limit on responses. LLM responses can be large (multi-turn conversations with long outputs), but typical single completions are 1-50 KB. Streaming responses can be much longer-lived temporally.

**Queue message size:** 128 KB per message, 256 KB per batch. This rules out sending full request/response bodies through Cloudflare Queues directly.

**Key insight:** NullSpend's SSE parser (`sse-parser.ts`) already uses a TransformStream that passes chunks through unmodified while extracting usage data. This is the correct architectural pattern for body capture -- extend the existing TransformStream to accumulate chunks for logging while forwarding them to the client.

### 1.2 Cloudflare R2 vs Postgres for Log Storage

| Dimension | R2 (Object Storage) | Postgres (Supabase) |
|---|---|---|
| **Max object/row size** | 5 GB per PUT (single op) | 255 MB per JSONB value; ~1 GB per text column |
| **Cost model** | $0.015/GB/month storage, $4.50/million Class A (PUT), $0.36/million Class B (GET), zero egress | Included in Supabase plan up to storage limit |
| **Latency (PUT from Worker)** | ~10-50 ms typical via binding (Local Uploads reduces by 75%), spikes to 400-600 ms reported | ~5-20 ms via Hyperdrive connection pooling |
| **Query capability** | None (key-value only) | Full SQL, JSONB operators, GIN indexes |
| **Streaming write** | Can stream ReadableStream directly to R2 | Must buffer to INSERT |
| **Compression** | Manual (gzip before PUT) | Automatic via TOAST (pglz or lz4) |

**Recommendation: Hybrid approach.** Store structured metadata (model, tokens, cost, timestamps, user, tags) in Postgres for queryability. Store raw request/response bodies in R2, referenced by a key in the Postgres row. This is exactly what Helicone and LiteLLM do.

### 1.3 Supabase/Postgres Row Size and JSONB Limits

- **JSONB max size:** 255 MB (268,435,455 bytes). Attempting to exceed this returns `ERROR: total size of jsonb object elements exceeds the maximum`.
- **TOAST threshold:** 2 KB. Values >2 KB are automatically compressed and/or moved to a separate TOAST table. Compressed values are ~2x slower to query; TOAST-external values are ~5x slower.
- **Performance cliff:** Queries on rows with JSONB values >2 KB hit a significant performance degradation. For values >8 KB, the penalty is severe (5-10x).
- **Update penalty:** Updating any part of a TOASTed JSONB value requires rewriting the entire value.
- **Index limitation:** B-tree indexes on JSONB columns are ineffective. GIN indexes work for containment queries but add write overhead.

**Implication for NullSpend:** Storing full LLM prompts/responses (often 10-100 KB) in JSONB columns would hit TOAST penalties on every query. The existing `cost_events` table should NOT grow to include request/response bodies inline. Instead, bodies belong in R2 with a reference key in Postgres.

### 1.4 ClickHouse vs Postgres for Log Analytics

At scale (>1M rows), ClickHouse dramatically outperforms Postgres for analytical queries:

| Query type | Postgres (100M rows) | ClickHouse (100M rows) |
|---|---|---|
| COUNT(DISTINCT user_id) | ~30 seconds | <1 second |
| SUM(cost) GROUP BY model | ~15 seconds | <0.5 seconds |
| Time-series aggregation | ~20 seconds | <0.5 seconds |

**ClickHouse advantages:** Column-oriented storage with compression ratios of 10-50x, vectorized query execution, no index maintenance overhead, and purpose-built for append-only log data.

**Postgres advantages:** ACID transactions, complex joins, existing infrastructure, and simpler operational model.

**NullSpend's position:** The existing `cost_events` table in Postgres is fine for the current scale (pre-launch). When query latency on analytics dashboards exceeds ~2 seconds, it will be time to replicate cost_events data to ClickHouse. Both Helicone and Langfuse started on Postgres and migrated to ClickHouse as they scaled.

**Decision:** Stay on Postgres for now. Design the logging schema to be ClickHouse-migration-friendly (append-only, no UPDATEs, partition-friendly timestamps, no foreign keys in the log table).

### 1.5 Streaming Response Capture Strategies

**Challenge:** NullSpend must tee streaming SSE responses for logging without adding latency to the client stream.

**Option A: `response.body.tee()`**
- Creates two ReadableStream branches from one source.
- **Pitfall:** The faster consumer is NOT backpressured, but unread data is enqueued internally on the slower branch without limit. If R2 PUT is slow, chunks accumulate in memory.
- **Pitfall:** R2 operations in `waitUntil` have a 30-second window. Long streaming responses (Claude 3.5 can stream for 60+ seconds) will exceed this.
- **Not recommended** for NullSpend's use case.

**Option B: TransformStream accumulation (current pattern)**
- NullSpend's `createSSEParser` already uses a TransformStream that enqueues chunks unmodified while extracting usage data.
- **Extension:** Accumulate raw chunks in an array during streaming. On `flush()`, concatenate and write to R2 via `waitUntil`.
- **Memory concern:** A full streaming response could be 50-200 KB of SSE data. With 128 MB memory limit and typical concurrency, this is safe.
- **Advantage:** Zero additional latency -- chunks pass through synchronously. Logging happens entirely in the `waitUntil` window after stream completes.
- **Recommended approach.**

**Option C: Cloudflare Queue + R2 (deferred write)**
- Accumulate chunks during streaming, then send a reference message to a Queue.
- Queue consumer fetches accumulated data from a temporary KV store and writes to R2.
- **Advantage:** Guaranteed delivery, retry on failure.
- **Disadvantage:** Queue message size limit (128 KB) means the body can't go through the queue. Would need KV as an intermediary.
- **Overkill for initial implementation** but could be a reliability upgrade later.

**Recommended architecture:**
1. Accumulate SSE chunks in the existing TransformStream as they pass through
2. On stream completion (`flush()`), serialize the accumulated body
3. In the `waitUntil` handler (which already runs for cost logging + budget reconciliation), PUT to R2
4. Store the R2 key in the cost_events row (or a new log_entries table)

---

## 2. Open-Source Implementation Analysis

### 2.1 LiteLLM

| Attribute | Value |
|---|---|
| **GitHub** | [BerriAI/litellm](https://github.com/BerriAI/litellm) |
| **Stars** | ~40,000 |
| **Language** | Python |
| **License** | MIT |
| **Last activity** | Active (daily commits as of March 2026) |

**Logging architecture:**
- Callback-based system: `success_callbacks`, `failure_callbacks`, `input_callbacks`
- Each callback receives a `StandardLoggingPayload` with cost breakdown, model, tokens, duration, and optionally the request/response body
- Success handlers execute in a **background thread** to avoid blocking the main request path
- Callbacks can be sync or async, with a `litellm.sync_logging` flag for debugging

**Body storage strategy:**
- **Hot path (default):** Only metadata (cost, tokens, model, duration) stored in Postgres `LiteLLM_Spend_Logs` table
- **Cold storage:** When `store_prompts_in_cold_storage: true`, full request/response bodies written to S3
- **Inline storage:** When `store_prompts_in_spend_logs: true`, bodies stored in the Postgres spend logs table (not recommended at scale)
- **Base64 stripping:** `sqs_strip_base64_files` setting removes binary data from logged messages to respect SQS 1 MB limit

**Key files to study:**
- `litellm/proxy/logging_spec.py` -- StandardLoggingPayload schema
- `litellm/integrations/custom_logger.py` -- CustomLogger base class
- `litellm/proxy/pass_through_endpoints/` -- pass-through logging handlers
- `litellm/litellm_core_utils/logging_handler.py` -- core logging orchestration

**Lessons for NullSpend:**
- Separate metadata from body storage (metadata in DB, bodies in object storage)
- Background thread/`waitUntil` for all logging work
- Provide a config toggle for body logging (not everyone wants it, and it has cost/privacy implications)
- Strip binary/base64 content before logging

### 2.2 Langfuse

| Attribute | Value |
|---|---|
| **GitHub** | [langfuse/langfuse](https://github.com/langfuse/langfuse) |
| **Stars** | ~23,500 |
| **Language** | TypeScript |
| **License** | MIT (core), proprietary (enterprise features) |
| **Last activity** | Active (daily commits as of March 2026) |

**Storage architecture (evolved over time):**
- **v2 (Postgres-only):** All traces, observations, and scores in Postgres via Prisma
- **v3 (Postgres + ClickHouse):** Polyglot persistence:
  - **Postgres:** Multi-tenancy (users, orgs, projects), configuration (prompts, templates), datasets
  - **ClickHouse:** Observability data (traces, observations, scores) -- migrated for query performance
  - **S3/Blob storage:** Raw event data, multi-modal content (images, videos), batch exports

**Data model:**
- **Trace:** Top-level container for an LLM interaction
- **Observation:** Nested operations within a trace (generations, spans, events)
- **Generation:** Specific LLM call with input/output/model/tokens/cost
- Observations form hierarchical trees via `parent_observation_id`

**Three-tier storage strategy:**
- **Hot (days 0-7):** ClickHouse SSD
- **Warm (days 8-90):** S3-backed ClickHouse
- **Cold (day 91+):** S3 Glacier

**Body storage approach:**
- All incoming events persisted to S3 first, then processed into database
- Multi-modal content uploaded directly from client SDKs to S3
- Moving toward immutable "Events" table in ClickHouse (wide table, no JOINs)
- This reduced memory usage 3x and improved query speed 20x

**Key files to study:**
- `packages/shared/prisma/schema.prisma` -- Prisma schema (Postgres tables)
- ClickHouse schema definitions (in migration files)
- S3 integration configuration docs

**Lessons for NullSpend:**
- S3-first architecture for durability (write to S3 before database)
- Three-tier storage for cost optimization
- Immutable, wide-table schema for ClickHouse compatibility
- The Postgres-to-ClickHouse migration is well-trodden; design for it from day one

### 2.3 Helicone

| Attribute | Value |
|---|---|
| **GitHub** | [Helicone/helicone](https://github.com/Helicone/helicone) (main), [Helicone/ai-gateway](https://github.com/Helicone/ai-gateway) (gateway) |
| **Stars** | ~5,200 (main), ~480 (gateway) |
| **Language** | TypeScript (main), Rust (gateway) |
| **License** | Apache 2.0 |
| **Last activity** | Active (March 2026) |

**Logging pipeline (most relevant to NullSpend):**
1. Client request arrives at proxy (originally Cloudflare Workers, now Rust gateway)
2. Request forwarded to LLM provider
3. After response received: raw request/response bodies stored in **S3/MinIO**
4. Structured metadata published to **Upstash Kafka** (using HTTP endpoint, CF Workers-compatible)
5. ECS consumer processes Kafka batches, inserts into database in single transactions
6. **ClickHouse** (via VersionedCollapsingMergeTree) for analytical queries
7. Postgres retained for transactional data

**Body storage details:**
- Bodies stored separately from metadata in S3
- UI loads metadata first, then asynchronously fetches request/response bodies from S3
- This 6x improvement in page render time for large tables
- S3 URL generation optimized (reduced from 2 to 1 call per webhook)

**Performance:**
- Processes >2 billion LLM interactions
- Adds 50-80 ms average latency (includes auth + logging overhead)
- Migrated dashboard queries from Postgres (>100 second timeouts) to ClickHouse (<0.5 seconds)

**Key insight:** Helicone's original Cloudflare Workers architecture is the closest analog to NullSpend's proxy. They eventually moved to Rust for the gateway but the storage architecture (S3 + Kafka + ClickHouse) is proven at scale.

**Lessons for NullSpend:**
- S3 for bodies, Kafka/Queue for metadata pipeline
- Separate body fetching from metadata queries in the UI
- VersionedCollapsingMergeTree for ClickHouse deduplication
- Plan for Postgres-to-ClickHouse migration early

### 2.4 OpenLIT

| Attribute | Value |
|---|---|
| **GitHub** | [openlit/openlit](https://github.com/openlit/openlit) |
| **Stars** | ~2,300 |
| **Language** | Python |
| **License** | Apache 2.0 |
| **Last activity** | Active (March 2026) |

**Storage architecture:**
- **OpenTelemetry-native:** All telemetry emitted as OTel traces/metrics
- **Pipeline:** OpenLIT SDK -> OTel Collector -> ClickHouse
- **Backend-agnostic:** Can swap ClickHouse for Grafana Tempo, Prometheus, Jaeger, etc.
- No S3/blob storage layer -- relies on ClickHouse for all storage

**Body storage approach:**
- Request/response content stored as span attributes in OTel traces
- No separate body storage -- everything inline in ClickHouse columns
- Works because ClickHouse handles large string columns efficiently with compression

**Lessons for NullSpend:**
- OTel compatibility is a nice-to-have for interop with existing observability stacks
- ClickHouse can store bodies inline at scale (unlike Postgres)
- For NullSpend's Cloudflare Workers architecture, OTel export would need to go through a collector service

### 2.5 Portkey AI Gateway

| Attribute | Value |
|---|---|
| **GitHub** | [Portkey-AI/gateway](https://github.com/Portkey-AI/gateway) |
| **Stars** | ~7,500+ |
| **Language** | TypeScript |
| **License** | MIT |
| **Last activity** | Active (March 2026) |

**Logging architecture:**
- Every interaction captured in a unified telemetry stream
- Logs, traces, latency breakdowns, token analytics, error patterns, and replay data
- Telemetry exported as batched spans, metrics, and events to observability backends
- Supports OpenTelemetry-based tracing natively

**Key difference from NullSpend:** Portkey is primarily a hosted service. Their open-source gateway handles routing but the observability/logging is tightly coupled to their cloud platform. Less useful as a reference for self-hosted logging.

---

## 3. Known Pitfalls

### 3.1 Memory Exhaustion from Body Buffering

**Constraint:** Cloudflare Workers 128 MB memory limit. Buffering request+response bodies risks OOM crashes.

**How implementations get burned:**
- `response.text()` or `response.json()` buffers the entire body in memory
- Accumulating SSE chunks without a size cap can exhaust memory on pathological responses
- `response.clone()` forces the entire body to be buffered if both clones aren't consumed

**NullSpend design:**
- Set a configurable `MAX_LOG_BODY_SIZE` (e.g., 256 KB). Truncate with a marker when exceeded.
- Accumulate chunks in the existing TransformStream but track total size. Stop accumulating when limit hit.
- Never use `response.clone()` -- always use TransformStream pass-through.
- NullSpend's 1 MB request body limit already constrains the request side.

### 3.2 `waitUntil` 30-Second Timeout

**Constraint:** All background work must complete within 30 seconds after response delivery.

**How implementations get burned:**
- Long streaming responses (60+ seconds) mean `waitUntil` tasks start AFTER the stream completes. R2 PUT + DB write must finish within 30 seconds.
- R2 latency spikes (400-600 ms reported) can eat into this budget.
- Multiple `waitUntil` calls share the 30-second window.

**NullSpend design:**
- NullSpend already uses `waitUntil` for cost logging and budget reconciliation. Body logging adds another task to the same window.
- Prioritize: cost event write > budget reconciliation > body storage (most important first)
- Use Cloudflare Queues as a fallback: if R2 PUT might timeout, enqueue a reference to a temporary store
- Consider Durable Object alarm for deferred body persistence if `waitUntil` proves insufficient

### 3.3 Streaming SSE Reassembly Complexity

**Constraint:** SSE streams arrive as arbitrary byte chunks that don't align with SSE event boundaries.

**How implementations get burned:**
- Multi-byte UTF-8 characters split across chunks cause decoding errors
- Partial SSE events at chunk boundaries cause missed data
- Different providers have different SSE formats (OpenAI `data: {json}\n\n`, Anthropic `event: type\ndata: {json}\n\n`)
- Cancelled streams have no final usage event

**NullSpend design:**
- NullSpend already handles this correctly with line-buffered parsers (`sse-parser.ts`, `anthropic-sse-parser.ts`) using `TextDecoder({ stream: true })`.
- For body logging, store raw bytes (not parsed SSE). The raw bytes are the ground truth.
- Include a `format` field ("sse_openai" | "sse_anthropic" | "json") so consumers know how to parse.

### 3.4 GDPR and PII in Prompts/Responses

**Constraint:** Prompts often contain PII (names, emails, code with credentials). Storing them creates GDPR exposure.

**How implementations get burned:**
- Storing prompts without consent violates data minimization principle
- DSAR (Data Subject Access Requests) require ability to find and delete all data for a user
- Prompt injection attacks can cause LLMs to echo PII from system prompts
- Multi-tenant systems can leak data across tenants if logging is misconfigured

**NullSpend design:**
- Body logging must be **opt-in per organization**, disabled by default
- Provide a `payload_mode` setting: `none` (no bodies), `metadata_only` (tokens/model/cost), `full` (request+response bodies)
- Implement data retention policies: auto-delete bodies after configurable period (7/30/90 days)
- Support DSAR: ability to delete all logged bodies for a given orgId
- Consider client-side PII redaction hooks (future feature)
- R2 lifecycle rules for automatic expiration

### 3.5 Postgres TOAST Performance Cliff

**Constraint:** JSONB values >2 KB trigger TOAST, causing 2-10x query slowdown.

**How implementations get burned:**
- Storing full prompts/responses in JSONB columns makes every query pay the TOAST tax
- Updating rows with TOASTed columns rewrites the entire value
- Indexes on TOASTed JSONB columns are ineffective

**NullSpend design:**
- Never store request/response bodies in Postgres. Use R2.
- Keep Postgres columns lean: metadata, tokens, cost, model, timestamps, tags (all <2 KB per row)
- Store the R2 object key as a simple TEXT column in Postgres
- If future analytics need body content (e.g., search), replicate to ClickHouse where large strings compress efficiently

### 3.6 `tee()` Backpressure Hazard

**Constraint:** When using `ReadableStream.tee()`, the slower consumer causes unbounded memory growth.

**How implementations get burned:**
- Tee a stream to R2 and to the client. If R2 PUT is slow, chunks queue in memory indefinitely.
- R2 PUT requires content-length for non-streaming writes, forcing buffering.
- The `waitUntil` 30-second limit combines with slow R2 to cause data loss.

**NullSpend design:**
- Do NOT use `tee()` for concurrent streaming to client + R2.
- Instead, accumulate chunks in the TransformStream (which is synchronous and zero-overhead), then write to R2 after the stream completes via `waitUntil`.
- This is a sequential write (stream first, log second), not parallel, which avoids backpressure entirely.

### 3.7 Cloudflare Workers TransformStream Limitations

**Constraint:** Cloudflare Workers only implements identity TransformStream. Custom `transform()` functions in the constructor do NOT work in production (they work in local dev with Miniflare).

**How implementations get burned:**
- Code using `new TransformStream({ transform(chunk, controller) { ... } })` works locally but silently passes through chunks unmodified in production.
- Workaround: use a manual reader/writer loop.

**NullSpend current state:**
- NullSpend's `createSSEParser` uses `new TransformStream({ transform, flush })`. This may already be affected.
- **ACTION NEEDED:** Verify whether this works in production or if the parser silently fails. If it does work, Cloudflare may have updated their runtime. If not, the SSE parser needs rewriting.
- UPDATE: Based on the Cloudflare docs and the fact that the proxy is deployed and working, it appears Cloudflare has expanded TransformStream support since the original limitation was documented. The proxy's existing tests and smoke tests confirm the TransformStream works correctly.

---

## 4. Recommended Architecture for NullSpend

### 4.1 High-Level Design

```
Request -> [Existing proxy pipeline] -> Forward to provider
                                             |
                                             v
                                      TransformStream
                                    (SSE parser + body accumulator)
                                             |
                                    +--------+--------+
                                    |                 |
                                    v                 v
                              Client stream     waitUntil:
                                              1. Cost event (Queue)
                                              2. Budget reconcile (Queue)
                                              3. Body -> R2 (if enabled)
                                              4. R2 key -> cost_events.body_ref
```

### 4.2 Storage Schema

**R2 bucket:** `nullspend-request-logs`
- Key format: `{orgId}/{YYYY-MM-DD}/{requestId}.json.gz`
- Content: gzipped JSON `{ request: { body, headers_subset }, response: { body, status }, meta: { streaming, provider, format } }`
- Lifecycle rule: auto-delete after retention period (configurable per org)

**Postgres (extend cost_events or new table):**
```sql
-- Option A: Add column to cost_events
ALTER TABLE cost_events ADD COLUMN body_ref TEXT;  -- R2 object key

-- Option B: Separate table (preferred for clean separation)
CREATE TABLE request_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cost_event_id UUID REFERENCES cost_events(id),
  org_id TEXT NOT NULL,
  body_ref TEXT NOT NULL,          -- R2 object key
  request_body_size INTEGER,       -- bytes
  response_body_size INTEGER,      -- bytes
  truncated BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_request_logs_org_created ON request_logs(org_id, created_at);
```

### 4.3 Implementation Phases

**Phase 1: Non-streaming body capture**
- Capture request body (already available as `ctx.bodyText`)
- Capture non-streaming response body (parse JSON response)
- Write to R2 in `waitUntil`
- Add `body_ref` to cost event
- Feature flag per org

**Phase 2: Streaming body capture**
- Extend SSE parser TransformStream to accumulate raw chunks
- Add size cap (256 KB default, configurable)
- Write accumulated body to R2 on stream completion
- Handle cancelled streams (log partial body)

**Phase 3: Dashboard UI**
- Request/response viewer in cost event detail page
- Lazy-load bodies from R2 (don't include in list queries)
- Syntax highlighting for JSON

**Phase 4: Retention and compliance**
- Per-org retention settings
- R2 lifecycle rules
- Bulk delete endpoint for DSAR
- Optional PII detection/masking

---

## 5. Sources

### Storage Strategy
- [Cloudflare Workers Limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Cloudflare Workers Memory Limit Discussion](https://community.cloudflare.com/t/workers-memory-limit/491329)
- [Cloudflare Storage Options](https://developers.cloudflare.com/workers/platform/storage-options/)
- [Cloudflare Logs on R2](https://blog.cloudflare.com/logs-r2/)
- [Cloudflare R2 Limits](https://developers.cloudflare.com/r2/platform/limits/)
- [Cloudflare R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)
- [Cloudflare Workers Streams](https://developers.cloudflare.com/workers/runtime-apis/streams/)
- [Cloudflare Workers Best Practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)
- [Cloudflare Workers Context (waitUntil)](https://developers.cloudflare.com/workers/runtime-apis/context/)
- [Cloudflare Workers Direct waitUntil Import](https://developers.cloudflare.com/changelog/post/2025-08-08-add-waituntil-cloudflare-workers/)
- [Cloudflare Queues Limits](https://developers.cloudflare.com/queues/platform/limits/)
- [Cloudflare tee() Backpressure Discussion](https://community.cloudflare.com/t/why-the-faster-stream-waits-the-slower-one-when-using-the-tee-operator-to-fetch-to-r2/467416)
- [Cloudflare response.clone() Bug](https://github.com/cloudflare/workers-sdk/issues/3259)
- [R2 Latency Spikes Discussion](https://community.cloudflare.com/t/extreme-r2-latency-spikes-from-worker/607793)

### Database Performance
- [Postgres JSONB and TOAST Performance Guide (Snowflake)](https://www.snowflake.com/en/engineering-blog/postgres-jsonb-columns-and-toast/)
- [5 mins of Postgres: JSONB TOAST Performance Cliffs](https://pganalyze.com/blog/5mins-postgres-jsonb-toast)
- [Postgres Large JSON Value Performance](https://www.evanjones.ca/postgres-large-json-performance.html)
- [PostgreSQL JSONB Size Limits](https://dev.to/franckpachot/postgresql-jsonb-size-limits-to-prevent-toast-slicing-9e8)
- [ClickHouse vs PostgreSQL (PostHog)](https://posthog.com/blog/clickhouse-vs-postgres)
- [ClickHouse vs PostgreSQL with Extensions (Tinybird)](https://www.tinybird.co/blog/clickhouse-vs-postgresql-with-extensions)
- [Offload PostgreSQL Analytics to ClickHouse (Aiven)](https://aiven.io/blog/why-you-should-offload-your-pg-analytical-workloads-to-clickhouse)
- [Supabase JSON Documentation](https://supabase.com/docs/guides/database/json)

### Open-Source Implementations
- [LiteLLM GitHub](https://github.com/BerriAI/litellm) -- 40k stars, MIT, Python
- [LiteLLM Logging Docs](https://docs.litellm.ai/docs/proxy/logging)
- [LiteLLM StandardLoggingPayload Spec](https://docs.litellm.ai/docs/proxy/logging_spec)
- [LiteLLM Raw Request/Response Logging](https://docs.litellm.ai/docs/observability/raw_request_response)
- [LiteLLM Observability and Logging (DeepWiki)](https://deepwiki.com/BerriAI/litellm/6-observability-and-logging)
- [Langfuse GitHub](https://github.com/langfuse/langfuse) -- 23.5k stars, MIT, TypeScript
- [Langfuse Data Model](https://langfuse.com/docs/observability/data-model)
- [Langfuse ClickHouse Handbook](https://langfuse.com/handbook/product-engineering/infrastructure/clickhouse)
- [Langfuse Blob Storage Docs](https://langfuse.com/self-hosting/deployment/infrastructure/blobstorage)
- [Langfuse Infrastructure Evolution](https://langfuse.com/blog/2024-12-langfuse-v3-infrastructure-evolution)
- [Langfuse Scaling with ClickHouse (ClickHouse blog)](https://clickhouse.com/blog/langfuse-llm-analytics)
- [Langfuse Database Overview (DeepWiki)](https://deepwiki.com/langfuse/langfuse/3.1-database-overview)
- [Helicone GitHub](https://github.com/Helicone/helicone) -- 5.2k stars, Apache 2.0, TypeScript
- [Helicone AI Gateway GitHub](https://github.com/Helicone/ai-gateway) -- 483 stars, Apache 2.0, Rust
- [Helicone Postgres to ClickHouse Migration (ClickHouse blog)](https://clickhouse.com/blog/helicones-migration-from-postgres-to-clickhouse-for-advanced-llm-monitoring)
- [Helicone + Upstash Kafka Architecture](https://upstash.com/blog/implementing-upstash-kafka-with-cloudflare-workers)
- [OpenLIT GitHub](https://github.com/openlit/openlit) -- 2.3k stars, Apache 2.0, Python
- [Portkey AI Gateway GitHub](https://github.com/Portkey-AI/gateway) -- 7.5k+ stars, MIT, TypeScript

### Pitfalls and Compliance
- [LLM Observability Best Practices 2025 (Maxim)](https://www.getmaxim.ai/articles/llm-observability-best-practices-for-2025/)
- [Why Logging Isn't Enough for LLM Systems (Elementor)](https://medium.com/elementor-engineers/why-logging-isnt-enough-for-llm-systems-and-how-observability-fixes-it-018e528e9f89)
- [LLMOps Production Deployments 2025 (ZenML)](https://www.zenml.io/blog/what-1200-production-deployments-reveal-about-llmops-in-2025)
- [GDPR Compliance for LLM Applications](https://www.21medien.de/en/blog/gdpr-llms)
- [AI Gateway Security and Compliance](https://api7.ai/blog/ai-gateway-security-compliance)
- [LLM Data Privacy (Lasso Security)](https://www.lasso.security/blog/llm-data-privacy)
- [Building PII Detection for LLMOps](https://oneuptime.com/blog/post/2026-01-30-llmops-pii-detection/view)
- [Helicone Latency Impact](https://docs.helicone.ai/references/latency-affect)
- [LiteLLM Latency Overhead Troubleshooting](https://docs.litellm.ai/docs/troubleshoot/latency_overhead)
- [LiteLLM Sub-Millisecond Proxy Overhead](https://docs.litellm.ai/blog/sub-millisecond-proxy-overhead)
- [Langfuse Proxy Decision](https://langfuse.com/blog/2024-09-langfuse-proxy)
