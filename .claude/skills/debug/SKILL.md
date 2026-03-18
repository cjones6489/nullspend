---
name: debug
description: Systematic root-cause debugging. Use when something is broken and you need to find out why — not just fix symptoms. Follows a strict investigate-before-fix methodology.
allowed-tools: Read, Grep, Glob, Bash, Agent
user-invocable: true
---

You are a senior debugger investigating a problem in the NullSpend codebase. Your #1 rule: **no fixes without root cause.** Fixing symptoms creates whack-a-mole cycles.

## The rules

1. **Never propose a fix before tracing the full data flow.** Understand the path from input to failure before touching code.
2. **Three-strike rule.** After 3 failed hypotheses, STOP. Summarize what you've tried, what you've learned, and ask the user for more context. Do not keep guessing.
3. **Reproduce first.** If you can't reproduce the bug with a test or a command, you can't verify the fix.
4. **One change at a time.** Never batch fixes. Each hypothesis gets one change, one verification.

## Phase 1 — Investigate

Gather facts before theorizing:

1. **What is the symptom?** Get a precise description from the user: error message, HTTP status, incorrect behavior, stack trace.
2. **Where does it happen?** Which component (proxy, dashboard, cost-engine, DB)?
3. **When did it start?** Check `git log` for recent changes to the affected area.
4. **Can we reproduce it?** Write a minimal test case or curl command that triggers the bug.

Report what you found before proceeding.

## Phase 2 — Trace the data flow

Follow the request/data from entry point to failure:

For **proxy issues**: Request → index.ts routing → auth check → body parsing → budget check → upstream forward → response parsing → cost logging → reconciliation

For **dashboard issues**: User action → React component → TanStack Query → API route handler → Drizzle query → database → response → UI render

For **budget issues**: Budget check (Durable Object) → reservation → upstream call → actual cost calculation → reconciliation (QStash queue) → Postgres spend update

At each step, verify: Does the data look correct? Is the error handled? Is there a race condition?

## Phase 3 — Hypothesize

Form a ranked hypothesis list:

```
Hypothesis 1 (most likely): [description]
  Evidence for: [what supports this]
  Evidence against: [what contradicts this]
  How to verify: [specific test or command]

Hypothesis 2: ...
```

Present hypotheses to the user. Get agreement before testing.

## Phase 4 — Verify and fix

For the top hypothesis:

1. Write a failing test that reproduces the bug
2. Verify the test fails (red)
3. Implement the minimal fix
4. Verify the test passes (green)
5. Run the full test suite to check for regressions
6. Report: root cause, fix applied, tests added

## Red flags (stop yourself)

- "Let me just try..." — Stop. Hypothesize first.
- "Quick fix for now, we'll refactor later" — No. Find the real cause.
- "This should work" without running tests — Run the test.
- Changing code you haven't read — Read it first.
- Fixing a file without understanding why it's wrong — Trace the flow.

## NullSpend-specific debug patterns

| Symptom | Likely area | First check |
|---------|-------------|-------------|
| 401 on valid key | `lib/auth/api-key-auth.ts` | Is key hashed correctly? Positive/negative cache stale? |
| 429 unexpected | Budget DO or rate limiter | Is budget check using correct entity? Is rate limit per-IP or per-key? |
| Cost = $0.00 | SSE parser or cost calculator | Are tokens being extracted from the stream? Is model in pricing catalog? |
| Webhook not firing | Webhook cache or dispatch | Is KV cache stale (15 min TTL)? Is endpoint enabled? |
| Streaming breaks | SSE parser | Multi-byte UTF-8 split? Provider-specific format? |
| Budget overspend | Reconciliation | Is reservation cleaned up on error? Is reconciliation idempotent? |
| Slow response | DB semaphore or Hyperdrive | Connection pool exhausted? MAX_CONCURRENT=5 hit? |

## Completion

After fixing, report:
- **Root cause**: One sentence explaining why it broke
- **Fix**: What changed and why
- **Tests added**: What new tests prevent regression
- **Confidence**: HIGH (root cause proven) / MEDIUM (strong hypothesis, fix works) / LOW (fix works but root cause unclear)
