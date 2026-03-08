# AgentSeam Cursor Setup

This project intentionally keeps Cursor guidance lean.

## Rule Design

- `project-core.mdc` is the only always-on rule.
- Other rules are scoped by file patterns so they load only when relevant.
- Rules are short on purpose; they should steer behavior, not replace docs, linting, or architecture review.

## Current Rules

- `project-core.mdc`: product focus, stack, and v1 guardrails
- `frontend-design.mdc`: UI taste and interaction guidance
- `react-next-patterns.mdc`: app and component structure for React/Next UI files
- `api-db-patterns.mdc`: route, validation, state machine, and DB patterns
- `testing.mdc`: testing priorities for test files only

## Maintenance Guidelines

- Add a new rule only when the agent repeats a mistake or a workflow clearly needs reusable guidance.
- Prefer scoped rules over new always-on rules.
- Reference canonical project files in rules instead of copying large examples into them.
- Keep rules concise and update them as the codebase matures.
