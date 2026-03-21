---
name: stress-test
description: Stress test the live deployed proxy — concurrency ramps, budget races, streaming abuse, and recovery verification. Use when you want to hammer the system and find edge cases. Pass intensity as argument (light/medium/heavy).
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, Bash, Agent
argument-hint: [light|medium|heavy] (default: medium)
---

Run a multi-phase stress test against the live deployed NullSpend proxy. The goal is to find bugs, race conditions, and degradation under load — not just verify happy paths.

## Arguments

`$ARGUMENTS` — intensity level: `light`, `medium`, or `heavy`. Default: `medium`.

| Level | Concurrency | Budget races | Abort cycles | Estimated cost |
|-------|------------|-------------|-------------|----------------|
| light | 10-15 | 10 concurrent | 5 cycles | ~$0.02 |
| medium | 25-40 | 25 concurrent | 15 cycles | ~$0.10 |
| heavy | 50-80 | 50 concurrent | 30 cycles | ~$0.30 |

## Phase 0 — Preflight

Before running tests, verify the system is ready:

1. Check the proxy is up:
```bash
cd apps/proxy && node -e "
  const url = process.env.PROXY_URL ?? 'http://127.0.0.1:8787';
  fetch(url + '/health').then(r => r.json()).then(b => {
    console.log('Health:', JSON.stringify(b));
    if (b.status !== 'ok') process.exit(1);
  }).catch(e => { console.error('Proxy unreachable:', e.message); process.exit(1); });
"
```

2. Verify `.env.smoke` exists in `apps/proxy/`:
```bash
test -f apps/proxy/.env.smoke && echo "OK" || echo "MISSING: apps/proxy/.env.smoke"
```

3. Show the user the intensity and estimated cost. **Wait for user confirmation before proceeding.**

> Ready to run stress tests at **{INTENSITY}** intensity.
> Estimated cost: ~${estimated}. This will send {N} real API requests to OpenAI/Anthropic.
> Proceed?

## Phase 1 — Run stress tests

Parse the intensity from `$ARGUMENTS` (default to "medium" if blank/missing).

Run the stress test suite:
```bash
cd apps/proxy && STRESS_INTENSITY={intensity} npx vitest run --config vitest.stress.config.ts 2>&1
```

Important:
- Capture the FULL output — every `[stress]` log line contains metrics
- If any test fails, DO NOT stop — collect all results first
- The test files run in order: concurrency → budget-races → streaming → recovery

## Phase 2 — Analyze results

After the test run completes, analyze the output for:

### Performance metrics
- Extract all `[stress]` log lines
- Compare latency p50/p95/p99 across test phases
- Flag if p95 > 10s or p99 > 20s

### Budget enforcement
- Did any requests leak past a $0 budget? (CRITICAL)
- How many requests succeeded vs budget capacity? (should be close)
- What's the spend drift between cost_events and Postgres budget?

### Streaming resilience
- Did all completed streams end with `[DONE]`?
- Did the abort storm cause any 500/502 errors?
- Are cost events logged for aborted streams?

### Recovery
- Are all health endpoints responsive?
- Are normal requests succeeding after stress?
- Any negative spend in budgets table?

## Phase 3 — Report

Present findings as a structured report:

```
## Stress Test Report — {INTENSITY} intensity

### Summary
| Phase | Status | Key metric |
|-------|--------|-----------|
| Concurrency ramp | PASS/FAIL | p95 latency |
| Cross-provider | PASS/FAIL | OAI/ANT success rates |
| Sustained load | PASS/FAIL | batch p95 |
| Budget races | PASS/FAIL | leak count |
| Zero-budget | PASS/FAIL | 100% denied? |
| Streaming abort | PASS/FAIL | post-abort health |
| Concurrent streams | PASS/FAIL | [DONE] rate |
| Recovery | PASS/FAIL | all checks |

### Anomalies
- List anything unexpected

### Performance
- Baseline vs stressed latency comparison
- Degradation percentage

### Budget consistency
- Cost events logged: X/Y
- PG spend vs cost events delta
- Drift percentage

### Recommendations
- What needs investigation
- What to fix before production
```

## Cognitive patterns

- **The goal is to break things.** Every test that passes is slightly disappointing. We want to find the bugs.
- **Watch for intermittent failures.** A test that fails 1/10 times is more interesting than one that always fails.
- **Budget races are the highest-value target.** Overspend bugs lose real money.
- **Don't dismiss "it worked".** If a test passes easily, consider whether the test was aggressive enough.
- **Latency degradation matters.** A system that technically works but takes 30s per request is broken.
