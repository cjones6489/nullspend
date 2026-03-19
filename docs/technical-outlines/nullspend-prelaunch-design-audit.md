# NullSpend Pre-Launch Design Patterns Audit
## Industry Best Practices vs. Current Implementation

**Date:** 2026-03-18 (revised 2026-03-19 05:30 UTC)
**Purpose:** Detailed comparison of NullSpend's current design decisions against proven patterns from Stripe, Marqeta, PostHog, and modern API platform design. Specific recommendations for changes to make before the API surface becomes permanent.

**Context:** NullSpend has zero external users. Every header, URL, response shape, schema column, and method name can be changed freely right now. After the first external API key is issued, these decisions become permanent. This audit prioritizes getting the design right over minimizing implementation effort.

**Migration principle:** When implementing these changes, fully replace old patterns — no backward compatibility layers, no dual-format parsing, no legacy shims. All test mocks, assertions, and production code should use the new format exclusively. If the old pattern exists anywhere in the codebase after a migration, it's a bug. There are zero consumers to protect; keeping dead code around only creates confusion for future contributors.

---

## 1. Object ID Strategy: Prefixed, Type-Safe IDs

### Industry Pattern

Stripe popularized prefixed IDs (`pi_`, `cus_`, `ch_`, `sk_`, `pk_`) and the pattern has become the gold standard for developer-facing APIs. The TypeID spec (jetify-com/typeid, 26 language implementations, ~90K weekly NPM downloads) formalizes this: a human-readable prefix + base32-encoded UUIDv7 underneath. Buttondown recently migrated their entire API to TypeIDs, storing plain UUIDs in the database but presenting prefixed IDs at the API layer.

The core benefits: you can identify an object type from its ID alone (invaluable for debugging, logging, and support), you can grep logs for `ns_evt_` to find all cost events, and you can prevent the extremely common bug of passing a cost event ID where a budget ID was expected.

### NullSpend Current State

Database primary keys are raw UUIDs from Postgres `gen_random_uuid()`. API responses return these UUIDs without prefixes. However, several internal identifiers already use ad-hoc prefixes:

| Prefix | Usage | Location |
|---|---|---|
| `ask_` | API key raw values | `lib/auth/api-key.ts` |
| `evt_` | Webhook event payload IDs | `lib/webhooks/dispatch.ts` |
| `sdk_` | SDK-generated cost event request IDs | `lib/cost-events/ingest.ts` |
| `whsec_` | Webhook signing secrets | `app/api/webhooks/route.ts` |
| `ns_` | SDK idempotency keys | `packages/sdk/src/client.ts` |

These internal prefixes work but are inconsistent — no shared convention, no type safety at the API boundary.

### Recommendation: Add Prefixed IDs at the API Layer

Don't change the database — keep UUID PKs (best for Postgres performance and indexing). Add a thin mapping layer that prepends type prefixes when IDs leave the API and strips them on the way in. Two categories of prefixed IDs:

**API-response IDs** (returned from REST endpoints, stored by consumers):
```
ns_key_     API keys
ns_evt_     Cost events
ns_bgt_     Budgets
ns_act_     Actions (approval workflow)
ns_wh_      Webhook endpoints
ns_del_     Webhook deliveries
ns_usr_     User references (in API responses)
ns_pol_     Policies (future)
ns_team_    Teams (future)
```

The `ns_` global prefix prevents collision with any other system's IDs. The type prefix after `ns_` makes every ID self-describing.

**Internal/payload IDs** (already established, do not change):
```
evt_        Webhook event payload IDs (used in X-NullSpend-Webhook-Id header)
sdk_        SDK-generated request IDs (used in cost event dedup)
whsec_      Webhook signing secrets (never exposed in API responses)
```

These internal prefixes are never stored by external consumers and don't need the `ns_` global prefix. Changing them would require updating webhook signature verification code that consumers may have deployed.

**Note on TypeID vs. simple prefix:** The full TypeID spec uses Crockford's base32 encoding for shorter IDs. For a B2B API where debuggability matters more than URL brevity, the simpler `ns_evt_{uuid}` format is better — developers can paste the UUID portion directly into Postgres queries without decoding.

Implementation: a utility function `toExternalId(type: string, uuid: string): string` and `fromExternalId(id: string): { type: string; uuid: string }`. Applied in API route handlers at the response boundary. The SDK's response type interfaces (`CreateActionResponse`, `ReportCostResponse`, etc.) already expect string IDs, so the SDK needs no changes — only the server-side route handlers.

**Files that return IDs to consumers (need prefixing):**
- `app/api/actions/route.ts` — action IDs
- `app/api/keys/route.ts` — API key IDs
- `app/api/budgets/route.ts` — budget IDs
- `app/api/cost-events/route.ts` and `batch/route.ts` — cost event IDs
- `app/api/webhooks/route.ts` — webhook endpoint IDs
- `lib/webhooks/dispatch.ts` — webhook event IDs in payloads (already prefixed with `evt_`)

**Estimated effort:** ~3 hours (utility + route handler updates + test fixture updates).

**Priority: High.** This is the single highest-leverage pre-launch change. Once external consumers store raw UUIDs in their databases, adding prefixes is a breaking change.

---

## 2. API Key Format and Scoping

### Industry Pattern

Stripe uses a two-dimensional key format: `sk_live_`, `sk_test_`, `pk_live_`, `pk_test_`. The first segment (`sk`/`pk`) determines permission level (secret vs. publishable). The second segment (`live`/`test`) determines environment. This simple prefix convention prevents four categories of bugs: using a test key in production, using a live key in test, using a publishable key where a secret key is needed, and leaking a secret key in client-side code.

Modern API key formats across the industry:

| Provider | Format | What the prefix encodes |
|---|---|---|
| Stripe | `sk_live_...`, `pk_test_...` | Permission level + environment |
| GitHub | `ghp_...`, `ghu_...`, `gha_...` | Key type (personal, user-to-server, app) |
| OpenAI | `sk-proj-...` | Key type + scope (project-scoped) |
| Anthropic | `sk-ant-api03-...` | Provider + API version |

Discord's AutoMod can automatically detect and flag `sk_live_` strings in messages. GitHub's Secret Scanning Partner Program detects keys by prefix regex — the prefix IS the security feature.

### NullSpend Current State

API keys use `ask_` + 32 hex characters (16 random bytes). The prefix is hardcoded in `lib/auth/api-key.ts`:

```typescript
export const API_KEY_PREFIX = "ask_";

export function generateRawKey(): string {
  return API_KEY_PREFIX + randomBytes(16).toString("hex");
}

export function extractPrefix(rawKey: string): string {
  return rawKey.slice(0, 12);  // "ask_" + 8 hex chars
}
```

The `ask_` prefix is:
- Not distinctive enough for secret scanning (too short, generic substring)
- Does not encode environment (live vs. test)
- Does not encode permission level (secret vs. publishable)
- Does not include the `ns` brand prefix for global uniqueness

### Recommendation: Adopt a Stripe-Style Key Format

```
ns_live_sk_[random]     Live secret key (full access)
ns_test_sk_[random]     Test/sandbox secret key (future)
ns_live_pk_[random]     Live publishable key (read-only, future)
ns_test_pk_[random]     Test publishable key (future)
```

Start by issuing all keys as `ns_live_sk_[random]`. The format has room for environment and permission dimensions without future format changes. When you add sandbox mode later, you issue `ns_test_sk_[random]` keys that hit a separate environment. The prefix tells the proxy which environment to use.

**GitHub Secret Scanning registration:** Register `ns_live_sk_` and `ns_test_sk_` as patterns with the GitHub Secret Scanning Partner Program (email `secret-scanning@github.com`). This is free and protects users from accidentally committing keys to public repos. The regex pattern would be: `ns_(live|test)_sk_[a-f0-9]{32}`.

**Files that need updating:**
- `lib/auth/api-key.ts` — `API_KEY_PREFIX`, `generateRawKey()`, `extractPrefix()` (prefix length changes from 4 to 11, so `keyPrefix` column width and slice offset change)
- `apps/proxy/src/lib/api-key-auth.ts` — proxy-side key validation and caching
- `packages/db/src/schema.ts` — `keyPrefix` column may need length adjustment
- `app/api/keys/route.ts` — key creation endpoint
- Test fixtures across the codebase that use `ask_test123` as mock keys
- SDK tests in `packages/sdk/src/client.test.ts` that use `ask_test123`

**Estimated effort:** ~3 hours (prefix change + extractPrefix logic + proxy auth + test fixtures).

**Priority: High.** Key format is permanent. Every developer who creates an API key stores that format in their env files, CI pipelines, and Terraform configs.

### Implementation Notes (2026-03-18)

**What shipped:**

| Change | File(s) |
|---|---|
| `API_KEY_PREFIX` changed from `"ask_"` to `"ns_live_sk_"` | `lib/auth/api-key.ts` |
| `extractPrefix()` slice changed from 12 to 19 chars (`ns_live_sk_` + 8 hex) | `lib/auth/api-key.ts` |
| Pre-commit hook detects `ns_(live\|test)_(sk\|pk)_[a-f0-9]{32}` | `.claude/scripts/check-secrets.sh` |
| Seed script uses `generateRawKey()`/`hashKey()`/`extractPrefix()`, prints raw keys | `scripts/seed-budgets.ts` |
| All `ask_`, `as_live_`, `as_seed_` test fixtures → `ns_live_sk_` format | 26 test files |
| E2E scripts updated to new format | `scripts/e2e-auth-hardening.ts`, `e2e-smoke.ts`, `e2e-observability.ts` |
| Documentation updated | 3 README files, `.env.smoke.example`, `unified-policy-engine-spec.md` |
| Regression tests added | Format regex, prefix regex, negative old-prefix test in `key-utils.test.ts` |
| Existing dev keys revoked, new `ns_live_sk_` keys created | Database + `.env.smoke` |

**Key design decisions:**

- **No prefix validation gates.** Auth is hash-based and format-agnostic. Adding `isValidKeyFormat()` would break the dashboard's dev fallback path (`NULLSPEND_API_KEY` env var accepts arbitrary strings). Validation is a separate concern if needed later.
- **No environment column added.** All keys are `ns_live_sk_` — the prefix encodes environment. Column can be added when sandbox mode ships.
- **Hex encoding, not base62.** Simpler to generate, debug, and regex-match. 128-bit entropy (32 hex chars) is cryptographically strong. GitHub Secret Scanning regex: `ns_(live|test)_sk_[a-f0-9]{32}`.
- **`keyPrefix` column unchanged.** `text` type, no width constraint. New 19-char prefix fits without schema migration.
- **Proxy auth unchanged.** `api-key-auth.ts` lookups are purely hash-based — format change is transparent.

**Three-pass audit findings caught and fixed:**

- **Critical:** `lib/validations/api-keys.test.ts:72` had `expect(result.rawKey).toContain("ask_")` — explicit format assertion that would pass vacuously after migration if missed
- **Critical:** `budget-edge-cases.test.ts:333` had `expect(text).not.toContain("ask_")` — security leak detection that would pass vacuously if not updated to `"ns_live_sk_"`
- **High:** `app/api/keys/route.test.ts` used transitional `as_live_` prefix, invisible to `grep "ask_"` verification
- **High:** `scripts/seed-budgets.ts` used `as_seed_` prefix with manual key construction — replaced with proper `generateRawKey()` imports
- **Medium:** Test description strings in `key-utils.test.ts` referenced old format/length in names

**Follow-up:** Register `ns_live_sk_` and `ns_test_sk_` patterns with GitHub Secret Scanning Partner Program (email `secret-scanning@github.com`). This is an external action, not a code change.

---

## 3. Error Response Contract

### Industry Pattern

The consensus across Stripe, GitHub, Google, and RFC 9457 (Problem Details for HTTP APIs, published July 2023) is a consistent structure with machine-readable code, human-readable message, and optional details.

**Stripe's format** (the practical standard for developer APIs):
```json
{
  "error": {
    "code": "budget_exceeded",
    "message": "Request would exceed budget for api_key:ns_key_abc",
    "details": {
      "remaining_microdollars": 500000,
      "estimated_cost_microdollars": 750000,
      "entity_type": "api_key",
      "entity_id": "ns_key_abc"
    },
    "doc_url": "https://docs.nullspend.com/errors/budget-exceeded"
  }
}
```

**RFC 9457** uses `type` (URI), `title`, `status`, `detail`, and `instance` fields with `application/problem+json` media type. It's more formal but less ergonomic than the Stripe pattern. Pure RFC 9457 adoption is uncommon in developer-facing APIs — the Stripe-inspired pattern dominates. However, the structure can be made RFC 9457-compatible by adding a `type` URI field later.

Key principles: `code` is snake_case (machine-readable, used in `if` statements), `message` is a complete sentence (human-readable, shown in logs), `details` is a structured object (context-specific), and `doc_url` links to documentation for that specific error.

### NullSpend Current State

The codebase uses a **flat** error format via `lib/utils/http.ts`:

```typescript
function errorJson(error: string, message: string, extra?: Record<string, unknown>) {
  return { error, message, ...extra };
}
```

This produces `{ error: "snake_code", message: "..." }` — the `error` field IS the machine code directly.

Existing error codes in `handleRouteError()` (`lib/utils/http.ts`):

| Code | Status | Usage |
|---|---|---|
| `invalid_json` | 400 | Request body parse failure |
| `unsupported_media_type` | 415 | Wrong Content-Type |
| `payload_too_large` | 413 | Body exceeds limit |
| `validation_error` | 400 | Zod validation failure |
| `not_found` | 404 | Resource not found |
| `invalid_action_transition` | 409 | Invalid state change |
| `stale_action` | 409 | Optimistic concurrency conflict |
| `action_expired` | 409 | TTL expired |
| `authentication_required` | 401 | Missing/invalid credentials |
| `forbidden` | 403 | Insufficient permissions |
| `service_unavailable` | 503 | Circuit breaker open |
| `internal_error` | 500 | Unhandled error |

Additional codes in specific routes: `limit_exceeded` (409), `spend_cap_exceeded` (400).

**The problem:** The flat format (`{ error: "code", message: "..." }`) is incompatible with the nested format (`{ error: { code, message, details } }`). This is a structural change, not just adding fields.

### Recommendation: Migrate to Nested Error Format + Standardize the Enum

This is a breaking change to every API response, the SDK's error parsing, and the proxy's error responses. Since there are zero external consumers, do it now.

**Step 1: Define the complete error code enum.**

```typescript
// lib/errors/codes.ts — Machine-readable error codes (API surface, permanent)
export const ERROR_CODES = {
  // Auth
  INVALID_API_KEY: "invalid_api_key",
  EXPIRED_API_KEY: "expired_api_key",
  REVOKED_API_KEY: "revoked_api_key",
  MISSING_API_KEY: "missing_api_key",
  INSUFFICIENT_PERMISSIONS: "insufficient_permissions",

  // Enforcement
  BUDGET_EXCEEDED: "budget_exceeded",
  RATE_LIMITED: "rate_limited",
  MODEL_NOT_ALLOWED: "model_not_allowed",
  COST_CAP_EXCEEDED: "cost_cap_exceeded",
  APPROVAL_REQUIRED: "approval_required",
  APPROVAL_REJECTED: "approval_rejected",
  APPROVAL_TIMEOUT: "approval_timeout",

  // Validation
  VALIDATION_ERROR: "validation_error",
  INVALID_JSON: "invalid_json",
  BATCH_TOO_LARGE: "batch_too_large",
  UNSUPPORTED_MEDIA_TYPE: "unsupported_media_type",
  PAYLOAD_TOO_LARGE: "payload_too_large",

  // Resource
  NOT_FOUND: "not_found",
  CONFLICT: "conflict",
  LIMIT_EXCEEDED: "limit_exceeded",
  INVALID_ACTION_TRANSITION: "invalid_action_transition",
  STALE_ACTION: "stale_action",
  ACTION_EXPIRED: "action_expired",

  // Server
  INTERNAL_ERROR: "internal_error",
  SERVICE_UNAVAILABLE: "service_unavailable",
  UPSTREAM_ERROR: "upstream_error",
} as const;
```

**Step 2: Update the error response helper.**

```typescript
function errorResponse(
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>
): NextResponse {
  return NextResponse.json({
    error: { code, message, details: details ?? null }
  }, { status });
}
```

**Step 3: Update SDK error parsing.**

The SDK's `request()` method in `packages/sdk/src/client.ts` currently parses errors as:
```typescript
detail = String(json.error ?? json.message ?? response.statusText);
```

This must change to handle the nested format:
```typescript
const errorObj = json.error;
if (typeof errorObj === "object" && errorObj !== null) {
  detail = String(errorObj.message ?? errorObj.code ?? response.statusText);
  code = String(errorObj.code ?? "");
} else {
  detail = String(errorObj ?? response.statusText);
}
```

Consider adding a `code` property to `NullSpendError` so consumers can write `if (err.code === 'budget_exceeded')`.

**Step 4: Update proxy error responses.**

The proxy in `apps/proxy/` returns its own error responses (budget denials, auth failures, upstream errors). These must also adopt the nested format.

**Files that need updating:**
- `lib/utils/http.ts` — `errorJson()`, `handleRouteError()`
- All `app/api/` route handlers with custom error responses
- `packages/sdk/src/client.ts` — error parsing in `request()`
- `packages/sdk/src/errors.ts` — add `code` property to `NullSpendError`
- `apps/proxy/src/` — error response helpers
- Tests across all surfaces that assert on error response shapes

The `doc_url` field can be added later when docs exist. The structure (`{ error: { code, message, details } }`) must be locked now.

**Estimated effort:** ~5-6 hours (error helper + route handlers + SDK parsing + proxy responses + test updates).

**Priority: High.** Developers write `if (err.code === 'budget_exceeded')` in their catch blocks. The code enum and response shape are permanent API surface.

---

## 4. Webhook Event Type Taxonomy

### Industry Pattern

Stripe events follow a strict `resource.action` naming convention: `charge.succeeded`, `invoice.created`, `customer.subscription.deleted`. The naming is hierarchical — subresources use dots as separators. Events are versioned with the API version, and webhook endpoints can filter by event type.

Stripe recently introduced "thin events" (lightweight notifications containing only the object ID) alongside "snapshot events" (containing the full object state). Thin events are unversioned — a major architectural advantage since the payload doesn't need to match the consumer's API version.

Critical Stripe pattern: webhook endpoints occasionally receive the same event more than once. Consumers must be idempotent, and Stripe provides the event ID for deduplication.

### NullSpend Current State

Six event types are already defined in `lib/validations/webhooks.ts`:

```typescript
export const WEBHOOK_EVENT_TYPES = [
  "cost_event.created",
  "budget.threshold.warning",
  "budget.threshold.critical",
  "budget.exceeded",
  "budget.reset",
  "request.blocked",
  "action.created",
  "action.approved",
  "action.rejected",
  "action.expired",
  "test.ping",
] as const;
```

The webhook event structure (`lib/webhooks/dispatch.ts`):
```typescript
export interface WebhookEvent {
  id: string;        // "evt_{uuid}"
  type: string;      // from WEBHOOK_EVENT_TYPES
  api_version: string; // "2026-04-01"
  created_at: number;  // Unix timestamp seconds
  data: { object: Record<string, unknown> };
}
```

Signature format: `t={timestamp},v1={hex}` (Stripe-compatible), delivered via `X-NullSpend-Signature` header. Additional headers: `X-NullSpend-Webhook-Id`, `X-NullSpend-Webhook-Timestamp`.

### Recommendation: Lock the Full Event Taxonomy

The existing 6 types use a consistent naming convention. Extend with the full planned taxonomy:

```
# Cost tracking (active)
cost_event.created          — A cost event was recorded

# Budget enforcement (active)
budget.threshold.warning    — Budget crossed a warning threshold
budget.threshold.critical   — Budget crossed a critical threshold
budget.exceeded             — A request was denied due to budget exhaustion

# Request enforcement (active)
request.blocked             — A request was blocked by the enforcement pipeline (reason in data.object.reason: "budget" | "rate_limit" | "policy")

# Budget lifecycle (future — reserve names now)
budget.created              — A new budget was configured
budget.updated              — A budget's limit or policy was changed
budget.deleted              — A budget was removed
budget.reset                — A budget's spend was reset (manual or periodic)

# Approval workflow (future — reserve names now)
action.pending              — An action was created and awaits approval
action.approved             — An action was approved
action.rejected             — An action was rejected
action.expired              — An action expired without a decision
action.executed             — An approved action completed successfully
action.failed               — An approved action failed during execution

# API key lifecycle (future — reserve names now)
api_key.created
api_key.revoked

# Test
ping                        — Test event for verifying webhook delivery
```

**Conventions (locked):** All lowercase, dots as separators, `resource.past_tense_verb` pattern. No present tense (`budget.exceed` is wrong, `budget.exceeded` is right). No camelCase. No hyphens. Subresource nesting via dots (`budget.threshold.warning`).

**Add `api_version` field to webhook events:**

```json
{
  "id": "evt_01h455vb4pex...",
  "type": "cost_event.created",
  "created_at": "2026-03-18T...",
  "api_version": "2026-03-01",
  "data": { ... }
}
```

The `api_version` field (Stripe's pattern) lets you evolve the `data` payload structure without breaking existing consumers. When you change the shape of `data` in a future version, old webhook endpoints continue receiving the shape they were registered with. At launch, all events use the single initial version.

**Thin events (future-compatible):** Start with snapshot events (full data in payload — simpler for consumers and appropriate at launch volume). The event structure is already forward-compatible with thin events — a thin event would simply have `data: { id: "ns_evt_..." }` instead of the full object. No structural changes needed when you add thin events later.

**Estimated effort:** ~1 hour (add `api_version` field to `WebhookEvent`, update `buildCostEventWebhookPayload`, add reserved types to validation).

**Priority: High.** Event type names are used in webhook endpoint configurations, consumer code switch statements, and monitoring alerts. They're permanent.

---

## 5. API Versioning Strategy

### Industry Pattern

Stripe uses date-based API versioning (`2025-03-31`) rather than numeric versioning (`v1`, `v2`). Each API key has a "default version" set at creation time. Requests can override with a `Stripe-Version` header. Breaking changes ship in new dated versions; non-breaking changes apply to all versions.

Stripe's three engineering principles for API versioning:
- **Lightweight:** Minimize upgrade cost for consumers
- **First-class:** Integrate versioning into docs and tooling automatically
- **Fixed-cost:** Tightly encapsulate old behavior so new development isn't burdened

Internally, Stripe uses "version change modules" — self-contained transformations that encapsulate each breaking change. Response processing applies version gates backward from the current version to the target version.

NullSpend's proxy passthrough paths already use `/v1/` (matching OpenAI's convention). The dashboard API routes use `/api/` without versioning.

### Recommendation: Add Version Column and Header Parsing

Keep `/v1/` on the proxy passthrough paths — that's the upstream provider's convention, not NullSpend's versioning. For NullSpend's own API surface (dashboard routes, SDK endpoints), adopt Stripe's pattern:

1. Add `api_version` column to `api_keys` table (set at key creation time, default to `'2026-03-01'`).
2. Parse `NullSpend-Version` header in API routes (optional override). Store/log the requested version.
3. Do **not** build version-gating logic. There is only one version at launch. The infrastructure (column + header parsing) is the important part — it gives you the data to know which version each consumer expects when you eventually need to make a breaking change.

This is minimal implementation cost now. It's impossible to retrofit later without guessing which version each consumer was "born into."

**Estimated effort:** ~30 minutes (schema column + header parsing middleware).

**Priority: Medium.** Not blocking for launch, but the `api_version` column must exist before the first API key is created.

---

## 6. Schema Columns to Add Before Launch

### cost_events Table

| Column | Type | Why | Priority |
|---|---|---|---|
| `source` | `text NOT NULL DEFAULT 'proxy'` | Distinguishes proxy vs. SDK (`sdk`) vs. MCP proxy (`mcp`) events. Critical for dedup — without this, you cannot tell which system generated a cost event, and the documented double-counting risk is unmitigable. | **High** |
| `trace_id` | `text NULL` | OTel trace ID from `traceparent` header. Links NullSpend events to developer's existing traces. Nullable and zero enforcement logic, so adding it later is trivial — but having it from day one means early adopters who use OTel get free integration. | **Low** |

**Columns considered and excluded:**

| Column | Why excluded |
|---|---|
| `budget_check_result` | Cost events are only created after a request succeeds. Denied requests don't generate cost events (there's no token usage to record). Recording denial decisions belongs in the `request.blocked` webhook event or a future `enforcement_events` table, not on cost events. |
| `enforcement_latency_ms` | Derivable from existing columns: `durationMs - upstreamDurationMs` gives approximate enforcement overhead. A dedicated column isn't worth the schema surface area. |

### api_keys Table

| Column | Type | Why | Priority |
|---|---|---|---|
| `api_version` | `text NOT NULL DEFAULT '2026-03-01'` | Stripe-style API versioning. Records which API version this key was created under, used as the default response version. | **High** |
| `environment` | `text NOT NULL DEFAULT 'live'` | `live` or `test`. Enables sandbox mode later without schema changes. At launch, all keys are `live`. | **Medium** |

**Columns considered and excluded:**

| Column | Why excluded |
|---|---|
| `has_policies` | No policies feature exists yet. Adding a column that's always `false` is premature schema pollution. Add when the policies feature is built — it mirrors the existing `has_budgets` pattern and can be added without migration risk. |

### budgets Table

| Column | Type | Why | Priority |
|---|---|---|---|
| `warn_threshold_pct` | `integer NULL` | Percentage at which to fire `budget.threshold.warning` webhook (e.g., 80). The webhook event types `budget.threshold.warning` and `budget.threshold.critical` already exist in the codebase, but there's no per-budget configuration for what percentage triggers them. Without this column, thresholds must be hardcoded. | **Medium** |

### webhook_endpoints Table (for secret rotation — see Section 7)

| Column | Type | Why | Priority |
|---|---|---|---|
| `previous_signing_secret` | `text NULL` | Holds the old signing secret during 24-hour rotation window. | **Medium** |
| `secret_rotated_at` | `timestamp NULL` | When the current secret replaced the previous one. Used to enforce the 24-hour expiry. | **Medium** |

All columns are nullable or have defaults — non-breaking additions. Adding them before launch means every row of data has these fields from day one.

**Estimated effort:** ~1 hour total for all schema additions + migration.

**Priority: High for `source` and `api_version`.** Medium for the rest.

---

## 7. Webhook Secret Rotation

### Industry Pattern

Stripe supports a 24-hour rolling secret transition: when you rotate a webhook signing secret, both the old and new secrets are valid for 24 hours. This gives consumers time to update their verification code without missing events. The NullSpend security audit identified this as a known gap: "Secret rotation lacks 24-hour transition period."

### Recommendation

Add `previous_signing_secret` (nullable) and `secret_rotated_at` (nullable timestamp) to `webhook_endpoints` (see Section 6). When the signing secret is rotated:

1. Move the current `signingSecret` to `previous_signing_secret`.
2. Generate a new `signingSecret`.
3. Set `secret_rotated_at` to now.
4. The dispatch module signs with BOTH secrets during the 24-hour window, sending two signature values in the header: `t={ts},v1={new_sig},v1={old_sig}`.
5. Consumers try verification with each `v1` value until one matches.
6. After 24 hours, a scheduled job (or lazy check on next dispatch) NULLs out `previous_signing_secret`.

This is a small change with disproportionate impact on developer trust. It means consumers never have to worry about webhook downtime during secret rotation.

**Estimated effort:** ~1 hour (schema + dispatch signing + rotation endpoint + expiry check).

**Priority: Medium.** Not blocking for launch, but should be in the first month.

---

## 8. Rate Limiting Response Headers

### Industry Pattern

Standard rate limiting headers (adopted by most APIs): `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, and `Retry-After` on 429 responses. The NullSpend SDK already parses `Retry-After` for retry logic. The proxy and dashboard routes already apply rate limit headers via `applyRateLimitHeaders`.

### Recommendation

Verify that the header names are consistent across all surfaces (proxy, dashboard API). Use the standard names: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` (Unix timestamp). For budget denial responses (429), add `X-NullSpend-Budget-Remaining` and `X-NullSpend-Budget-Limit` custom headers so the SDK can surface budget state without parsing the response body.

**Estimated effort:** ~30 minutes (verify consistency, add budget headers to 429 responses).

**Priority: Low.** Mostly in place already. Just verify consistency.

---

## 9. Summary: Pre-Launch Checklist

### High Priority (must complete before first external API key)

| Item | Current State | Action Needed | Effort |
|---|---|---|---|
| ~~DO-first budget enforcement (Section 11)~~ **DONE** | ~~Postgres queried on every cache miss~~ | ~~Eliminate Postgres from hot path~~ Deployed 2026-03-18. Single DO RPC, 1-5ms. | ~~3-4 hours~~ |
| ~~Prefixed object IDs (Section 1)~~ **DONE** | ~~Raw UUIDs in API responses~~ | ~~Add `ns_` prefix mapping layer at API boundary~~ Deployed 2026-03-18. Zod schema transforms on all 8 resource types, 47 files changed. Three-pass audit completed. | ~~3 hours~~ |
| ~~API key format (Section 2)~~ **DONE** | ~~`ask_` prefix, no env/permission encoding~~ | ~~Migrate to `ns_live_sk_` format + register with GitHub Secret Scanning~~ Format migrated 2026-03-18. `ns_live_sk_` + 32 hex chars (43 total). 35+ files updated, three-pass audit completed. GitHub Secret Scanning registration is a follow-up external action. | ~~3 hours~~ |
| ~~Error response contract~~ **DONE** | ~~Flat `{ error, message }` format~~ | ~~Migrate to nested `{ error: { code, message, details } }` + SDK parsing + proxy~~ Completed 2026-03-18. | ~~5-6 hours~~ |
| Webhook event taxonomy | 6 types defined, no `api_version` on events | Lock full taxonomy + add `api_version` field to event structure | ~1 hour |
| `source` column on cost_events | Missing | Add column (`DEFAULT 'proxy'`) + set in all ingestion paths | ~30 min |
| `api_version` on api_keys | Missing | Add column (`DEFAULT '2026-03-01'`) + header parsing | ~30 min |

### Completed — Budget Enforcement Architecture (2026-03-18)

| Item | Status |
|---|---|
| ~~Remove `hasBudgets` early-exit~~ | **DONE** — Removed from budget-orchestrator.ts, mcp.ts route, MCP proxy CostTracker |
| ~~Remove `hasBudgets` from auth~~ | **DONE** — Removed from ApiKeyIdentity, AuthResult, auth SQL (EXISTS subquery removed), introspect endpoint, budget status response, SDK BudgetStatus type, budgetStatusResponseSchema. Deleted lib/auth/check-has-budgets.ts |
| ~~Reduce auth cache TTL~~ | **DONE** — 60s → 30s |
| ~~Remove vestigial `source` field~~ | **DONE** — Removed `source: "postgres"` from budget status response + validation schema (always one source, field was redundant) |
| ~~Stale Redis comments~~ | **DONE** — Updated 4 proxy comments referencing Redis HINCRBY / cache rebuilds to reference DO architecture |
| ~~Rate limit headers~~ | **DONE** — Proxy forwards upstream `x-ratelimit-*`, dashboard applies standard headers |

### Medium Priority (should complete before launch or within first month)

| Item | Current State | Action Needed | Effort |
|---|---|---|---|
| Schema columns (Section 6) | Missing columns on 3 tables | Add `source` on cost_events, `api_version` + `environment` on api_keys, `warn_threshold_pct` on budgets | ~1 hour |
| Webhook secret rotation | No transition period | Add `previous_signing_secret` + dual-signing + 24h expiry | ~1 hour |

### Low Priority (can do incrementally after launch)

| Item | Current State | Action Needed | Effort |
|---|---|---|---|
| `trace_id` on cost_events | Missing | Add nullable column + `traceparent` extraction in proxy | ~30 min |
| `doc_url` on error responses | Missing | Add to error helper when docs site exists | ~15 min |
| Thin webhook events | Not needed at launch volume | Design is forward-compatible; implement when scale requires it | TBD |

See Section 10 for budget enforcement architecture analysis, Section 11 for DO-first implementation notes.

### Explicitly Deferred (not needed pre-launch)

| Item | Why deferred |
|---|---|
| `budget_check_result` on cost_events | Wrong table — denials don't create cost events. Use `request.blocked` webhook or future `enforcement_events` table. |
| `enforcement_latency_ms` on cost_events | Derivable from `durationMs - upstreamDurationMs`. Not worth schema surface area. |
| `has_policies` on api_keys | No policies feature exists. Add with the feature. (Note: `has_budgets` pattern was removed — do not reintroduce cached existence flags; always check the authoritative source.) |
| API version-gating logic | Only one version at launch. The column + header parsing is the important part; build gating when the first breaking change ships. |
| Postgres to ClickHouse migration | Right choice at launch scale. Migration trigger is well-understood (>1M rows, slow analytics). |
| Multi-region DO replication | Smart Placement handles latency. Active-active budget enforcement is a hard distributed systems problem not needed until multi-continent users. |

---

## 10. Budget Enforcement Architecture: Remove `hasBudgets` Early-Exit

### The Problem

The proxy's budget enforcement pipeline has a critical fast-path optimization that creates a 60-second enforcement bypass window after every budget creation or deletion:

```
checkBudget() [budget-orchestrator.ts:73]
  └─ if (!ctx.auth.hasBudgets) return skipped  ← EARLY EXIT
  └─ checkBudgetDO(...)  ← never reached if hasBudgets is false
```

The `hasBudgets` flag is determined by a Postgres `EXISTS` subquery during API key authentication and cached for 60 seconds in a module-level Map (per Worker isolate). When a user creates their first budget:

1. Isolates that already cached `hasBudgets: false` continue skipping enforcement for up to 60 seconds
2. The `/internal/budget/invalidate` endpoint clears the auth cache on the isolate that handles the request, but Cloudflare distributes requests across multiple isolates — other isolates retain stale caches
3. There is **no mechanism** to broadcast cache invalidation across Worker isolates (confirmed by Cloudflare documentation)

This is not a test issue — it affects production. A user who creates a budget and immediately sends an AI request may not see enforcement for up to 60 seconds.

### Root Cause Analysis (from debugging session 2026-03-18)

Three layers of budget state were identified:

| Layer | Location | TTL | Invalidation |
|---|---|---|---|
| Auth cache (`hasBudgets`) | Per-isolate module-level Map | 60s | Only on the isolate that handles the invalidation request |
| DO lookup cache (entity list) | Per-isolate module-level Map | 60s | `invalidateDoLookupCacheForUser()` — same isolate limitation |
| Durable Object SQLite | Single global instance per userId | Permanent | `removeBudget()`, `syncBudgets()` — always consistent |

The DO (Layer 3) is always correct. The problem is that Layer 1 gates access to the DO — if the auth cache says "no budgets", the request never reaches the DO.

### Industry Precedent

**Stripe Issuing** and **Marqeta** both evaluate spend controls synchronously on every transaction. Neither caches "does this entity have controls?" — they always check. The rationale: caching the *existence* of controls is a false optimization when the control check itself is fast.

### Recommended Architecture

**Remove the `hasBudgets` early-exit entirely. Always call the DO.**

```
Current flow:
  Auth (Postgres + cache) → hasBudgets check → DO lookup (Postgres + cache) → DO check

Recommended flow:
  Auth (Postgres + cache) → DO lookup (Postgres + cache) → DO check
```

The DO's `checkAndReserve()` already handles the "no budgets" case efficiently — a `SELECT * FROM budgets` on an empty table completes in microseconds (same-thread SQLite, zero network hop). The `checkAndReserve` method was also updated to defensively read ALL rows in its SQLite storage, not just the entities the caller passes, so stale DO lookup caches can't cause missed enforcement.

**Performance impact:** The DO RPC call adds 1-20ms for same-region traffic. Upstream LLM API calls take 500ms-60s. The overhead is negligible (<1% of total request time).

**Implementation:**

1. In `budget-orchestrator.ts`: remove `if (!ctx.auth.hasBudgets) return skipped` at line 73
2. In `api-key-auth.ts`: remove the `EXISTS(SELECT 1 FROM budgets ...)` subquery from the auth SQL. Remove `hasBudgets` from the `ApiKeyIdentity` interface. This simplifies the auth query and reduces Postgres load.
3. In `auth.ts`: remove `hasBudgets` from the `AuthResult` interface
4. Keep the `doLookupCache` as-is — it caches the Postgres→DO entity sync and is an optimization for avoiding redundant Postgres queries. Its staleness is safe because the DO checks all its own rows regardless.
5. Reduce auth cache TTL from 60s to 30s for faster key revocation propagation (independent improvement)
6. Update unit tests that mock `hasBudgets`

**Estimated effort:** ~1.5 hours (remove field from 3 interfaces, update auth SQL, remove early-exit, update ~30 test fixtures).

### Alternatives Considered and Rejected

| Alternative | Why rejected |
|---|---|
| **KV as cache coordination layer** | KV propagation is also eventually consistent (30-60s). Trades one consistency window for another, adds a new dependency. |
| **Reduce auth cache TTL to 5s** | Shrinks the window but doesn't eliminate it. Increases Postgres load by 12x. |
| **Broadcast invalidation via DO** | DOs can't push to Worker isolates. The communication is pull-only (Worker→DO). |
| **Use Cache API for cross-isolate state** | Cache API is per-colo, not per-isolate. Better than module-level Maps but still not globally consistent. |

### What This Enables

- Budget creation takes effect **immediately** on the next request (no 60-second window)
- Budget deletion takes effect immediately (no stale `hasBudgets: true` allowing DO checks on deleted budgets)
- Simplified auth SQL (one fewer subquery per request)
- Simplified codebase (remove `hasBudgets` from 3 interfaces and all test fixtures)
- Budget smoke tests become reliable (the primary failure mode is eliminated)

---

## 11. DO-First Budget Enforcement: Eliminate Postgres from the Hot Path — DONE

> **Implemented 2026-03-18.** Deployed to production as commit `23184e4`. Live smoke tests confirm 429 enforcement on $0 budgets and 200 passthrough for tracking-only users. See implementation notes at the end of this section.

### The Problem

After removing the `hasBudgets` early-exit (Section 10), every request calls `checkBudgetDO()` which queries Postgres via `lookupBudgetsForDO()` to discover which budget entities exist before calling the DO. This adds 15-50ms to every cache miss. Worse, empty results (tracking-only users) are intentionally not cached, so tracking-only users pay a Postgres roundtrip on **every request**.

| Scenario | Current latency added | Bottleneck |
|---|---|---|
| With budgets, cache hit | 2-5ms | DO RPC only |
| With budgets, cache miss | 30-150ms | Postgres lookup |
| Tracking-only (no budgets) | 30-80ms per request | Postgres lookup, never cached |

The DO's internal computation (SQLite check + reserve) is sub-millisecond. The DO RPC hop is 1-5ms colocated. **Postgres is the only thing keeping us from sub-5ms enforcement on every request.**

### Industry Precedent

| System | Pattern | Per-request latency |
|---|---|---|
| **Stripe Issuing** | Pre-load all spend controls, evaluate locally, timeout fallback | Sub-50ms internal |
| **LaunchDarkly** | Download all rules via streaming, evaluate in-memory, zero network per eval | Sub-1ms |
| **Marqeta JIT Funding** | Card balance is $0, authorize by funding exact amount in real-time | Sub-3s end-to-end |
| **Envoy local rate limit** | In-process token bucket, no external calls | Sub-microsecond |
| **CF Native Rate Limiting** | Per-location counters, async backing store sync | Sub-1ms |

The common pattern: **pre-load state into a local evaluator, evaluate with zero network calls per request, sync state changes asynchronously.**

NullSpend's DO already implements this pattern at 90% — `blockConcurrencyWhile` loads all budget rows into memory, `checkAndReserve` evaluates against the in-memory Map. The remaining 10% is removing the Postgres query that gates access to the DO.

### Recommended Architecture: DO as the Only Read Path

Remove `lookupBudgetsForDO()` from the request hot path. The DO already knows its own state.

```
Current flow (3 network calls on cache miss):
  Auth → Postgres (lookupBudgetsForDO) → DO (syncBudgets) → DO (checkAndReserve) → LLM

Recommended flow (1 network call, always):
  Auth → DO (checkAndReserve) → LLM
```

**How it works:**

1. **Every request calls the DO directly** — `checkAndReserve(userId, keyId, estimate)`. The DO checks its own SQLite for budget rows. If none exist, it returns "approved" in sub-millisecond time. If budgets exist, it evaluates and reserves atomically.

2. **Postgres is write-only on the hot path** — Budget CRUD (dashboard), cost event logging, and reconciliation write to Postgres. The DO is the read-side authority for enforcement.

3. **Postgres→DO sync happens on budget mutations only** — When the dashboard creates/updates/deletes a budget, the `/internal/budget/invalidate` endpoint calls `syncBudgets()` on the DO. This is the only time Postgres data flows to the DO.

4. **Remove `lookupBudgetsForDO()`** — The entire Postgres lookup + DO lookup cache layer is eliminated. No more cache miss penalty. No more tracking-only penalty.

5. **DO `populateIfEmpty` handles cold start** — On first access (new DO instance or after eviction), `blockConcurrencyWhile` loads budget rows from Postgres via `populateIfEmpty()`. This is a one-time cost per DO instance, not per request.

**Latency after this change:**

| Scenario | Latency | What happens |
|---|---|---|
| With budgets | 1-5ms | DO RPC → in-memory check → reserve |
| Tracking-only | 1-5ms | DO RPC → empty SQLite → "approved" |
| DO cold start (first request for a user) | 15-50ms | `blockConcurrencyWhile` loads from Postgres, then check |
| Budget mutation | Async | Dashboard → Postgres → `/internal/budget/invalidate` → DO sync |

**What this eliminates:**
- `lookupBudgetsForDO()` — Postgres query per request on cache miss
- `doLookupCache` — the entire module-level Map cache and its TTL logic
- `doBudgetPopulate()` calls from the orchestrator — sync only happens on mutations and cold start
- The tracking-only penalty — every user pays the same 1-5ms

**Consistency guarantees:**
- Budget creation: takes effect as soon as the dashboard calls `/internal/budget/invalidate` with `action: "sync"`. The DO receives the new budget and enforces on the next request.
- Budget deletion: same path. The DO removes the budget row from SQLite.
- DO eviction + cold start: `blockConcurrencyWhile` re-loads from Postgres. Requests queue behind this (CF guarantees no concurrent access during construction). No enforcement gap.
- Reconciliation: unchanged — async write-back to Postgres + DO spend update.

**Risk: stale DO state if sync fails:**
If the `/internal/budget/invalidate` call fails after a budget mutation, the DO has stale data until the next cold start. Mitigation: the dashboard should retry the invalidation call, and the DO's `populateIfEmpty` re-syncs on every cold start.

### Implementation Plan

1. Modify `checkBudgetDO()` in `budget-orchestrator.ts` to call the DO directly without `lookupBudgetsForDO()`
2. Update the DO's `checkAndReserve` to accept `keyId` so it can check both user and api_key budgets without the caller specifying entity types
3. Remove the `doLookupCache` (module-level Map, TTL logic, eviction logic)
4. Remove the `lookupBudgetsForDO()` import and its `doBudgetPopulate()` call from the orchestrator
5. Ensure the DO's `populateIfEmpty()` (called in `blockConcurrencyWhile`) handles the cold-start Postgres load correctly
6. Verify `/internal/budget/invalidate` sync action properly updates the DO
7. Update tests — remove DO lookup cache tests, update orchestrator tests
8. Add budget check latency instrumentation (`checkBudget` duration metric)

**Estimated effort:** ~3-4 hours.

**Priority: High.** This is the right long-term architecture. It makes budget enforcement O(1) for every request — same latency whether you have 0 or 100 budgets, cache hit or miss. It also simplifies the codebase by removing an entire caching layer.

### Implementation Notes (2026-03-18)

**What shipped:**

| Change | File(s) |
|---|---|
| `checkAndReserve` accepts `keyId: string \| null` instead of entity array; queries SQLite with `WHERE entity_type='user' OR (entity_type='api_key' AND entity_id=?)` | `user-budget.ts` |
| DO returns `hasBudgets: boolean` + `checkedEntities` array so orchestrator builds `budgetEntities` without Postgres | `user-budget.ts` |
| Orchestrator rewritten — single `doBudgetCheck(env, userId, keyId, estimate)` call, no Postgres, no cache | `budget-orchestrator.ts` |
| `doBudgetCheck` emits `do_budget_check` metric (status, hasBudgets, durationMs) | `budget-do-client.ts` |
| POST `/api/budgets` calls `invalidateProxyCache({ action: "sync" })` after insert | `app/api/budgets/route.ts` |
| Internal sync action uses `doBudgetUpsertEntities` (per-entity `populateIfEmpty`) — no ghost purge | `routes/internal.ts`, `budget-do-client.ts` |
| `invalidateProxyCache` retries 2x with 1s/3s backoff | `lib/proxy-invalidate.ts` |
| Removed dead code: `doBudgetPopulate`, `syncBudgets`, `doLookupCache`, `invalidateDoLookupCacheForUser` | Multiple |

**Audit findings caught and fixed during implementation:**
- **Critical:** Sync action called `syncBudgets` which purges sibling budgets — replaced with `populateIfEmpty` per-entity upsert
- **High:** `budget-do-client.test.ts` and `user-budget-do.do.test.ts` still used old `checkAndReserve(entities, estimate)` signature — updated 40+ call sites
- **High:** Fire-and-forget `invalidateProxyCache` had no retry — added 2x retry with backoff

**Known limitation:** Ghost budgets (deleted via direct SQL, not dashboard) persist in DO indefinitely. Dashboard DELETE uses `removeBudget` which cleans up correctly. A periodic full-sync sweep can be added if non-dashboard deletions become common.

---

## 12. Agent Tracing & Cost Correlation Gap

### The Problem

NullSpend tracks per-request costs precisely but cannot correlate them across an agent loop. When an agent calls LLM → executes tools → calls LLM again, each step is an isolated `cost_events` row with no causal link. There is no way to answer "how much did this agent run cost?" without manual timestamp correlation. The proxy captures `toolCallsRequested` from LLM responses but can't link them to actual tool executions.

### Industry Validation

No proxy-only platform (Portkey, LiteLLM, Helicone) solves this without client cooperation. However, DX research shows **server-side tool_call_id stitching** (matching `tool_calls` in LLM responses to `role: "tool"` messages in subsequent requests) can provide ~80% of trace correlation value with zero client headers. No competitor does this. Additionally: the MCP specification has zero cost tracking primitives, and OTel GenAI conventions have no cost/billing attributes — both are unclaimed spaces.

### Recommendation

Eight-phase buildout detailed in [`docs/technical-outlines/agent-tracing-architecture.md`](agent-tracing-architecture.md):

| Phase | What | Effort |
|---|---|---|
| 1 | Accept trace headers (`traceparent`, `X-NullSpend-Trace-Id: "auto"`) + return cost/trace response headers | ~4h |
| 2 | **Server-side tool_call_id stitching** (primary correlation, NullSpend-unique) | ~6h |
| 3 | Cost rollup per trace API | ~4h |
| 4 | MCP `_meta` cost conventions (`com.nullspend/*`) | ~3h |
| 5 | Tool definition cost attribution | ~2h |
| 6 | Agent loop detection + session circuit breakers (EWMA anomaly detection) | ~6h |
| 7 | Adaptive cost estimation (learned multiplier per model+shape) | ~4h |
| 8 | Mid-stream SSE cost injection (real-time cost during streaming) | ~4h |

Each phase is independently shippable. Total ~33 hours. See the full spec for data model changes, API designs, SDK integration tiers, wire protocol, defensive architecture checklist, and test plans.

**Supporting research:**
- [`docs/claude-research/agent-tracing-cost-correlation-research.md`](../claude-research/agent-tracing-cost-correlation-research.md) — 10-agent competitive/standards survey, 100+ references
- [`docs/claude-research/competitor-infrastructure-bugs-research.md`](../claude-research/competitor-infrastructure-bugs-research.md) — 80+ bugs across LiteLLM, Langfuse, Helicone, Portkey, OTel, Cloudflare
- [`docs/claude-research/developer-adoption-tracing-research.md`](../claude-research/developer-adoption-tracing-research.md) — DX adoption patterns, SDK design, progressive disclosure

**Priority: Medium.** Not a launch blocker (existing per-request tracking and budgets work), but a significant competitive differentiator. Should be the first post-launch feature.

---

## 13. What NOT to Change

- **Postgres as primary store** — right choice at launch scale. ClickHouse migration path is clear when needed.
- **Cloudflare Workers + DOs architecture** — native DO integration for budget enforcement is the product's architectural advantage.
- **Webhook signature format** (`t=,v1=`) — already matches the Stripe convention. Locked.
- **Webhook delivery headers** (`X-NullSpend-Signature`, `X-NullSpend-Webhook-Id`, `X-NullSpend-Webhook-Timestamp`) — consistent, well-named. Locked.
- **Auth header name** (`X-NullSpend-Key`) — clear, branded, follows convention. Locked.
- **TypeScript + Node.js** — CF Workers architecture is the right fit. No language rewrite needed.
- **Proxy passthrough URL paths** (`/v1/chat/completions`, `/v1/messages`) — these match upstream provider conventions, not NullSpend versioning. Don't change.
