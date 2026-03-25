# Org & Team Implementation Plan

**Created:** 2026-03-24
**Status:** Phase 2 Increments 1-3 Complete, Increment 4 Ready
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

### Increment 1: Proxy Auth — Add `orgId` — COMPLETE (2026-03-24)

- [x] `apps/proxy/src/lib/api-key-auth.ts`: `orgId: string | null` in `ApiKeyIdentity`, `k.org_id` in auth SQL
- [x] `apps/proxy/src/lib/auth.ts`: `orgId: string | null` in `AuthResult`, passed through
- [x] Updated 16 proxy test `makeCtx` helpers
- [x] `pnpm proxy:test` — 1210 tests passing

### Increment 2: Proxy Cost-Logger — COMPLETE (2026-03-24)

- [x] `apps/proxy/src/lib/cost-logger.ts`: `org_id` in single + batch INSERT
- [x] `EnrichmentFields` includes `orgId: string | null`
- [x] OpenAI, Anthropic, MCP routes all pass `orgId: ctx.auth.orgId` in enrichment

### ~~Increment 3: Proxy DO Keying + Cache~~ — MOVED TO PHASE 3

**Decision (Phase 2 arch review):** DO keying stays `idFromName(userId)` for personal orgs. Changing to `idFromName(orgId)` would orphan all existing DO state (budgets, reservations, velocity tracking) and require a complex data migration with zero benefit — personal orgId maps 1:1 to userId. The DO keying change is only needed when team orgs exist (Phase 3), where multiple users share one org-keyed DO. At that point, the first budget sync for a new team org naturally creates the DO via `idFromName(orgId)`.

Items moved to Phase 3:
- `budget-do-client.ts`: `idFromName(userId)` → `idFromName(orgId)` (6 call sites)
- `budget-do-lookup.ts`: `WHERE user_id =` → `WHERE org_id =` (3 queries)
- `budget-orchestrator.ts`: pass `orgId` to DO client
- `routes/internal.ts`: add `orgId` to invalidation body
- `webhook-cache.ts`: cache key by `orgId`
- Proxy test updates for DO/webhook mocks

### Increment 3: Dashboard Query Migration — COMPLETE (2026-03-24)

**Backfill:** 124 personal orgs created, all rows across 8 tables backfilled with `org_id`. 3 orphan actions (null `owner_user_id`) remain — handled in Increment 4 NOT NULL migration.

**Route migration (27 routes migrated):**
- [x] All GET/POST/PATCH/DELETE handlers switched from `resolveSessionUserId` to `resolveSessionContext`
- [x] All data-scoping queries switched from `eq(table.userId, userId)` to `eq(table.orgId, orgId)`
- [x] Aggregation functions (9) use `orgId` parameter
- [x] `listCostEvents`, `listActions`, `getAction`, `getCostEventsByActionId` — all use `orgId`
- [x] `approveAction`, `rejectAction`, `resolveAction`, `expireAction`, `bulkExpireActions`, `markResult` — all use `orgId`
- [x] `fetchWebhookEndpoints`, `dispatchWebhookEvent` — query by `orgId`
- [x] `sendSlackNotification`, `sendSlackTestNotification` — query by `orgId`
- [x] `assertApiKeyOrSession` returns `DualAuthResult { userId: string, orgId: string }` (non-nullable orgId; null returns 403)
- [x] `ApiKeyIdentity` and `ApiKeyAuthContext` include `orgId: string | null`
- [x] `insertCostEvent`/`insertCostEventsBatch` write `orgId` via `InsertContext`
- [x] `createAction` accepts and writes `orgId`
- [x] `tool-costs/discover` writes `orgId` on INSERT and updates it on conflict
- [x] `slack/config` upsert updates `orgId` on conflict
- [x] `budgets/status` filters by `orgId` when available
- [x] Billing routes (Stripe) keep `userId` for subscription queries — per-user until Phase 4
- [x] Budget entity ownership verification keeps `userId` (intentional — verifies user owns the API key)

**Known Phase 3 items (not in scope):**
- Proxy webhook cache keyed by `userId` (works for personal orgs)
- DO keying by `userId` (works for personal orgs)
- Dev fallback API keys have null orgId — 3 dual-auth routes return 403 (session auth works for all routes)

**Test results:** 929 root tests + 1210 proxy tests = 2139 total, 0 TypeScript errors, 0 migration lint errors

### ~~Increment 4: Feature Gating~~ — MOVED TO PHASE 3

**Decision (Phase 2 arch review):** No features to gate until team orgs exist. `FEATURE_TIERS` map, `<FeatureGate>` component, and `<UpgradeCard>` component deferred to Phase 3 where they wrap actual features (Members page, org creation, invitations). Building gate UI for features that don't exist is premature abstraction.

Items moved to Phase 3:
- `FEATURE_TIERS` map in `lib/stripe/tiers.ts`
- `<FeatureGate>` component (banner/card/hidden modes)
- `<UpgradeCard>` component
- Upgrade CTAs on gated pages

### Increment 4: Make `org_id` NOT NULL + Indexes — COMPLETE (2026-03-24)

- [x] Verified 0 null org_id rows across all 8 tables
- [x] Deleted 3 orphan actions (null owner_user_id, test artifacts from March 8)
- [x] Migration `0042_org_id_not_null.sql`: SET NOT NULL on all 8 tables + 7 indexes
- [x] Updated `upsertSubscription` to look up personal org for orgId (Stripe webhook path has no session)
- [x] All API-key-authenticated routes now guard null orgId with 403 (actions POST, cost-events POST/batch, tool-costs discover, actions/[id]/result)
- [x] Schema `.notNull()` on all 8 orgId columns + index definitions in Drizzle
- [x] 929 root tests + 1210 proxy tests passing, 0 TypeScript errors

### Phase 2 Review Gate — COMPLETE

- [x] Proxy auth returns `orgId` on every request
- [x] Proxy cost events include `org_id`
- [x] Every dashboard query scopes by `org_id` (billing uses `userId` for Stripe, but subscription table stores `orgId`)
- [x] Budget enforcement still works (DO keying unchanged — uses `userId`)
- [x] `org_id` is NOT NULL on all 8 tables (+ org_memberships, org_invitations = 10 total)
- [x] Zero rows with NULL `org_id` in any table
- [x] All tests pass (929 root, 1210 proxy, typecheck clean)
- [ ] **Re-read Phase 3 plan** — do assumptions still hold?

---

## Phase 3: Team Features + Feature Gating

**Goal:** Multi-user collaboration. Users can create team orgs and invite members. Feature gating enforces tier limits.

**Prerequisites (verify before starting):**
- [x] Phase 2 complete — everything scoped by `org_id`, NOT NULL enforced
- [ ] Re-read Phase 3 plan — do assumptions still hold?

**Industry research (2026-03-24):**
Studied GitHub, Vercel, Supabase, Clerk, WorkOS, Linear, Stripe, Datadog, PostHog. Key findings:
- **Free orgs drive adoption:** GitHub, Clerk, Linear, PostHog all allow free team creation. Only Vercel gates team creation behind Pro. Recommendation: allow free users to create team orgs with limited members (3).
- **Viewer seats should be free:** Vercel charges only "deploying seats." Finance/management stakeholders viewing dashboards shouldn't count toward seat limits.
- **Add `viewer` role:** Every platform (Vercel, Linear, Datadog, Stripe) has a read-only role. NullSpend currently has `owner | admin | member` — add `viewer`.
- **Billing on org, not user:** GitHub, Supabase, Vercel all bill at the org level. Personal orgs get their own subscription.
- **Resources stay with org when user leaves:** Universal pattern (WorkOS, GitHub, Supabase). NullSpend already implements this via `orgId` scoping.
- **Graceful downgrade:** Never delete config on downgrade. Block new creation beyond limits. Show persistent upgrade banner. Supabase pauses, GitHub preserves but stops enforcing.
- **SSO/SAML = enterprise only:** Universal. Use WorkOS or Clerk's enterprise add-on when needed.

**Tier matrix (revised from research):**

| Feature | Free | Pro ($49/mo) | Enterprise |
|---------|------|-------------|------------|
| Team members | 3 | Unlimited | Unlimited |
| Viewer seats | Unlimited | Unlimited | Unlimited |
| Budgets | 3 | Unlimited | Unlimited |
| API keys | 10 | Unlimited | Unlimited |
| Webhook endpoints | 2 | 25 | Unlimited |
| Data retention | 30 days | 90 days | Unlimited |
| Spend cap | $5K | $50K | Unlimited |
| Org creation | Yes | Yes | Yes |
| Roles | owner/admin/member/viewer | owner/admin/member/viewer | Custom RBAC |
| Invite method | Email only | Email + link | Email + link + domain auto-join |
| Audit log | Last 10 events | Full | Full + export |
| SSO/SAML | No | No | Yes |

### Phase 3a: Tier + Role Updates (~1 hour)

Schema and config changes before building features.

- [ ] Add `viewer` role to `orgMemberships.role` type and `ORG_ROLES` constant
- [ ] Update `TIERS.free.maxTeamMembers` from `1` to `3`
- [ ] Viewer seats exempt from `maxTeamMembers` count (don't count viewers in limit checks)
- [ ] Update `ASSIGNABLE_ROLES` to include `viewer`
- [ ] Tests for viewer role validation

### Phase 3b: Feature Gating Infrastructure (~1 day)

Three-layer gating: API-level enforcement, middleware-level context, component-level UX.

- [ ] `lib/stripe/feature-gate.ts`: `assertTierLimit(orgId, limitKey)` — server-side enforcement helper
  - Returns structured error: `{ code: "tier_limit_exceeded", message, upgradeUrl }`
  - Checks `TIERS[tier][limitKey]` against current count
- [ ] `<TierGate requiredTier="pro" feature="unlimited-budgets">` — client-side wrapper component
  - Renders children when tier is sufficient
  - Renders inline `<UpgradeCard>` when tier is insufficient (shows what they unlock, not just a lock icon)
- [ ] `<UpgradeCard feature tier currentTier>` — contextual upgrade prompt
- [ ] Tier context provider: resolve tier in server layout, inject via React context
- [ ] `useOrgTier()` hook for client components
- [ ] Tests for each component and the server-side helper

### Phase 3c: Proxy DO Keying for Team Orgs (~2-3 hours)

**Moved from Phase 2.** Personal orgs keep `idFromName(userId)`. Team orgs use `idFromName(orgId)`.

- [ ] `budget-do-client.ts`: 6 call sites — use `orgId` when available, fall back to `userId` for personal orgs
- [ ] `budget-orchestrator.ts`: pass `ctx.auth.orgId` or `ctx.auth.userId`
- [ ] `budget-do-lookup.ts`: `WHERE org_id =` instead of `WHERE user_id =` (3 queries)
- [ ] `routes/internal.ts`: add `orgId` to `InvalidationBody`
- [ ] `webhook-cache.ts`: cache key by `orgId` instead of `userId`
- [ ] `lib/proxy-invalidate.ts`: include `orgId` in invalidation request body
- [ ] Update proxy tests (~20-30 files)
- [ ] Run smoke tests after deploy

### Phase 3d: Org CRUD API (~1 day)

- [ ] `app/api/orgs/route.ts`: GET (list user's orgs), POST (create org)
  - POST enforces `maxTeamMembers` — free users can create orgs (industry standard)
  - POST creates org + owner membership in transaction
- [ ] `app/api/orgs/[orgId]/route.ts`: GET, PATCH (name, slug, logo), DELETE (owner only, cascades)
- [ ] `app/api/orgs/[orgId]/members/route.ts`: GET (list members with roles)
- [ ] `app/api/orgs/[orgId]/members/[userId]/route.ts`: PATCH (role), DELETE (remove)
  - Cannot remove the owner; owner transfer is a separate action
  - Cannot change own role (prevent accidental de-admin)
- [ ] Membership verification middleware: check requester is member of target org
- [ ] Role checks: member management requires `admin` or `owner`
- [ ] Tests for each route + permission edge cases

### Phase 3e: Invitation Backend (~1 day)

- [ ] `lib/auth/invitation.ts`: token generation (crypto.randomBytes), SHA-256 hashing, verification
- [ ] `app/api/orgs/[orgId]/invitations/route.ts`: GET (list), POST (create — requires admin+)
  - POST enforces `maxTeamMembers` (viewer invites exempt from count)
  - 7-day token expiry (matches schema `expiresAt`)
  - Prevents duplicate invitations to same email
- [ ] `app/api/orgs/[orgId]/invitations/[id]/route.ts`: DELETE (revoke)
- [ ] `app/api/invite/accept/route.ts`: POST (accept via token hash lookup)
  - Creates `orgMembership` with invited role
  - Sets `ns-active-org` cookie to new org
  - Returns redirect URL
- [ ] Email sending (Resend) for invitation emails
- [ ] Tests: create, accept, expire, revoke, already-member, invalid token, duplicate invite

### Phase 3f: Member Management UI (~1-2 days)

- [ ] `<InviteForm>` — email + role selector (admin/member/viewer) + invite button
- [ ] `<MemberTable>` — avatar, name, email, role badge, joined date, actions dropdown (change role, remove)
- [ ] `<PendingInvitesTable>` — email, role, sent date, expiry, resend/revoke actions
- [ ] Empty states for both tables
- [ ] Loading skeletons
- [ ] Wire up to API routes via TanStack Query hooks
- [ ] `AlertDialog` for destructive actions (remove member, revoke invitation)
- [ ] `/app/settings/members/page.tsx` — members page with invite form + both tables

### Phase 3g: Invitation Acceptance Page (~1 day)

- [ ] `/invite/[token]/page.tsx` — outside dashboard layout
- [ ] States: valid+logged-in → accept, valid+not-logged-in → signup redirect, expired, already-member, error
- [ ] Accept: call API → create membership → set cookie → redirect to dashboard
- [ ] Not-logged-in: redirect to signup with `redirect` param back to invitation

### Phase 3h: Create Org + Multi-Org Switcher (~1 day)

- [ ] `<OrgSwitcher>` in sidebar header (top-left, matches GitHub/Vercel/Linear placement)
  - Current org: avatar + name + plan badge
  - Dropdown: other orgs with role badges, personal org, "Create organization" action
- [ ] Create Organization dialog: name + auto-slug + create
- [ ] On switch: update `ns-active-org` cookie → full page refresh
- [ ] `/app/settings/general/page.tsx`: org name, avatar, slug (team orgs only, personal org is read-only)

### Phase 3 Review Gate

Before proceeding to Phase 4, verify:
- [ ] Feature gating blocks creation beyond tier limits with contextual upgrade prompts
- [ ] Can create a team org, invite members, accept invitations end-to-end
- [ ] Viewer role works — read-only access, doesn't count toward seat limit
- [ ] Org switcher works for multi-org users (personal + team orgs)
- [ ] Member table shows correct roles, invite/remove/role-change works
- [ ] Invitation emails send and acceptance links work
- [ ] Personal org is unaffected (solo user experience unchanged)
- [ ] Downgrade behavior: existing resources preserved, new creation blocked beyond limits
- [ ] All tests pass
- [ ] **Re-read Phase 4 plan** — do assumptions still hold?

---

## Phase 4: Permission Enforcement + Billing Migration

**Goal:** Enforce role-based permissions. Move billing from per-user to per-org.

**Prerequisites (verify before starting):**
- Phase 3 complete — team orgs exist, members can be invited, feature gating works
- Roles are assigned but not yet enforced at API level (everyone with org access can do everything)

### Phase 4a: Permission Middleware (~1 day)

- [ ] `lib/auth/permissions.ts`: `requireRole('viewer' | 'member' | 'admin' | 'owner')` middleware
  - `viewer`: read-only access (GET routes only)
  - `member`: create own resources (budgets, keys), view shared dashboards
  - `admin`: manage all resources, invite members, change roles
  - `owner`: billing, delete org, transfer ownership
- [ ] Apply to all dashboard API routes with appropriate minimum role
- [ ] Tests: viewer tries write → 403, member tries admin action → 403, admin tries owner action → 403
- [ ] `useOrgRole()` hook for client-side role checks

### Phase 4b: Frontend Role Enforcement (~1 day)

- [ ] Hide admin actions from members/viewers (invite, budget management, key revocation)
- [ ] Billing section restricted to owners (show read-only plan info to others)
- [ ] Settings > General danger zone (delete org) restricted to owners
- [ ] Disabled state with tooltips for permission-denied actions
- [ ] Viewer sees dashboards but all create/edit buttons hidden

### Phase 4c: Billing Migration (~2-3 days)

- [ ] Subscription scoped to org: `getTierForOrg(orgId)` replaces `getTierForUser(userId)`
- [ ] Stripe Customer per org (personal orgs get their own Stripe Customer)
- [ ] Stripe checkout route: scope to org, owner-only
- [ ] Stripe webhook: handle org-scoped subscriptions
- [ ] Stripe portal: scope to org, owner-only
- [ ] Pricing page: show plan for current org, upgrade/downgrade flows
- [ ] Tests: upgrade flow, multi-org billing, owner transfer doesn't break billing

### Phase 4 Review Gate

- [ ] Permissions enforced — viewer reads only, member can't admin, admin can't owner
- [ ] Billing works per-org — Stripe Customer per org, subscription per org
- [ ] Upgrade flow works end-to-end (free → pro)
- [ ] Downgrade preserves resources, blocks new creation beyond limits
- [ ] All tests pass
- [ ] Platform is ready for multi-user teams

---

## Phase 5: Enterprise (demand-driven, not pre-built)

**Trigger:** Enterprise customer requests it. Do not build speculatively.

**Industry patterns:** SSO = $125/connection/mo (WorkOS), custom RBAC = enterprise-only (Datadog, Clerk), audit logs = team+ tier (Supabase, GitHub), domain auto-join = enterprise (WorkOS, Clerk).

### Phase 5a: Audit Log
- `audit_events` table: actor, action, resource_type, resource_id, org_id, metadata, created_at
- Pro: full audit log access. Free: last 10 events only.
- Audit log page in org settings
- Retention policy (90 days Pro, unlimited Enterprise)

### Phase 5b: Custom Roles + Permissions
- `org_roles` and `org_permissions` tables
- Granular permission strings (`org:budgets:write`, `org:members:invite`) — Clerk's Feature > Permission model
- Role editor UI in org settings
- Gate to Enterprise tier

### Phase 5c: SSO/SAML
- Use WorkOS or Clerk Enterprise add-on (do not build SAML yourself)
- Per-connection pricing model
- Domain-verified auto-join for enterprise orgs
- Enforce SSO for org members
- Gate to Enterprise tier

### Phase 5d: Project-Scoped Roles
- Scope member access to specific budgets or API keys (not all org resources)
- Follows Supabase's project-scoped roles pattern
- Gate to Enterprise tier

---

## Effort Summary

| Phase | Estimated | Status |
|---|---|---|
| **Phase 0** | ~1 day | **COMPLETE** (2026-03-24) |
| **Phase 1** | ~2 hours | **COMPLETE** (2026-03-24) |
| **Phase 2** | ~3 days | **COMPLETE** (2026-03-24) |
| 3a: Tier + role updates | ~1 hour | Not started |
| 3b: Feature gating infrastructure | ~1 day | Not started |
| 3c: Proxy DO keying for team orgs | ~2-3 hours | Not started |
| 3d: Org CRUD API | ~1 day | Not started |
| 3e: Invitation backend | ~1 day | Not started |
| 3f: Member management UI | ~1-2 days | Not started |
| 3g: Invitation acceptance page | ~1 day | Not started |
| 3h: Create org + multi-org switcher | ~1 day | Not started |
| **Phase 3 total** | **~8-10 days** | |
| 4a: Permission middleware | ~1 day | Not started |
| 4b: Frontend role enforcement | ~1 day | Not started |
| 4c: Billing migration | ~2-3 days | Not started |
| **Phase 4 total** | **~4-6 days** | |
| **Phase 5** | Demand-driven | Not started |
| **Grand total (3-4)** | **~12-16 days** | |

---

## Changelog

| Date | Change |
|---|---|
| 2026-03-24 | Initial plan created from architecture + UI/UX research |
| 2026-03-24 | Phase 0 completed — all 4 sub-phases shipped + pricing tier restructure (Free/Pro/Enterprise) |
| 2026-03-24 | Phase 1 completed — 3 increments shipped, audited 3 times, all findings resolved |
| 2026-03-24 | Phase 2 arch review: DO keying + feature gating moved to Phase 3. Backfill-first strategy. |
| 2026-03-24 | Phase 2 completed — 4 increments shipped. 88 files changed, 3 audit passes, all 2139 tests passing. |
| 2026-03-24 | Phase 3-5 updated from industry research (GitHub, Vercel, Supabase, Clerk, WorkOS, Linear, Stripe, Datadog, PostHog). Key changes: free users can create team orgs (3 members), added `viewer` role (free seats), feature gating is now Phase 3b (not deferred), revised tier matrix, graceful downgrade strategy, audit log moved from Phase 5 to Pro feature. |
