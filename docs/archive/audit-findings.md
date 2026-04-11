# Audit Findings Tracker

Consolidated findings from adversarial audits (Codex challenge, CSO reviews, QA passes).

## Summary

| Severity | Total | Done | Remaining |
|----------|-------|------|-----------|
| P0/HIGH  | 10    | 8    | 2         |
| P1       | 5     | 3    | 2         |
| P2/MED   | 5     | 3    | 2 (+2 known/intentional) |
| P3/LOW   | 3     | 1    | 2         |
| **Total** | **23** | **15** | **8 actionable** |

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
| PXY-2 | P0 | DO/Postgres split-brain permanent on PG failure | [TODO] | — | Architectural. Queue retry mitigates. Needs compensation log or reconciliation audit. |
| PXY-3 | P0 | Unknown models off-ledger: estimator reserves $1, calculator writes $0 | [TODO] | — | Needs design decision: block unknown? use max fallback rate? alert? |
| PXY-4 | P1 | Streams charged as $0 when SSE parser drops usage | [TODO] | — | Parser silently drops malformed JSON / oversized lines. Estimate fallback exists but reconciles 0. |
| PXY-5 | P1 | Webhook queue-send failures silently dropped | [KNOWN] | — | Intentional fail-open. Needs direct fallback or dead-letter signal. |
| PXY-6 | P1 | PG outage during webhook delivery → permanent acked loss | [TODO] | — | Secret lookup returns [], consumer acks "missing" endpoint. Fix: retry on empty endpoint list. |
| PXY-7 | P1 | Auth DB failure returned 401 instead of 503 | [DONE] | 70af634 | `auth_db_error` metric added. Index-level 503 test (d0dd2b9). |
| PXY-8 | P1 | Budget estimates biased low for Unicode bodies (string.length vs UTF-8 bytes) | [DONE] | 70af634 | CJK byte length regression test (d0dd2b9). |
| PXY-9 | P2 | Default tags from DB bypass validation (`__proto__` poisoning) | [TODO] | — | `default_tags` trusted as-is, merged without key/value checks. |
| PXY-10 | P2 | Budget enforcement fails open on auth/DO desync | [KNOWN] | — | Intentional fail-open. `budget_cache_stale` metric exists. |
| PXY-11 | P2 | Duplicate threshold webhooks under concurrency (no dedup) | [KNOWN] | — | Documented in code. Needs KV or DO-based dedup (future). |
| PXY-12 | P2 | Upstream error sanitization leaks provider error.message for non-401/403 | [TODO] | — | Forwards error.message verbatim. Should redact or generic-ize. |
| PXY-13 | P3 | Webhook API-version handling inconsistent across event types | [TODO] | — | cost events per-endpoint, velocity/denial use ctx, threshold uses endpoints[0]. |
| PXY-14 | P3 | Anthropic beta header forwarded blindly (client-controlled) | [TODO] | — | Callers can opt into response shapes the parser doesn't handle. |

**Tests added:** 5 regression tests (1,372 → 1,377 proxy tests)

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
