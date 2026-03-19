# API Versioning Research — NullSpend Pre-Launch

**Date:** 2026-03-19
**Purpose:** Inform the `api_version` column addition (Section 5/6 of pre-launch design audit). Covers industry patterns, known pitfalls, and NullSpend-specific architecture considerations.
**Companion files:** `api-versioning-platforms.md` (8-platform deep dive), `api-versioning-pitfalls.md` (anti-patterns and failure stories)

---

## Executive Summary

The research strongly suggests a **minimal, infrastructure-only approach** for pre-launch:

1. **Add the `api_version` column to `api_keys`** (records which version each key was born into)
2. **Parse the `NullSpend-Version` header** in API routes (per-request override)
3. **Return the version in response headers** (so clients can detect drift)
4. **Wire the SDK to send the version header** (pins behavior)
5. **Do NOT build version-change modules or transformation logic yet** — there is only one version

This gives us the data to know what version each consumer expects when a breaking change eventually ships, without building the Stripe-scale transformation machinery we don't need.

---

## Industry Patterns — What Works

### The Stripe Model (gold standard, but expensive)

- Per-account version pinning (set at first API call)
- `Stripe-Version` header for per-request overrides
- "Version change modules" — encapsulated transformation classes that walk backward from the latest internal model
- Webhooks pinned per-endpoint, shaped to that endpoint's version
- 72-hour rollback window after upgrading
- ~130-180 versions maintained since 2011
- **Requires dedicated DSL, registry, and transformation pipeline** — built by 8,000+ employees

**Key quote (Brandur Leach, Stripe):** *"The core API endpoint logic is all coupled to just the latest version. For each substantial API change in each new API version, logic is encapsulated into what we call a 'compatibility gate'... the response is passed back through a compatibility layer that applies changes for each gate until it's been walked all the way back to the target version."*

Sources: https://stripe.com/blog/api-versioning, https://brandur.org/api-upgrades

### The GitHub Model (conservative, low-overhead)

- Header-based: `X-GitHub-Api-Version: YYYY-MM-DD`
- Only 2 versions in 3.5 years (conservative cadence)
- 24-month minimum support window per version
- Additive changes deploy to ALL versions simultaneously — only breaking changes create new versions
- **Gap: webhook versioning completely undocumented**

### The Shopify Model (structured cadence)

- URL-path versioning: `YYYY-MM` quarterly
- 12-month support window, 9-month overlap
- Webhooks auto-advance ("fall forward") when version expires
- `X-Shopify-Api-Version` header on every webhook delivery

### The Slack Model (no versioning)

- Additive-only philosophy: *"What worked yesterday should work tomorrow"*
- When breaking changes ARE needed, ad-hoc deprecation with extended timelines
- Community pushback can halt deprecations (classic apps, Dec 2025)
- **Works because of strong internal API design review (`#api-decisions` channel)**

### Consensus Across 8 Platforms

| Decision | Best Practice | Anti-Pattern |
|---|---|---|
| Version location | Header-based (Stripe, GitHub) | URL path with integer versions (Discord) |
| Version format | Date-based `YYYY-MM-DD` | Semver in URLs (`/v1.2.3/`) |
| Default version | Current version for new accounts | Stale deprecated default (Discord v6) |
| Webhook versioning | Per-endpoint pinning with version header | Undocumented (GitHub) |
| Breaking change granularity | Small, frequent (Stripe) | Big-bang batches (GitHub's 25 changes) |
| Version retirement | Published SLA (12-24 months) | "Temporary" versions that live forever |

---

## Known Pitfalls and Failure Stories

### Critical Lessons

1. **Stripe's `verified` → `status` incident:** A simple boolean-to-string type change broke real integrations. Design fields with future extensibility — use enums/strings, not booleans that may need more states.

2. **The `userId` → `user_id` rename:** A single field rename broke 147 client applications. Never rename fields — deprecate and add alongside.

3. **Twitter v2 migration disaster:** Changed default response shapes (all-fields-included → opt-in). Every client broke. Combine with pricing changes → permanent trust destruction.

4. **Slack's simultaneous deprecations (Feb 2021):** Retired 4 method namespaces at once, staggered per-workspace. Apps worked in one workspace, broke in another. Extended debugging nightmare.

5. **Discord's stale default:** Default version is v6 (deprecated), current is v10. New developers unknowingly build against 4-versions-old behavior.

### Hyrum's Law

*"With a sufficient number of users, all observable behaviors of your system will be depended on by somebody."*

Real dependencies people form: list ordering, error message text, response timing, field ordering in JSON, status code specifics. Versioning doesn't protect against this — careful initial design does.

### The Overengineering Trap

- Stripe's architecture requires a custom DSL, master registry, transformation pipeline, and side-effect annotations. Built by a company with 8,000+ employees processing trillions of dollars.
- **Most companies cannot and should not replicate this.**
- Every supported version multiplies: test cases, deployment configs, monitoring rules, documentation, SDK versions.
- Google says most of their own APIs never needed versioning.
- GitHub shipped 2 REST API versions in 3.5 years.

Sources: https://stripe.com/blog/api-versioning, https://cloud.google.com/blog/products/api-management/common-misconceptions-about-api-versioning

---

## The Additive-Only Strategy (Primary Defense)

Three rules that eliminate most future versioning needs:

1. **Never remove** existing endpoints, parameters, or response fields
2. **Never change** field meanings (e.g., `count` parameter semantics)
3. **All new features must be optional** (new fields have defaults, new parameters are optional)

TCP/IP, HTTP, and HTML demonstrate this works at massive scale.

**For webhooks specifically (Svix insight):** *"A much easier way of not breaking your webhooks API is: not to break your webhooks API."* Adding fields is non-breaking. Rename by duplicating (keep old name, add new name). Mark deprecated fields in docs.

---

## NullSpend-Specific Architecture

### What We Already Have

- `webhook_endpoints.api_version` column (default `'2026-04-01'`) — added in Section 4
- `WebhookEvent` interface includes `api_version: string`
- All `build*Payload()` functions accept `apiVersion` parameter
- `CURRENT_API_VERSION = "2026-04-01"` constant in both proxy and dashboard
- SDK (`packages/sdk/src/client.ts`) sends `x-nullspend-key` but no version header

### What Needs to Be Added

#### 1. Schema: `api_version` on `api_keys`

```sql
ALTER TABLE api_keys
  ADD COLUMN api_version text NOT NULL DEFAULT '2026-04-01';
```

Records which API version each key was created under. Same safe Postgres 11+ instant-add pattern used for `cost_events.source`.

#### 2. Header parsing: `NullSpend-Version`

Utility function in `lib/api-version.ts`:

```typescript
export const SUPPORTED_VERSIONS = ["2026-04-01"] as const;
export const CURRENT_VERSION = "2026-04-01";
export type ApiVersion = typeof SUPPORTED_VERSIONS[number];

export function resolveApiVersion(request: Request): ApiVersion {
  const raw = request.headers.get("nullspend-version");
  if (raw && SUPPORTED_VERSIONS.includes(raw as ApiVersion)) return raw as ApiVersion;
  return CURRENT_VERSION;
}
```

Called in route handlers. NOT in proxy.ts middleware (avoid complexity in an already dense file).

#### 3. Response header: echo version back

```
NullSpend-Version: 2026-04-01
```

Lets clients detect version drift.

#### 4. SDK: send version header

```typescript
// packages/sdk/src/client.ts
const SDK_API_VERSION = "2026-04-01";

// In constructor
this.apiVersion = config.apiVersion ?? SDK_API_VERSION;

// In request headers
headers["NullSpend-Version"] = this.apiVersion;
```

#### 5. Proxy: read version header

Same pattern as `x-nullspend-key` — extract from request, store in context. No behavior branching (single version).

### What NOT to Build

- Version-change modules / transformation pipeline (zero breaking changes to transform)
- Version-gating logic / conditional response shapes (one version)
- Per-endpoint version overrides in API routes (one version)
- Version migration tooling (zero consumers to migrate)
- Historical API documentation per version (one version)

### Webhook Versioning (Already Partially Wired)

The `api_version` from `webhook_endpoints` is stored but not currently passed to `build*Payload()` calls — the default `CURRENT_API_VERSION` is used. This should be wired through so when a second version exists, endpoint-pinned versioning works automatically.

**The proxy `dispatchToEndpoints()` has access to each endpoint's full data** via `WebhookEndpointWithSecret` — the plumbing is in place, just not connected.

### Version Resolution Priority (Future)

When multiple version sources exist:

1. `NullSpend-Version` request header (highest — per-request override for testing)
2. API key's `api_version` column (per-key default)
3. `CURRENT_VERSION` constant (system fallback)

At launch, all three resolve to `"2026-04-01"`.

---

## Implementation Estimate

| Item | Effort | Files |
|---|---|---|
| Migration: `api_version` on `api_keys` | 5 min | `drizzle/0022_*.sql`, `packages/db/src/schema.ts` |
| `lib/api-version.ts` utility | 10 min | New file |
| SDK: send `NullSpend-Version` header | 15 min | `packages/sdk/src/client.ts`, `types.ts`, `client.test.ts` |
| Proxy: extract version into context | 10 min | `apps/proxy/src/lib/context.ts`, `index.ts` |
| Dashboard routes: echo version header | 10 min | `lib/utils/http.ts` or route handlers |
| Wire webhook endpoint version to builders | 10 min | `apps/proxy/src/lib/webhook-dispatch.ts` |
| Tests | 20 min | Schema test, SDK test, route tests |
| **Total** | **~1.5 hours** | |

---

## Decision: What to Build

**Recommendation: Infrastructure only.** Add the column, parse the header, send it from the SDK, echo it back. Zero version-gating logic. When the first breaking change is needed post-launch, THEN build the minimal transformation needed for that specific change.

This follows Google's advice (*"if you don't really need versioning, don't add unnecessary complexity"*), avoids Stripe's acknowledged burden (*"every new version is more code to understand and maintain"*), and captures the critical data (which version each key expects) that is impossible to retrofit later.

---

## Sources

See companion files for full source indexes:
- `api-versioning-platforms.md` — 8-platform deep dive with 30+ sources
- `api-versioning-pitfalls.md` — Anti-patterns and failure stories with 25+ sources
