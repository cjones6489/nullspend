# TODOS

## Attribution

### Functional index for hot tag keys

**What:** Add a PostgreSQL functional index on frequently-used tag keys when tag-based attribution queries exceed 3 seconds.

**Why:** Tag-based GROUP BY (`tags->>'customer_id'`) scans the full orgId+createdAt result set and extracts JSONB values. At 4.5M+ rows this hits 2-5s. A functional index (`CREATE INDEX ON cost_events ((tags->>'customer_id'), created_at) WHERE tags ? 'customer_id'`) turns it into an index scan (<100ms).

**Context:** The attribution feature ships without this index. Monitor query times via Supabase dashboard or pg_stat_statements. If any org consistently hits >3s on tag attribution, create the functional index for their most-used tag key. Each index costs ~50MB disk + write overhead, so only create for tag keys with proven usage. This is a zero-downtime `CREATE INDEX CONCURRENTLY` migration.

**Effort:** S
**Priority:** P3
**Depends on:** Attribution feature shipped + real usage data showing slow queries

### Per-customer cost threshold alerting

**What:** Webhook-based alerting when any customer's cost exceeds a configured threshold in a rolling window.

**Why:** Attribution answers "what does each customer cost?" Alerting answers "when does it change?" Together they close the FinOps feedback loop. The target user (backend dev at a SaaS startup) will want to know immediately when a customer's usage spikes.

**Context:** Leverage existing webhook infrastructure (dispatch, signing, threshold detection). Requires a new entity type for per-customer thresholds (e.g., "alert when any API key exceeds $50/day"). Could be polling-based (check on each cost event) or batch (periodic aggregation check). The webhook payload builders (`buildThresholdCrossingPayload`) and dispatch pipeline already exist. Main work is the threshold entity model and the trigger mechanism.

**Effort:** M
**Priority:** P2
**Depends on:** Attribution feature shipped. Webhook infrastructure (already exists).

## Design

### Create DESIGN.md

**What:** Codify the implicit design system into a DESIGN.md via `/design-consultation`.

**Why:** No single source of truth for design decisions. Each new page requires inferring patterns from existing code (typography scale, color tokens, spacing, component conventions). A DESIGN.md would make all future UI work faster and more consistent.

**Context:** The codebase uses Tailwind + shadcn/ui + base-ui with a dark monospace aesthetic. Typography: text-xl / text-sm / text-[13px] / text-xs / text-[11px]. Colors: CSS variables (chart-1 through chart-5, foreground, muted-foreground, etc.). Spacing: space-y-6 / space-y-4 / gap-3. The system exists implicitly and is consistent, but undocumented.

**Effort:** S
**Priority:** P3
**Depends on:** None

## Completed
