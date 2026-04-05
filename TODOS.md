# TODOS

## Attribution

### Functional index for hot tag keys

**What:** Add a PostgreSQL functional index on the `customer` tag key. Ships alongside the Margins feature.

**Why:** Tag-based GROUP BY (`tags->>'customer'`) scans the full orgId+createdAt result set and extracts JSONB values. At 4.5M+ rows this hits 2-5s. A functional index turns it into an index scan (<100ms). The Margins feature depends on this query pattern.

**Context:** `CREATE INDEX CONCURRENTLY ON cost_events ((tags->>'customer'), created_at) WHERE tags ? 'customer'`. Zero-downtime, no lock. ~50MB disk + write overhead. The standard tag key is `customer` (not `customer_id`).

**Effort:** S
**Priority:** P1 (ships with Margins)
**Depends on:** None (ships alongside Margins feature)

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

## Margins

### CSV/PDF export for margin table

**What:** Let users download the margin table as CSV or styled PDF for board decks.

**Why:** The CFO use case. Board-ready margin reports differentiate NullSpend from "I maintain a spreadsheet." The CSV pattern already exists in the attribution API.

**Context:** CSV export can copy the existing `format=csv` pattern from `/api/cost-events/attribution`. PDF is harder (requires HTML-to-PDF pipeline, e.g., Puppeteer or a service like DocRaptor). Consider CSV-only for v1 fast-follow, PDF as Phase 2.

**Effort:** S
**Priority:** P2
**Depends on:** Margin table shipped

### Stripe key rotation support

**What:** When `STRIPE_ENCRYPTION_KEY` needs rotating, re-encrypt all stored Stripe connections. Store key version in ciphertext prefix (`v1:iv:ciphertext:tag`) so old keys can be tried during transition.

**Why:** Security hygiene. Without versioned encryption, a key rotation causes all Stripe connections to become undecryptable. Not urgent pre-launch but must exist before production customers.

**Context:** Current encryption is unversioned AES-256-GCM. Add a version prefix (`v1:`) to the ciphertext format. On rotation: write new `STRIPE_ENCRYPTION_KEY_V2` env var, run a migration script that decrypts with old key and re-encrypts with new key, then swap env vars.

**Effort:** S
**Priority:** P3
**Depends on:** Margin table shipped

### Margin-driven Slack alerts

**What:** When `margin.threshold_crossed` fires AND a Slack config exists, send a rich Slack message with customer details, margin data, and action buttons.

**Why:** The Slack alert is the killer feature for eng managers. It turns "dashboard you check" into "system that alerts you." Phase 4 lock-in starts here. Reuses existing Slack message infrastructure from budget negotiation.

**Context:** Budget negotiation already sends rich Slack messages with action buttons (`lib/slack/budget-message.ts`). Margin alerts follow the same pattern: build a message payload with customer name, margin %, revenue, cost, and action URLs (View Margins, Set Budget Cap).

**Effort:** S
**Priority:** P1
**Depends on:** Margin webhook event + Slack integration (both already exist)

## Completed
