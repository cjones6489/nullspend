# AgentSeam

AgentSeam is a lightweight approval layer for risky AI agent actions.

It sits between an agent and a risky side effect, turns that action into a proposed action, presents it for approval, and only allows execution after a human decision.

## v1 Goal

Prove the smallest useful end-to-end loop:

1. An agent proposes a risky action.
2. The action appears in a web inbox.
3. A human approves or rejects it.
4. Approved actions execute.
5. Rejected actions do not execute.
6. The result is logged and visible.

## Product Scope

AgentSeam is:

- a developer tool
- a control layer
- an approval inbox for risky agent actions
- a small, testable product

AgentSeam is not:

- a full governance platform
- a workflow orchestration engine
- a policy engine
- an enterprise compliance suite

## Planned Stack

- Next.js App Router
- React
- TypeScript
- Tailwind CSS
- shadcn/ui
- Supabase
- Drizzle ORM
- Zod
- pnpm

## Documentation

- `agentseam-project-outline.txt`: original project brief and product outline
- `docs/architecture.md`: system overview, boundaries, and state machine
- `docs/repo-guide.md`: repo organization, naming, and file placement guidance
- `docs/adr/`: architecture decision records for important early choices

## Planned Repo Structure

```text
agentseam/
  app/
  components/
  lib/
    actions/
    auth/
    db/
    validations/
    utils/
  drizzle/
  docs/
    adr/
  public/
  scripts/
```

## Current Status

This repository is in pre-scaffold setup.

The current focus is to establish:

- lean Cursor guidance
- clean repo conventions
- lightweight architecture documentation
- a small set of durable decisions before coding begins

## Working Principles

- Prove the approval loop first.
- Prefer boring, explicit implementations.
- Keep the SDK tiny.
- Keep the UI clean and operationally clear.
- Do not add enterprise features before the core loop works.
