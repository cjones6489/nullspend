# API Versioning: Cross-Platform Research

Research conducted 2026-03-19. Sources: official documentation, engineering blogs, community discussions.

---

## 1. Stripe

**Source:** https://stripe.com/blog/api-versioning, https://docs.stripe.com/upgrades, https://docs.stripe.com/api/versioning, https://docs.stripe.com/webhooks/versioning

### Where the version lives

- **Per-account default** — each Stripe account is pinned to the API version current at first request. Visible/changeable in the Dashboard (Workbench).
- **Per-request override** — `Stripe-Version` header overrides the account default.
- **Per-SDK pinning** — newer SDKs (Ruby v9+, Python v6+, Node v12+) lock to the API version at SDK release time. Older SDKs use the account default.
- Current version (as of research date): `2026-02-25.clover`.

### Version format

Date-based with named major releases: `YYYY-MM-DD.name` (e.g., `2024-09-30.acacia`, `2026-02-25.clover`). Monthly releases within a major share the same name and are backward-compatible. Major releases (~2/year) may contain breaking changes.

### How backward compatibility works

Stripe's internal architecture uses **version change modules** — encapsulated transformation classes. The API always runs against the latest internal models. When a request arrives for an older version, the system walks backward through version change modules, applying transformations to downgrade the response to the pinned version's shape.

> "Like a connected power grid or water supply, after hooking it up, an API should run without interruption."

Backward-compatible (safe) changes: adding new endpoints, optional parameters, new response fields, reordering properties, changing opaque string formats (including object ID prefixes), new event types.

Breaking (unsafe) changes: replacing fields (e.g., `verified` boolean → `status` string), removing fields, changing field types.

### Webhook versioning

- Webhook endpoints use either a **specific API version** set at creation time or the **account default**.
- Webhook payloads are shaped according to the webhook endpoint's pinned version.
- Stripe recommends matching your webhook endpoint version to your SDK's pinned version.
- **Migration strategy**: create a parallel webhook endpoint on the new version (distinguished by query param), update code, enable new endpoint, disable old one. Returning 400 on the old endpoint triggers Stripe retries.
- 72-hour rollback window after upgrading account default.

### Pitfalls and lessons

- **Three core principles**: (1) lightweight upgrades reduce cost for everyone, (2) first-class versioning keeps docs/tooling accurate, (3) fixed-cost maintenance via tight encapsulation prevents scattered version checks.
- The version-change-module architecture means each breaking change is a single class, not conditionals spread through the codebase.
- API reviews happen pre-release to catch inconsistencies before they become versioning debt.
- For Connect platforms, requests on behalf of connected accounts always use the platform's API version, regardless of the connected account's setting — this simplifies version management for platform developers.

---

## 2. GitHub

**Source:** https://docs.github.com/en/rest/about-the-rest-api/api-versions, https://docs.github.com/en/rest/about-the-rest-api/breaking-changes, https://docs.github.com/en/graphql/overview/breaking-changes

### Where the version lives

- **Request header** — `X-GitHub-Api-Version: YYYY-MM-DD`
- No URL-path versioning for REST.
- Default: requests without the header get `2022-11-28` (the inaugural version).
- Unsupported version → `400 Bad Request`.

### Version format

Date-based: `YYYY-MM-DD` (e.g., `2022-11-28`, `2026-03-10`). Versions are named by release date. Currently only two versions: the original `2022-11-28` and the newer `2026-03-10`.

### How backward compatibility works

- **Breaking changes** (scoped to new versions): removing/renaming operations, parameters, response fields; adding required parameters; changing types; removing enum values; new validation rules; auth changes.
- **Non-breaking/additive changes** deploy to ALL supported versions simultaneously — new operations, optional parameters, new response fields. No version bump needed.
- Each version supported for **at least 24 months** after the next version ships.
- Advance notice before releasing breaking changes.

### Breaking changes in 2026-03-10 (25 changes)

Concrete examples of what GitHub considers version-worthy changes:
- Removed deprecated properties (`rate`, `assignee`, `has_downloads`, `merge_commit_sha`, `use_squash_pr_title_as_default`)
- HTTP status code changes (installation deletion: 204 → 202; workflow dispatch: 204 → 200 with body; trade control: various → 451)
- Type changes (`selected_repository_ids` now integers-only)
- Enum merges (`javascript` + `typescript` → `javascript-typescript`)
- Content-Type corrections (`application/json+sarif` → `application/sarif+json`)
- Behavior changes (submodules return `type: "submodule"` instead of `"file"`)

### GraphQL versioning (different approach)

- No versioned endpoints or headers.
- Uses **field-level deprecation** within the schema.
- Breaking changes announced 3+ months in advance.
- Changes take effect on quarter boundaries (Jan 1, Apr 1, Jul 1, Oct 1).
- Fields are individually retired with migration paths (e.g., "Use `fullDatabaseId` instead").

### Webhook versioning

- **Not documented** — GitHub's webhook documentation does not discuss how webhook payloads interact with `X-GitHub-Api-Version`. Webhook delivery headers include `X-GitHub-Hook-ID`, `X-GitHub-Event`, `X-GitHub-Delivery` but no version header.
- This is a notable gap: it's unclear whether webhook payloads reflect the REST API version or always use the latest format.

### Pitfalls and community issues

- Only two versions in ~3.5 years suggests very conservative release cadence.
- The default version (`2022-11-28`) is now old — new integrations that omit the header get stale behavior, but changing the default would break existing integrations that rely on the implicit default.
- Webhook versioning gap is a real concern for developers building webhook consumers.
- 25 breaking changes accumulated between versions — some developers may find the "big bang" upgrade harder than Stripe's granular approach.

---

## 3. Shopify

**Source:** https://shopify.dev/docs/api/usage/versioning

### Where the version lives

- **URL path** — `https://{store}.myshopify.com/admin/api/{YYYY-MM}/graphql.json`
- Format: `YYYY-MM` (e.g., `2026-04`).

### Release cadence

- **Quarterly** — new stable version at the beginning of each quarter at 5pm UTC.
- Three version types: **stable** (12-month minimum support), **release candidate** (preview of next stable), **unstable** (experimental, may change without notice).
- At least **9 months of overlap** between consecutive stable versions.

### Backward compatibility

- Stable versions guarantee no breaking changes for their support window.
- Exception: new enum values may be retroactively added to stable versions.
- When an older version loses support, requests automatically **fall forward** to the oldest supported stable version (not rejected).

### Webhook versioning

- Webhooks follow the same versioning as REST/GraphQL APIs.
- Developers select a webhook API version; it applies to all webhooks for that app.
- Each webhook includes `X-Shopify-Api-Version` header indicating which version generated the payload.
- When the selected version becomes unsupported, Shopify **automatically advances** ("falls forward") to the next stable version.
- If the header value differs from what you selected, your version has been auto-advanced.

### Deprecation communication

- API health report
- GraphQL Explorer warnings
- Developer changelog
- Updated documentation
- Deprecated fields removed in subsequent releases with the 9-month migration window.

### Pitfalls and lessons

- Quarterly cadence means 4 versions/year — more frequent than GitHub but more predictable than Stripe.
- The "fall forward" behavior is developer-friendly (no hard failures) but can silently break apps that depend on removed fields.
- 12-month support window is half of GitHub's 24 months.
- Enum retroactive additions to stable versions is an explicit carve-out — signals that strict immutability is impractical for enums.

---

## 4. Twilio

**Source:** https://www.twilio.com/docs/usage/twilios-response, https://www.twilio.com/docs/messaging/api/message-resource, https://www.twilio.com/docs/voice/api/call-resource

### Where the version lives

- **URL path** — but two different patterns coexist:
  - Legacy "2010 APIs": `https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/...`
  - Newer product APIs: `https://{product}.twilio.com/v{N}/...` (e.g., `v1`, `v2`)
- The legacy date `2010-04-01` has been frozen in the URL for 16+ years.

### How backward compatibility works

- The `2010-04-01` API version has essentially never been rev'd — the same version string is used for all core Messaging/Voice APIs since 2010.
- New features are added as new product-specific APIs with their own integer versioning (v1, v2).
- Each resource response includes an `apiVersion` field tracking which version processed the request.
- The 2010 APIs support XML (default), JSON, and CSV responses; newer product APIs are JSON-only.

### Webhook versioning

- Not explicitly documented as a versioning concept.
- Twilio webhook callbacks include an `ApiVersion` parameter in the payload, indicating which version generated the callback.
- Since the core API version hasn't changed (it's perpetually `2010-04-01`), webhook versioning is effectively a non-issue for the legacy API.

### Pitfalls and lessons

- The "freeze the version forever" approach means Twilio avoided versioning complexity entirely for their core API — at the cost of carrying legacy decisions forever.
- Having `2010-04-01` in every URL for 16 years is increasingly anachronistic.
- The bifurcation between legacy date-versioned APIs and newer integer-versioned product APIs creates inconsistency.
- New products can evolve independently (good), but the ecosystem feels fragmented.
- Developers frequently note the oddity of a 2010 date in modern API calls.

---

## 5. Discord

**Source:** https://docs.discord.com/developers/reference

### Where the version lives

- **URL path** — `https://discord.com/api/v{version_number}` (integer versions).
- Default (unversioned requests): **v6** — despite v10 being current. This is a known source of confusion.

### Version lifecycle

| Version | Status |
|---|---|
| 10 | Available (recommended) |
| 9 | Available |
| 8 | Deprecated |
| 7 | Deprecated |
| 6 | Deprecated (but still the default!) |
| 5 | Discontinued (returns 400) |
| 4 | Discontinued (returns 400) |
| 3 | Discontinued (returns 400) |

### Backward compatibility

- Deprecated versions continue to function but receive no new features.
- Discontinued versions return `400 Bad Request`.
- No explicit deprecation timeline published (unlike GitHub's 24 months or Shopify's 12 months).
- Gateway (WebSocket) and REST API versions are coupled — "API and Gateway versions" are referenced together.

### Pitfalls and lessons

- **Default version is deprecated** — the single biggest footgun. Unversioned requests hit v6, which is 4 major versions behind. New developers who don't read docs carefully will build against a deprecated API.
- Integer versioning means 7 major versions to date, which implies many breaking changes over the years.
- No formal SLA on how long deprecated versions remain functional.
- The jump from v6 (default) to v10 (recommended) is daunting for developers discovering they need to upgrade.

---

## 6. Slack

**Source:** https://slack.engineering/how-we-design-our-apis-at-slack/, https://docs.slack.dev/changelog

### Where the version lives

- **No explicit versioning scheme** — Slack's Web API methods (`chat.postMessage`, `conversations.list`, etc.) are not versioned in URLs or headers.
- Instead, Slack follows an **additive-only, avoid-breaking-changes** philosophy.

### How backward compatibility works

> "What worked yesterday should work tomorrow."

- Breaking changes are treated as exceptional events, not normal releases.
- When breaking changes are unavoidable, Slack implements:
  - Proportional notice periods based on impact scope
  - Communication plans tailored to affected developers
  - Migration support
- Example: `files.upload` deprecation announced May 2024, sunset extended to November 2025 (~18 months). Classic apps deprecation was **paused entirely** in December 2025 after community pushback.
- CLI versioning uses semver (`v2.8.0`), separate from API method versioning.

### Webhook versioning

- Not applicable in the traditional sense — Slack Events API payloads evolve additively.
- No version parameter in event subscriptions.

### Design philosophy

- API specification before implementation.
- Internal cross-functional review via `#api-decisions` channel.
- Early partner feedback on draft specs.
- Beta testing with selected developers before public release.
- Target: "Time to First Hello World" of ~15 minutes.

### Pitfalls and lessons

- The no-versioning approach works for Slack's scale because they have strong internal review processes preventing breaking changes.
- Downside: when breaking changes ARE needed (like `files.upload` → `files.uploadV2`), the migration is ad-hoc rather than systematic.
- Community pushback can delay or halt deprecations (classic apps example).
- Method-level deprecation (`files.upload`) without API-level versioning means scattered migration timelines.

---

## 7. Cloudflare

**Source:** https://developers.cloudflare.com/fundamentals/api/how-to/make-api-calls/, https://developers.cloudflare.com/fundamentals/api/reference/deprecations/

### Where the version lives

- **URL path** — `https://api.cloudflare.com/client/v4/`
- Single major version (`v4`) has been current for years.
- Individual endpoints are deprecated independently.

### Backward compatibility

- `v4` is treated as a stable base; Cloudflare adds new endpoints/fields without bumping the version.
- Deprecated endpoints get a deprecation date and an end-of-life (EOL) date.
- Typical deprecation windows: 5-12 months between announcement and EOL.

### Deprecation communication

- RSS feed for API deprecation posts.
- Documentation notices on affected endpoints.
- Migration guides with replacement APIs.
- Dual-support periods during transitions.

### Deprecation examples (2025-2026)

- Service Key Authentication: announced Mar 2026, EOL Sep 2026 (6 months)
- DNS Record Type Updates: announced Jan 2026, EOL Jun 2026 (5 months)
- Legacy Analytics APIs: announced Dec 2025, EOL Dec 2026 (12 months)

### Pitfalls and lessons

- The single-version approach avoids versioning complexity but means "v4" is a meaningless version number — it's really "the current API."
- Individual endpoint deprecation is fine for removing old features but doesn't help when you need to change the shape of existing responses.
- No mechanism for requesting a specific "snapshot" of the API — if Cloudflare changes a response field, all consumers see it immediately.
- Auth: RFC 6750 Bearer token standard (`Authorization: Bearer <API_TOKEN>`).

---

## 8. Intercom

**Source:** https://www.intercom.com/blog/api-versioning/ (content extracted from cached/referenced version)

### Architecture (Version Change Modules)

Intercom adopted Stripe's approach with their own twist:

- Controllers always operate on the **latest internal models**.
- **Version change objects** are individual transformation classes that each represent one discrete breaking change.
- When a request arrives for an older version, the system applies version changes in reverse chronological order to transform the response.
- They open-sourced their serialization library **Requisite** for this purpose.

### Design principles

> "API interfaces are like contracts, which can't be easily changed once released to the world."

- Comprehensive, centralized changelog documentation.
- Developers can upgrade on their own timeline.
- Safe testing environments before migration.
- Quick rollback capabilities.

### Lessons from Intercom

- The version-change-module pattern (shared with Stripe) prevents code duplication — legacy logic is encapsulated in transformation objects, not scattered through controllers.
- Researching developer needs revealed they wanted flexibility, safety, and centralized changelogs above all.

---

## Cross-Platform Comparison Matrix

| Platform | Version Location | Format | Webhook Versioning | Support Window | Default Behavior |
|---|---|---|---|---|---|
| **Stripe** | Header (`Stripe-Version`) + per-account default | `YYYY-MM-DD.name` | Pinned per webhook endpoint or account default | Rolling (72h rollback) | Account pinned at first use |
| **GitHub** | Header (`X-GitHub-Api-Version`) | `YYYY-MM-DD` | Undocumented | 24 months minimum | Falls back to `2022-11-28` |
| **Shopify** | URL path | `YYYY-MM` | Same as API; `X-Shopify-Api-Version` header; auto-advances | 12 months minimum | Falls forward to oldest supported |
| **Twilio** | URL path | `YYYY-MM-DD` (legacy) or `vN` (new) | `ApiVersion` field in callbacks | Indefinite (never changed) | Fixed at `2010-04-01` |
| **Discord** | URL path | `vN` (integer) | N/A (no outbound webhooks to version) | No published SLA | v6 (deprecated!) |
| **Slack** | None (no versioning) | N/A | N/A | N/A | Latest (additive only) |
| **Cloudflare** | URL path | `v4` (static) | N/A | Per-endpoint (5-12 months) | Always latest within v4 |
| **Intercom** | Header (Stripe-style) | Numbered versions | Version-change modules | Developer-paced | Account-pinned |

---

## Key Takeaways for NullSpend

### What works well

1. **Per-account version pinning** (Stripe, GitHub) — developers never get surprised by breaking changes. Best-in-class approach for API stability.
2. **Version change modules** (Stripe, Intercom) — encapsulates backward compatibility logic in single classes instead of scattered conditionals. Fixed maintenance cost per breaking change.
3. **Webhook versioning tied to API version** (Stripe, Shopify) — webhook payloads must be versioned or you create a hidden breaking-change vector.
4. **Date-based version names** (Stripe, GitHub, Shopify) — communicates age clearly. Developers know at a glance how far behind they are.
5. **Header-based versioning** (Stripe, GitHub) — keeps URLs clean, allows per-request overrides during migration testing.

### What causes pain

1. **Stale defaults** (Discord v6, GitHub `2022-11-28`) — if the default version is old/deprecated, new developers build against outdated behavior.
2. **Undocumented webhook versioning** (GitHub) — creates uncertainty about whether webhook payloads will change shape.
3. **No versioning at all** (Slack, Cloudflare v4) — works until it doesn't. When you need a breaking change, you have no systematic mechanism.
4. **Frozen legacy versions** (Twilio `2010-04-01`) — avoids complexity but accumulates permanent technical debt.
5. **Big-bang version upgrades** (GitHub's 25 changes in one version) — harder to adopt than Stripe's granular per-change approach.

### If starting over

Based on patterns across all platforms:

- **Use header-based versioning** with a per-account default (Stripe model). URL versioning creates permanent legacy in every URL and makes it harder to do granular upgrades.
- **Pin new accounts to the current version** automatically.
- **Version webhooks explicitly** — include a version header in webhook deliveries, pin webhook endpoints to specific versions.
- **Implement version-change modules** from day one, even if you have zero breaking changes. The architecture prevents future pain.
- **Publish a clear support window** (12-24 months) so developers know when old versions sunset.
- **Make the default version explicit, not implicit** — require the version header or return an error. Discord's "default to a deprecated version" pattern is an anti-pattern.
- **Keep breaking changes small and frequent** rather than batching them into big releases.
- **Document what constitutes a breaking change** up front (GitHub's definition list is a good template).
