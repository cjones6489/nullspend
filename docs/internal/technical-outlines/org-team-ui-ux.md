# Org & Team UI/UX Design

**Created:** 2026-03-24
**Status:** Research Complete, Implementation Not Started
**Author:** Claude (from research with @cjone)
**Backend companion:** [`org-team-architecture.md`](org-team-architecture.md) — schema, API routes, proxy changes, data model
**Implementation plan:** [`org-team-implementation-plan.md`](org-team-implementation-plan.md) — unified phased guide with sub-phases, checklists, review gates, effort estimates

---

## Executive Summary

This document defines the frontend architecture for NullSpend's org/team management: navigation, routing, org switching, member management, invitation flows, tier-gated features, and upgrade paths. Patterns are drawn from Vercel, Supabase, Clerk, Linear, and PostHog, adapted for NullSpend's Next.js 16 + shadcn/ui stack.

The backend architecture (schema, API, proxy) is specified in the companion document. This document covers everything the user sees and interacts with.

---

## Navigation & Routing

### Decision: Implicit org context (cookie-based)

The active org is stored in an `httpOnly` cookie (`ns-active-org`). The dashboard layout reads it server-side and passes it through React context. No org slug in the URL — routes stay stable when switching orgs.

**Why not URL-based?** Vercel uses implicit scoping. Supabase's URL-based project refs have received complaints about painful switching. NullSpend already has 40+ routes at `/app/*` — rewriting all to include an org slug is unnecessary churn.

### Route Map

```
# Existing routes (unchanged, now org-scoped via cookie)
/app/home
/app/analytics
/app/activity
/app/budgets
/app/tool-costs
/app/inbox
/app/history
/app/billing

# Settings (restructured with secondary nav)
/app/settings                    → redirects to /app/settings/general
/app/settings/general            # Org profile: name, slug, avatar, delete
/app/settings/members            # Member table, invitations, roles
/app/settings/api-keys           # API key management (existing, moved here)
/app/settings/webhooks           # Webhook management (existing, moved here)
/app/settings/integrations       # Slack + future integrations

# Outside dashboard layout
/invite/[token]                  # Invitation acceptance (minimal page)
```

---

## Org Switcher

### Position: Sidebar header (top-left)

Replaces the current NullSpend logo row in the sidebar. The logo moves below the switcher. Follows Vercel (sidebar team switcher at top), Linear (workspace dropdown), PostHog (org dropdown).

### Design

**Trigger:** `DropdownMenuTrigger`
- Org avatar (32x32, rounded-lg, letter fallback with color hash)
- Org name (truncated)
- Plan badge: `Free` / `Pro` / `Team` (small, muted)
- `ChevronsUpDown` icon

**Dropdown content:** `DropdownMenuContent`
```
Organizations
─────────────────────────
[AV] Personal              Owner  ✓
[AV] Acme Corp             Admin
[AV] Side Project          Member
─────────────────────────
[+]  Create Organization
```

**Switching:** Clicking an org calls a server action that sets the `ns-active-org` cookie and calls `router.refresh()`. All data queries re-execute with the new org scope.

**Create org:** Opens a `Dialog` (not a page navigation) with name + auto-generated slug + create button. On success, switches to the new org.

### shadcn Components
`DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuLabel`, `DropdownMenuSeparator`, `DropdownMenuItem`, `Avatar`, `AvatarFallback`, `Badge`

---

## Settings Page Layout

### Pattern: Two-column with secondary nav

Left column: narrow settings nav (links). Right column: active settings page content.

```
+──sidebar──+──settings nav──+──content─────────────────────+
│ OrgSwitch │ General        │ General Settings              │
│ Home      │ Members        │                               │
│ ...       │ API Keys       │ [Org Name]  [Edit]            │
│ Settings* │ Webhooks       │ [Org Slug]  acme-corp         │
│ ...       │ Integrations   │ [Org Avatar] [Upload]         │
│           │ Billing        │                               │
│           │                │ Danger Zone                   │
│           │                │ [Delete Organization]         │
+───────────+────────────────+───────────────────────────────+
```

### Settings Nav

| Section | Icon | Gated? |
|---------|------|--------|
| General | `Building2` | No |
| Members | `Users` | Team tier (upgrade card on Free/Pro) |
| API Keys | `Key` | No |
| Webhooks | `Webhook` | Pro tier |
| Integrations | `Puzzle` | Pro tier |
| Billing | `CreditCard` | No |

**Personal orgs:** Members nav item hidden (no team management for personal orgs). Billing shows "Personal Free Plan" with upgrade CTA.

### Implementation
- `app/(dashboard)/app/settings/layout.tsx`: Renders secondary nav + content area
- `app/(dashboard)/app/settings/[section]/page.tsx`: Dynamic segment for each settings page
- Or explicit files: `settings/general/page.tsx`, `settings/members/page.tsx`, etc.

---

## Member Management Page

### `/app/settings/members`

Three sections stacked vertically.

### Invite Section (top)

Card with inline invite form:
```
┌─ Invite Team Members ──────────────────────────────────┐
│                                                         │
│ [email@example.com          ] [Member ▼] [Invite]       │
│                                         + Add more      │
│                                                         │
│ Invite Link                                             │
│ [https://nullspend.com/invite/abc...] [Copy] [Reset]    │
└─────────────────────────────────────────────────────────┘
```

Components: `Card`, `Input`, `Select`, `Button`, `CopyButton`

### Active Members Table

```
┌─ Team Members ─────────────────────────────── 3 members ┐
│ Name/Email           │ Role    │ Joined       │ Actions  │
│──────────────────────┼─────────┼──────────────┼──────────│
│ [AV] Jane Smith      │ Owner   │ Mar 1, 2026  │ ...      │
│      jane@acme.com   │         │              │          │
│──────────────────────┼─────────┼──────────────┼──────────│
│ [AV] Bob Dev         │ Member  │ Mar 10, 2026 │ ...      │
│      bob@acme.com    │         │              │          │
└──────────────────────┴─────────┴──────────────┴──────────┘
```

**Row actions** (`DropdownMenu`):
- Change Role → inline `Select` or small `Dialog`
- Remove from Team → `AlertDialog` confirmation

**Constraints:**
- Owners cannot demote themselves if they're the last owner
- Members cannot see the actions column (admin/owner only)

Components: `Table`, `Avatar`, `Badge` (role), `DropdownMenu`, `AlertDialog`, `Select`

### Pending Invitations Table

```
┌─ Pending Invitations ──────────────────────── 2 pending ┐
│ Email               │ Role    │ Sent         │ Actions   │
│─────────────────────┼─────────┼──────────────┼───────────│
│ alice@acme.com      │ Member  │ 2 days ago   │ [Resend] [Revoke] │
│ charlie@acme.com    │ Admin   │ 5 days ago   │ [Resend] [Revoke] │
└─────────────────────┴─────────┴──────────────┴───────────┘
```

Expired invitations: muted red `Badge` "Expired", "Resend" generates a fresh token.

---

## Invitation Flow

### Sender (admin/owner in dashboard)

1. Settings > Members > Enter email + role > "Invite"
2. Toast: "Invitation sent to alice@acme.com"
3. Invitation appears in Pending table immediately
4. Email sent with `/invite/[token]` link

### Receiver (`/invite/[token]` page)

Minimal page outside the dashboard layout (no sidebar, centered card).

**Valid token, logged in:**
```
        [NullSpend Logo]

┌─────────────────────────────────┐
│                                 │
│        [Org Avatar]             │
│   You've been invited to join   │
│        Acme Corp                │
│                                 │
│   Invited by: jane@acme.com     │
│   Role: Member                  │
│                                 │
│      [Accept & Join]            │
│                                 │
└─────────────────────────────────┘
```

**Valid token, not logged in:** Same card but CTA is "Sign up to join" → redirect to signup → redirect back → auto-accept.

**Expired/revoked:** "This invitation has expired. Ask the team owner to send a new one."

**Already a member:** "You're already a member of Acme Corp." + "Go to Dashboard" link.

Components: `Card`, `Avatar`, `Badge`, `Button`

---

## Upgrade / Billing Flow

### Where upgrade CTAs appear

| Location | Trigger | Pattern |
|----------|---------|---------|
| Billing page | Free users see pricing cards | Existing — keep as-is |
| Settings > Members | Free/Pro user visits | Full-page `<UpgradeCard>` |
| Budgets page | Free user hits 1-budget limit | Inline `<UpgradeBanner>` |
| Webhooks settings | Free user visits | Inline `<UpgradeBanner>` |
| Budget form | Free user toggles velocity limits | Disabled input + tooltip + `Pro` badge |
| Home page | New user after signup | Subtle banner: "Working with a team? [Create an Organization]" |

### Checkout flow (existing, no changes needed)

1. User clicks "Upgrade to Pro" or "Upgrade to Team"
2. Server creates Stripe Checkout session
3. Redirect to Stripe hosted checkout
4. Success redirect: `/app/billing?success=true`
5. Subscription synced, toast shown

---

## Tier-Gated Feature Patterns

### Philosophy: Visible but gated (not hidden)

Users see what they're missing — drives upgrade conversion. Clear visual indicators that a feature requires an upgrade.

### `<FeatureGate>` Component

```tsx
<FeatureGate feature="team_members" requiredTier="team" fallback="card">
  <MemberManagementPage />
</FeatureGate>
```

**Modes:**
- `"banner"` — subtle inline banner with lock icon + upgrade button (default)
- `"card"` — centered upgrade card replacing the content area
- `"hidden"` — don't render (use sparingly)

### Inline Banner (`<UpgradeBanner>`)
```
┌──────────────────────────────────────────────────────────┐
│ 🔒 Velocity limits require the Pro plan.   [Upgrade →]   │
└──────────────────────────────────────────────────────────┘
```
Muted background, `Lock` icon, text, outline `Button`.

### Upgrade Card (`<UpgradeCard>`)
```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│                     🔒 (48px)                            │
│                                                          │
│               Team Management                            │
│                                                          │
│     Invite team members, assign roles, and manage        │
│     access to your NullSpend workspace.                  │
│                                                          │
│          Available on Team ($199/mo)                     │
│                                                          │
│              [Upgrade to Team]                            │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### Disabled Control Pattern
For individual form fields that are tier-gated:
- Input is `disabled` with `opacity-50`
- `Badge` next to label: "Pro"
- `Tooltip` on hover: "Available on the Pro plan"

### Tier-Feature Map

```typescript
const FEATURE_TIERS = {
  team_members: "team",
  unlimited_budgets: "pro",
  velocity_limits: "pro",
  session_limits: "pro",
  webhooks: "pro",
  tag_budgets: "pro",
  advanced_analytics: "team",
} as const;
```

---

## Personal vs Team Org UI

| Aspect | Recommendation |
|--------|---------------|
| Label | "Personal" (not user's name) — matches Vercel |
| Settings | Personal org: no Members tab. Only API Keys, Webhooks, Integrations, Billing. |
| Switcher | Personal always first in list, visually separated |
| Upgrade prompt | Subtle home page banner: "Working with a team? [Create an Organization]" |
| Auto-creation | Every signup creates a personal org automatically (invisible to user) |

---

## Component Inventory

### Existing (already in project)

`Button`, `Card`, `Table`, `Dialog`, `DropdownMenu`, `Select`, `Input`, `Badge`, `Skeleton`, `Label`, `Separator`, `Switch`, `Command`, `Tabs`, `Progress`, `CopyButton`

### Need to Install (from shadcn registry)

| Component | Used For |
|-----------|----------|
| `Avatar` + `AvatarFallback` | Org avatars, member avatars |
| `AlertDialog` | Destructive confirmations (remove member, delete org) |
| `Tooltip` | Tier-gated feature hover explanations |

### Custom Components to Build

| Component | Description | Notes |
|-----------|-------------|-------|
| `<OrgSwitcher>` | DropdownMenu org switcher in sidebar header | Core new component |
| `<FeatureGate>` | Tier-gating wrapper (banner/card/hidden modes) | Consumes `FEATURE_TIERS` from `lib/stripe/tiers.ts` |
| `<UpgradeCard>` | Full-page upgrade CTA for gated sections | Reuse patterns from existing `PricingCard` in billing page |
| `<InviteForm>` | Email + role + invite button, multi-row support | Uses raw `useState` (no React Hook Form — matches codebase) |
| `<MemberTable>` | Members with avatar, name, role, actions | Includes empty state (follow `EmptyKeys` pattern) |
| `<PendingInvitesTable>` | Invitations with email, role, status, actions | Includes empty/expired states |
| `<SettingsNav>` | Secondary sidebar for settings sub-pages | Simple link list with active state |

Simpler utilities (inline, not standalone component files):
- `<OrgAvatar>` — styled `Avatar` + `AvatarFallback` with deterministic color
- `<RoleBadge>` — `Badge` with variant logic per role (one-liner)
- `<PlanBadge>` — `Badge` with variant logic per tier (one-liner)
- `<UpgradeBanner>` — inline banner, similar to existing toast patterns

---

## Implementation Phases

See [`org-team-implementation-plan.md`](org-team-implementation-plan.md) for the full unified phase guide with sub-phases, checklists, review gates, and effort estimates. The plan covers both backend and frontend work interleaved, with explicit dependencies between them.

**Summary:**
- Phase 0: Schema prep + settings restructure (~1 day)
- Phase 1: Org tables + foundation (~2-3 days)
- Phase 2: Org-scoped dashboard (~4-6 days)
- Phase 3: Team features + invitations (~5-7 days)
- Phase 4: Role enforcement + billing migration (~4-6 days)
- Phase 5: Enterprise (demand-driven)

---

## Known Gaps (tracked, not blocking)

| Gap | Status | Notes |
|---|---|---|
| **Mobile/responsive sidebar** | Not addressed | Sidebar is fixed 224px with no responsive behavior. Adding org switcher makes it denser. Address before or during Phase 1. |
| **`loading.tsx` files** | Zero exist in codebase | New settings sub-pages need loading states. Use existing skeleton component patterns (`KeysSkeleton`, `BillingSkeleton`). |
| **React Server Components** | Not used in dashboard | All dashboard pages are `"use client"` with TanStack Query. New pages must follow this pattern. |
| **Form library** | None (raw `useState`) | No React Hook Form in codebase. New forms (`InviteForm`, org profile) should use `useState` + `onChange`. |
| **Billing "no changes needed"** | True for Phases 1-3 | Phase 4 requires scoping checkout + subscription to `orgId`. |

---

## References

- [Vercel Dashboard Redesign](https://vercel.com/blog/dashboard-redesign)
- [Vercel Managing Team Members](https://vercel.com/docs/rbac/managing-team-members)
- [Supabase Access Control](https://supabase.com/docs/guides/platform/access-control)
- [Clerk OrganizationSwitcher](https://clerk.com/docs/components/organization/organization-switcher)
- [Clerk OrganizationProfile](https://clerk.com/docs/components/organization/organization-profile)
- [Linear Settings Redesign](https://linear.app/now/settings-are-not-a-design-failure)
- [PostHog Organizations](https://posthog.com/docs/settings/organizations)
- [shadcn/ui Sidebar Blocks](https://ui.shadcn.com/)
