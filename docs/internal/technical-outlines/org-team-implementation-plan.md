# Org & Team Implementation Plan

**Created:** 2026-03-24
**Status:** Phase 1 Complete, Phase 2 Ready
**Author:** Claude (from research + planning with @cjone)

**Companion documents:**
- [`org-team-architecture.md`](org-team-architecture.md) — schema design, API routes, proxy changes, data model
- [`org-team-ui-ux.md`](org-team-ui-ux.md) — routing, components, wireframes, upgrade flows

---

## How to Use This Document

Each phase is broken into sub-phases that can be implemented, tested, and shipped independently. Before starting each phase:

1. **Review gate:** Re-read the phase's prerequisites and assumptions. Verify they still hold against the current codebase. If prior phases changed anything, update the plan before starting.
2. **Implement** the sub-phases in order (they have internal dependencies).
3. **Audit** after the phase is complete — run tests, verify assumptions, check for regressions.
4. **Update this document** with actual outcomes, adjusted estimates, and lessons learned.

---

## Phase 0: Schema Prep + Settings Restructure — COMPLETE (2026-03-24)

**Goal:** Add future-proofing columns while tables are empty. Restructure settings for sub-page navigation. No behavioral changes.

**Shipped:** All 4 sub-phases. `org_id uuid` on all 8 tables, tier-driven limits (Free: 3 budgets/$5K/10 keys/2 webhooks/30d, Pro: unlimited/$50K/25 webhooks/90d, Enterprise: all unlimited), `org` in PREFIX_MAP, settings split into sub-pages with secondary nav.

### Phase 0a: Schema Columns (~15 min)

Add nullable `org_id` and `created_by` columns to remaining tables. Zero risk on empty tables.

**Migration SQL:**
```sql
ALTER TABLE "webhook_endpoints" ADD COLUMN "org_id" uuid;
ALTER TABLE "tool_costs" ADD COLUMN "org_id" uuid;
ALTER TABLE "actions" ADD COLUMN "org_id" uuid;
ALTER TABLE "slack_configs" ADD COLUMN "org_id" uuid;
ALTER TABLE "subscriptions" ADD COLUMN "org_id" uuid;

ALTER TABLE "api_keys" ADD COLUMN "created_by" text;
ALTER TABLE "budgets" ADD COLUMN "created_by" text;
ALTER TABLE "webhook_endpoints" ADD COLUMN "created_by" text;
```

**Drizzle schema updates** (`packages/db/src/schema.ts`):
- `webhookEndpoints`: add `orgId: uuid("org_id")`, `createdBy: text("created_by")`
- `toolCosts`: add `orgId: uuid("org_id")`
- `actions`: add `orgId: uuid("org_id")`
- `slackConfigs`: add `orgId: uuid("org_id")`
- `subscriptions`: add `orgId: uuid("org_id")`
- `apiKeys`: add `createdBy: text("created_by")`
- `budgets`: add `createdBy: text("created_by")`

**Files changed:** `packages/db/src/schema.ts` + 1 migration file
**Tests affected:** None (nullable columns, no code reads them)
**Deploy:** No proxy deploy needed (schema-only change)

- [ ] Update Drizzle schema
- [ ] Create and apply migration
- [ ] Verify `pnpm typecheck` passes
- [ ] Verify `pnpm test` and `pnpm proxy:test` pass

### Phase 0b: Tier-Driven Limits (~30 min)

Move hardcoded per-user limits into tier definitions so they can scale with org billing.

**Current state:**
```typescript
// lib/validations/api-keys.ts
MAX_KEYS_PER_USER = 20  // hardcoded constant

// lib/validations/webhooks.ts
MAX_WEBHOOK_ENDPOINTS_PER_USER = 10  // hardcoded constant
```

**Target state:**
```typescript
// lib/stripe/tiers.ts
free:  { maxApiKeys: 5,   maxWebhookEndpoints: 2,  maxBudgets: 1,  ... }
pro:   { maxApiKeys: 50,  maxWebhookEndpoints: 25, maxBudgets: Infinity, ... }
team:  { maxApiKeys: 100, maxWebhookEndpoints: 50, maxBudgets: Infinity, ... }
```

**Files changed:**
- `lib/stripe/tiers.ts` — add `maxApiKeys`, `maxWebhookEndpoints` to tier definitions
- `lib/validations/api-keys.ts` — remove `MAX_KEYS_PER_USER`, export a function that accepts tier
- `lib/validations/webhooks.ts` — remove `MAX_WEBHOOK_ENDPOINTS_PER_USER`, same
- `app/api/keys/route.ts` — pass tier to validation
- `app/api/webhooks/route.ts` — pass tier to validation (if limit is enforced here)

**Tests affected:** Any tests that reference `MAX_KEYS_PER_USER` or `MAX_WEBHOOK_ENDPOINTS_PER_USER`

- [ ] Update tier definitions
- [ ] Update validation functions
- [ ] Update route handlers
- [ ] Update affected tests
- [ ] Verify all tests pass

### Phase 0c: PREFIX_MAP (~5 min)

Add `org` type to the prefixed ID system.

**File:** `lib/ids/prefixed-id.ts`
- Add `org: "ns_org_"` to `PREFIX_MAP`

**Tests:** May need to update prefix map tests if they assert exhaustive coverage.

- [ ] Update PREFIX_MAP
- [ ] Verify tests pass

### Phase 0d: Settings Restructure (~2-3 hours)

Split the monolithic settings page into sub-pages with secondary navigation. This is frontend-only and independent of org work — it improves UX regardless.

**Current state:** Single page at `app/(dashboard)/app/settings/page.tsx` (~370 lines) with `ApiKeysSection`, `SlackSection`, `WebhooksSection` stacked vertically.

**Target state:**
```
app/(dashboard)/app/settings/
  layout.tsx          — two-column layout with <SettingsNav>
  page.tsx            — redirects to /app/settings/api-keys (or general)
  api-keys/page.tsx   — extracted ApiKeysSection
  webhooks/page.tsx   — wrapper for existing WebhooksSection component
  integrations/page.tsx — wrapper for existing SlackSection component
  general/page.tsx    — placeholder for org profile (Phase 3)
  members/page.tsx    — placeholder for member management (Phase 3)
```

**Steps:**
1. Install `Avatar`, `AlertDialog`, `Tooltip` from shadcn registry
2. Create `<SettingsNav>` component (link list with active state)
3. Create `app/(dashboard)/app/settings/layout.tsx` (two-column: nav + content)
4. Extract `ApiKeysSection` into its own page (currently inline in settings)
5. Create wrapper pages for webhooks, integrations (components already exist)
6. Create placeholder pages for general and members (empty card with "Coming soon" or org profile form)
7. Add loading skeletons for each page (follow existing `KeysSkeleton`, `WebhooksSkeleton` patterns)
8. Update sidebar "Settings" link to point to `/app/settings` (or first sub-page)
9. Update any existing links that point to `/app/settings`

**Files changed:** ~8-10 new/modified files
**Tests affected:** Settings-related tests may need route updates

- [ ] Install shadcn components
- [ ] Build SettingsNav
- [ ] Create settings layout
- [ ] Extract/create each settings sub-page
- [ ] Add loading states
- [ ] Update sidebar links
- [ ] Verify navigation works end-to-end
- [ ] Verify existing settings functionality preserved

### Phase 0 Review Gate

Before proceeding to Phase 1, verify:
- [ ] All 8 resource tables have nullable `org_id` columns
- [ ] `api_keys`, `budgets`, `webhook_endpoints` have `created_by` columns
- [ ] Per-user limits are tier-driven (not hardcoded constants)
- [ ] PREFIX_MAP includes `org`
- [ ] Settings pages are split and navigable
- [ ] All tests pass (`pnpm test`, `pnpm proxy:test`, `pnpm typecheck`)

---

## Phase 1: Org Tables + Foundation — COMPLETE (2026-03-24)

**Goal:** Create org infrastructure. Every user gets a personal org. No scoping changes yet — `org_id` is populated on new writes but not used for queries.

**Shipped:** 3 increments. Organizations/memberships/invitations tables with partial unique index. Cookie-based `resolveSessionContext()` (zero DB on hot path, `ns-active-org` httpOnly cookie with `orgId:role`). `ensurePersonalOrg` with transactional creation + 23505 catch-and-retry. `org_id` populated on API key, webhook, and budget writes. 7 dedicated tests. Audited 3 times, all findings resolved.

**Prerequisites (verify before starting):**
- Phase 0 complete — all `org_id` columns exist as `uuid` (migrated in Phase 0a)
- Settings restructure done (Phase 0d)

**Architecture decisions (from Phase 1 arch review, 2026-03-24):**
- **Org context resolution:** Cookie-embedded (`ns-active-org` httpOnly cookie stores `orgId:role`). Zero DB queries on hot path. DB hit only on first request (new user), cookie miss, or org switch. Industry standard (Clerk, WorkOS pattern).
- **Personal org race condition:** Partial unique index `UNIQUE(created_by) WHERE is_personal = true` + catch-and-retry. Database-level idempotency (Stripe pattern).
- **`created_by` columns:** Skipped — existing `user_id` serves as creator audit trail (Phase 0 decision).
- **Org switcher UI:** Deferred to Phase 3 — no value for single-org users. Keep sidebar clean.

**Estimated effort:** ~2 hours (down from 2-3 days after scope reduction).

### Increment 1: Schema + Validation (~30 min)

**Phase 1a: Org tables**
- [ ] Add `organizations`, `orgMemberships`, `orgInvitations` to Drizzle schema (`packages/db/src/schema.ts`)
  - `organizations.id`: `uuid` PK (matches codebase convention)
  - Role/status columns: use `.$type<>()` annotations
  - Add partial unique index: `UNIQUE(created_by) WHERE is_personal = true` — enforces one personal org per user
- [ ] Create migration SQL for 3 tables + indexes (including partial unique index)
- [ ] Apply migration via Supabase MCP
- [ ] Verify `pnpm typecheck` passes

**Phase 1b: Validation schemas**
- [ ] Create `lib/validations/orgs.ts` with Zod schemas:
  - `createOrgSchema` — name (1-50 chars), slug (alphanumeric + hyphens, 3-50 chars, lowercase)
  - `updateOrgSchema` — name (optional), slug (optional)
  - `inviteMemberSchema` — email (valid email), role (`"owner" | "admin" | "member"`)
  - `changeRoleSchema` — role (`"owner" | "admin" | "member"`)
- [ ] Follow existing patterns in `lib/validations/`
- [ ] Verify `pnpm test` and `pnpm proxy:test` pass

### Increment 2: Personal Org + Session Context (~45 min)

**Phase 1c: `ensurePersonalOrg` + cookie-based `resolveSessionContext`**

`ensurePersonalOrg(userId)` in `lib/auth/session.ts`:
- [ ] Try INSERT `organizations` (name: "Personal", slug: `user-{userId prefix}`, is_personal: true, created_by: userId) + `org_memberships` (role: "owner") in transaction
- [ ] If partial unique index violation → catch, re-query existing personal org
- [ ] Return `{ orgId, role: "owner" }`

`resolveSessionContext()` — cookie-first, zero DB on hot path:
- [ ] Step 1: `userId = resolveSessionUserId()` (existing)
- [ ] Step 2: Read `ns-active-org` cookie → parse `orgId:role`
- [ ] Step 3: If cookie valid → validate membership (in-memory cache, 60s TTL) → return `{ userId, orgId, role }`
- [ ] Step 4: If no cookie or invalid → `ensurePersonalOrg(userId)` → set `ns-active-org` cookie → return
- [ ] In-memory membership cache: `Map<string, { orgId, role, expiresAt }>` keyed by `userId:orgId`

Cookie server action:
- [ ] `setActiveOrg(orgId, role)` — sets `ns-active-org` httpOnly cookie with value `orgId:role`
- [ ] Cookie is httpOnly, SameSite=Lax, path=/app

Tests:
- [ ] New user → personal org created, cookie set, context returned with orgId + role "owner"
- [ ] Existing user with cookie → no DB hit, context returned from cookie
- [ ] Concurrent first requests → second catches unique violation, returns same org
- [ ] Invalid cookie (bad format, nonexistent org) → falls back to DB lookup
- [ ] Verify `resolveSessionContext()` returns correct shape `{ userId, orgId, role }`

### Increment 3: Populate `org_id` on Writes (~30 min)

**Phase 1d: Add `orgId` to dashboard INSERT routes**
- [ ] `app/api/keys/route.ts`: `orgId` from `resolveSessionContext()` in POST handler
- [ ] `app/api/budgets/route.ts`: `orgId` in POST handler (transaction already has `userId`)
- [ ] `app/api/webhooks/route.ts`: `orgId` in POST handler
- [ ] Proxy cost-logger: NOT yet — `org_id` populated in Phase 2 when proxy auth returns it

Tests:
- [ ] Create API key → verify `org_id` column is populated (non-null)
- [ ] Create budget → verify `org_id` populated
- [ ] Create webhook → verify `org_id` populated

### Phase 1 Review Gate

Before proceeding to Phase 2, verify:
- [ ] `organizations`, `org_memberships`, `org_invitations` tables exist in DB
- [ ] Partial unique index enforces one personal org per user
- [ ] New user first request creates a personal org (test the lazy-init path)
- [ ] `resolveSessionContext()` returns `{ userId, orgId, role }` correctly
- [ ] Cookie-based hot path: zero DB queries on subsequent requests
- [ ] Concurrent first requests don't create duplicate orgs
- [ ] New API key/budget/webhook writes include `org_id`
- [ ] All tests pass (922+ root, 1208 proxy, typecheck clean)
- [ ] **Re-read Phase 2 plan** — do assumptions still hold? Any adjustments needed?

---

## Phase 2: Org-Scoped System

**Goal:** Switch all queries from `user_id` to `org_id`. Largest phase — proxy, dashboard, DO keying, feature gating all change.

**Prerequisites (verify before starting):**
- [x] Phase 1 complete — personal orgs auto-created, `resolveSessionContext()` works
- [ ] Existing rows have `org_id` populated (backfill needed for pre-Phase-1 data)
- [x] `org_id` columns are correctly typed as `uuid` on all 8 tables

**Architecture decisions (from Phase 2 arch review, 2026-03-24):**
- For personal orgs, `orgId` maps 1:1 to `userId`. Net behavioral change is zero until Phase 3 (team orgs).
- DO keying change (`userId` → `orgId`) is the highest-risk sub-phase — budget enforcement path.
- Dashboard migration is mechanical (22 routes) but wide-reaching.
- Feature gating (`<FeatureGate>`, `FEATURE_TIERS`) is independent frontend work.

**Verified counts (2026-03-24):**
- 22 dashboard route files use `resolveSessionUserId()`
- 16 proxy test files have `makeCtx` helpers needing `orgId`
- 6 `idFromName(userId)` call sites in budget-do-client
- Webhook cache keyed by `userId`
- Cost logger INSERT missing `org_id`
- `ApiKeyIdentity` missing `orgId`

### Increment 1: Proxy Auth — Add `orgId` (~1 hour)

- [ ] `apps/proxy/src/lib/api-key-auth.ts`:
  - Add `orgId: string` to `ApiKeyIdentity`
  - Add `k.org_id` to auth SQL SELECT
  - Map `row.org_id as string` to result
- [ ] `apps/proxy/src/lib/auth.ts`: add `orgId: string` to `AuthResult`, pass through
- [ ] `apps/proxy/src/lib/context.ts`: `RequestContext` inherits from `AuthResult` (automatic)
- [ ] Update 16 proxy test `makeCtx` helpers with `orgId`
- [ ] Verify `pnpm proxy:test` and typecheck pass

### Increment 2: Proxy Cost-Logger (~30 min)

- [ ] `apps/proxy/src/lib/cost-logger.ts`: add `org_id` to single INSERT column list + VALUES
- [ ] Batch INSERT: add `org_id: e.orgId ?? null` to column map
- [ ] Verify cost events are written with `org_id`

### ~~Increment 3: Proxy DO Keying + Cache~~ — MOVED TO PHASE 3

**Decision (Phase 2 arch review):** DO keying stays `idFromName(userId)` for personal orgs. Changing to `idFromName(orgId)` would orphan all existing DO state (budgets, reservations, velocity tracking) and require a complex data migration with zero benefit — personal orgId maps 1:1 to userId. The DO keying change is only needed when team orgs exist (Phase 3), where multiple users share one org-keyed DO. At that point, the first budget sync for a new team org naturally creates the DO via `idFromName(orgId)`.

Items moved to Phase 3:
- `budget-do-client.ts`: `idFromName(userId)` → `idFromName(orgId)` (6 call sites)
- `budget-do-lookup.ts`: `WHERE user_id =` → `WHERE org_id =` (3 queries)
- `budget-orchestrator.ts`: pass `orgId` to DO client
- `routes/internal.ts`: add `orgId` to invalidation body
- `webhook-cache.ts`: cache key by `orgId`
- Proxy test updates for DO/webhook mocks

### Increment 3: Dashboard Query Migration (~2-3 days)

**Mechanical but wide-reaching — 22 route files.**

- [ ] Backfill existing rows: migration to set `org_id` from personal org for all existing data
- [ ] `lib/cost-events/aggregate-cost-events.ts`: `baseConditions` uses `eq(costEvents.orgId, orgId)` (8 functions)
- [ ] Migrate dashboard routes batch by batch:
  - Batch 1 (high-traffic): `budgets/route.ts`, `keys/route.ts`, `cost-events/route.ts`, `webhooks/route.ts` — GET handlers switch from `resolveSessionUserId` to `resolveSessionContext`, queries by `orgId`
  - Batch 2 (analytics): `cost-events/summary/route.ts`, `activity`, `analytics` pages
  - Batch 3 (actions): `actions/route.ts` and sub-routes
  - Batch 4 (settings): `tool-costs/route.ts`, `slack/config/route.ts`, `velocity-status/route.ts`
  - Batch 5 (billing): `stripe/checkout/route.ts`, `stripe/portal/route.ts`, `stripe/subscription/route.ts`
- [ ] Update remaining routes that insert without `orgId` (tool-costs, slack-config, actions)
- [ ] `lib/proxy-invalidate.ts`: include `orgId` in invalidation request body
- [ ] Update dashboard tests

### Increment 4: Feature Gating + NOT NULL (~1 day)

- [ ] Add `FEATURE_TIERS` map to `lib/stripe/tiers.ts`:
  ```typescript
  export const FEATURE_TIERS = {
    team_members: "enterprise",
    sso_saml: "enterprise",
    custom_roles: "enterprise",
    audit_log: "enterprise",
  } as const;
  ```
  (Note: all enforcement features are free on all tiers per pricing strategy. Only Enterprise-specific org features are gated.)
- [ ] Build `<FeatureGate>` component (banner/card/hidden modes)
- [ ] Build `<UpgradeCard>` component (reuse existing PricingCard patterns from billing page)
- [ ] Add upgrade CTAs where relevant (Members page → Enterprise, SSO → Enterprise)
- [ ] Verify all existing rows have `org_id` populated (SQL count check per table)
- [ ] Migration: `ALTER TABLE ... ALTER COLUMN org_id SET NOT NULL` on all 8 tables
- [ ] Add indexes: `CREATE INDEX ... ON ... (org_id, ...)` to match query patterns

### Phase 2 Review Gate

Before proceeding to Phase 3, verify:
- [ ] Every proxy request flows `orgId` through auth → context → cost event → budget check
- [ ] Every dashboard query scopes by `org_id`, not `user_id`
- [ ] Budget enforcement works (run smoke tests against live worker)
- [ ] `org_id` is NOT NULL on all tables
- [ ] Feature gating shows Enterprise CTA on gated features
- [ ] All tests pass (929+ root, 1208+ proxy, typecheck clean)
- [ ] **Re-read Phase 3 plan** — do assumptions still hold?

---

## Phase 3: Team Features

**Goal:** Multi-user collaboration. Users can create team orgs and invite members.

**Prerequisites (verify before starting):**
- Phase 2 complete — everything scoped by `org_id`
- Feature gating works (Members page shows upgrade CTA on free/pro)
- Org switcher shows personal org correctly

### Phase 3a: Proxy DO Keying for Team Orgs (~2-3 hours)

**Moved from Phase 2.** Personal orgs keep `idFromName(userId)`. Team orgs use `idFromName(orgId)`. The DO client needs to accept an org-aware identifier.

- [ ] `budget-do-client.ts`: change 6 call sites — use `orgId` when available, fall back to `userId` for personal orgs
- [ ] `budget-orchestrator.ts`: pass `ctx.auth.orgId` (for team orgs) or `ctx.auth.userId` (for personal orgs)
- [ ] `budget-do-lookup.ts`: change `WHERE user_id =` to `WHERE org_id =` in all 3 queries
- [ ] `routes/internal.ts`: add `orgId` to `InvalidationBody`, use for DO client calls
- [ ] `webhook-cache.ts`: cache key by `orgId` instead of `userId`
- [ ] `lib/proxy-invalidate.ts`: include `orgId` in invalidation request body
- [ ] Update proxy tests (~20-30 files)
- [ ] Run smoke tests after deploy

### Phase 3b: Org CRUD API (~1 day)

- [ ] `app/api/orgs/route.ts`: GET (list user's orgs), POST (create org)
- [ ] `app/api/orgs/[orgId]/route.ts`: GET, PATCH, DELETE
- [ ] `app/api/orgs/[orgId]/members/route.ts`: GET (list members)
- [ ] `app/api/orgs/[orgId]/members/[userId]/route.ts`: PATCH (role), DELETE (remove)
- [ ] Permission checks: verify requester is member of org, check role for write ops
- [ ] Tests for each route
- [ ] Zod validation on all inputs

### Phase 3c: Invitation Backend (~1 day)

- [ ] `lib/auth/invitation.ts`: token generation, SHA-256 hashing, verification
- [ ] `app/api/orgs/[orgId]/invitations/route.ts`: GET (list), POST (create)
- [ ] `app/api/orgs/[orgId]/invitations/[id]/route.ts`: DELETE (revoke)
- [ ] `app/api/invite/accept/route.ts`: POST (accept via token hash lookup)
- [ ] Email sending (Resend/SendGrid/Supabase) for invitation emails
- [ ] Tests: create, accept, expire, revoke, already-member, invalid token

### Phase 3d: Member Management UI (~1-2 days)

- [ ] `<InviteForm>` — email + role selector + invite button
- [ ] `<MemberTable>` — avatar, name, email, role badge, joined date, actions dropdown
- [ ] `<PendingInvitesTable>` — email, role, sent date, status badge, resend/revoke actions
- [ ] Empty states for both tables (follow existing `EmptyKeys` pattern)
- [ ] Loading skeletons
- [ ] Wire up to API routes via TanStack Query hooks
- [ ] `AlertDialog` for destructive actions (remove member, revoke invitation)

### Phase 3e: Invitation Acceptance Page (~1 day)

- [ ] `/invite/[token]/page.tsx` — outside dashboard layout
- [ ] States: valid+logged-in, valid+not-logged-in, expired, already-member, error
- [ ] Accept action: call API → create membership → set `ns-active-org` cookie → redirect to dashboard
- [ ] Not-logged-in path: redirect to signup with `redirect` param back to invitation

### Phase 3f: Create Org + Multi-Org Switcher (~1 day)

- [ ] Create Organization dialog (from org switcher dropdown)
- [ ] Name + auto-generated slug + create button
- [ ] On success: switch to new org (update cookie, refresh)
- [ ] Org switcher now lists multiple orgs with role badges and active checkmark
- [ ] Settings > General page: org name, avatar editing (for team orgs)

### Phase 3 Review Gate

Before proceeding to Phase 4, verify:
- [ ] Can create a team org, invite members, accept invitations end-to-end
- [ ] Org switcher works for multi-org users
- [ ] Member table shows correct roles, invite/remove works
- [ ] Invitation emails send and links work
- [ ] Personal org is unaffected (solo user experience unchanged)
- [ ] All tests pass
- [ ] **Re-read Phase 4 plan** — do assumptions still hold?

---

## Phase 4: Role Enforcement + Billing Migration

**Goal:** Enforce permissions. Move billing from per-user to per-org.

**Prerequisites (verify before starting):**
- Phase 3 complete — team orgs exist, members can be invited
- Roles are assigned but not yet enforced (everyone can do everything)

### Phase 4a: Permission Middleware (~1 day)

- [ ] `lib/auth/permissions.ts`: `requireRole('member' | 'admin' | 'owner')` middleware
- [ ] Apply to all dashboard API routes (budget CRUD: admin, key revocation: admin, billing: owner, etc.)
- [ ] Tests: member tries admin action → 403, admin tries owner action → 403
- [ ] Role-based UI rendering: `useOrgRole()` hook

### Phase 4b: Frontend Role Enforcement (~1 day)

- [ ] Hide admin actions from members (invite, budget management, key revocation)
- [ ] Billing section restricted to owners
- [ ] Settings > General: danger zone (delete org) restricted to owners
- [ ] Disabled state for actions user can't perform (with tooltip explaining why)

### Phase 4c: Billing Migration (~2-3 days)

- [ ] `subscriptions` table: `user_id` → `org_id` (migration + backfill from personal orgs)
- [ ] Stripe Customer: create per-org instead of per-user
- [ ] `getTierForOrg(orgId)` replaces `getTierForUser(userId)`
- [ ] Stripe checkout route: scope to org
- [ ] Stripe webhook: handle org-scoped subscriptions
- [ ] Stripe portal: scope to org
- [ ] Pricing page: personal (free) vs team (paid plans)
- [ ] Test: upgrade personal → still works. Create team org → new Stripe Customer.

### Phase 4 Review Gate

- [ ] Permissions enforced — member can't do admin things, admin can't do owner things
- [ ] Billing works per-org — Stripe Customer per org, subscription per org
- [ ] Upgrade flow works end-to-end (free → pro, personal → team)
- [ ] All tests pass
- [ ] Platform is ready for multi-user teams

---

## Phase 5: Enterprise (demand-driven, not pre-built)

**Trigger:** Enterprise customer requests it.

### Phase 5a: Additional Roles
- Viewer role (read-only dashboard access)
- Billing role (invoice management only)

### Phase 5b: Custom Roles + Permissions
- `org_roles` and `org_permissions` tables
- Granular permission strings (`org:budgets:write`, `org:members:invite`)
- Role editor UI

### Phase 5c: SSO/SAML
- SSO per org (WorkOS integration or custom)
- Domain-verified auto-join
- Enforce SSO for org members

### Phase 5d: Audit Log
- `org_audit_log` table: who changed what, when
- Audit log page in settings
- Retention policy

---

## Effort Summary

| Phase | Estimated | Dependencies |
|---|---|---|
| 0a: Schema columns | ~15 min | None |
| 0b: Tier-driven limits | ~30 min | None |
| 0c: PREFIX_MAP | ~5 min | None |
| 0d: Settings restructure | ~2-3 hours | None (frontend-only) |
| **Phase 0 total** | **~1 day** | |
| Increment 1: Org tables + validation (1a+1b) | ~30 min | Phase 0 |
| Increment 2: Personal org + session context (1c) | ~45 min | Increment 1 |
| Increment 3: Populate org_id on writes (1d) | ~30 min | Increment 2 |
| ~~1e: Frontend org switcher~~ | ~~deferred~~ | Moved to Phase 3 |
| **Phase 1 total** | **~2 hours** | Phase 0 |
| Increment 1: Proxy auth orgId | ~1 hour | Phase 1 |
| Increment 2: Proxy cost-logger | ~30 min | Increment 1 |
| ~~Increment 3: Proxy DO keying + cache~~ | ~~moved~~ | Moved to Phase 3 |
| Increment 3: Dashboard query migration | ~2-3 days | Phase 1, Increment 1 |
| Increment 4: Feature gating + NOT NULL | ~1 day | Increment 3 |
| **Phase 2 total** | **~3-4 days** | Phase 1 |
| 3a: Proxy DO keying for team orgs | ~2-3 hours | Phase 2 |
| 3b: Org CRUD API | ~1 day | Phase 2 |
| 3c: Invitation backend | ~1 day | Phase 3b |
| 3d: Member management UI | ~1-2 days | Phase 3b, 3c |
| 3e: Invitation acceptance page | ~1 day | Phase 3c |
| 3f: Create org + multi-org switcher | ~1 day | Phase 3b |
| **Phase 3 total** | **~6-8 days** | Phase 2 |
| 4a: Permission middleware | ~1 day | Phase 3 |
| 4b: Frontend role enforcement | ~1 day | Phase 4a |
| 4c: Billing migration | ~2-3 days | Phase 4a |
| **Phase 4 total** | **~4-6 days** | Phase 3 |
| **Grand total** | **~16-24 days** | |

---

## Changelog

| Date | Change |
|---|---|
| 2026-03-24 | Initial plan created from architecture + UI/UX research |
| 2026-03-24 | Phase 0 completed (all 4 sub-phases shipped) |
| 2026-03-24 | Phase 1 arch review: cookie-embedded org context, partial unique index for race safety, deferred org switcher UI to Phase 3, removed created_by (already skipped), removed text→uuid migration (already done). Scope reduced from 2-3 days to ~2 hours across 3 increments. |
| 2026-03-24 | Phase 0 completed — all 4 sub-phases shipped + pricing tier restructure (Free/Pro/Enterprise) |
| 2026-03-24 | Phase 1 completed — 3 increments shipped, audited 3 times, all findings resolved |
| 2026-03-24 | Phase 2 arch review: broken into 5 increments. Verified 22 dashboard routes, 16 proxy test files, 6 DO call sites need updating. Feature gating scoped to Enterprise-only features per pricing strategy. |
| 2026-03-24 | Phase 2 arch review (cont): DO keying change moved to Phase 3 — personal orgs keep idFromName(userId), team orgs get idFromName(orgId) when created. Phase 2 reduced from ~4-6 days to ~3-4 days. Phase 3 grows by ~2-3 hours. |
