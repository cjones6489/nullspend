# Org & Team Implementation Plan

**Created:** 2026-03-24
**Status:** Phase 0 Ready
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

## Phase 0: Schema Prep + Settings Restructure

**Goal:** Add future-proofing columns while tables are empty. Restructure settings for sub-page navigation. No behavioral changes.

**Prerequisites:** None (this is the starting phase).

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

## Phase 1: Org Tables + Foundation

**Goal:** Create org infrastructure. Every user gets a personal org. No scoping changes yet — `org_id` is populated but not used for queries.

**Prerequisites (verify before starting):**
- Phase 0 complete — all `org_id` columns exist
- Schema types are correct (`org_id` is `uuid` on all tables)
- Settings restructure is done (members page placeholder exists)

### Phase 1a: Org Schema + Tables (~1 hour)

- [ ] Add `organizations`, `orgMemberships`, `orgInvitations` to Drizzle schema
- [ ] Use `uuid` PK for `organizations.id` (matches codebase convention)
- [ ] Use `.$type<>()` annotations for role and status columns
- [ ] Create migration SQL for 3 tables + indexes
- [ ] Apply migration via Supabase MCP
- [ ] Migrate existing `org_id` columns from `text` to `uuid` (zero rows, safe)
- [ ] Verify typecheck and tests pass

### Phase 1b: Validation Schemas (~30 min)

- [ ] Create `lib/validations/orgs.ts` with Zod schemas:
  - `createOrgSchema` (name, slug)
  - `updateOrgSchema` (name, slug)
  - `inviteMemberSchema` (email, role)
  - `changeRoleSchema` (role)
- [ ] Follow existing patterns in `lib/validations/`

### Phase 1c: Personal Org Lazy-Init (~1-2 hours)

- [ ] Implement `ensurePersonalOrg(userId)` in `lib/auth/session.ts`
  - Check for existing personal org via `org_memberships` + `organizations.isPersonal`
  - If none, create org + owner membership in transaction
  - Cache result in-memory for the request lifecycle
- [ ] Extend `resolveSessionContext()` to return `{ userId, orgId, role }`
  - `orgId` from personal org (for now)
  - `role` always `"owner"` (personal org)
- [ ] Add tests for `ensurePersonalOrg` (new org created, existing org returned, concurrent-safe)

### Phase 1d: Populate `created_by` + `org_id` on Writes (~1 hour)

- [ ] `app/api/keys/route.ts`: Set `createdBy: userId` on INSERT
- [ ] `app/api/budgets/route.ts`: Set `createdBy: userId` on INSERT
- [ ] `app/api/webhooks/route.ts`: Set `createdBy: userId` on INSERT
- [ ] Set `orgId` on new rows where `resolveSessionContext()` is available (dashboard routes)
- [ ] Proxy cost-logger: NOT yet — `org_id` populated in Phase 2 when proxy auth returns it

### Phase 1e: Frontend Org Switcher (non-functional) (~2 hours)

- [ ] Build `<OrgSwitcher>` component (DropdownMenu-based)
- [ ] Add to sidebar header (replace Shield icon row)
- [ ] Shows single personal org (reads from `resolveSessionContext()`)
- [ ] Build `ns-active-org` cookie server action
- [ ] Build inline utilities: `OrgAvatar`, `RoleBadge`, `PlanBadge`
- [ ] No behavioral change — personal org only, same data

### Phase 1 Review Gate

Before proceeding to Phase 2, verify:
- [ ] `organizations`, `org_memberships`, `org_invitations` tables exist in DB
- [ ] New user signup creates a personal org (test the lazy-init path)
- [ ] `resolveSessionContext()` returns `{ userId, orgId, role }` correctly
- [ ] Org switcher renders in sidebar with personal org
- [ ] New API key/budget/webhook writes include `created_by` and `org_id`
- [ ] All tests pass
- [ ] **Re-read Phase 2 plan** — do assumptions still hold? Any adjustments needed?

---

## Phase 2: Org-Scoped Dashboard

**Goal:** Switch all queries from `user_id` to `org_id`. This is the largest and most impactful phase.

**Prerequisites (verify before starting):**
- Phase 1 complete — personal orgs auto-created, `resolveSessionContext()` works
- Existing rows have `org_id` populated (or backfill migration run)
- `org_id` columns are correctly typed as `uuid`

### Phase 2a: Proxy Auth — Add `orgId` (~2 hours)

- [ ] `ApiKeyIdentity`: add `orgId: string`
- [ ] Auth SQL: add `k.org_id` to SELECT, map to result
- [ ] `AuthResult`: add `orgId: string`
- [ ] `RequestContext`: inherits from `AuthResult` (automatic)
- [ ] Update all 18+ proxy test `makeCtx` helpers with `orgId`
- [ ] Verify proxy typecheck and tests pass

### Phase 2b: Proxy Cost-Logger + Enrichment (~1 hour)

- [ ] `cost-logger.ts`: add `org_id` to both INSERT paths (single + batch)
- [ ] `EnrichmentFields`: no change needed — `orgId` flows from auth via cost event type
- [ ] Verify cost events are written with `org_id` in smoke tests

### Phase 2c: Proxy DO Keying (~2-3 hours, highest risk)

- [ ] `budget-do-client.ts`: change 6 call sites from `idFromName(userId)` to `idFromName(orgId)`
- [ ] `budget-orchestrator.ts`: pass `ctx.auth.orgId` instead of `ctx.auth.userId`
- [ ] `budget-do-lookup.ts`: change `WHERE user_id =` to `WHERE org_id =` (3 queries)
- [ ] `routes/internal.ts`: invalidation body — add `orgId`, keep `userId` for auth cache
- [ ] `webhook-cache.ts`: cache key by `orgId` instead of `userId`
- [ ] Update proxy tests for DO keying changes (~20-30 test files)
- [ ] **Test extensively** — this is the highest-risk change (budget enforcement path)

### Phase 2d: Dashboard Query Migration (~2-3 days)

- [ ] Update `resolveSessionContext()` callers (migrate from `resolveSessionUserId()`)
  - Start with a few routes, verify pattern works, then batch the rest
  - 42+ route files to update
- [ ] `aggregate-cost-events.ts`: `baseConditions` uses `orgId` instead of `userId`
- [ ] Each dashboard API route: `const { orgId } = await resolveSessionContext()` then `WHERE org_id = orgId`
- [ ] Update TanStack Query hooks to pass `orgId`
- [ ] Update dashboard tests

### Phase 2e: Feature Gating Infrastructure (~1 day)

- [ ] Add `FEATURE_TIERS` map to `lib/stripe/tiers.ts`
- [ ] Build `<FeatureGate>` component (banner/card/hidden modes)
- [ ] Build `<UpgradeCard>` (reuse existing PricingCard patterns)
- [ ] Add upgrade CTAs at feature limits (budgets, webhooks, velocity)
- [ ] Home page banner: "Working with a team? [Create an Organization]"

### Phase 2f: Make `org_id` NOT NULL (~30 min)

- [ ] Verify all existing rows have `org_id` populated (SQL count check)
- [ ] Migration: `ALTER TABLE ... ALTER COLUMN org_id SET NOT NULL` on all tables
- [ ] Add indexes: `CREATE INDEX ... ON ... (org_id, ...)` to match query patterns

### Phase 2 Review Gate

Before proceeding to Phase 3, verify:
- [ ] Every proxy request flows `orgId` through auth → context → cost event → budget check
- [ ] Every dashboard query scopes by `org_id`, not `user_id`
- [ ] Budget enforcement works (run smoke tests against live worker)
- [ ] `org_id` is NOT NULL on all tables
- [ ] Feature gating works (free user sees upgrade CTA on gated features)
- [ ] All tests pass
- [ ] **Re-read Phase 3 plan** — do assumptions still hold?

---

## Phase 3: Team Features

**Goal:** Multi-user collaboration. Users can create team orgs and invite members.

**Prerequisites (verify before starting):**
- Phase 2 complete — everything scoped by `org_id`
- Feature gating works (Members page shows upgrade CTA on free/pro)
- Org switcher shows personal org correctly

### Phase 3a: Org CRUD API (~1 day)

- [ ] `app/api/orgs/route.ts`: GET (list user's orgs), POST (create org)
- [ ] `app/api/orgs/[orgId]/route.ts`: GET, PATCH, DELETE
- [ ] `app/api/orgs/[orgId]/members/route.ts`: GET (list members)
- [ ] `app/api/orgs/[orgId]/members/[userId]/route.ts`: PATCH (role), DELETE (remove)
- [ ] Permission checks: verify requester is member of org, check role for write ops
- [ ] Tests for each route
- [ ] Zod validation on all inputs

### Phase 3b: Invitation Backend (~1 day)

- [ ] `lib/auth/invitation.ts`: token generation, SHA-256 hashing, verification
- [ ] `app/api/orgs/[orgId]/invitations/route.ts`: GET (list), POST (create)
- [ ] `app/api/orgs/[orgId]/invitations/[id]/route.ts`: DELETE (revoke)
- [ ] `app/api/invite/accept/route.ts`: POST (accept via token hash lookup)
- [ ] Email sending (Resend/SendGrid/Supabase) for invitation emails
- [ ] Tests: create, accept, expire, revoke, already-member, invalid token

### Phase 3c: Member Management UI (~1-2 days)

- [ ] `<InviteForm>` — email + role selector + invite button
- [ ] `<MemberTable>` — avatar, name, email, role badge, joined date, actions dropdown
- [ ] `<PendingInvitesTable>` — email, role, sent date, status badge, resend/revoke actions
- [ ] Empty states for both tables (follow existing `EmptyKeys` pattern)
- [ ] Loading skeletons
- [ ] Wire up to API routes via TanStack Query hooks
- [ ] `AlertDialog` for destructive actions (remove member, revoke invitation)

### Phase 3d: Invitation Acceptance Page (~1 day)

- [ ] `/invite/[token]/page.tsx` — outside dashboard layout
- [ ] States: valid+logged-in, valid+not-logged-in, expired, already-member, error
- [ ] Accept action: call API → create membership → set `ns-active-org` cookie → redirect to dashboard
- [ ] Not-logged-in path: redirect to signup with `redirect` param back to invitation

### Phase 3e: Create Org + Multi-Org Switcher (~1 day)

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
| 1a: Org tables | ~1 hour | Phase 0a |
| 1b: Validation schemas | ~30 min | Phase 1a |
| 1c: Personal org lazy-init | ~1-2 hours | Phase 1a |
| 1d: Populate created_by + org_id | ~1 hour | Phase 1c |
| 1e: Frontend org switcher | ~2 hours | Phase 1c |
| **Phase 1 total** | **~2-3 days** | Phase 0 |
| 2a: Proxy auth orgId | ~2 hours | Phase 1 |
| 2b: Proxy cost-logger | ~1 hour | Phase 2a |
| 2c: Proxy DO keying | ~2-3 hours | Phase 2a |
| 2d: Dashboard query migration | ~2-3 days | Phase 1c |
| 2e: Feature gating | ~1 day | Phase 2d |
| 2f: org_id NOT NULL | ~30 min | Phase 2d |
| **Phase 2 total** | **~4-6 days** | Phase 1 |
| 3a: Org CRUD API | ~1 day | Phase 2 |
| 3b: Invitation backend | ~1 day | Phase 3a |
| 3c: Member management UI | ~1-2 days | Phase 3a, 3b |
| 3d: Invitation acceptance page | ~1 day | Phase 3b |
| 3e: Create org + multi-org switcher | ~1 day | Phase 3a |
| **Phase 3 total** | **~5-7 days** | Phase 2 |
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
