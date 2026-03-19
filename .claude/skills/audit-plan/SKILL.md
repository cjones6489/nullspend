---
name: audit-plan
description: Pre-implementation plan audit. Use when a build plan is ready and you want a skeptical staff-engineer review before coding begins. Catches hidden risks, missing details, bad sequencing, weak assumptions, and implementation failure points.
disable-model-invocation: true
allowed-tools: Read, Edit, Write, Grep, Glob, Agent, WebFetch, WebSearch, mcp__context7__resolve-library-id, mcp__context7__query-docs
argument-hint: (no arguments — audits the current plan in context)
model: opus
---

Audit this build plan before any implementation begins.

Your role:
Act as a skeptical senior staff engineer reviewing this plan for hidden risks, missing details, bad sequencing, weak assumptions, and implementation failure points.

Objective:
Find everything that could cause rework, regressions, incorrect implementation, or avoidable ambiguity before code is written.

Instructions:
1. Review the plan critically. Do not assume it is correct.
2. Identify missing assumptions, hidden dependencies, sequencing problems, edge cases, migration issues, and operational risks.
3. For anything that depends on framework, library, SDK, API, infrastructure, or platform behavior, verify against the latest official documentation when available.
4. Use Context7 whenever relevant to retrieve and check current technical documentation, implementation guidance, API references, and library/framework usage details.
5. Prefer official docs and primary technical sources over blog posts.
6. Flag anything underspecified, unverifiable, or likely to fail in practice.
7. Do not rewrite the plan immediately. First produce the audit.
8. Be concise but specific. If something is unknown, say exactly what is unknown.
9. If the scope is too large or vague, recommend how to split it into smaller implementation phases.
10. When documentation or Context7 findings materially affect the plan, explicitly call that out and explain what should change.

Return the audit in exactly this structure:

## Audit Summary
- Readiness score: /10
- Safe to implement now: Yes / No
- Biggest reasons why

## Critical Gaps
For each critical gap include:
- Category
- Problem
- Why it matters
- Recommended fix

## High-Priority Issues
For each issue include:
- Category
- Problem
- Why it matters
- Recommended fix

## Assumptions to Validate
List assumptions that must be confirmed before implementation.

## Documentation Checks
List any findings from official docs or Context7 that change, constrain, or clarify the plan.

## Missing Acceptance Criteria
List what "done" should mean for each major part of the implementation.

## Missing Test and Verification Steps
List required tests, validation steps, observability checks, migration checks, and rollback checks.

## Recommended Plan Changes
Summarize the exact changes needed before implementation.

Final rule:
Optimize for preventing implementation mistakes, not for being agreeable.
