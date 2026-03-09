# V1 Build Contract

> **Status: Completed.** The v1 ship bar (below) has been met. This document is preserved
> as the original build contract. For current status, see `docs/roadmap.md`.

## Purpose

This document locks the minimum implementation target for the first build.

If a feature does not help prove this loop, defer it.

## Target Outcome

A developer can wrap one risky action, see it appear in a web inbox, approve or reject it, and see the final result recorded.

## First Demo

Use `http_post` as the first end-to-end demo action.

Why this action first:

- It is easy to represent as structured payload data.
- It is easy to preview in the UI.
- It proves a real side effect without introducing email provider setup.
- It is less environment-specific than `shell_command`.

## Fixed V1 Scope

Build only these pieces first:

- create action
- view pending actions in an inbox
- view a single action detail page
- approve an action
- reject an action
- mark the final execution result
- poll for approval from a tiny TypeScript helper

Do not build these before the loop works:

- history page
- settings page
- realtime updates
- action events table
- signed receipts
- auto-approve rules
- framework-specific adapters

## V1 Data Contract

Start with one primary table: `actions`.

Suggested fields:

```text
id
agent_id
action_type
status
payload_json
metadata_json
created_at
approved_at
rejected_at
executed_at
expired_at
approved_by
rejected_by
result_json
error_message
environment
source_framework
```

V1 decisions:

- Keep `action_type` as a database `text` column.
- Validate `action_type` with a Zod enum at the API boundary.
- Initial allowed action types: `send_email`, `http_post`, `http_delete`, `shell_command`, `db_write`, `file_write`, `file_delete`.
- Store the Supabase auth user id in `approved_by` and `rejected_by` as text in v1.
- Do not block the first implementation on joins to a separate profile table.

## Allowed Status Transitions

These transitions are the product.

```text
pending
  -> approved
  -> rejected
  -> expired

approved
  -> executing

executing
  -> executed
  -> failed
```

Rules:

- Only allow explicit transitions.
- Record the timestamp for each transition that occurs.
- Record the actor id for approve and reject decisions.
- Never jump directly from `pending` to `executed`.

## Initial API Contract

Build only these routes first:

- `POST /api/actions`
- `GET /api/actions/[id]`
- `POST /api/actions/[id]/approve`
- `POST /api/actions/[id]/reject`
- `POST /api/actions/[id]/result`

V1 response guidance:

- Return compact JSON.
- Prefer `id`, `status`, and only the fields the caller actually needs.
- Keep error shapes simple and typed.

## Initial UI Contract

Create only these views first:

- inbox page showing pending actions
- action detail page showing payload, metadata, status, and decision controls

The inbox should show:

- action type
- agent id
- created at
- environment
- preview summary
- approve button
- reject button

The detail page should show:

- full payload
- metadata
- current status
- result or failure details
- approve or reject controls when pending

## Initial SDK Contract

The first helper should do only this:

1. Create an action.
2. Poll `GET /api/actions/[id]` until the action is no longer `pending`.
3. Throw if the action is rejected or expired.
4. Mark the action as `executing` before the wrapped side effect starts.
5. Mark the action as `executed` or `failed` after the side effect finishes.

Keep the helper tiny. Do not turn it into a framework.

## Ship Bar

The first implementation is good enough when all of these are true:

1. A wrapped `http_post` action creates a pending record.
2. The action appears in the inbox.
3. A user can approve or reject it in the UI.
4. Approval allows the wrapped function to continue.
5. Rejection prevents the wrapped function from executing.
6. The final status and result are visible afterward.
