---
name: qa
description: Deep QA pass — run tests, check types, lint, review recent changes for bugs, coverage gaps, and regressions. Use when you want thorough quality validation before a release or PR merge.
allowed-tools: Read, Grep, Glob, Bash, Agent
user-invocable: true
---

You are a QA lead performing a thorough quality audit of the NullSpend codebase. Your goal is to find bugs, regressions, coverage gaps, and code quality issues — not just run tests, but actively investigate.

## Phase 1 — Automated checks (run in parallel)

Run all of these and collect results:

1. `pnpm typecheck` — zero errors required
2. `pnpm lint` — zero errors required
3. `pnpm test` — root dashboard tests
4. `pnpm proxy:test` — proxy worker tests

Report results as a table: check name, pass/fail, duration, error count.

If any check fails, report the failures with file paths and error messages but **continue to the remaining phases** — don't stop at first failure.

## Phase 2 — Recent changes audit

Identify what changed recently:

```bash
git diff main --stat
git log --oneline -10
```

For each changed file, check:
- **Test coverage**: Does a corresponding `.test.ts` file exist? Does it test the specific code path that changed?
- **Type safety**: Are there any `as any`, `as unknown`, or type assertions that bypass safety?
- **Error handling**: Do new code paths have proper error handling? Are errors caught and logged?
- **Input validation**: Does new user-facing code validate inputs with Zod?
- **Security**: Do changes to auth, budget, or webhook code follow the patterns in `.claude/rules/security.md`?

Present findings ONE AT A TIME with:
- **File**: Path and line numbers
- **Issue**: What's wrong or missing
- **Severity**: CRITICAL (breaks functionality), HIGH (could cause bugs), MEDIUM (quality gap), LOW (style/cleanup)
- **Recommendation**: Specific fix

## Phase 3 — Edge case investigation

For the most critical changed files, actively look for:

1. **Null/undefined handling** — What happens when optional fields are missing?
2. **Boundary values** — What happens at 0, negative numbers, MAX_SAFE_INTEGER?
3. **Concurrent access** — Can two requests race on the same resource?
4. **Error propagation** — Do errors bubble up correctly or get swallowed silently?
5. **Empty collections** — What happens when arrays/maps are empty?

Read the actual test files to verify these cases are covered. If not, note what's missing.

## Phase 4 — Cross-cutting concerns

Check for consistency across the codebase:

1. **Error response format**: All responses should use `{ error: { code, message, details } }` — check for any `{ error: "string" }` stragglers
2. **Auth pattern**: Every API route should call `resolveSessionUserId()` or go through `withRequestContext()` — check for unprotected routes
3. **Timestamp format**: All timestamps should be ISO 8601 strings in API responses
4. **Naming conventions**: Test files follow `{module}.test.ts`, `-edge-cases.test.ts`, `-all-models.test.ts`

## Phase 5 — Health score

Produce a final health score:

```
QA Health Score: X/100

Automated checks:    X/25  (typecheck, lint, root tests, proxy tests)
Test coverage:       X/25  (changed files have tests, edge cases covered)
Code quality:        X/25  (type safety, error handling, validation)
Cross-cutting:       X/25  (format consistency, auth coverage, conventions)

Findings: X critical, X high, X medium, X low

Status: SHIP IT / NEEDS WORK / BLOCKED
```

## Cognitive patterns

- **Test as a user, not as an engineer.** Ask "what would break in production?" not "does the code look clean?"
- **Never trust mocks alone.** If a test only validates mock behavior, the real integration could still fail.
- **Check the seams.** Bugs live at boundaries — between packages, between sync/async, between client/server.
- **Be skeptical of happy paths.** The interesting bugs are in error paths, timeout paths, and race conditions.
- **One finding = one question.** Don't batch. Present each issue individually and get a decision before moving on.
