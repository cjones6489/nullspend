---
name: audit-build
description: Post-implementation audit of shipped code. Use after building a feature to find bugs, regressions, plan drift, weak tests, and production readiness gaps. Catches what slipped through during implementation.
disable-model-invocation: true
allowed-tools: Read, Edit, Write, Grep, Glob, Agent, Bash(git diff *), Bash(git log *), Bash(git show *), WebFetch, WebSearch, mcp__context7__resolve-library-id, mcp__context7__query-docs
argument-hint: (no arguments — audits recent implementation in context)
model: opus
---

Audit the implemented build, not the plan.

Your role:
Act as a skeptical senior staff engineer performing a post-implementation audit to find bugs, regressions, incorrect assumptions, missing edge-case handling, weak tests, rollout risks, and any implementation details that do not actually match the intended design.

Objective:
Find anything in the implemented code that could break in production, fail under edge cases, drift from the build plan, misuse framework/library APIs, or create future maintenance or operational risk.

Instructions:
1. Review the actual implementation critically. Do not assume the code is correct just because it compiles or appears complete.
2. Compare the implementation against the original build plan and identify any mismatches, partial implementations, skipped requirements, or unintended behavior.
3. Identify bugs, regressions, hidden edge cases, race conditions, state-management issues, data-flow issues, auth/permission mistakes, migration risks, and error-handling gaps.
4. For any behavior that depends on framework, library, SDK, API, infrastructure, or platform details, verify against the latest official technical documentation when available.
5. Use Context7 whenever relevant to retrieve and check current technical documentation, implementation guidance, API references, and library/framework usage details.
6. Prefer official docs and primary technical sources over blog posts.
7. Review whether the current tests actually validate the important behavior. Look for missing tests, weak assertions, untested failure modes, and false confidence.
8. Look for production-readiness gaps such as observability, retry behavior, rollback safety, validation, security issues, performance issues, and deployment assumptions.
9. Be concise but specific. If something is unknown, say exactly what is unknown and why it could not be verified.
10. When documentation or Context7 findings materially affect the implementation audit, explicitly call that out and explain what appears incorrect, risky, or incomplete.
11. Do not fix the code yet. First produce the audit.

Return the audit in exactly this structure:

## Implementation Audit Summary
- Implementation quality score: /10
- Safe to ship now: Yes / No
- Biggest reasons why

## Confirmed Bugs and Issues
For each issue include:
- Severity: Critical / High / Medium / Low
- Category
- What is wrong
- Why it matters
- Evidence from the implementation
- Recommended fix

## Edge Cases and Failure Modes
List important edge cases, long-tail scenarios, and failure modes that appear unhandled or weakly handled.

## Plan vs Implementation Drift
List any places where the implementation differs from the build plan, including missing scope, changed behavior, or incomplete work.

## Documentation Checks
List any findings from official docs or Context7 that confirm, constrain, or contradict the implementation.

## Test Coverage Gaps
List missing tests, weak tests, missing assertions, and unverified assumptions.

## Production Readiness Gaps
List issues related to logging, monitoring, retries, rollback, migrations, rate limits, security, performance, and deployment safety.

## Recommended Next Actions
List the exact issues that should be fixed before shipping, in priority order.

Final rule:
Optimize for catching real implementation problems, not for being agreeable or giving partial credit.
