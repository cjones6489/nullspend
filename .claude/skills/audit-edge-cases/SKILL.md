---
name: audit-edge-cases
description: Deep edge-case and resilience audit. Use after the main build audit to find remaining subtle failure modes, race conditions, timing issues, and long-tail production risks that earlier audits missed.
disable-model-invocation: true
allowed-tools: Read, Edit, Write, Grep, Glob, Agent, Bash(git diff *), Bash(git log *), Bash(git show *), WebFetch, WebSearch, mcp__context7__resolve-library-id, mcp__context7__query-docs
argument-hint: (no arguments — audits implementation in context)
model: opus
---

Continue the post-implementation audit and focus only on remaining edge cases, subtle failure modes, and long-tail production risks that may still be missed.

Assume the obvious bugs and main implementation issues have already been identified. Do not repeat prior findings unless you are refining them based on new evidence.

Your role:
Act as a highly skeptical senior staff engineer performing a final edge-case and resilience audit of the implemented code.

Objective:
Find the non-obvious problems that would still cause failures in production, especially under unusual inputs, timing issues, partial failures, retries, malformed data, concurrency, permissions boundaries, and real-world operational conditions.

Instructions:
1. Review the implemented code and prior audit results together.
2. Focus only on net-new edge cases, hidden failure modes, and places where the previous audit may have been too shallow.
3. Look specifically for:
   - invalid, null, empty, partial, stale, duplicate, or malformed inputs
   - race conditions, retry loops, timeouts, partial writes, and out-of-order events
   - state transition bugs and inconsistent UI/backend behavior
   - auth, session, and permission boundary issues
   - pagination, rate limit, caching, idempotency, and concurrency problems
   - migration edge cases, rollback hazards, and deploy-order issues
   - weak error handling, silent failures, and missing fallback behavior
   - observability blind spots that would make failures hard to detect
   - long-tail performance issues that appear only under realistic load or larger datasets
4. Re-check any uncertain framework, SDK, library, or API assumptions against official technical documentation when available.
5. Prefer official docs and primary technical sources over blog posts.
6. Do not restate generic best practices. Only surface concrete risks tied to this implementation.
7. If something cannot be verified from the code or available context, state exactly what is unknown.
8. Do not fix the code yet. Produce only the focused audit.

Return the audit in exactly this structure:

## Remaining Edge-Case Risks
For each issue include:
- Severity: Critical / High / Medium / Low
- Category
- Scenario
- What could fail
- Why it matters
- Evidence or reasoning
- Recommended fix

## Resilience and Recovery Gaps
List missing handling for retries, partial failures, timeouts, rollbacks, fallback behavior, and recovery paths.

## State and Data Integrity Risks
List any issues involving state transitions, duplicate actions, stale data, inconsistent writes, idempotency, or data corruption risk.

## Security and Permission Edge Cases
List subtle auth, session, role, tenant-boundary, or permission-related risks.

## Observability and Debuggability Gaps
List places where failures could occur without clear logs, metrics, tracing, alerts, or user-visible signals.

## Remaining Test Gaps
List missing edge-case tests, failure-mode tests, integration tests, and production-simulation checks.

## Final Edge-Case Readiness
- Edge-case readiness score: /10
- Safe to ship now: Yes / No
- Remaining blockers, if any

Final rule:
Only surface net-new edge cases, subtle risks, and meaningful refinements. Optimize for catching what earlier audits missed.
