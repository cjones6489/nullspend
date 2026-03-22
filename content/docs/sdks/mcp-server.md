---
title: "MCP Server"
description: "MCP server that exposes NullSpend approval tools to any MCP client. Agents can propose risky actions and wait for human approval before execution."
---

MCP server that exposes NullSpend approval tools to any MCP client. Agents can propose risky actions and wait for human approval before execution.

## Installation

Build from source (private package):

```bash
cd packages/mcp-server
npm install
npm run build
```

## Configuration

Set environment variables before starting the server:

| Variable | Required | Default | Description |
|---|---|---|---|
| `NULLSPEND_URL` | Yes | — | NullSpend dashboard URL (e.g. `https://nullspend.com`) |
| `NULLSPEND_API_KEY` | Yes | — | API key (`ns_live_sk_...` or `ns_test_sk_...`) |
| `NULLSPEND_AGENT_ID` | No | `"mcp-agent"` | Default agent ID for actions created by this server |

## Tools

The server registers two MCP tools.

### `propose_action`

Propose a risky action for human approval. By default, blocks until a decision is made.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `actionType` | `string` | Yes | — | Type of action (e.g. `send_email`, `http_post`, `db_write`) |
| `payload` | `object` | Yes | — | Action payload with relevant details |
| `summary` | `string` | Yes | — | Human-readable summary of what this action will do |
| `agentId` | `string` | No | `NULLSPEND_AGENT_ID` | Identifier for the agent proposing the action |
| `metadata` | `object` | No | — | Additional metadata attached to the action |
| `timeoutSeconds` | `number` | No | `300` | Seconds to wait for a decision |
| `waitForDecision` | `boolean` | No | `true` | If `true`, block until decided. If `false`, return immediately |

**Response (blocking mode — `waitForDecision: true`):**

```json
{
  "actionId": "ns_act_550e8400-...",
  "status": "approved",
  "approved": true,
  "rejected": false,
  "timedOut": false,
  "message": "Action ns_act_550e8400-... was approved."
}
```

**Response (non-blocking mode — `waitForDecision: false`):**

```json
{
  "actionId": "ns_act_550e8400-...",
  "status": "pending",
  "approved": false,
  "rejected": false,
  "timedOut": false,
  "message": "Action ns_act_550e8400-... created. Use check_action to poll for the decision."
}
```

**Response (timeout):**

```json
{
  "actionId": "ns_act_550e8400-...",
  "status": "pending",
  "approved": false,
  "rejected": false,
  "timedOut": true,
  "message": "Timed out waiting for decision on action ns_act_550e8400-.... Use check_action to poll later."
}
```

### `check_action`

Check the current status of a previously proposed action.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `actionId` | `string` | Yes | The ID of the action to check |

**Response:**

```json
{
  "actionId": "ns_act_550e8400-...",
  "status": "approved",
  "approved": true,
  "rejected": false,
  "timedOut": false,
  "message": "Action ns_act_550e8400-... is currently approved."
}
```

## Claude Desktop Setup

Add the server to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "nullspend": {
      "command": "node",
      "args": ["path/to/packages/mcp-server/dist/index.js"],
      "env": {
        "NULLSPEND_URL": "https://nullspend.com",
        "NULLSPEND_API_KEY": "ns_live_sk_your-key-here"
      }
    }
  }
}
```

The server communicates via stdio transport. It logs startup and error messages to stderr.

## Graceful Shutdown

The server handles `SIGINT`, `SIGTERM`, and stdin close. In-flight `propose_action` calls waiting for a decision are aborted when the server shuts down.

## Related

- [Human-in-the-Loop](../features/human-in-the-loop.md) — approval workflow concepts and state machine
- [Actions API](../api-reference/actions-api.md) — raw HTTP endpoint reference
- [MCP Proxy](mcp-proxy.md) — proxy that gates upstream MCP tool calls through approval
- [JavaScript SDK](javascript.md) — programmatic API client used internally
