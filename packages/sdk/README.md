# @agentseam/sdk

TypeScript SDK for [AgentSeam](https://github.com/cjones6489/AgentSeam) — propose, approve, and execute risky AI agent actions.

## Quick start

```typescript
import { AgentSeam } from "@agentseam/sdk";

const seam = new AgentSeam({
  baseUrl: "http://localhost:3000",
  apiKey: "ask_...", // from your Settings page
});

const result = await seam.proposeAndWait({
  agentId: "my-agent",
  actionType: "send_email",
  payload: { to: "sarah@example.com", subject: "Follow up" },
  execute: async () => {
    return await sendEmail("sarah@example.com", "Follow up", "...");
  },
});
```

The SDK creates a pending action in AgentSeam, polls until a human approves or rejects it, then either runs your `execute` callback or throws.

## API

### `new AgentSeam(config)`

| Option    | Type     | Required | Description                                      |
| --------- | -------- | -------- | ------------------------------------------------ |
| `baseUrl` | `string` | Yes      | URL of your AgentSeam instance                   |
| `apiKey`  | `string` | Yes      | API key from Settings                            |
| `fetch`   | `fetch`  | No       | Custom fetch implementation (defaults to global)  |

### `seam.proposeAndWait(options)`

High-level: proposes an action, waits for approval, executes, and reports the result.

| Option           | Type                          | Default  | Description                        |
| ---------------- | ----------------------------- | -------- | ---------------------------------- |
| `agentId`        | `string`                      | required | Identifier for the agent           |
| `actionType`     | `string`                      | required | e.g. `send_email`, `http_post`     |
| `payload`        | `Record<string, unknown>`     | required | Action details shown in the inbox  |
| `metadata`       | `Record<string, unknown>`     | optional | Extra context (environment, etc.)  |
| `execute`        | `() => Promise<T>`            | required | Runs only if approved              |
| `pollIntervalMs` | `number`                      | 2000     | ms between status polls            |
| `timeoutMs`      | `number`                      | 300000   | Total timeout in ms                |
| `onPoll`         | `(action: ActionRecord) => void` | optional | Called each poll cycle           |

### Lower-level methods

```typescript
const action = await seam.createAction({ agentId, actionType, payload });
const fetched = await seam.getAction(actionId);
const decided = await seam.waitForDecision(actionId, { pollIntervalMs, timeoutMs });
await seam.markResult(actionId, { status: "executed", result: { ... } });
```

## Error handling

```typescript
import { RejectedError, TimeoutError, AgentSeamError } from "@agentseam/sdk";

try {
  await seam.proposeAndWait({ ... });
} catch (err) {
  if (err instanceof RejectedError) {
    // Human rejected (or action expired)
  } else if (err instanceof TimeoutError) {
    // No decision within timeoutMs
  } else if (err instanceof AgentSeamError) {
    // API error (err.statusCode has the HTTP status)
  }
}
```

## Demo

See [`examples/demo-send-email.ts`](examples/demo-send-email.ts) for a runnable end-to-end demo.

```bash
# Terminal 1: start the app
pnpm dev

# Terminal 2: run the demo
AGENTSEAM_API_KEY=ask_... npx tsx packages/sdk/examples/demo-send-email.ts
```

Then open <http://localhost:3000/app/inbox> and approve the action.
