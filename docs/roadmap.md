# AgentSeam Roadmap

## Completed

### Phase 0 — Repo Setup
- Next.js app with TypeScript, Tailwind, shadcn/ui
- Supabase connection (auth + Postgres)
- Drizzle ORM with migrations
- ESLint, Vitest, pnpm workspace

### Phase 1 — Core Backend
- `actions` table with full lifecycle schema
- Create, get, approve, reject, result API routes
- Explicit state machine with optimistic locking
- Zod validation on all boundaries

### Phase 2 — Inbox UI + Auth
- Supabase email/password auth (signup, login, session refresh)
- Dashboard shell with sidebar navigation
- Inbox page with status tabs and action table
- Action detail page with payload viewer and approve/reject controls
- TanStack Query data layer with mutations and cache invalidation

### Phase 3 — API Keys + Dashboard Completion
- `api_keys` table with SHA-256 hashing
- Settings page: create, name, revoke API keys
- History page with status filters
- Per-user action ownership (`ownerUserId`)
- DB-backed API key auth for SDK routes

### Phase 4 — SDK Package
- `@agentseam/sdk` TypeScript package at `packages/sdk/`
- `AgentSeam` client with `proposeAndWait`, `createAction`, `getAction`, `waitForDecision`, `markResult`
- Polling-based approval wait strategy
- Custom error types: `AgentSeamError`, `TimeoutError`, `RejectedError`
- 19 unit tests, tsup build (ESM + CJS + types)
- Demo script: `examples/demo-send-email.ts`

### Phase 5 — MCP Adapters
- `@agentseam/mcp-server` package at `packages/mcp-server/`
  - Tools: `propose_action`, `check_action`
  - Uses `@agentseam/sdk` internally
  - Configurable via env vars (`AGENTSEAM_URL`, `AGENTSEAM_API_KEY`)
  - Publishable as `@agentseam/mcp-server` / installable via `npx`
- `@agentseam/mcp-proxy` package at `packages/mcp-proxy/`
  - Stdio proxy between LLM and any upstream MCP server
  - Selectively gates risky tool calls through AgentSeam approval
  - Configurable gated/passthrough tool lists
  - Handles approval, rejection, expiration, and timeout
  - 49 unit tests across config, gate, and proxy modules

### Action Expiration
- Configurable server-side TTL (`expiresInSeconds`, default 1 hour)
- Lazy check-on-read expiration at `getAction`, `listActions`, `approve`, `reject`
- `expiresAt` column in DB, distinct from `expiredAt` (transition timestamp)
- Expiration-aware approve/reject (409 Conflict when expired)
- SDK and MCP proxy forward `expiresInSeconds`; proxy maps `expired` to `timedOut`
- UI: expires countdown, expired tab, timeline event, cache invalidation
- Unit tests for expiration logic + E2E expiration scenarios
- Race condition fix for concurrent `getAction` on expiring action

---

## Next Up

### Signed Receipts
Cryptographic proof of every action lifecycle event. Every approval, rejection, and execution produces a signed, verifiable receipt.

- `receipts` table: action_id, event_type, hash, previous_hash, signature
- Ed25519 key pair for signing
- Chain hashed events per action for tamper evidence
- Public receipt viewer page (e.g. `/receipt/[id]`)
- Exportable receipt JSON
- Pitch: "Not just approval — proof."
- Estimated effort: 2-3 days

### Notification Channels
Notify users about pending actions through channels beyond the web dashboard.

**Slack (with interactive buttons)** — ~1 day
- Incoming webhook for notifications
- Interactive message buttons for approve/reject directly in Slack
- Slack callback route (`/api/webhooks/slack`)
- Webhook URL configuration in Settings

**PWA + Web Push** — ~1-2 days
- `manifest.json` and service worker for installable mobile experience
- Web Push API for notifications when new actions arrive
- Works on Android and iOS Safari (16.4+)

**SMS (Twilio)** — ~1-2 days
- SMS notification when actions are created
- Link to dashboard for approval
- Phone number configuration in Settings
- Optional: reply "YES" to approve via SMS

**iOS App (Expo/React Native)** — 1-2 weeks
- Login, inbox, action detail, approve/reject
- Push notifications via Expo
- Only if mobile becomes a core selling point

Priority order: Slack → PWA → SMS → Native app

---

## Future (Post-Launch)

### Developer Experience
- Python SDK (direct port of TypeScript client)
- Additional demo scripts (HTTP POST, shell command, stock trade)
- CLI tool for creating actions from the terminal

### Product Features
- Auto-approve rules (approve all actions matching a pattern)
- Allowlists / blocklists
- Action templates and grouping
- Multiple environments with separate policies
- Bulk approve/reject

### Integrations
- Framework adapters (LangChain, CrewAI, AutoGen)
- OpenAI function call wrapper
- Discord approval channel
- Email notifications with one-click approve links

### Enterprise
- Team/org management
- Role-based access control
- Audit log exports
- SSO
- Self-hosted deployment option

### Infrastructure
- Real-time updates (WebSocket/SSE instead of polling)
- Action event timeline table (`action_events`)
- Webhook system for external integrations
- Rate limiting and usage quotas
