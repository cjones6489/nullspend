# Architecture Overview

## Summary

AgentSeam is a lightweight approval layer for risky AI agent actions.

The core system sits between an agent runtime and a real-world side effect. Instead of executing immediately, risky actions become pending proposals that a human can approve or reject.

## Core Loop

1. An agent attempts a risky action.
2. AgentSeam creates a pending action record.
3. The action appears in the approval inbox.
4. A human approves or rejects it.
5. If approved, the agent continues and executes the original action.
6. If rejected, execution is blocked.
7. The final result is stored.

## High-Level Shape

```text
Agent Runtime
    ->
AgentSeam SDK / Wrapper
    ->
Next.js API / Backend
    ->
Supabase Postgres
    ->
Approval Dashboard
```

## Main Boundaries

### Agent / SDK

- Wraps risky side effects
- Creates proposed actions
- Waits for approval by polling in v1
- Executes only after approval
- Reports final success or failure

### API / Backend

- Validates requests
- Stores and updates actions
- Enforces explicit state transitions
- Returns compact typed responses

### Database

- Stores actions as the primary v1 record
- May later add event history and signed receipts
- Should remain simple until the core loop is proven

### Dashboard

- Shows pending actions
- Supports approve and reject decisions
- Shows action details and history
- Prioritizes trust, clarity, and obvious action affordances

## Initial State Machine

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

State transitions should be explicit in code and reflected in timestamps and actor metadata.

## v1 Constraints

- Use one Next.js app, not a monorepo
- Use polling before realtime
- Keep the SDK small
- Avoid policy engines, workflow systems, and enterprise governance features
- Optimize for one strong end-to-end demo before expanding the product

## Source of Truth

The fuller product brief lives in `agentseam-project-outline.txt`. This document is the maintainable engineering summary, not the full ideation archive.
