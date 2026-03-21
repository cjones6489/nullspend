---
name: audit-status
description: Show audit findings progress and security review status. Use when asked about audit status, security findings, remaining issues, or what to work on next.
allowed-tools: Read, Grep
user-invocable: true
---

Read `docs/archive/audit-findings.md` and produce a summary:

1. Parse the summary table for current counts (Done, Partial, Todo by severity)
2. List all items marked [DONE] with their ID and title
3. List all items marked [TODO] grouped by the recommended phase order at the bottom of the file
4. Highlight the next recommended items to work on

Keep the output concise — use a table for the summary and bullet points for the lists.
