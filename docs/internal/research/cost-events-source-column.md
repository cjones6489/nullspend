# Deep Technical Research Document

## Topic

**Add `source` column to `cost_events` table** — so events can be attributed to their ingestion path (proxy vs SDK vs MCP vs future sources).

This matters because NullSpend has three distinct cost event ingestion paths today, and the data they produce is indistinguishable once stored. Without a `source` column, you cannot answer "what percentage of cost tracking comes from the proxy vs the SDK?" or "show me only MCP tool costs." For dashboards, debugging, trust (proxy-measured costs are more reliable than self-reported SDK costs), and future analytics, source attribution is essential. Once events accumulate without this column, backfilling is guesswork.

## Executive Summary

Add `source text NOT NULL DEFAULT 'proxy'` to the `cost_events` table with a CHECK constraint and Drizzle `$type<>()` for TypeScript safety. Three values: `'proxy'` (intercepted LLM costs — OpenAI/Anthropic), `'api'` (self-reported via dashboard REST API — SDK and raw HTTP), and `'mcp'` (MCP tool costs reported via proxy worker). The default `'proxy'` is correct for all existing rows. The column is system-derived (set by server code), not client-settable. Include `source` in API list responses and webhook payloads. No standalone index needed. Run a one-time backfill to retroactively tag historical REST API events.

This is a clean, small change: 1 schema column + CHECK constraint, 4 insert sites updated, 2 validation schemas updated, 2 webhook payload builders updated (SYNC'd).

## Research Method

- **Codebase exploration**: Mapped all 3 ingestion paths (proxy `logCostEvent` via `Omit<NewCostEventRow, "id" | "createdAt">`, dashboard REST API `insertCostEvent`/`insertCostEventsBatch` via `buildInsertValues`, proxy MCP route `handleMcpEvents` via direct row construction), the schema, validation schemas, query/list functions, and webhook payload builders.
- **Platform pattern research**: Studied Stripe, Datadog, PostHog, Segment, OpenTelemetry, CloudEvents, Vercel AI Gateway, Cloudflare Workers, and the FOCUS FinOps specification.
- **Drizzle/Postgres research**: Verified `ADD COLUMN ... DEFAULT` behavior in Postgres 15, Drizzle CHECK constraint support (native since array syntax), and constraint modification semantics.
- **Risk analysis**: Analyzed deploy ordering, default accuracy, value semantics, backfill completeness, and forward compatibility.

## Official Documentation Findings

**Postgres 11+ ADD COLUMN with DEFAULT**: Since Postgres 11, `ALTER TABLE ADD COLUMN ... DEFAULT` stores the default in catalog metadata (`pg_attribute.attmissingval`) and applies it lazily on read. No table rewrite occurs. Adding `NOT NULL DEFAULT 'proxy'` to `cost_events` is instantaneous regardless of row count. Confirmed in Postgres 15 (Supabase). Source: [PostgreSQL 11 Release Notes, Section E.23.3.3](https://www.postgresql.org/docs/11/release-11.html).

**Postgres CHECK constraint on ADD COLUMN**: Adding a CHECK constraint requires a **table scan** (to validate existing rows) but NOT a table rewrite. For existing rows that all satisfy the constraint (which they will, since they all get the DEFAULT), the scan is fast. Can be combined with ADD COLUMN in a single `ALTER TABLE` statement. To skip the scan entirely, use `NOT VALID` + `VALIDATE CONSTRAINT` as a two-step. Source: [PostgreSQL ALTER TABLE](https://www.postgresql.org/docs/current/sql-altertable.html).

**Postgres CHECK modification**: No `ALTER CONSTRAINT` syntax exists. Must `DROP CONSTRAINT` + `ADD CONSTRAINT`. Both can be combined in a single `ALTER TABLE` statement (atomic). When widening the constraint (adding a value), all existing rows pass, so the validation scan is safe. Source: [PostgreSQL ALTER TABLE](https://www.postgresql.org/docs/current/sql-altertable.html).

**Drizzle ORM CHECK constraints**: Drizzle now supports CHECK constraints natively via the `check()` function in the table callback's array syntax. Requires `import { check } from "drizzle-orm/pg-core"` and `import { sql } from "drizzle-orm"`. The syntax is: `check("constraint_name", sql\`${table.column} IN ('a', 'b')\`)`. drizzle-kit generates the constraint in migrations when using the array syntax (not the older object syntax). Source: [Drizzle ORM Indexes & Constraints](https://orm.drizzle.team/docs/indexes-constraints), [GitHub Issue #3520](https://github.com/drizzle-team/drizzle-orm/issues/3520).

**Drizzle `$type<>()`**: Confirmed TypeScript-only with zero database effect. Narrows the TS type for compile-time checking. The database column remains plain `text`. Chaining with `.notNull().default()` works correctly. Source: [Drizzle ORM Goodies](https://orm.drizzle.team/docs/goodies).

**`source` is not a reserved keyword in PostgreSQL.** Can be used as a column name without quoting.

## Modern Platform and Ecosystem Patterns

| Platform | Field name | Type | Values | Settable by client? | Notes |
|----------|-----------|------|--------|-------------------|-------|
| Stripe | `event.request.id` | Nullable string | Request ID or null | No — system-derived | `null` = system-generated event (no API call triggered it). No explicit `source` enum — Stripe tracks *what API request* caused an event, not *which channel*. |
| Datadog | `ddsource` (reserved attribute) | Freeform string (soft enum) | Integration names: `nginx`, `python`, `java`, `postgres` | Semi — client log shipper sets it | Known values trigger automatic log pipeline activation. Separate `service` attribute identifies the application. |
| PostHog | `$lib`, `$lib_version` | Freeform string, semver | SDK names: `web`, `posthog-node`, `posthog-python` | Set by SDK, not user | `$` prefix marks system properties. `$lib_version` supports semver comparison operators. |
| Segment | Source entity + `channel` + `context.library` | Entity + enum + object | `channel`: `browser`, `mobile`, `server`. `context.library.name`: SDK names | `channel` system-derived; Source entity has unique `writeKey` | **Gold standard three-tier model**: Source (organizational/routing) > channel (platform category) > library (specific SDK). |
| OpenTelemetry | `telemetry.sdk.name`, `.language`, `.version` + `InstrumentationScope` | String (well-known values with custom fallback) | Language: `go`, `java`, `python`, `nodejs`, `webjs` | Set by SDK | Two-layer: `telemetry.sdk.*` (SDK identity, resource-level) vs `InstrumentationScope` (which instrumentation library generated each span). |
| CloudEvents | `source` (required) | URI-reference | Application-specific URIs | Producer-set | Required attribute. `source` + `id` must be globally unique. Identifies the producing context. |
| Vercel AI Gateway | Project/team (implicit) + `user` + `tags` | String + string array | Freeform | `user`/`tags` client-settable; project/team system-derived | Structural attribution (team/project) is system-derived from routing; business attribution (user, tags) is client-settable. |
| Cloudflare | `ScriptName` (Workers Logpush) | String | Worker script names | System-derived | Analytics Engine is BYO schema — no predefined source field. |
| FOCUS (FinOps spec) | Service Provider / Host Provider | Separate dimensions | Cloud provider names | System-derived | Distinguishes who sells the resource from where it physically runs. Analogous to separating ingestion path from originating client. |

### Cross-cutting pattern: ingestion path vs originating client

The most sophisticated platforms (Segment, OpenTelemetry) separate two concerns that are often conflated:

| Concern | Description | Segment | OpenTelemetry | NullSpend analog |
|---------|-------------|---------|---------------|-----------------|
| **Ingestion path** | WHERE did data enter the system? | Source entity + `writeKey` | `service.name`, resource attributes | `source` column: `proxy`, `api`, `mcp` |
| **Originating client** | WHAT sent the data? | `context.library.name` + version | `telemetry.sdk.name` + language + version | Future: `X-NullSpend-SDK-Version` header |

**Key takeaway**: The `source` column should track the **ingestion path** (which server endpoint received the data), not the **originating client** (which SDK/tool sent it). These are different questions with different answers. A single `source` column handles ingestion path. Client identification, if ever needed, should be a separate field.

### Recurring patterns across all platforms

1. **System-derived for ingestion path.** Every platform sets the ingestion path server-side, not from client input. Client-settable attribution is reserved for business-level concerns (user IDs, tags, metadata).
2. **Short lowercase machine-readable strings.** PostHog: `web`, `posthog-node`. Datadog: `nginx`, `python`. Segment: `server`, `browser`. Not URIs, UUIDs, or sentences.
3. **Include in API responses and export payloads.** Every platform that tracks source includes it in query results and webhook/export payloads.
4. **Constrained values, not freeform.** CHECK constraint or enum, not arbitrary text. Datadog's "soft enum" (freeform with well-known values) is the exception, driven by their diverse integration ecosystem.

## Architecture Options

### Option A: `text` with CHECK constraint (recommended)

```typescript
// Drizzle schema (native CHECK support)
import { check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const COST_EVENT_SOURCES = ["proxy", "api", "mcp"] as const;
export type CostEventSource = (typeof COST_EVENT_SOURCES)[number];

// In costEvents table definition:
source: text("source").$type<CostEventSource>().notNull().default("proxy"),

// In table callback array:
check("cost_events_source_check", sql`${table.source} IN ('proxy', 'api', 'mcp')`),
```

- **Strengths**: Database-level enforcement. Matches codebase convention (`tool_costs.source` uses the identical pattern: exported const array + `$type<>()` + CHECK). Drizzle now supports `check()` natively in array syntax. Adding new values is `DROP CONSTRAINT` + `ADD CONSTRAINT` (atomic, instant).
- **Weaknesses**: Requires a migration to add new source values.
- **Complexity**: Minimal. Established pattern in this codebase.
- **When appropriate**: Controlled write paths with a small, known set of values. This is us.

### Option B: Plain `text` with Zod-only validation

```typescript
source: text("source").notNull().default("proxy")
// Zod: z.enum(["proxy", "api", "mcp"])
```

- **Strengths**: No DDL change to add new values.
- **Weaknesses**: No database-level constraint. Raw SQL INSERTs could bypass validation. Breaks codebase convention (audit M17).
- **Complexity**: Minimal.
- **When appropriate**: When write paths are so diverse that CHECK constraints would churn frequently. Not our case.

### Option C: Postgres ENUM type

```sql
CREATE TYPE cost_event_source AS ENUM ('proxy', 'api', 'mcp');
ALTER TABLE cost_events ADD COLUMN source cost_event_source NOT NULL DEFAULT 'proxy';
```

- **Strengths**: Database-level enforcement. Storage efficient (4 bytes).
- **Weaknesses**: Adding a new enum value requires `ALTER TYPE ... ADD VALUE`. In Postgres 12+ it can run inside a transaction, but it's still a DDL operation. Drizzle's enum support requires `pgEnum()` which adds schema complexity.
- **Complexity**: Medium — enum type definition, migration ordering.
- **When appropriate**: High-trust environments where raw SQL writes are common.

**Recommendation: Option A.** All cost event writes go through controlled code paths. CHECK constraint matches the existing `tool_costs.source` convention. Drizzle natively generates CHECK constraints in migrations. TypeScript safety via `$type<>()` + exported const array.

## Recommended Approach for Our Platform

### Values — three

| Value | Ingestion path | Trust level | Set where |
|-------|---------------|-------------|-----------|
| `proxy` | Proxy worker intercepted an LLM API call and measured cost from the actual response | **Measured** — highest trust | `apps/proxy/src/routes/openai.ts`, `anthropic.ts` |
| `api` | Client self-reported cost data via the dashboard REST API (SDK or raw HTTP) | **Self-reported** — lower trust | `lib/cost-events/ingest.ts` via `buildInsertValues()` |
| `mcp` | Client reported MCP tool costs via the proxy worker's `/v1/mcp/events` endpoint | **Self-reported** — lower trust | `apps/proxy/src/routes/mcp.ts` |

**Why three values, not two:**

The original research recommended two values (`proxy`, `api`) with the argument that MCP events go through the proxy worker so "the server writing to Postgres is the proxy worker." This conflates the Postgres write path (an implementation detail) with the ingestion path (what users care about). Three reasons to use three:

1. **Different trust boundaries.** `proxy` events are measured from actual API responses — the proxy sees the real token counts. `mcp` events are self-reported by the MCP client — the proxy trusts the client's claim. This trust distinction matters for cost accuracy dashboards.
2. **Different code paths and data shapes.** MCP events enter via a different HTTP endpoint (`/v1/mcp/events`), with a different payload format, different validation, and produce cost events with `inputTokens: 0`, `outputTokens: 0`, `provider: "mcp"`, `eventType: "tool"`. They are qualitatively different from proxy-intercepted LLM costs.
3. **Cleaner filtering.** A user filtering `source = 'proxy'` expects to see LLM costs the proxy measured, not MCP tool costs lumped in. While `provider = 'mcp'` can distinguish them, requiring a compound filter (`source = 'proxy' AND provider != 'mcp'`) is a DX antipattern that Segment and Datadog specifically design to avoid.
4. **No cost to adding.** The CHECK constraint supports three values as easily as two. No additional code complexity — the MCP route already constructs its own cost event rows separately from the LLM routes.

**Why `api` instead of `sdk`**: The REST endpoint is called by the SDK, but also by raw HTTP clients. The server cannot distinguish them. Naming it `api` describes the ingestion path accurately. If SDK-specific attribution is needed later, the SDK can send a header (e.g., `X-NullSpend-SDK-Version`) — a separate concern per the Segment/OTel pattern.

### Files to modify

**Schema (1 file)**:
- `packages/db/src/schema.ts` — add `COST_EVENT_SOURCES` const array, `CostEventSource` type, `source` column to `costEvents` table, `check()` constraint in table callback

**Migration (1 DDL)**:
- Via Supabase MCP `apply_migration`

**Proxy insert sites (3 files, 5 locations)**:
- `apps/proxy/src/routes/openai.ts` — add `source: "proxy"` to `logCostEvent` call (2 locations: streaming + non-streaming)
- `apps/proxy/src/routes/anthropic.ts` — same (2 locations: streaming + non-streaming)
- `apps/proxy/src/routes/mcp.ts` — add `source: "mcp"` to `costEventRows` mapping

**Dashboard insert site (1 file)**:
- `lib/cost-events/ingest.ts` — add `source: "api"` in `buildInsertValues()`

**Validation schemas (1 file)**:
- `lib/validations/cost-events.ts` — add `source` to `costEventRecordSchema` for API responses; add `source` as optional filter param to `listCostEventsQuerySchema`

**List query (1 file)**:
- `lib/cost-events/list-cost-events.ts` — add `source` to SELECT columns; add optional `WHERE source = $x` filter when query param is provided

**Summary query (1 file)**:
- `app/api/cost-events/summary/route.ts` (or underlying aggregate function) — add `GROUP BY source` as a supported dimension

**Webhook payload builders (2 SYNC'd files)**:
- `apps/proxy/src/lib/webhook-events.ts` — add `source` to `CostEventData` interface and `buildCostEventPayload` `data.object` output
- `lib/webhooks/dispatch.ts` — add `source` to `buildCostEventWebhookPayload` parameter type and `data.object` output

**Not modified**:
- `costEventInputSchema` in `lib/cost-events/ingest.ts` — `source` is NOT in the request body. It's system-derived.
- `apps/proxy/src/lib/cost-logger.ts` — uses `Omit<NewCostEventRow, "id" | "createdAt">`, auto-accepts the new `source` field once the schema is updated. No code changes needed.
- `apps/proxy/src/lib/cost-calculator.ts` — uses `type CostEventInsert = Omit<NewCostEventRow, "id" | "createdAt">`, auto-accepts. The calculator returns cost data; the route handler adds `source` at the call site.

### Deploy order

1. Apply migration (adds column with DEFAULT + CHECK — instant, no table rewrite; CHECK scan is fast since all rows satisfy the DEFAULT)
2. Deploy code (sets `source` explicitly on each path)

Between steps 1 and 2, new events get `source = 'proxy'` (the DEFAULT). This is correct for proxy events and slightly inaccurate for any SDK/API or MCP events during the window. Since this is pre-launch with near-zero API traffic, the window is negligible.

### Post-migration backfill

Run once after deploy to retroactively tag historical events:
```sql
-- Tag REST API events (SDK path uses sdk_ prefix for request_id)
UPDATE cost_events SET source = 'api' WHERE request_id LIKE 'sdk_%';

-- Tag MCP tool cost events (distinguishable by provider + eventType)
UPDATE cost_events SET source = 'mcp' WHERE provider = 'mcp' AND event_type = 'tool';
```

**Backfill gap**: REST API events submitted with a custom `Idempotency-Key` header use the idempotency key as `request_id` instead of the `sdk_` prefix (see `resolveRequestId` in `lib/cost-events/ingest.ts`). These are not caught by the `LIKE 'sdk_%'` backfill. Pre-launch with near-zero API traffic, this gap is negligible. Post-launch, the code will set `source` explicitly so no backfill is needed.

## Risks, Gaps, and Edge Cases

| Risk | Severity | Mitigation |
|------|----------|------------|
| Existing rows all get `source = 'proxy'` | Low | Mostly correct. Backfill tags `sdk_%` rows as `api` and `provider = 'mcp'` rows as `mcp`. |
| Backfill misses API events with custom idempotency keys | Low | Pre-launch, near-zero API traffic. Code deploy fixes it going forward. |
| Deploy gap: API/MCP events get `source = 'proxy'` between migration and code deploy | Low | Pre-launch, near-zero traffic. Window is minutes. Backfill catches stragglers. |
| Client lies about source | N/A | Source is system-derived, not in the request body. |
| Future source not in CHECK constraint | Low | `DROP CONSTRAINT` + `ADD CONSTRAINT` in single `ALTER TABLE` is atomic and instant. |
| `source` column not indexed | Low | Low cardinality (3 values). Existing composite indexes handle filtered queries. Add to composite if analytics need it later. |
| Webhook payload builders desync | Medium | Two SYNC'd files (`dispatch.ts` + `webhook-events.ts`) must be updated together. Cross-builder shape test catches drift. |
| CHECK constraint scan on ADD | Low | All existing rows satisfy `DEFAULT 'proxy'` which is IN ('proxy', 'api', 'mcp'). Scan is fast. Can use `NOT VALID` if table is large. |
| RLS policies | None | Confirmed unaffected — existing SELECT policy doesn't reference `source`. |

## Recommended Technical Direction

- **Column**: `source text NOT NULL DEFAULT 'proxy'` with `$type<CostEventSource>()`
- **Constraint**: `CHECK (source IN ('proxy', 'api', 'mcp'))` via Drizzle `check()` in table callback
- **Values**: `proxy` (measured LLM costs), `api` (self-reported via REST API), `mcp` (MCP tool costs)
- **Convention**: Follow existing `tool_costs.source` pattern: exported const array + type alias + `$type<>()` + CHECK
- **Validation**: Add to response schema and webhook payload, NOT to input schema
- **System-derived**: Each insert path sets `source` explicitly; not client-settable
- **API response**: Include in `GET /api/cost-events` and `cost_event.created` webhook payloads
- **Filtering**: Add `source` as optional query param on `GET /api/cost-events` — zero users means zero migration cost, painful to retrofit after dashboards are built on the response shape
- **Summary**: Add `source` as a groupable dimension on `GET /api/cost-events/summary` — same logic, build complete now
- **Index**: Defer — low cardinality, existing composites suffice. Revisit if `source`-filtered queries show up in slow query logs.
- **Backfill**: Two queries: `WHERE request_id LIKE 'sdk_%'` for API events, `WHERE provider = 'mcp' AND event_type = 'tool'` for MCP events
- **Do now**: Schema + CHECK + migration + insert paths + response schema + filtering + summary grouping + both SYNC'd webhook builders
- **Avoid**: Postgres ENUM type, client-settable source, freeform string without CHECK, deferring API surface work to post-launch

## Resolved Questions

1. **Should the cost event summary endpoint support `GROUP BY source`?** — **Yes, build now.** The endpoint already groups by provider/model/key. Adding source as a dimension is trivial today. Retrofitting after dashboards are built on the current response shape is a breaking change.
2. **Should `source` be a filterable query parameter on `GET /api/cost-events`?** — **Yes, build now.** One Zod field in the query schema, one AND clause in the Drizzle query. Zero users means zero migration cost. Deferring API surface work to post-launch creates unnecessary breaking changes later.
3. **Option A (CHECK) vs Option B (Zod-only) vs Option C (ENUM)?** — **Option A.** DB-level enforcement + TypeScript safety. Matches existing `tool_costs.source` convention. Drizzle supports `check()` natively. The migration "cost" of adding new values is the right friction — new ingestion paths should be deliberate. Option B gives up DB enforcement for nothing. Option C (ENUM) is strictly worse than CHECK for this use case.

## Sources and References

- [PostgreSQL 11 Release Notes, Section E.23.3.3](https://www.postgresql.org/docs/11/release-11.html) — ADD COLUMN with DEFAULT optimization
- [PostgreSQL ALTER TABLE](https://www.postgresql.org/docs/current/sql-altertable.html) — CHECK constraint behavior, combining operations
- [Drizzle ORM Indexes & Constraints](https://orm.drizzle.team/docs/indexes-constraints) — Native CHECK support
- [Drizzle ORM Goodies](https://orm.drizzle.team/docs/goodies) — `$type<>()` documentation
- [GitHub Issue #3520](https://github.com/drizzle-team/drizzle-orm/issues/3520) — CHECK constraint generation fix (array syntax)
- [Stripe API: Event object](https://docs.stripe.com/api/events/object) — `request.id` null convention
- [Segment Spec: Common Fields](https://segment.com/docs/connections/spec/common/) — `channel`, `context.library`
- [Segment Sources Overview](https://segment.com/docs/connections/sources/) — Three-tier attribution model
- [OpenTelemetry Resource Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/resource/) — `telemetry.sdk.*`
- [OpenTelemetry Instrumentation Scope](https://opentelemetry.io/docs/concepts/instrumentation-scope/) — Two-layer attribution
- [CloudEvents Specification](https://github.com/cloudevents/spec/blob/main/cloudevents/spec.md) — Required `source` attribute
- [Datadog Attributes and Aliasing](https://docs.datadoghq.com/logs/log_configuration/attributes_naming_convention/) — `ddsource` reserved attribute
- [PostHog Events Documentation](https://posthog.com/docs/data/events) — `$lib`, `$lib_version`
- [Vercel AI Gateway Attribution](https://vercel.com/docs/ai-gateway/app-attribution) — Project/user/tags model
- [FOCUS FinOps Specification](https://focus.finops.org/focus-specification/) — Provider/Host distinction
- NullSpend codebase: `packages/db/src/schema.ts` (tool_costs pattern), `apps/proxy/src/lib/cost-logger.ts` (Omit type), `lib/cost-events/ingest.ts` (resolveRequestId), `apps/proxy/src/routes/mcp.ts` (MCP row construction)
