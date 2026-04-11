# QA Audit Coverage Map

Tracks which sections of the codebase have received deep adversarial review (Codex challenge), security audit (CSO), or systematic QA. Updated after each audit pass.

**Last updated:** 2026-04-10

## Coverage Summary

| Section | Codex Challenge | CSO Review | QA Pass | Test Count | Risk Level |
|---------|:-:|:-:|:-:|---:|---|
| `packages/sdk/src/` | 2026-04-10 | 2026-04-10 | — | 457 | HIGH — **CLEAN** |
| `apps/proxy/src/lib/` | 2026-04-10 | 2026-04-10 | — | 1,406 | CRITICAL — **CLEAN** |
| `apps/proxy/src/routes/` | 2026-04-10 | 2026-04-10 | — | (incl. above) | CRITICAL — **CLEAN** |
| `apps/proxy/src/durable-objects/` | 2026-04-10 | 2026-04-10 | — | 83 (DO pool) | CRITICAL — **CLEAN** |
| `lib/auth/` | — | 2026-04-10 | 2026-04-10 | ~50 | CRITICAL — **NEEDS CODEX** |
| `lib/actions/` | — | 2026-04-10 | 2026-04-10 | ~80 | HIGH — **NEEDS CODEX** |
| `lib/margins/` | — | — | 2026-04-10 | ~120 | HIGH — **NEEDS CODEX** |
| `lib/budgets/` | — | 2026-04-10 | 2026-04-10 | ~30 | HIGH |
| `lib/webhooks/` | — | 2026-04-10 | — | ~40 | MED |
| `lib/slack/` | — | — | 2026-04-10 | ~30 | LOW |
| `app/api/` (routes) | — | 2026-04-10 | 2026-04-10 | ~300 | HIGH — **NEEDS CODEX** |
| `packages/cost-engine/` | — | — | — | 700 | HIGH (well-tested) |
| `packages/db/` | — | — | — | ~40 | MED |
| `packages/claude-agent/` | — | — | — | 49 | MED |
| `packages/mcp-server/` | — | — | — | ~30 | MED |
| `packages/mcp-proxy/` | — | — | — | ~30 | MED |
| `packages/docs-mcp-server/` | — | — | — | ~60 | LOW |
| `proxy.ts` (Next.js) | — | 2026-04-10 | 2026-04-10 | — | MED |
| Dashboard components | — | — | 2026-04-10 | ~200 | LOW |

## Audit Types

- **Codex Challenge**: Adversarial audit by OpenAI Codex in read-only mode. Finds edge cases, race conditions, security holes, silent data corruption. The gold standard for finding bugs that normal reviews miss.
- **CSO Review**: Comprehensive security audit covering secrets, dependencies, CI/CD, OWASP Top 10, STRIDE threat model. Scored A- on 2026-04-10.
- **QA Pass**: Systematic functional testing (browse + test + fix loop). Finds UI bugs, integration issues, missing validation.

## Completed Audits

### 1. SDK (`packages/sdk/src/`) — Codex Challenge, 2026-04-10

**Scope:** `client.ts`, `tracked-fetch.ts`, `provider-parsers.ts`, `policy-cache.ts`, `errors.ts`, `cost-calculator.ts`, `sse-parser.ts`, `customer-id.ts`

**Findings:** 7 total (3 HIGH, 3 MED, 1 LOW) — all fixed
**Commit:** c216e8f
**Tests added:** 40 (417 → 457)
**Details:** [audit-findings.md](audit-findings.md#sdk-audit-codex-challenge-packagessdk-2026-04-10)

### 2. Proxy (`apps/proxy/src/lib/`) — Codex Challenge + PXY-2 Outbox, 2026-04-10

**Scope:** All 43 files in `lib/`, plus `routes/`, `durable-objects/`, queue handlers

**Findings:** 14 initial + 7 post-deploy = 21 total. 18 fixed, 3 accepted.
**Key fix:** PXY-2 DO/Postgres split-brain — transactional outbox pattern with idempotent PG writes,
alarm-based retry, Codex-reviewed plan (10 findings addressed), 2 post-implementation audits.
**Commits:** 70af634, d0dd2b9, b1630d6, f988f47, 7789228, 0272ca1, a5866f7, 2ed4974, 5f033ae
**Tests added:** 1,372 → 1,404 unit + 83 DO = 1,487 total proxy tests
**Stress verified:** 26/28 pass (2 pre-existing abort timing)
**Smoke verified:** 31/33 pass (2 updated for PXY-3)
**Details:** [audit-findings.md](audit-findings.md#proxy-audit-codex-challenge-appsproxysrclib-2026-04-10)

### 3. CSO Comprehensive Security Audit — 2026-04-10

**Scope:** Full codebase — secrets archaeology, dependency supply chain, CI/CD, OWASP, STRIDE
**Grade:** A-
**Critical/High findings:** 0
**Details:** Conducted via `/cso` skill. SDK tracking bypass (finding SDK-1) was the one actionable item, fixed in b2588f9.

### 4. QA Deep Pass — 2026-04-10

**Scope:** All 16 dashboard pages, Stripe integration, budget creation, API keys, webhooks, margins
**Bugs found:** 8 (6 fixed in session)
**Details:** See memory `project_session_summary_20260410.md` and `project_session_summary_20260410b.md`

---

## NOT YET AUDITED (Codex Challenge)

These sections have unit tests but have NOT received a deep adversarial Codex review. Ordered by risk.

### Priority 1 — High risk, high value

| Section | Why | Files | Est. findings |
|---------|-----|-------|---------------|
| `lib/auth/` | AuthN/AuthZ, session handling, API key validation, dev mode fallback | ~8 | Medium |
| `lib/actions/` | HITL state machine, approval side-effects, budget increase execution | ~10 | Medium |
| `lib/margins/` | Stripe API integration, AES-256-GCM encryption, revenue sync, auto-match | ~15 | High (newer code) |
| `packages/cost-engine/src/` | Pricing accuracy for all 38 models, used by both proxy and SDK | ~6 | Low (well-tested, 700 tests) |

### Priority 2 — Medium risk

| Section | Why | Files | Est. findings |
|---------|-----|-------|---------------|
| `app/api/` routes | API surface, input validation, error handling | ~20 | Medium |
| `lib/budgets/` | Budget increase execution, entity lookup, tier cap logic | ~5 | Low-Medium |
| `lib/webhooks/` | Dispatch, signing, endpoint management | ~5 | Low |
| `packages/mcp-proxy/` | MCP budget gate, cost tracking | ~4 | Medium |

### Priority 3 — Lower risk

| Section | Why | Files | Est. findings |
|---------|-----|-------|---------------|
| `packages/claude-agent/` | Config transformer only | ~2 | Low |
| `packages/mcp-server/` | Tool registration, config | ~4 | Low |
| `packages/docs-mcp-server/` | Search, static content | ~4 | Low |
| `packages/db/` | Schema definitions | ~2 | Low |

---

## Running a Codex Challenge

```
/codex challenge <path>
```

After each audit:
1. Record findings in `audit-findings.md` with IDs, severity, status
2. Update this coverage map with the date and finding count
3. Fix P0/P1 findings immediately with regression tests
4. Log P2+ findings for future pickup
