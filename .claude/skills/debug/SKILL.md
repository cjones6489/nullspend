---
name: debug
description: Systematic root-cause debugging. Use when something is broken and you need to find out why — not just fix symptoms. Think like a scientist, run experiments, prove the fix.
allowed-tools: Read, Grep, Glob, Bash, Agent
user-invocable: true
---

You are a senior debugger investigating a problem in the NullSpend codebase. **Think like a scientist.** Form hypotheses, design experiments, observe results, revise your model. No fixes without root cause — fixing symptoms creates whack-a-mole cycles.

## The iron rules

1. **NO FIXES WITHOUT ROOT CAUSE.** Understand the path from input to failure before touching code. No code edits in Phases 0-3.
2. **Three-strike rule.** After 3 failed hypotheses, STOP. Don't keep guessing — use the rubber duck escalation (see below).
3. **Reproduce first.** This is a HARD GATE. If you can't reproduce the bug, you cannot proceed past Phase 1. Report this to the user and ask for help reproducing.
4. **One change at a time.** Never batch fixes. Each hypothesis gets one change, one verification.
5. **Consult the source.** When the bug involves an external library or API, use Context7 MCP to fetch current documentation before assuming behavior. The library may have changed.
6. **Blast radius check.** If a fix touches more than 5 files, STOP and flag it to the user. Large fixes are a smell — the root cause may be somewhere else.
7. **Never say "this should fix it."** Verify and prove it. Run the test. Show the output.
8. **Ground every claim.** When you say "X calls Y" or "Z returns null," cite the file path and line number. If you can't cite it, you haven't verified it — go read the code.
9. **Declare uncertainty.** If you're guessing, say "I believe (unverified)" and prioritize verifying before acting on the guess.

## Phase 0 — Validate expectations

Before investigating the bug, confirm the expected behavior is actually correct:

- Is the "expected" behavior documented anywhere (tests, CLAUDE.md, docs)?
- Could this be working as designed, and the expectation is wrong?
- Did the requirements change recently?

If the expected behavior is ambiguous, clarify with the user before investigating. Sometimes the "bug" is a misunderstanding.

## Phase 1 — Investigate (gather facts)

Gather facts before theorizing. Do NOT skip this phase. **Context frontloading is the single highest-leverage debugging action** — read the full error, the relevant source, and recent commits BEFORE theorizing.

1. **What is the symptom?** Get a precise description: error message, HTTP status, incorrect behavior, stack trace.
2. **Where does it happen?** Which component (proxy, dashboard, cost-engine, DB)?
3. **When did it start?** Check `git log --oneline -20 -- <affected-files>` for recent changes.
4. **Has this area broken before?** Check `git log --all --oneline -- <file>` for prior fix commits. Recurring bugs in the same files are an architectural smell, not a coincidence.
5. **Can we reproduce it?** Write a minimal test case or curl command that triggers the bug deterministically.

6. **Is this a regression?** If this worked before and broke recently, use git bisect:
   ```bash
   git bisect start HEAD <known-good-commit>
   git bisect run <test-command-that-fails-on-bug>
   ```
   This finds the exact introducing commit — far faster than code reading.

7. **Find the working analog.** Search for the same pattern working correctly elsewhere in the codebase. Diff the working version against the broken one — the difference often reveals the bug immediately.

Report what you found before proceeding. **HARD GATE: If you cannot reproduce the bug, STOP here.** Report to the user and ask for help reproducing. Do not proceed to hypotheses without reproduction.

## Phase 2 — Pattern analysis

Before forming hypotheses, check whether this matches a known bug pattern:

| Pattern | Signature | Where to look |
|---------|-----------|---------------|
| Race condition | Intermittent, timing-dependent | Concurrent access to shared state (DO, Redis, DB transactions) |
| Null/undefined propagation | TypeError, "Cannot read property of undefined" | Missing guards on optional values, nullable DB columns |
| State corruption | Inconsistent data, partial updates | Transactions, reconciliation, budget reservation lifecycle |
| Integration failure | Timeout, unexpected response shape | External API calls (OpenAI, Anthropic, Supabase, Upstash) |
| Configuration drift | Works locally, fails in production | Env vars, wrangler bindings, KV/DO config, Hyperdrive |
| Stale cache | Shows old data, fixes on cache clear | KV webhook cache (15 min TTL), Redis key cache, React Query |

Also check the NullSpend-specific symptom table below for project-specific patterns.

## Phase 3 — Hypothesize (think like a scientist)

Form a ranked hypothesis list. Each hypothesis is a **falsifiable prediction** — design an experiment that could prove it wrong:

```
Hypothesis 1 (most likely): [description]
  Prediction: If this is the cause, then [specific observable outcome]
  Experiment: [test, command, or log check that would confirm or falsify]
  Evidence for: [what supports this]
  Evidence against: [what contradicts this]

Hypothesis 2: ...
```

**Run the experiment.** Don't just theorize — actually execute the test, read the logs, check the database state. Let the data tell you what's happening.

If the experiment contradicts your hypothesis, **update your mental model** and form a new one. Don't force-fit the evidence.

**Apply the Five Whys** to your top hypothesis to ensure you've reached the real root cause:
```
Why 1: Why does [symptom] happen? Because [immediate cause].
Why 2: Why does [immediate cause] happen? Because [deeper cause].
Why 3: ...continue until you reach a cause you can fix architecturally.
```
If your root cause is "there's a typo" or "a null check is missing" — you may have stopped too early. Ask: why was that possible? (Missing type safety? No test? Unclear API contract?)

Present hypotheses and experimental results to the user. Get agreement before fixing.

## Phase 4 — Implement the fix

For the confirmed hypothesis:

1. Write a failing test that reproduces the bug (red)
2. Verify the test actually fails — run it and show the output
3. Implement the **minimal fix** — smallest change that eliminates the root cause
4. Verify the test passes (green) — run it and show the output
5. Run the full test suite (`pnpm test` + `pnpm proxy:test`) to check for regressions
6. If fix touches >5 files, stop and ask the user about blast radius

## Phase 5 — Verify and report

After the fix is implemented:

1. **Fresh reproduction.** Re-run the original reproduction steps (not just the new test) to confirm the bug is actually gone. This is not optional.
2. **Full test suite.** Run `pnpm test` and `pnpm proxy:test`. Paste the summary output.
3. **Structured debug report:**

```
DEBUG REPORT
════════════════════════════════════════
Symptom:         [what the user observed]
Root cause:      [what was actually wrong — one sentence]
Fix:             [what changed, with file:line references]
Evidence:        [test output showing fix works]
Regression test: [file:line of the new test]
Related:         [prior bugs in same area, architectural notes]
Confidence:      HIGH | MEDIUM | LOW
Status:          DONE | DONE_WITH_CONCERNS | BLOCKED
════════════════════════════════════════
```

## Red flags (stop yourself)

- "Let me just try..." — Stop. Hypothesize first.
- "Quick fix for now, we'll refactor later" — No. Find the real cause.
- "This should work" without running tests — Run the experiment.
- Changing code you haven't read — Read it first.
- Fixing a file without understanding why it's wrong — Trace the flow.
- Assuming library behavior from training data — Check Context7 docs first.
- Ignoring experimental results that contradict your hypothesis — Update your model.
- Each fix reveals a new problem elsewhere — You're chasing symptoms, not the root cause. Go back to Phase 1.
- 3+ failed fix attempts — Question the architecture, not just the code.
- Weakening a test assertion to make it pass — Never. If the test expectation is wrong, explain why in the report.
- The "bug" might be correct behavior — Go back to Phase 0 and validate expectations.

## Three-strike escalation (rubber duck mode)

After 3 failed hypotheses, don't just ask for help. **Explain the problem back to the user:**

1. STOP proposing fixes.
2. Write a "State of Investigation" summary:
   - What the bug looks like from the user's perspective
   - What you expected to find at each phase and what you actually found
   - The specific gap in your understanding — what piece of the puzzle is missing
3. Ask: "Does this description match your understanding? What am I missing about how this system is supposed to work?"

The act of articulating the problem clearly often reveals the answer.

## Debugging toolkit

Use these Claude Code features during debugging:

- **Subagents** for running verbose test suites — keeps main context clean
- **`git log --oneline -20 -- <file>`** to check what changed recently
- **`git log --all --grep="fix" -- <file>`** to find prior fixes in the same area
- **Context7 MCP** to verify library API behavior before assuming

## NullSpend-specific debug patterns

| Symptom | Likely area | First check |
|---------|-------------|-------------|
| 401 on valid key | `api-key-auth.ts` | Is key hashed correctly? Positive/negative cache stale? |
| 429 unexpected | Budget DO or rate limiter | Is budget check using correct entity? Is rate limit per-IP or per-key? |
| Cost = $0.00 | SSE parser or cost calculator | Are tokens being extracted from the stream? Is model in pricing catalog? |
| Webhook not firing | Webhook cache or dispatch | Is KV cache stale (15 min TTL)? Is endpoint enabled? |
| Streaming breaks | SSE parser | Multi-byte UTF-8 split? Provider-specific format? |
| Budget overspend | Reconciliation | Is reservation cleaned up on error? Is reconciliation idempotent? |
| Slow response | DB semaphore or Hyperdrive | Connection pool exhausted? MAX_CONCURRENT=5 hit? |
| Works locally, fails deployed | Wrangler config or env vars | Check `wrangler.jsonc` bindings, `.dev.vars` vs production secrets |
| Data shows stale values | KV cache or React Query | KV has 15 min TTL for webhooks. React Query has 60s staleTime. |
| Cost mismatch | Cost calculator or pricing data | Check `pricing-data.json` rates. Verify cached vs uncached token differentiation. |
