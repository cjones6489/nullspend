# Org & Team Architecture Design

**Created:** 2026-03-24
**Updated:** 2026-03-24 (post-review corrections, unified phase guide in UI/UX companion doc)
**Status:** Research Complete, Implementation Not Started
**Author:** Claude (from research + brainstorm with @cjone)
**Frontend companion:** [`org-team-ui-ux.md`](org-team-ui-ux.md) — routing, org switcher, settings layout, member management, invitation flow, tier-gated features, component inventory
**Implementation plan:** [`org-team-implementation-plan.md`](org-team-implementation-plan.md) — unified phased guide with sub-phases, checklists, review gates, effort estimates

---

## Executive Summary

NullSpend's entire system currently scopes to `userId`. To support teams, enterprise plans, and multi-user collaboration, the architecture needs an **organization** layer. Industry research across Vercel, Supabase, Clerk, WorkOS, and GitHub shows strong consensus: **org as the universal scope**, with personal orgs as a degenerate single-member case.

Nullable `org_id` columns already exist on 3 core tables (`api_keys`, `budgets`, `cost_events`) but are completely unused — no code reads, writes, or indexes them. The proxy auth types (`AuthResult`, `ApiKeyIdentity`) do not include `orgId`. There are zero users, so every migration is free.

---

## Design Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | **Auto-create personal org on signup** | Uniform `org_id` scoping everywhere. No branching logic for "personal vs team." Solo UX unchanged — hide org management UI for `is_personal` orgs. Used by WorkOS, Slack, Linear, Notion. |
| 2 | **3 fixed roles: owner, admin, member** | Covers 95% of use cases. Custom roles add schema complexity. Can extend later with `org_roles` + `org_permissions` tables. Vercel starts with 2 roles on Pro. |
| 3 | **Stay on Supabase Auth** | Clerk's org features are appealing but: auth migration is high-risk, Clerk+Supabase integration was overhauled April 2025, and implementing orgs in Postgres is ~3 tables. |
| 4 | **API key scoped to org** | Keys are already the proxy auth mechanism. `org_id` on the key is zero-friction for agents. No new header needed. |
| 5 | **Billing per org** (Stripe Customer per org) | Universal across Vercel, Supabase, GitHub. Enables seat-based pricing. Personal orgs = free tier. |
| 6 | **Org context via httpOnly cookie for dashboard** | `ns-active-org` cookie set by server action on org switch. Persists across navigation (headers don't). Single middleware read vs rewriting every route URL. |
| 7 | **`organizations.id` as `uuid`** | Matches all existing entity PK convention (`uuid("id").defaultRandom().primaryKey()`). External API uses prefixed ID (`ns_org_{uuid}`) via existing `lib/ids/prefixed-id.ts`. |
| 8 | **Invitation tokens hashed** | Matches API key pattern (SHA-256 hash + prefix). Defense in depth. |

---

## Data Model

### Core Tables (Drizzle schema)

```typescript
export const organizations = pgTable("organizations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  isPersonal: boolean("is_personal").notNull().default(false),
  logoUrl: text("logo_url"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'`),
  createdBy: text("created_by").notNull(),           // user_id of creator
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const orgMemberships = pgTable("org_memberships", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),                 // Supabase auth.uid()
  role: text("role").$type<"owner" | "admin" | "member">().notNull().default("member"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("org_memberships_org_user_idx").on(table.orgId, table.userId),
  index("org_memberships_user_id_idx").on(table.userId),
]);

export const orgInvitations = pgTable("org_invitations", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role").$type<"owner" | "admin" | "member">().notNull().default("member"),
  invitedBy: text("invited_by").notNull(),           // user_id
  tokenHash: text("token_hash").notNull().unique(),  // SHA-256 of invite token
  tokenPrefix: text("token_prefix").notNull(),       // first 8 chars for display
  status: text("status").$type<"pending" | "accepted" | "declined" | "revoked" | "expired">().notNull().default("pending"),
  acceptedBy: text("accepted_by"),                   // user_id who accepted
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (table) => [
  index("org_invitations_org_id_idx").on(table.orgId),
  index("org_invitations_email_idx").on(table.email),
  uniqueIndex("org_invitations_pending_idx").on(table.orgId, table.email).where(sql`status = 'pending'`),
]);
```

### Role Permissions

| Permission | Owner | Admin | Member |
|---|---|---|---|
| View dashboards & cost events | Yes | Yes | Yes |
| Create/manage own API keys | Yes | Yes | Yes |
| View all API keys | Yes | Yes | Yes |
| Revoke any API key | Yes | Yes | No |
| Create/edit budgets | Yes | Yes | No |
| Manage webhooks | Yes | Yes | No |
| Manage Slack config | Yes | Yes | No |
| Invite members | Yes | Yes | No |
| Remove members | Yes | Yes | No |
| Change member roles | Yes | Yes (not to owner) | No |
| Manage billing/subscription | Yes | No | No |
| Delete organization | Yes | No | No |
| Transfer ownership | Yes | No | No |

---

## Current State (verified 2026-03-24)

### `org_id` column status

| Table | `org_id` exists? | Type | Proxy reads it? | Proxy writes it? | Dashboard queries by it? |
|---|---|---|---|---|---|
| `api_keys` | Yes (nullable) | `text` (needs migration to `uuid`) | **No** — auth SQL doesn't SELECT it | N/A | No |
| `budgets` | Yes (nullable) | `text` (needs migration to `uuid`) | **No** | N/A | No |
| `cost_events` | Yes (nullable) | `text` (needs migration to `uuid`) | **No** | **No** — cost-logger INSERT omits it | No |
| `webhook_endpoints` | **No** | — | — | — |
| `tool_costs` | **No** | — | — | — |
| `actions` | **No** | — | — | — |
| `slack_configs` | **No** | — | — | — |
| `subscriptions` | **No** | — | — | — |

### Proxy auth types (current — NO `orgId`)

```typescript
// apps/proxy/src/lib/api-key-auth.ts
interface ApiKeyIdentity {
  userId: string; keyId: string; hasWebhooks: boolean;
  hasBudgets: boolean; apiVersion: string; defaultTags: Record<string, string>;
  // orgId: NOT HERE YET
}

// apps/proxy/src/lib/auth.ts
interface AuthResult {
  userId: string; keyId: string; hasWebhooks: boolean;
  hasBudgets: boolean; apiVersion: string; defaultTags: Record<string, string>;
  // orgId: NOT HERE YET
}
```

### Dashboard auth (current — user-only)

```typescript
// lib/auth/session.ts
resolveSessionUserId(): Promise<string>        // 42+ call sites in app/api/
resolveSessionContext(): Promise<{ userId }>    // 4 call sites (actions only)
```

### Signup flow (current — NO server-side hook)

`app/(auth)/signup/page.tsx` calls `supabase.auth.signUp()` client-side. No server-side webhook, no database trigger, no post-signup hook. Auto-creating a personal org requires adding either:
- A Supabase Auth webhook/trigger, or
- Lazy-init in `resolveSessionContext()` on first authenticated request

### Per-user limits (current — hardcoded, NOT tier-driven)

```typescript
// lib/validations/api-keys.ts
MAX_KEYS_PER_USER = 20        // flat constant

// lib/validations/webhooks.ts
MAX_WEBHOOK_ENDPOINTS_PER_USER = 10  // flat constant

// lib/stripe/tiers.ts — budget limits ARE tier-driven
TIERS[tier].maxBudgets         // 1 (free), Infinity (pro/team)
```

---

## Resource Scoping Migration

### Target: All resources scoped to `org_id`

| Resource | Current scope | Target scope | `user_id` becomes |
|---|---|---|---|
| `api_keys` | `user_id` | `org_id` (NOT NULL) | `created_by` (who created the key) |
| `budgets` | `user_id` | `org_id` (NOT NULL) | `created_by` (who set the budget) |
| `cost_events` | `user_id` | `org_id` (NOT NULL) | Stays (which user's key triggered it, audit trail) |
| `webhook_endpoints` | `user_id` | `org_id` (NOT NULL) | `created_by` |
| `subscriptions` | `user_id` (1:1) | `org_id` (1:1) | Removed (billing attaches to org) |
| `slack_configs` | `user_id` | `org_id` | `configured_by` |
| `tool_costs` | `user_id` | `org_id` | Stays (auto-discovered per-user context) |
| `actions` | `owner_user_id` | `org_id` | `owner_user_id` stays (HITL action creator) |
| `webhook_deliveries` | via `endpoint_id` FK | via `endpoint_id` FK (unchanged) | N/A — chains through endpoint |

---

## Invitation Flow

```
Owner/Admin → POST /api/orgs/{orgId}/invitations
  → Validate role permission (owner/admin only)
  → Generate secure token, hash with SHA-256 (same pattern as API keys)
  → Create org_invitations row (status: pending, expires: 7 days)
  → Send email with /invite/{token} link
  → Recipient clicks link:
    → Has account? → Accept screen → membership created, status → accepted
    → No account? → Signup → lazy-init personal org → auto-accept → membership created
```

---

## API Design

### Proxy (agent-facing)
API key's `org_id` provides context automatically after Phase 2. No new headers. Cost events, budget checks, webhooks all inherit `orgId` from the key.

### Dashboard (user-facing)

**Session context resolution (target):**
```typescript
resolveSessionContext(): Promise<{
  userId: string;
  orgId: string;      // from ns-active-org header → fallback: personal org
  role: 'owner' | 'admin' | 'member';
}>
```

**New API routes:**
```
GET    /api/orgs                           -- list user's orgs
POST   /api/orgs                           -- create org
GET    /api/orgs/[orgId]                   -- get org details
PATCH  /api/orgs/[orgId]                   -- update org
DELETE /api/orgs/[orgId]                   -- delete org (owner only)
GET    /api/orgs/[orgId]/members           -- list members
DELETE /api/orgs/[orgId]/members/[userId]  -- remove member
PATCH  /api/orgs/[orgId]/members/[userId]  -- change role
POST   /api/orgs/[orgId]/invitations       -- create invitation
GET    /api/orgs/[orgId]/invitations       -- list pending
DELETE /api/orgs/[orgId]/invitations/[id]  -- revoke
POST   /api/invite/accept                  -- accept (token-based)
```

---

## Step-by-Step Implementation Guide

> **Unified phase guide:** The combined backend + frontend implementation timeline is in [`org-team-ui-ux.md`](org-team-ui-ux.md#unified-phase-guide-backend--frontend-combined). The steps below are the backend-only detail — see the companion doc for how frontend work interleaves.

### Phase 0: Schema Prep (no code changes, just migrations)

**Goal:** Add all remaining nullable columns while tables are empty. Zero risk.

**Step 0.1: Add `org_id` to remaining 5 tables**
```sql
ALTER TABLE "webhook_endpoints" ADD COLUMN "org_id" uuid;
ALTER TABLE "tool_costs" ADD COLUMN "org_id" uuid;
ALTER TABLE "actions" ADD COLUMN "org_id" uuid;
ALTER TABLE "slack_configs" ADD COLUMN "org_id" uuid;
ALTER TABLE "subscriptions" ADD COLUMN "org_id" uuid;
```

**Step 0.2: Add `created_by` to 3 tables**
```sql
ALTER TABLE "api_keys" ADD COLUMN "created_by" text;
ALTER TABLE "budgets" ADD COLUMN "created_by" text;
ALTER TABLE "webhook_endpoints" ADD COLUMN "created_by" text;
```

**Step 0.3: Update Drizzle schema** (`packages/db/src/schema.ts`)
- Add `orgId` and `createdBy` columns to relevant table definitions
- Use `uuid("org_id")` (nullable) and `text("created_by")` (nullable)

**Step 0.4: Move per-user limits into tier definitions**
- `lib/stripe/tiers.ts`: Add `maxApiKeys` and `maxWebhookEndpoints` to each tier
- `lib/validations/api-keys.ts`: Replace `MAX_KEYS_PER_USER` with tier lookup
- `lib/validations/webhooks.ts`: Replace `MAX_WEBHOOK_ENDPOINTS_PER_USER` with tier lookup
- `app/api/keys/route.ts` and `app/api/webhooks/route.ts`: Pass tier to validation

**Step 0.5: Add `org` to PREFIX_MAP**
- `lib/ids/prefixed-id.ts`: Add `org: "ns_org_"` to the prefix map

**Files changed:** ~8 files + 1 migration
**Effort:** ~1-2 hours

---

### Phase 1: Org Tables + Personal Org Auto-Provisioning

**Goal:** Create org infrastructure. Every user gets a personal org. No behavioral changes yet — `org_id` is populated but not used for scoping.

**Step 1.1: Create org tables + fix `org_id` column types**
- Add `organizations`, `orgMemberships`, `orgInvitations` to `packages/db/src/schema.ts`
- Migrate existing `org_id` columns from `text` to `uuid` on `api_keys`, `budgets`, `cost_events` (zero rows, safe)
- Add `org_id uuid` to remaining tables (`webhook_endpoints`, `tool_costs`, `actions`, `slack_configs`, `subscriptions`)
- Create migration SQL for the 3 new tables + column type changes + indexes
- Apply migration via Supabase MCP

**Step 1.2: Add Zod validation schemas**
- `lib/validations/orgs.ts`: Create org (name, slug), update org, invite member (email, role)
- Follow existing patterns in `lib/validations/`

**Step 1.3: Implement personal org lazy-init**

Since there's no server-side signup hook, use lazy initialization:
```typescript
// lib/auth/session.ts — new function
async function ensurePersonalOrg(userId: string): Promise<string> {
  // Check if user has a personal org
  const existing = await db.select({ orgId: orgMemberships.orgId })
    .from(orgMemberships)
    .innerJoin(organizations, eq(organizations.id, orgMemberships.orgId))
    .where(and(
      eq(orgMemberships.userId, userId),
      eq(organizations.isPersonal, true),
    ))
    .limit(1);

  if (existing.length > 0) return existing[0].orgId;

  // Create personal org + owner membership in transaction
  return db.transaction(async (tx) => {
    const [org] = await tx.insert(organizations).values({
      name: "Personal",
      slug: `user-${userId.slice(0, 8)}`,  // unique from UUID prefix
      isPersonal: true,
      createdBy: userId,
    }).returning({ id: organizations.id });

    await tx.insert(orgMemberships).values({
      orgId: org.id,
      userId,
      role: "owner",
    });

    return org.id;
  });
}
```

**Step 1.4: Update `resolveSessionContext()` to return orgId**
```typescript
// lib/auth/session.ts
export async function resolveSessionContext(): Promise<{
  userId: string;
  orgId: string;
  role: 'owner' | 'admin' | 'member';
}> {
  const userId = await resolveSessionUserId();
  // For now, always returns personal org
  const orgId = await ensurePersonalOrg(userId);
  return { userId, orgId, role: 'owner' };
}
```

**Step 1.5: Backfill `org_id` on existing rows**

Migration script (run once):
```sql
-- For each user, create a personal org, then populate org_id on all their rows
-- This is a one-time backfill, not a recurring migration
```

In practice, with zero users this is a no-op. The lazy-init handles new users automatically.

**Step 1.6: Populate `created_by` on new writes**
- `app/api/keys/route.ts`: Set `createdBy: userId` on INSERT
- `app/api/budgets/route.ts`: Set `createdBy: userId` on INSERT
- `app/api/webhooks/route.ts`: Set `createdBy: userId` on INSERT

**Files changed:** ~12-15 files
**Effort:** ~1-2 days

---

### Phase 2: Enforce Org-Scoping

**Goal:** Switch all queries from `user_id` to `org_id`. This is the largest phase.

**Step 2.1: Proxy auth — add `orgId` to identity**
- `apps/proxy/src/lib/api-key-auth.ts`:
  - Add `orgId: string` to `ApiKeyIdentity`
  - Add `k.org_id` to the auth SQL SELECT
  - Map `row.org_id as string` in result
- `apps/proxy/src/lib/auth.ts`:
  - Add `orgId: string` to `AuthResult`
  - Pass through `identity.orgId`
- Update all 18+ test `makeCtx` helpers to include `orgId`

**Step 2.2: Proxy cost-logger — add `org_id` to INSERTs**
- `apps/proxy/src/lib/cost-logger.ts`:
  - Add `org_id` to the single INSERT column list + VALUES
  - Add `org_id: e.orgId ?? null` to the batch INSERT column map

**Step 2.3: Proxy budget DO — key by `orgId`**
- `apps/proxy/src/lib/budget-do-client.ts`: Change 6 call sites from `idFromName(userId)` to `idFromName(orgId)`
- `apps/proxy/src/lib/budget-orchestrator.ts`: Pass `ctx.auth.orgId` instead of `ctx.auth.userId`
- `apps/proxy/src/lib/budget-do-lookup.ts`: Change `WHERE user_id =` to `WHERE org_id =`
- `apps/proxy/src/routes/internal.ts`: Invalidation body adds `orgId`

**Step 2.4: Proxy webhook + cache — scope by `orgId`**
- `apps/proxy/src/lib/webhook-cache.ts`: Cache key by `orgId` instead of `userId`
- `apps/proxy/src/lib/api-key-auth.ts`: `invalidateAuthCacheForUser` → scope consideration

**Step 2.5: Dashboard queries — switch to `org_id`**
- `lib/cost-events/aggregate-cost-events.ts`: `baseConditions` uses `eq(costEvents.orgId, orgId)` (8 functions)
- Migrate 42+ dashboard API routes from `resolveSessionUserId()` to `resolveSessionContext()`
- Each route: `const { orgId } = await resolveSessionContext()` then `WHERE org_id = orgId`

**Step 2.6: Add `FEATURE_TIERS` for tier-gated features**
- `lib/stripe/tiers.ts`: Add feature flag map consumed by `<FeatureGate>` on frontend:
```typescript
export const FEATURE_TIERS = {
  team_members: "team",
  unlimited_budgets: "pro",
  velocity_limits: "pro",
  session_limits: "pro",
  webhooks: "pro",
  tag_budgets: "pro",
  advanced_analytics: "team",
} as const satisfies Record<string, Tier>;
```

**Step 2.7: Make `org_id` NOT NULL**
- Migration: `ALTER TABLE ... ALTER COLUMN org_id SET NOT NULL` on all tables
- Add indexes: `CREATE INDEX ... ON ... (org_id, ...)` to match query patterns

**Step 2.7: Update proxy tests (~80 files)**
- All `makeCtx`, `makeEnv`, mock auth objects need `orgId`
- All budget test fixtures need org-scoped queries

**Files changed:** ~60-70 source files + ~80 test files
**Effort:** ~3-5 days (largest phase — mostly mechanical but wide-reaching)

---

### Phase 3: Team Orgs + Invitations

**Goal:** Multi-user collaboration. Users can create team orgs and invite members.

**Step 3.1: Org CRUD API routes**
- `app/api/orgs/route.ts`: GET (list user's orgs), POST (create org)
- `app/api/orgs/[orgId]/route.ts`: GET, PATCH, DELETE
- `app/api/orgs/[orgId]/members/route.ts`: GET (list members)
- `app/api/orgs/[orgId]/members/[userId]/route.ts`: PATCH (change role), DELETE (remove)

**Step 3.2: Invitation API routes**
- `app/api/orgs/[orgId]/invitations/route.ts`: GET (list pending), POST (create)
- `app/api/orgs/[orgId]/invitations/[id]/route.ts`: DELETE (revoke)
- `app/api/invite/accept/route.ts`: POST (accept via token)
- `lib/auth/invitation.ts`: Token generation, hashing, verification (reuse API key patterns)

**Step 3.3: Email sending**
- Invitation email via Resend/SendGrid/Supabase email
- Template: org name, inviter name, role, accept link

**Step 3.4: Org switcher UI**
- Dashboard header component: dropdown of user's orgs
- Sets `ns-active-org` cookie/header on switch
- `resolveSessionContext()` reads and validates

**Step 3.5: Member management UI**
- Members list page with role badges
- Invite form (email + role selector)
- Remove/change role actions with confirmation

**Files changed:** ~20-25 new files + UI components
**Effort:** ~3-5 days

---

### Phase 4: Role Enforcement + Billing Migration

**Goal:** Enforce permissions. Move billing from per-user to per-org.

**Step 4.1: Permission middleware**
```typescript
// lib/auth/permissions.ts
function requireRole(minRole: 'member' | 'admin' | 'owner') {
  return async (ctx: SessionContext) => {
    const roleRank = { member: 0, admin: 1, owner: 2 };
    if (roleRank[ctx.role] < roleRank[minRole]) {
      throw new ForbiddenError("Insufficient permissions");
    }
  };
}
```

**Step 4.2: Apply permissions to all routes**
- Budget CRUD: `requireRole('admin')`
- Key revocation: `requireRole('admin')`
- Webhook management: `requireRole('admin')`
- Member management: `requireRole('admin')`
- Billing: `requireRole('owner')`
- Org deletion: `requireRole('owner')`
- Read-only routes: `requireRole('member')` (default)

**Step 4.3: Billing migration**
- `subscriptions` table: `user_id` → `org_id`
- Stripe Customer: create per-org instead of per-user
- `getTierForUser()` → `getTierForOrg(orgId)`
- Stripe checkout, webhook, portal: scope to org
- Pricing page: personal (free) vs team (paid)

**Step 4.4: Role-based UI**
- Hide admin actions (invite, budget management, key revocation) from members
- Show billing section only to owners

**Files changed:** ~30-40 files (routes + UI + billing)
**Effort:** ~3-5 days

---

### Phase 5: Enterprise (demand-driven, not pre-built)

- Viewer role (read-only dashboard access)
- Billing role (invoice management only)
- Custom roles + granular permissions (`org_roles`, `org_permissions` tables)
- SSO/SAML per org (WorkOS integration or custom)
- Domain-verified auto-join (auto-add users with matching email domain)
- Audit log (who changed what, when)

**Trigger to build:** Enterprise customer requests it.

---

## Key Risks

1. **DO migration (Phase 2):** Changing DO keying from `idFromName(userId)` to `idFromName(orgId)` requires creating new DOs and migrating SQLite budget state. Personal org pattern mitigates this — every user maps 1:1 to an org initially, so the migration is mechanical. **Mitigation:** During transition, the DO key can use `orgId` which equals `userId` for personal orgs (if org IDs are derived from user IDs) or a mapping table.

2. **Phase 2 scope (60-70 files):** The query migration is the largest single change. **Mitigation:** Do it incrementally — start with proxy (highest impact), then dashboard routes one at a time. The `resolveSessionContext()` function provides a clean migration boundary.

3. **Billing migration (Phase 4):** Moving Stripe Customer from per-user to per-org touches the entire payment flow. **Mitigation:** Scope carefully. Personal orgs keep the existing Stripe Customer; team orgs create new ones.

4. **Supabase RLS:** NullSpend bypasses RLS (direct Drizzle connection). Org scoping is enforced in application code. Every query must be audited for correct org filtering. **Mitigation:** The `resolveSessionContext()` middleware validates membership before returning `orgId`.

---

## Industry Comparison

| Feature | Vercel | Supabase | GitHub | Clerk | NullSpend (planned) |
|---|---|---|---|---|---|
| Personal + org | Separate types | Orgs only | Separate types | Both (configurable) | Personal org pattern |
| Default roles | 2 (Pro) | 4 | 6 (per-repo) | 2 + custom | 3 |
| Invitations | Email | Email | Email | Email + UI | Email |
| Billing scope | Per team | Per org | Per org | N/A | Per org |
| SSO/SAML | Enterprise | Enterprise | Enterprise | Add-on | Phase 5 |
| Custom roles | No (Access Groups) | No | Yes (Enterprise) | Yes | Phase 5 |

---

## References

- [Vercel: Team Members & Roles](https://vercel.com/docs/teams-and-accounts/team-members-and-roles)
- [Supabase: Organization-based Billing](https://supabase.com/blog/organization-based-billing)
- [Supabase: Access Control](https://supabase.com/docs/guides/platform/access-control)
- [Clerk: Organizations Overview](https://clerk.com/docs/guides/organizations/overview)
- [Clerk: Roles and Permissions](https://clerk.com/docs/organizations/roles-permissions)
- [WorkOS: Users and Organizations](https://workos.com/docs/authkit/users-organizations)
- [WorkOS: Roles and Permissions](https://workos.com/docs/authkit/roles-and-permissions)
- [GitHub: Types of Accounts](https://docs.github.com/en/get-started/learning-about-github/types-of-github-accounts)
- [GitHub: Roles in an Organization](https://docs.github.com/en/organizations/managing-peoples-access-to-your-organization-with-roles/roles-in-an-organization)
