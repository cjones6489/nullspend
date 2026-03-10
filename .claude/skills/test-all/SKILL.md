---
name: test-all
description: Run all test suites across the monorepo
allowed-tools: Bash
user-invocable: true
---

Run both test suites and report results. These are independent and can run in parallel:

1. Root tests: `cd C:/Users/cjone/Projects/AgentSeam && npx vitest run`
2. Proxy tests: `cd C:/Users/cjone/Projects/AgentSeam/apps/proxy && npx vitest run`

After both complete, summarize:
- Total test files and tests per suite
- Any failures with file paths and test names
- Overall pass/fail status
