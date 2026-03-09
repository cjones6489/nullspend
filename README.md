# AgentSeam

AgentSeam is a lightweight approval layer for risky AI agent actions.

It sits between an agent and a risky side effect, turns that action into a proposed action, presents it for approval, and only allows execution after a human decision.

## How it works

```text
Agent Runtime                MCP Client (Claude, Cursor, ...)
    │                              │                  │
    │                              ▼                  ▼
    │                     MCP Server adapter    MCP Proxy (gates
    │                     (propose_action,       upstream tools)
    ▼                      check_action)              │
AgentSeam SDK ────────────────────┼───────────────────┘
    │                             │
    │         HTTPS               │
    ▼                             ▼
┌──────────────────────────────────────┐
│        Next.js API / Backend         │
│  POST /api/actions                   │
│  GET  /api/actions/:id               │
│  POST /api/actions/:id/approve       │
│  POST /api/actions/:id/reject        │
│  POST /api/actions/:id/result        │
└──────────────┬───────────────────────┘
               │
               ▼
┌──────────────────────────────────────┐
│         Supabase Postgres            │
└──────────────┬───────────────────────┘
               │
               ▼
┌──────────────────────────────────────┐
│       Approval Dashboard (web UI)    │
│  Inbox · Action Detail · History     │
└──────────────────────────────────────┘
```

## Quickstart

Prerequisites: Node 18+, pnpm, a Supabase project.

```bash
git clone https://github.com/cjones6489/AgentSeam.git
cd AgentSeam
pnpm install

# Copy .env.example to .env.local and fill in your Supabase credentials
cp .env.example .env.local

# Push the database schema to Supabase
pnpm db:push

# Start the dev server
pnpm dev
```

Then open <http://localhost:3000>, sign up, and create an API key in **Settings**.

To run a demo end-to-end:

```bash
# In a second terminal — pick any demo:
AGENTSEAM_API_KEY=ask_your-key pnpm tsx packages/sdk/examples/demo-send-email.ts
AGENTSEAM_API_KEY=ask_your-key pnpm tsx packages/sdk/examples/demo-http-post.ts
AGENTSEAM_API_KEY=ask_your-key pnpm tsx packages/sdk/examples/demo-shell-command.ts
```

Approve the action at <http://localhost:3000/app/inbox>. See [`packages/sdk/examples/`](packages/sdk/examples/) for details on each demo.

## Project structure

```text
app/            Next.js routes, layouts, API route handlers
components/     UI components (ui/, dashboard/, actions/, providers/)
lib/            Business logic, DB, auth, validations, queries, utils
packages/
  sdk/          @agentseam/sdk — TypeScript client for agents
  mcp-server/   @agentseam/mcp-server — MCP server with propose/check tools
  mcp-proxy/    @agentseam/mcp-proxy — stdio proxy that gates upstream MCP tools
drizzle/        Schema migrations
docs/           Architecture, roadmap, ADRs
scripts/        E2E smoke tests and experiment scripts
```

## Commands

| Command | Description |
|---|---|
| `pnpm dev` | Start the Next.js dev server |
| `pnpm build` | Production build |
| `pnpm test` | Run root unit tests (Vitest) |
| `pnpm e2e` | Run E2E smoke tests against a running server |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | TypeScript type check |
| `pnpm sdk:build` | Build the SDK package |
| `pnpm sdk:test` | Run SDK unit tests |
| `pnpm mcp:build` | Build the MCP server package |
| `pnpm mcp:test` | Run MCP server tests |
| `pnpm mcp-proxy:build` | Build the MCP proxy package |
| `pnpm mcp-proxy:test` | Run MCP proxy tests |
| `pnpm db:push` | Push Drizzle schema to database |
| `pnpm db:generate` | Generate Drizzle migrations |
| `pnpm db:studio` | Open Drizzle Studio |

## Packages

- **[@agentseam/sdk](packages/sdk/)** — TypeScript client: `proposeAndWait`, `createAction`, `getAction`, `waitForDecision`, `markResult`. See [SDK README](packages/sdk/README.md).
- **[@agentseam/mcp-server](packages/mcp-server/)** — MCP server exposing `propose_action` and `check_action` tools to MCP clients. See [MCP Server README](packages/mcp-server/README.md).
- **[@agentseam/mcp-proxy](packages/mcp-proxy/)** — Stdio proxy that sits between an LLM and any upstream MCP server, gating risky tool calls through AgentSeam approval. See [MCP Proxy README](packages/mcp-proxy/README.md).

## Documentation

- [docs/architecture.md](docs/architecture.md) — system overview, boundaries, packages, and state machine
- [docs/roadmap.md](docs/roadmap.md) — completed phases and planned features
- [docs/v1-build-contract.md](docs/v1-build-contract.md) — original v1 implementation target (completed)
- [docs/repo-guide.md](docs/repo-guide.md) — repo organization and file placement guidance
- [docs/adr/](docs/adr/) — architecture decision records
- [agentseam-project-outline.txt](agentseam-project-outline.txt) — original product brief and planning archive

## Current status

The core approval loop is proven and working end-to-end. Completed:

- Full action lifecycle API with explicit state machine and optimistic locking
- Approval dashboard: inbox, action detail, history, settings
- Supabase auth (email/password) with API key authentication for SDK routes
- TypeScript SDK with polling-based approval wait
- MCP server adapter for Claude Desktop, Cursor, and other MCP clients
- MCP proxy for transparently gating any upstream MCP server's tools
- Action expiration with configurable TTL and lazy check-on-read
- Slack notifications with interactive approve/reject buttons
- 170+ tests (unit, SDK, MCP proxy, E2E smoke)

## Stack

Next.js App Router, TypeScript, Tailwind CSS, shadcn/ui, Supabase (auth + Postgres), Drizzle ORM, TanStack Query, Zod, pnpm workspace.
