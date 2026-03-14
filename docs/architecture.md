# Architecture Overview

## Summary

NullSpend is a lightweight approval layer for risky AI agent actions.

The core system sits between an agent runtime and a real-world side effect. Instead of executing immediately, risky actions become pending proposals that a human can approve or reject.

## Core Loop

1. An agent attempts a risky action.
2. NullSpend creates a pending action record.
3. The action appears in the approval inbox.
4. A human approves or rejects it.
5. If approved, the agent continues and executes the original action.
6. If rejected, execution is blocked.
7. The final result is stored.

## High-Level Shape

```text
Agent Runtime                  MCP Client (Claude, Cursor, ...)
    │                                │                  │
    │                                ▼                  ▼
    │                       MCP Server adapter    MCP Proxy (gates
    │                       (propose_action,       upstream tools)
    ▼                        check_action)              │
NullSpend SDK ──────────────────────┼───────────────────┘
    │                               │
    │           HTTPS               │
    ▼                               ▼
┌────────────────────────────────────────┐
│         Next.js API / Backend          │
│  Zod validation → action helpers       │
│  API key auth (x-nullspend-key)        │
└──────────────────┬─────────────────────┘
                   │
                   ▼
┌────────────────────────────────────────┐
│          Supabase Postgres             │
│  actions table (per-user ownership)    │
│  api_keys table (SHA-256 hashed)       │
│  slack_configs table (webhook URLs)    │
└──────────────────┬─────────────────────┘
                   │
               ┌───┴───┐
               ▼       ▼
┌──────────────────┐  ┌─────────────────────┐
│ Approval Dashboard│  │  Slack Integration  │
│ (web UI)          │  │  Webhook notify +   │
│ Supabase Auth     │  │  interactive buttons│
│ Inbox · Detail    │  │  POST /api/slack/   │
└──────────────────┘  └─────────────────────┘
```

Three integration paths exist:

1. **SDK** — Agent code imports `@nullspend/sdk` and calls `proposeAndWait()` or lower-level methods directly.
2. **MCP Server** — An MCP client (Claude Desktop, Cursor) connects to `@nullspend/mcp-server`, which exposes `propose_action` and `check_action` tools.
3. **MCP Proxy** — An MCP client connects to `@nullspend/mcp-proxy`, which spawns an upstream MCP server and selectively gates its tools through NullSpend approval before forwarding.

## Main Boundaries

### Agent / SDK

- Wraps risky side effects
- Creates proposed actions
- Waits for approval by polling in v1
- Executes only after approval
- Reports final success or failure

### API / Backend

- Validates requests with Zod at the route boundary
- Authenticates SDK/agent requests via API keys (`x-nullspend-key` header, SHA-256 hashed lookup)
- Stores and updates actions scoped to the owning user (`ownerUserId`)
- Enforces explicit state transitions with optimistic locking
- Returns compact typed responses

### Database

- `actions` table: primary record for the action lifecycle, scoped per user
- `api_keys` table: hashed API keys for SDK route authentication
- Drizzle ORM for schema definition and typed queries

### Dashboard

- Supabase Auth (email/password) for user sessions
- Shows pending actions in an inbox with status tabs
- Supports approve and reject decisions
- Shows action details, timeline, payload, and history
- TanStack Query for client-side data fetching and cache management

## Packages

The repo is a pnpm workspace monorepo with three packages under `packages/`:

- **`@nullspend/sdk`** (`packages/sdk/`) — TypeScript client with `proposeAndWait`, `createAction`, `getAction`, `waitForDecision`, `markResult`. Polling-based, zero runtime dependencies.
- **`@nullspend/mcp-server`** (`packages/mcp-server/`) — MCP server exposing `propose_action` and `check_action` tools. Uses `@nullspend/sdk` internally. Runs over stdio.
- **`@nullspend/mcp-proxy`** (`packages/mcp-proxy/`) — Stdio proxy that sits between an LLM and any upstream MCP server, transparently gating risky tool calls through NullSpend approval. Configurable gated/passthrough tool lists.

## State Machine

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

State transitions are explicit in code and reflected in timestamps and actor metadata.

## Action Expiration

Pending actions support a configurable server-side TTL via `expiresInSeconds` (default: 1 hour). Expiration uses a lazy check-on-read pattern — no background jobs. When a pending action is accessed via `getAction`, `listActions`, `approve`, or `reject`, the system checks whether `expiresAt` has passed and atomically transitions it to `expired` if so. Attempting to approve or reject an expired action returns 409 Conflict.

## Authentication

- **Dashboard users**: Supabase Auth (email/password), session cookies
- **SDK/agent callers**: API key authentication via `x-nullspend-key` header. Keys are created in the Settings page, stored as SHA-256 hashes, and scoped to the creating user. All actions created with an API key are owned by that user.

## Source of Truth

Use `docs/roadmap.md` for current project status and planned features. The original v1 build contract is preserved in `docs/v1-build-contract.md` (completed). The fuller product brief lives in `nullspend-project-outline.txt`.
