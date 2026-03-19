# API Versioning Research — NullSpend Pre-Launch

**Date:** 2026-03-19
**Purpose:** Inform the `api_version` column addition (Section 5/6 of pre-launch design audit). Covers industry patterns, known pitfalls, and NullSpend-specific architecture considerations.
**Companion files:** `api-versioning-platforms.md` (8-platform deep dive), `api-versioning-pitfalls.md` (anti-patterns and failure stories)

---

## Executive Summary

The research strongly suggests **full resolution plumbing, zero gating logic** for pre-launch:

1. **Add the `api_version` column to `api_keys`** — the key's stored version is its default, not just record-keeping
2. **Wire `apiVersion` through auth** — both proxy and dashboard return it alongside `userId`/`keyId`
3. **Resolve version with three-tier fallback** — header → key default → system constant
4. **Send `NullSpend-Version` from the SDK** and echo it back in response headers
5. **Wire webhook endpoint version to builders** — pass `endpoint.apiVersion` instead of relying on the default constant
6. **Do NOT build version-change modules or transformation logic yet** — there is only one version

This gives us the complete plumbing so adding a second version later is a data change, not a wiring change — without building the Stripe-scale transformation machinery we don't need.

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

### Implementation Status: COMPLETE (deployed 2026-03-19)

All items below have been implemented. 49 files changed, 534 insertions. Commit `4296704`.

- `api_keys.api_version` column (`NOT NULL DEFAULT '2026-04-01'`) — migration `0022`
- `resolveApiVersion(header, keyVersion)` utility — SYNC'd copies in `lib/api-version.ts` and `apps/proxy/src/lib/api-version.ts`
- Proxy auth chain: `ApiKeyIdentity` → `AuthResult` → `RequestContext` carry `apiVersion` / `resolvedApiVersion`
- Dashboard auth chain: `ApiKeyAuthContext` carries `apiVersion`, dev-mode fallback returns `CURRENT_VERSION`
- SDK sends `NullSpend-Version` header on every request, custom override via `config.apiVersion`
- `NullSpend-Version` response header echoed on all proxy responses (OpenAI, Anthropic, MCP) and session-auth dashboard routes
- Cost event webhooks use per-endpoint `ep.apiVersion`; threshold/budget events use `endpoints[0]?.apiVersion`
- Key creation explicitly sets `apiVersion: CURRENT_VERSION`
- 8 new tests, 20 test files updated for interface changes

### What Was Already In Place (Before This Implementation)

- `webhook_endpoints.api_version` column (default `'2026-04-01'`) — added in Section 4
- `WebhookEvent` interface includes `api_version: string`
- All `build*Payload()` functions accept `apiVersion` parameter
- `CURRENT_API_VERSION = "2026-04-01"` constant in both proxy and dashboard

### Implementation Details (Preserved for Reference)

#### 1. Schema: `api_version` on `api_keys`

```sql
ALTER TABLE api_keys
  ADD COLUMN api_version text NOT NULL DEFAULT '2026-04-01';
```

Records which API version each key was created under. The key's `api_version` is the **default version for all requests made with that key** — not just record-keeping. Same safe Postgres 11+ instant-add pattern used for `cost_events.source`.

#### 2. Version resolution: header → key default → system fallback

Pure utility function in `lib/api-version.ts`:

```typescript
export const SUPPORTED_VERSIONS = ["2026-04-01"] as const;
export const CURRENT_VERSION = "2026-04-01";
export type ApiVersion = typeof SUPPORTED_VERSIONS[number];

export function resolveApiVersion(header: string | null, keyVersion: string): ApiVersion {
  // Priority: per-request header > key's stored version > system default
  if (header && SUPPORTED_VERSIONS.includes(header as ApiVersion)) return header as ApiVersion;
  if (SUPPORTED_VERSIONS.includes(keyVersion as ApiVersion)) return keyVersion as ApiVersion;
  return CURRENT_VERSION;
}
```

Takes two plain strings, returns the resolved version. No request/auth objects — easy to test all three fallback levels. Called after auth (because we need the key's `api_version`), result flows through request context.

**Dashboard routes:** `resolveApiVersion(request.headers.get("nullspend-version"), authResult.apiVersion)`

**Proxy routes:** `resolveApiVersion(request.headers.get("nullspend-version"), ctx.auth.apiVersion)` — `apiVersion` added to `AuthResult`/`ApiKeyIdentity` alongside existing `userId` and `keyId`.

#### 3. Auth flow: return `apiVersion` from key lookup

The proxy's `api-key-auth.ts` already queries `api_keys` and returns `ApiKeyIdentity { userId, keyId }`. Add `apiVersion` to this interface. The auth SQL already fetches the key row — no additional query needed.

The dashboard's `authenticateApiKey` in `lib/auth/with-api-key-auth.ts` does the same. Add `apiVersion` to its return type.

#### 4. Response header: echo version back

```
NullSpend-Version: 2026-04-01
```

Set on every API response so clients can detect version drift.

#### 5. SDK: send version header

```typescript
// packages/sdk/src/client.ts
const SDK_API_VERSION = "2026-04-01";

// In constructor
this.apiVersion = config.apiVersion ?? SDK_API_VERSION;

// In request headers
headers["NullSpend-Version"] = this.apiVersion;
```

#### 6. Proxy: version in request context

The proxy's `RequestContext` gains a `resolvedApiVersion` field, set after auth. Passed to webhook builders so endpoint-pinned versioning works. No behavior branching (single version).

### What NOT to Build

- Version-change modules / transformation pipeline (zero breaking changes to transform)
- Version-gating logic / conditional response shapes (one version)
- Version migration tooling (zero consumers to migrate)
- Historical API documentation per version (one version)
- Backward-compatibility shims or dual-format support (zero consumers, clean codebase)

### Webhook Versioning (Already Partially Wired)

The `api_version` from `webhook_endpoints` is stored but not currently passed to `build*Payload()` calls — the default `CURRENT_API_VERSION` is used. Wire this through now so endpoint-pinned versioning works automatically when a second version exists.

**The proxy `dispatchToEndpoints()` has access to each endpoint's full data** via `WebhookEndpointWithSecret` — the plumbing is in place, just not connected. Pass `endpoint.apiVersion` to the builder instead of relying on the default.

### Version Resolution Priority (Locked)

Three-tier fallback, implemented from day one:

1. `NullSpend-Version` request header (highest — per-request override for testing)
2. API key's `api_version` column (per-key default, set at key creation)
3. `CURRENT_VERSION` constant (system fallback for unauthenticated/session routes)

At launch, all three resolve to `"2026-04-01"`. The full resolution chain is wired and tested even though the result is always the same — this means adding a second version later is a data change, not a plumbing change.

### Codebase Hygiene Principle

When a version is eventually deprecated and retired:
- **Remove it completely.** Delete the version from `SUPPORTED_VERSIONS`, delete any transformation code, delete tests for the old version's behavior.
- **No backward-compatibility shims.** No `// legacy` comments, no re-exports, no dead code.
- Requests with an unsupported version get a clear error: `{ error: { code: "unsupported_api_version", message: "API version '2026-04-01' is no longer supported. Use '2027-01-01' or later." } }`
- This matches the project-wide principle: zero external users means zero legacy debt. Even post-launch, published sunset dates give consumers a hard deadline.

---

## Implementation Summary (Completed 2026-03-19)

| Item | Files Changed |
|---|---|
| Migration: `api_version` on `api_keys` | `drizzle/0022_api_keys_api_version.sql`, `packages/db/src/schema.ts` |
| `lib/api-version.ts` utility (+ proxy SYNC copy) | `lib/api-version.ts`, `apps/proxy/src/lib/api-version.ts` |
| Proxy auth chain | `api-key-auth.ts`, `auth.ts`, `context.ts`, `index.ts` |
| Dashboard auth chain | `lib/auth/api-key.ts`, `lib/auth/with-api-key-auth.ts` |
| SDK: `NullSpend-Version` header | `packages/sdk/src/client.ts`, `types.ts` |
| Response headers (proxy + dashboard) | `headers.ts`, `anthropic-headers.ts`, `openai.ts`, `anthropic.ts`, `mcp.ts`, 5 dashboard routes |
| Webhook per-endpoint wiring | `openai.ts`, `anthropic.ts`, `mcp.ts`, `webhook-thresholds.ts` |
| Key creation | `app/api/keys/route.ts` |
| Tests | 8 new test files/tests, 20 existing test files updated |
| **Total** | **49 files, 534 insertions, 67 deletions** |

---

## Decisions (Locked)

1. **Infrastructure with full resolution chain.** Add the column, wire it through auth, resolve version from header → key → fallback, send from SDK, echo back. The resolution chain is fully wired even though it resolves to a single value today. Adding a second version later is a data/schema change, not a plumbing change.

2. **Key's `api_version` is the default, not just record-keeping.** When no `NullSpend-Version` header is sent, the key's stored version determines response shape. This matches the Stripe model and is the correct architecture.

3. **No version-gating logic.** One version exists. Don't build transformation machinery for hypothetical future versions. Build the minimal transformation for a specific change when that change ships.

4. **Clean deprecation.** When a version is retired, delete it entirely — code, tests, constants. No shims, no backward-compat layers. Published sunset dates give consumers a hard deadline. Zero legacy debt.

5. **Webhook version wired through.** Pass `endpoint.apiVersion` to builders instead of relying on `CURRENT_API_VERSION` default. Costs minutes now, saves a retrofit later.

This follows Google's advice (*"if you don't really need versioning, don't add unnecessary complexity"*), avoids Stripe's acknowledged burden (*"every new version is more code to understand and maintain"*), and captures the critical data (which version each key expects) that is impossible to retrofit later.

---

## Sources

See companion files for full source indexes:
- `api-versioning-platforms.md` — 8-platform deep dive with 30+ sources
- `api-versioning-pitfalls.md` — Anti-patterns and failure stories with 25+ sources
