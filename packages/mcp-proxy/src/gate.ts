import { AgentSeam, TimeoutError } from "@agentseam/sdk";
import type { ProxyConfig } from "./config.js";

export interface GateResult {
  actionId: string;
  decision: "approved" | "rejected" | "timedOut";
}

const POLL_INTERVAL_MS = 3_000;

const PROXY_METADATA = {
  sourceFramework: "mcp-proxy",
  transport: "stdio",
} as const;

export function isToolGated(toolName: string, config: ProxyConfig): boolean {
  if (config.passthroughTools.has(toolName)) return false;
  if (config.gatedTools === "*") return true;
  return config.gatedTools.has(toolName);
}

export async function gateToolCall(
  sdk: AgentSeam,
  toolName: string,
  args: Record<string, unknown> | undefined,
  config: ProxyConfig,
  signal: AbortSignal,
): Promise<GateResult> {
  const argsPreview = JSON.stringify(args ?? {}).slice(0, 200);
  const summary = `Tool call: ${toolName}(${argsPreview})`;

  const { id } = await sdk.createAction({
    agentId: config.agentId,
    actionType: toolName,
    payload: args ?? {},
    metadata: {
      ...PROXY_METADATA,
      upstreamTool: toolName,
      summary,
    },
  });

  const timeoutMs = config.approvalTimeoutSeconds * 1_000;

  try {
    const action = await waitWithAbort(sdk, id, timeoutMs, signal);

    if (action.status === "approved") {
      return { actionId: id, decision: "approved" };
    }
    return { actionId: id, decision: "rejected" };
  } catch (err) {
    if (err instanceof TimeoutError) {
      return { actionId: id, decision: "timedOut" };
    }
    throw err;
  }
}

async function waitWithAbort(
  sdk: AgentSeam,
  actionId: string,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<{ status: string }> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (signal.aborted) {
      throw new Error("Proxy shutting down");
    }

    const action = await sdk.getAction(actionId);
    if (action.status !== "pending") {
      return action;
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;

    await interruptibleSleep(Math.min(POLL_INTERVAL_MS, remaining), signal);
  }

  throw new TimeoutError(actionId, timeoutMs);
}

function interruptibleSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }

    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    function onAbort() {
      clearTimeout(timer);
      resolve();
    }

    signal.addEventListener("abort", onAbort, { once: true });
  });
}
