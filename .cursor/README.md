# NullSpend Cursor Setup

This project intentionally keeps Cursor guidance lean.

## Rule Design

- `project-core.mdc` is the only always-on rule.
- Other rules are scoped by file patterns so they load only when relevant.
- Rules are short on purpose; they should steer behavior, not replace docs, linting, or architecture review.

## Current Rules

- `project-core.mdc`: product focus, stack, and v1 guardrails (always-on)
- `api-db-patterns.mdc`: API, cost tracking, budget, and DB patterns
- `frontend-design.mdc`: UI taste and cost dashboard guidance
- `react-next-patterns.mdc`: app and component structure for React/Next UI files
- `testing.mdc`: testing priorities and proxy test patterns
- `security.mdc`: security requirements for auth, API, and proxy code
- `proxy-worker.mdc`: Cloudflare Workers proxy guardrails and architecture

## Skills

Skills live in `.claude/skills/` and are auto-discovered by both Cursor and Claude Code. No duplication needed.

- `audit-status`: summarize security audit progress from `docs/audit-findings.md`
- `test-all`: run all monorepo test suites and report results

## Maintenance Guidelines

- Add a new rule only when the agent repeats a mistake or a workflow clearly needs reusable guidance.
- Prefer scoped rules over new always-on rules.
- Reference canonical project files in rules instead of copying large examples into them.
- Keep rules concise and update them as the codebase matures.
