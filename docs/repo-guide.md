# Repo Guide

## Purpose

This document defines the intended repository shape and the basic placement rules for new code.

Keep the repo small, explicit, and easy to navigate.

## Top-Level Layout

```text
app/         Next.js routes, layouts, and route handlers
components/  Reusable UI and page-facing presentation components
lib/         Business logic, validation, database access, helpers
drizzle/     Schema and migration files
docs/        Durable project documentation and ADRs
public/      Static assets
scripts/     Repeatable scripts and local utilities
```

## Folder Responsibilities

### `app/`

- Keep route files thin.
- Use for page composition, layouts, and route handlers.
- Do not hide business logic here if it can live in `lib/`.

### `components/`

- Use for reusable UI pieces and page sections.
- Prefer small, focused components.
- Shared UI primitives should live under `components/ui/` once added.

### `lib/`

Use `lib/` for durable application logic.

Expected subfolders:

- `lib/actions/`: action lifecycle operations
- `lib/auth/`: auth helpers and session-related code
- `lib/db/`: database client, schema helpers, and typed queries
- `lib/validations/`: Zod schemas and boundary validation
- `lib/utils/`: small shared helpers with no domain ownership

Do not turn `lib/` into a junk drawer. If a domain grows, give it a focused folder.

### `drizzle/`

- Store Drizzle schema and migration assets here.
- Keep schema naming boring and explicit.

### `docs/`

- Store durable docs only.
- Do not use `docs/` for temporary scratch notes unless they are intentionally part of planning history.

### `scripts/`

- Put repeatable scripts here.
- Name them clearly and prefer explicit inputs over hidden assumptions.

## Placement Rules

- Page and route handlers stay thin.
- Validation happens at the boundary.
- State transition logic belongs in focused helpers, not spread across pages and routes.
- Database access should be centralized and typed.
- If logic is reused or business-critical, it should not live only inside a component.

## Naming

- Use kebab-case for most file names.
- Use clear domain names over vague names like `helpers.ts` or `misc.ts`.
- Prefer explicit names such as `approve-action.ts`, `create-action.ts`, or `actions.ts`.

## File Size and Extraction

- Start simple, but split files once they become hard to scan.
- Extract when a file mixes unrelated concerns, repeats logic, or obscures the state flow.
- Do not over-abstract early.

## Tests

- Co-locate tests with the code they verify when practical.
- Favor focused tests around action lifecycle behavior, validation, and approval outcomes.

## Repo Hygiene

- Use `pnpm` only.
- Keep root clutter low.
- Do not commit secrets or generated junk.
- Prefer a few good docs over many stale docs.
