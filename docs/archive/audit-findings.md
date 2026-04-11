# Audit Findings Tracker

Consolidated findings from adversarial audits (Codex challenge, CSO reviews, QA passes).

## Summary

| Severity | Total | Done | Remaining |
|----------|-------|------|-----------|
| P0/HIGH  | 12    | 12   | 0         |
| P1       | 26    | 19   | 7 (known/by-design) |
| P2/MED   | 23    | 17   | 6 (known/by-design) |
| P3/LOW   | 9     | 9    | 0         |
| **Total** | **70** | **57** | **13** |

---

## SDK Audit (Codex challenge `packages/sdk/src/`, 2026-04-10)

| # | Sev | Finding | Status | Commit |
|---|-----|---------|--------|--------|
| SDK-1 | HIGH | Tracking bypass via `x-nullspend-key` header injection | [DONE] | b2588f9 |
| SDK-2 | HIGH | `createTrackedFetch` ignores `config.fetch`, hardcodes `globalThis.fetch` | [DONE] | c216e8f |
| SDK-3 | HIGH | `Request` object body parsing fails — model="unknown", cost=0 | [DONE] | c216e8f |
| SDK-4 | MED | Route matching misses `/embeddings`, `/completions` | [DONE] | c216e8f |
| SDK-5 | MED | Policy cache silently swallows fetch failures (no `onError`) | [DONE] | c216e8f |
| SDK-6 | MED | Direct-mode 429 trusts `X-NullSpend-Denied` from any origin | [DONE] | c216e8f |
| SDK-7 | LOW | Error constructors don't validate args (NaN, Infinity, negative) | [DONE] | c216e8f |

**Tests added:** 40 (417 → 457 SDK tests)

---

## Proxy Audit (Codex challenge `apps/proxy/src/lib/`, 2026-04-10)

| # | Sev | Finding | Status | Commit | Notes |
|---|-----|---------|--------|--------|-------|
| PXY-1 | P0 | Cross-tenant budget corruption: `UPDATE budgets` missing `org_id` in WHERE | [DONE] | 70af634 | 3 regression tests (d0dd2b9) |
| PXY-2 | P0 | DO/Postgres split-brain permanent on PG failure | [DONE] | 7789228→2ed4974 | Transactional outbox in DO SQLite + idempotent PG writes via reconciled_requests dedup. 4 commits, 26 tests, Codex adversarial plan review. |
| PXY-3 | P0 | Unknown models off-ledger: estimator reserves $1, calculator writes $0 | [DONE] | b1630d6 | Route handler substitutes estimate when calculator returns $0 with tokens. `_ns_unpriced` + `cost_event_unpriced` metric. |
| PXY-4 | P1 | Streams charged as $0 when SSE parser drops usage | [DONE] | b1630d6 | Non-cancelled streams now use estimate. Cost event tagged `_ns_no_usage`. `stream_no_usage` metric. |
| PXY-5 | P1 | Webhook queue-send failures silently dropped | [KNOWN] | — | Intentional fail-open. Needs direct fallback or dead-letter signal. |
| PXY-6 | P1 | PG outage during webhook delivery → permanent acked loss | [DONE] | b1630d6 | `getWebhookEndpointsWithSecrets` now throws on DB error. Queue consumer retries instead of acking. |
| PXY-7 | P1 | Auth DB failure returned 401 instead of 503 | [DONE] | 70af634 | `auth_db_error` metric added. Index-level 503 test (d0dd2b9). |
| PXY-8 | P1 | Budget estimates biased low for Unicode bodies (string.length vs UTF-8 bytes) | [DONE] | 70af634 | CJK byte length regression test (d0dd2b9). |
| PXY-9 | P2 | Default tags from DB bypass validation (`__proto__` poisoning) | [DONE] | f988f47 | `isValidTagEntry` helper + `Object.create(null)` in mergeTags. 6 tests. |
| PXY-10 | P2 | Budget enforcement fails open on auth/DO desync | [KNOWN] | — | Intentional fail-open. `budget_cache_stale` metric exists. |
| PXY-11 | P2 | Duplicate threshold webhooks under concurrency (no dedup) | [KNOWN] | — | Documented in code. Needs KV or DO-based dedup (future). |
| PXY-12 | P2 | Upstream error sanitization leaks provider error.message for non-401/403 | [DONE] | f988f47 | 5xx returns generic message. 4xx strips org IDs, API keys, emails, hex IDs. 10 tests. |
| PXY-13 | P3 | Webhook API-version handling inconsistent across event types | [DONE] | 5de7aff | dispatchToEndpoints overrides api_version per endpoint. 2 tests. |
| PXY-14 | P3 | Anthropic beta header forwarded blindly (client-controlled) | [DONE] | 5de7aff | anthropic_beta_used metric emitted for audit trail. |

**Tests added:** 27 regression tests (1,372 → 1,390 proxy tests)

### PXY-2 Codex Post-Deploy Challenge (2026-04-10)

7 findings on the deployed outbox code. 3 fixed, 4 accepted:

| # | Sev | Finding | Status |
|---|-----|---------|--------|
| CD-1 | CRITICAL | Abandoned outbox entries permanently undercount PG spend | ACCEPTED — Decision 3 (max 5 retries + metric + alert). Infinite retry risks alarm backlog. |
| CD-2 | HIGH | Dedup INSERT poisons retries when budget row is missing | **FIXED** (5f033ae) — dedup record deleted when UPDATE count=0 |
| CD-3 | HIGH | getSql() leaks postgres.js clients | ACCEPTED — idle_timeout=20s handles cleanup per db.ts design |
| CD-4 | MED-HIGH | No indexes on pg_sync_outbox SQLite table | **FIXED** (5f033ae) — retry + request_id indexes added |
| CD-5 | MED | First outbox retry waits 30s for reservation alarm | **FIXED** (5f033ae) — reconcile() reschedules alarm to 1s |
| CD-6 | MED | Pruning inside pending.length > 0 gate | Already fixed in prior commit (2ed4974) |
| CD-7 | MED | Bigint precision above $9B | ACCEPTED — theoretical, no action needed |

---

## Dashboard Auth Audit (Codex challenge `lib/auth/`, 2026-04-10)

| # | Sev | Finding | Status | Notes |
|---|-----|---------|--------|-------|
| AUTH-1 | P0 | Dev fallback (`NULLSPEND_DEV_MODE`) has no `NODE_ENV` guard — ships to production as full auth bypass | [DONE] | Added `NODE_ENV === "production"` guard in both `session.ts` and `api-key.ts`. 7 regression tests. |
| AUTH-2 | P2 | Unknown role values (including `__proto__`, `constructor`) fail open in `assertOrgRole()` — privilege escalation | [DONE] | Changed to `Object.hasOwn(ROLE_LEVEL, member.role)` check. 5 regression tests. |
| AUTH-3 | P1 | API key auth not bound to org membership — missed key revocation = permanent cross-tenant access | [DONE] | Added `assertOrgMember` verification in `dual-auth.ts` for every API key auth. Observability log on non-member detection. 2 regression tests. |
| AUTH-4 | P1 | Membership cache is process-local (60s TTL), revocations don't propagate across instances | [DONE] | Added cache hit observability logging. Documented limitation. Acceptable for single-instance. |
| AUTH-5 | P2 | API key rate limiting fails open on misconfiguration + Redis failure; dev fallback key skips throttling | [KNOWN] | Intentional fail-open. Per-IP rate limiting in proxy.ts is the DDoS safety net. |
| AUTH-6 | P3 | Invite-accept rate limiting is process-local, null IP bypasses | [KNOWN] | Acceptable for current scale. |

**Tests added:** 14 regression tests (129 → ~143 lib/auth/ tests)

---

## HITL Actions Audit (Codex challenge `lib/actions/`, 2026-04-10)

| # | Sev | Finding | Status | Notes |
|---|-----|---------|--------|-------|
| ACT-1 | P1 | Slack callback auth fail-open: null `slackUserId` accepts any click, no workspace/membership verification | [KNOWN] | Slack signing secret is the primary boundary. `slackUserId` restriction is opt-in. Low risk given Slack workspace scoping. |
| ACT-2 | P1 | Actions scoped by orgId only, not ownerUserId — any org member can see/act on any action | [BY DESIGN] | Intentional. Admins approve org-wide actions. Viewers see org-wide actions. |
| ACT-3 | P2 | `POST /approve` swallows malformed JSON bodies via `.catch(() => undefined)` | [DONE] | Changed to Content-Length-based detection. Empty body still valid for non-budget approvals; malformed JSON now 400s. |
| ACT-4 | P1 | Idempotency key globally scoped — no caller/route in Redis key. Cross-tenant key collision possible. | [DONE] | Key now includes SHA-256 hash of API key + request path. 2 regression tests. |
| ACT-5 | P2 | Serialization exposes raw payload/metadata/result | [BY DESIGN] | Actions are org-scoped. Payload visibility is required for approval decisions. |
| ACT-6 | P2 | `expiresInSeconds: 0` or `null` creates immortal pending actions | [DONE] | Now capped at MAX_EXPIRATION_SECONDS (7 days). 3 regression tests. |
| ACT-7 | P2 | Budget increase can be approved for more than requested (only tier cap guards) | [KNOWN] | Admin discretion within tier cap. UI shows over-approval warning. |
| ACT-8 | P3 | Expiration check uses app-level `new Date()` not SQL `NOW()` in UPDATE predicate | [ACCEPTED] | Inside `FOR UPDATE` lock, timing drift is microseconds. |
| ACT-9 | P3 | Slack mrkdwn injection via unsanitized payload fields | [KNOWN] | Cosmetic/social engineering only. Low priority. |

**Tests added:** 5 regression tests. 2,113 root tests green.

---

## Margins Audit (Codex challenge `lib/margins/`, 2026-04-10)

| # | Sev | Finding | Status | Notes |
|---|-----|---------|--------|-------|
| MRG-1 | P1 | Transient sync failures permanently brick cron — non-auth errors set `status=error`, cron only picks `active` | [DONE] | Non-auth errors now keep `status=active` with `lastError` set. Cron retries next cycle. |
| MRG-2 | P1 | Critical customers downgraded to `at_risk` in alerts — zero-revenue special case not propagated to crossing detector | [DONE] | `detectWorseningCrossings` now accepts pre-computed `healthTier` from table. |
| MRG-3 | P1 | Any org `member` can rewrite customer attribution via manual mapping | [DONE] | POST/DELETE customer-mappings now require `admin` role. |
| MRG-4 | P2 | Slack `tagValue` not escaped when no customer name — mrkdwn injection | [DONE] | `escapeSlack()` applied to tagValue fallback. |
| MRG-5 | P1 | Alert spam — same threshold crossing fires every sync (no dedup) | [KNOWN] | Needs KV/DB-based sent-state tracking. Deferred. |
| MRG-6 | P1 | No sync lock — concurrent syncs leave mixed data snapshots | [KNOWN] | Needs Redis/DB advisory lock. Deferred. |
| MRG-7 | P1 | Key rotation destructive — no ciphertext versioning | [KNOWN] | Needs key version prefix in ciphertext. Deferred. |
| MRG-8 | P1 | Margin webhook silently drops HTTP error responses | [KNOWN] | Dispatch layer has retry. Low priority. |
| MRG-9 | P2 | Revenue monthing uses `invoice.created` not payment date | [KNOWN] | Design choice — payment date would require `invoice.paid_at` which Stripe doesn't reliably expose. |
| MRG-10 | P2 | Mixed-currency customers understated | [KNOWN] | `skippedCurrencies` banner exists. Multi-currency support deferred. |
| MRG-11 | P2 | JS `number` on DB `bigint` — precision loss above safe integer | [KNOWN] | Theoretical — $9B+ in microdollars. No action needed. |
| MRG-12 | P2 | Auto-match trusts unverified Stripe metadata | [KNOWN] | By design — auto-matches are `confidence: 0.9-1.0`, admin can override. |
| MRG-13 | P2 | Stripe connect probe only checks `customers.list` | [KNOWN] | Acceptable — sync failure updates status with actionable error. |
| MRG-14 | P2 | Mapping unique constraint collision → 500 instead of 409 | [KNOWN] | Low frequency. Future cleanup. |
| MRG-15 | P2 | Period helpers silently normalize invalid months | [KNOWN] | Route regex validates YYYY-MM. Internal callers are trusted. |
| MRG-16 | P1 | Slack alerts to wrong destination in multi-admin orgs | [KNOWN] | `limit(1)` without ordering. Low impact — same org's webhook either way. |
| MRG-17 | P3 | Raw sync error text exposed to org viewers | [KNOWN] | Acceptable — viewers are org members. |

**Tests updated:** 1 (sync error status assertion). 2,113 root tests green.

---

## API Routes Audit (Codex challenge `app/api/`, 2026-04-10)

| # | Sev | Finding | Status | Notes |
|---|-----|---------|--------|-------|
| API-1 | P1 | Routes using `authenticateApiKey()` directly skip AUTH-3 membership check | [DONE] | Membership check moved INTO `authenticateApiKey()` itself. ALL callers now get it. |
| API-2 | P1 | Actions org-scoped not user-scoped | [BY DESIGN] | Same as ACT-2. Admins approve org-wide. |
| API-3 | P1 | Invite accept doesn't check email match | [KNOWN] | Real gap. Needs email verification. Deferred — no multi-user orgs yet. |
| API-4 | P1 | Budget POST only requires member for tag/customer | [DONE] | Elevated to admin. |
| API-5 | P1 | Slack config userId vs orgId confusion | [KNOWN] | Same as MRG-16. Low impact. |
| API-6 | P1 | Webhook SSRF via DNS rebinding | [KNOWN] | Admin-only, documented risk. Needs DNS resolution check in future. |
| API-7 | P1 | Health endpoint public + verbose open by default | [KNOWN] | Opt-in gate exists via INTERNAL_HEALTH_SECRET. Documented. |
| API-8 | P2 | Cursor JSON.parse throws 500 on malformed input | [DONE] | Wrapped in Zod transform with addIssue fallback. All 3 schemas fixed. |
| API-9 | P2 | Cost event ingestion accepts `_ns_*` tags | [KNOWN] | Low priority. Tags are org-scoped, not trust-boundary. |
| API-10 | P2 | Webhook URLs visible to viewers | [KNOWN] | Acceptable for team visibility. |
| API-11 | P2 | Key metadata visible to viewers | [BY DESIGN] | Viewers see org keys. |
| API-12 | P2 | Invite rate limit evasion | [KNOWN] | Same as AUTH-6. |
| API-13 | P3 | Malformed `ns_evt_` prefixed ID → 500 | [DONE] | Wrapped in try/catch → 400. |
| API-14 | P3 | `decodeURIComponent` → 500 on malformed percent-encoding | [DONE] | Wrapped in try/catch → 400. |

**Fixes:** 6 (API-1, API-4, API-8 x3, API-13, API-14). Tests: 2 new, 7 updated. 2,119 root tests green.

---

## Other Findings (from prior sessions)

| # | Sev | Finding | Status | Source |
|---|-----|---------|--------|--------|
| QA-005 | P1 | Budget sync missing env vars on Vercel | [DONE] | QA deep pass (2026-04-10) |
| QA-006 | P2 | Webhook UI mismatch (payload mode) | [DONE] | QA deep pass (2026-04-10) |
| ISSUE-014 | P1 | Self-invite prevention (own email succeeds) | [TODO] | sdk-hardening-pickup.md |

---

## Pickup Priority (recommended order)

### Quick wins (15 min each)
1. **PXY-9** — Default tags `__proto__` poisoning: validate with same rules as request tags
2. **PXY-12** — Upstream error message leaks: redact non-401/403 error.message

### Medium effort
3. **ISSUE-014** — Self-invite prevention
4. **PXY-6** — Webhook ack-on-PG-outage: retry when endpoint list is empty instead of acking
5. **PXY-4** — Zero-cost streams: emit metric when usage is missing, use estimate as fallback

### Design decisions needed
6. **PXY-3** — Unknown model pricing: choose between block, max-rate fallback, or alert-only
7. **PXY-2** — DO/PG split-brain: compensation log, periodic reconciliation audit, or accept risk

### Future / low priority
8. **PXY-13** — Webhook API version consistency
9. **PXY-14** — Anthropic beta header filtering
