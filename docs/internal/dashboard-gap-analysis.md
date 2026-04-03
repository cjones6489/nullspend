# Dashboard Gap Analysis

Last updated: 2026-04-01

Backend capabilities vs dashboard UI exposure. Organized by shipping priority.

---

## P0 — PearX Demo Blockers

### Budget Increase Inbox UX
- **Status:** Shipped
- **What shipped:**
  - `BudgetIncreaseCard` replaces generic PayloadViewer for `budget_increase` actions — shows current limit, spend with color-coded progress bar, requested increase, projected new limit, entity, reason. Status-aware labels ("if Approved" vs "Approved").
  - Partial approval input on approve dialog — optional dollar amount, defaults to requested. Client-side validation (positive, $1M cap). Toast shows "Budget increased from $X to $Y".
  - DollarSign icon + requested amount badge on inbox list rows for `budget_increase` actions.
  - `mutateActionResponseSchema` extended to pass `budgetIncrease` through to the client (was being stripped by Zod `.parse()`).
  - `BudgetEntityNotFoundError` → 404 (was falling through to opaque 500).
  - SDK `MutateActionResponse` type updated to include `budgetIncrease`.
- **Files:** `components/actions/budget-increase-card.tsx`, `components/actions/decision-controls.tsx`, `app/(dashboard)/app/inbox/page.tsx`, `app/(dashboard)/app/actions/[id]/page.tsx`, `lib/validations/actions.ts`, `lib/queries/actions.ts`, `lib/actions/errors.ts`, `lib/budgets/increase.ts`, `lib/utils/http.ts`, `packages/sdk/src/types.ts`

### Budget Policy Selector
- **Status:** Shipped
- **What shipped:**
  - `policySchema` enum (`strict_block | soft_block | warn`) added to `createBudgetInputSchema` and tightened in response schemas.
  - API route accepts `policy` in both insert and upsert (onConflictDoUpdate).
  - Button-group selector ("Block Requests" / "Allow + Warn" / "Track Only") added to both BudgetDialog (budgets page) and CreateBudgetDialog (key detail page). Pre-populates on edit.
  - Policy badge (Block/Warn/Track with red/amber/blue coloring) shown in budget table rows.
  - `BudgetData` and `EditBudgetData` interfaces updated to include `policy`.
  - Key detail page existing read-only badge auto-reflects updates.
- **Files:** `lib/validations/budgets.ts`, `app/api/budgets/route.ts`, `app/(dashboard)/app/budgets/page.tsx`, `components/keys/key-budget-section.tsx`, `lib/queries/budgets.ts`

### Cost Breakdown Display
- **Status:** Shipped
- **What shipped:**
  - `costBreakdown` plumbed through all API routes (detail, list, sessions, action costs, CSV export)
  - `CostBreakdownBar` component with decomposed segments (reasoning ⊂ output, toolDefinition ⊂ input)
  - Stacked bar in cost event detail view, title attr on activity table cost cell
  - SDK `CostEventRecord` type updated, Zod schema resilient to corrupt JSONB
  - Analytics cost breakdown chart correctly decomposes reasoning from output
  - `formatMicrodollars` fix for sub-cent values (<$0.0001)
  - 35 new tests
- **Files:** `components/usage/cost-breakdown-bar.tsx`, `app/(dashboard)/app/cost-events/[id]/page.tsx`, `components/usage/recent-activity.tsx`, `app/api/cost-events/export/route.ts`, plus 6 API/serializer files

---

## P1 — Pre-Launch

### Webhook Delivery History
- **Status:** Not started
- **Gap:** Users create webhook endpoints but can't see delivery status, failures, or retry history.
- **Backend ready:** `webhook_deliveries` table tracks: status, attempts, last_attempt_at, response_status, response_body_preview. API endpoint exists.
- **What to build:** Delivery log table on webhook detail page. Show: event type, status (pending/delivered/failed), attempts, response code, timestamp. Retry button optional.
- **Files:** `app/(dashboard)/app/settings/webhooks/`, delivery list component

### Org Member Management
- **Status:** Partial (invite works, role display works)
- **Gap:** Can't change member roles, remove members, transfer ownership, or leave an org from the UI.
- **Backend ready:** All API endpoints exist: PATCH role, DELETE member, POST transfer, POST leave.
- **What to build:**
  - Role dropdown on each member row (owner/admin/member/viewer)
  - Remove member button with confirmation
  - Transfer ownership action (owner only)
  - Leave organization button (non-owner)
- **Files:** `app/(dashboard)/app/settings/members/page.tsx`, member management components

### Tool Event Details in Activity
- **Status:** Not started
- **Gap:** `toolName`, `toolServer`, `toolCallsRequested` captured on MCP cost events but invisible in activity view.
- **Backend ready:** Fields returned by cost event APIs. Tool costs page shows aggregates but disconnected from individual events.
- **What to build:** Show tool name/server as columns or badges in activity table for `eventType: "tool"`. Link to tool costs page.
- **Files:** `app/(dashboard)/app/activity/page.tsx`, activity table component

---

## P2 — Post-Launch

### Cost Event Export
- **Gap:** No CSV/JSON export. Backend has `/api/cost-events/export` endpoint.
- **What to build:** Export button on activity/analytics pages.

### API Version Selector
- **Gap:** API keys and webhook endpoints have `apiVersion` fields but no UI to set them.
- **What to build:** Version dropdown on key/webhook create/edit forms.

### Upstream vs Total Latency
- **Gap:** `upstreamDurationMs` captured separately from `durationMs` but only total shown.
- **What to build:** Two-bar latency display: proxy overhead vs upstream time.

### Audit Log Viewer
- **Gap:** Route exists at `/app/settings/audit-log` but unclear if fully wired.
- **What to build:** Verify existing page, add filtering by actor/resource/action type.

### Request Chain Visualization
- **Gap:** `parentRequestId` links cost events in chains but no visualization.
- **What to build:** Tree view or timeline connecting parent/child requests.

### Webhook Secret Rotation History
- **Gap:** `previous_signing_secret` and `secret_rotated_at` stored but not shown.
- **What to build:** Rotation history on webhook detail page.

### API Key Environment Toggle
- **Gap:** `environment` field (live/staging) exists on keys but not editable in UI.
- **What to build:** Environment badge + toggle on key detail page.

---

## What's Already Solid

- **Keys page** — mandates (allowed models/providers), default tags, tag budgets, budget, velocity, session limits all editable
- **Sessions** — list + replay with event timeline and bodies
- **Analytics** — spend chart, breakdowns by cost/key/model/provider/source/tool/trace
- **Attribution** — group by key + tags, sort by cost/requests/avg
- **Billing** — tier management, spend cap progress, upgrade flow
- **Webhooks** — create with event filtering, payload mode toggle (full/thin), enabled toggle
- **Activity** — cost event table with filters (provider, source, key, budget status, model)
- **Home** — metric cards, 7d spend chart, setup snippets
