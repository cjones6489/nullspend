# TODOS

## Attribution

### ~~Functional index for hot tag keys~~

**Completed:** 2026-04-04 (migration 0052_cost_events_customer_tag_index.sql)

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

### ~~CSV export for margin table~~

**Completed:** 2026-04-05 (GET /api/margins?format=csv with RFC 4180 escaping + formula injection defense)

### PDF export for margin table

**What:** Let users download the margin table as a styled PDF for board decks.

**Why:** The CFO use case. CSV is shipped. PDF adds polish for investor/board presentations.

**Context:** Requires HTML-to-PDF pipeline (e.g., Puppeteer, DocRaptor, or a headless Chrome service). The margin table data is already available via the API.

**Effort:** M
**Priority:** P3
**Depends on:** CSV export shipped

### Stripe key rotation support

**What:** When `STRIPE_ENCRYPTION_KEY` needs rotating, re-encrypt all stored Stripe connections. Store key version in ciphertext prefix (`v1:iv:ciphertext:tag`) so old keys can be tried during transition.

**Why:** Security hygiene. Without versioned encryption, a key rotation causes all Stripe connections to become undecryptable. Not urgent pre-launch but must exist before production customers.

**Context:** Current encryption is unversioned AES-256-GCM. Add a version prefix (`v1:`) to the ciphertext format. On rotation: write new `STRIPE_ENCRYPTION_KEY_V2` env var, run a migration script that decrypts with old key and re-encrypts with new key, then swap env vars.

**Effort:** S
**Priority:** P3
**Depends on:** Margin table shipped

### ~~Margin-driven Slack alerts~~

**Completed:** 2026-04-05 (lib/margins/margin-slack-message.ts — rich Block Kit messages with View Margins + Set Budget Cap deep links, HTTPS validation, per-crossing error isolation)

## Completed
