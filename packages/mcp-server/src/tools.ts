import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { NullSpend, TimeoutError, waitWithAbort } from "@nullspend/sdk";
import type { McpServerConfig } from "./config.js";
import {
  successResult,
  errorResult,
  formatActionForResponse,
} from "./output.js";

const DEFAULT_TIMEOUT_SECONDS = 300;

const MCP_METADATA = {
  sourceFramework: "mcp",
  transport: "stdio",
} as const;

export function registerTools(
  server: McpServer,
  config: McpServerConfig,
  shutdownSignal: AbortSignal,
) {
  const sdk = new NullSpend({
    baseUrl: config.nullspendUrl,
    apiKey: config.nullspendApiKey,
  });

  registerProposeAction(server, sdk, config, shutdownSignal);
  registerCheckAction(server, sdk);
}

function registerProposeAction(
  server: McpServer,
  sdk: NullSpend,
  config: McpServerConfig,
  shutdownSignal: AbortSignal,
) {
  server.tool(
    "propose_action",
    "Propose a risky action for human approval before execution. " +
      "Returns the approval decision (approved/rejected/expired) or pending status.",
    {
      actionType: z.string().describe("Type of action (e.g. send_email, http_post, db_write)"),
      payload: z.record(z.string(), z.unknown()).describe("Action payload with relevant details"),
      summary: z.string().describe("Human-readable summary of what this action will do"),
      agentId: z.string().optional().describe("Identifier for the agent proposing this action"),
      metadata: z.record(z.string(), z.unknown()).optional().describe("Additional metadata"),
      timeoutSeconds: z.number().optional().describe(
        `Seconds to wait for a decision (default: ${DEFAULT_TIMEOUT_SECONDS})`,
      ),
      waitForDecision: z.boolean().optional().describe(
        "If true (default), block until approved/rejected/expired. If false, return immediately with pending status.",
      ),
    },
    async (params) => {
      try {
        const agentId = params.agentId ?? config.agentId;
        const wait = params.waitForDecision ?? true;
        const timeoutMs = (params.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS) * 1_000;

        const { id } = await sdk.createAction({
          agentId,
          actionType: params.actionType,
          payload: params.payload,
          metadata: {
            ...params.metadata,
            ...MCP_METADATA,
            summary: params.summary,
          },
          expiresInSeconds: params.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS,
        });

        if (!wait) {
          return successResult({
            actionId: id,
            status: "pending",
            approved: false,
            rejected: false,
            timedOut: false,
            message: `Action ${id} created. Use check_action to poll for the decision.`,
          });
        }

        try {
          const action = await waitWithAbort(sdk, id, timeoutMs, shutdownSignal);
          const data = formatActionForResponse(action);
          const statusLabel =
            action.status === "approved"
              ? "approved"
              : action.status === "rejected"
                ? "rejected"
                : action.status;

          return successResult({
            ...data,
            message: `Action ${id} was ${statusLabel}.`,
          });
        } catch (err) {
          if (err instanceof TimeoutError) {
            return successResult({
              actionId: id,
              status: "pending",
              approved: false,
              rejected: false,
              timedOut: true,
              message: `Timed out waiting for decision on action ${id}. Use check_action to poll later.`,
            });
          }
          throw err;
        }
      } catch (err) {
        return errorResult(
          `NullSpend API error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  );
}

function registerCheckAction(server: McpServer, sdk: NullSpend) {
  server.tool(
    "check_action",
    "Check the current status of a previously proposed action.",
    {
      actionId: z.string().describe("The ID of the action to check"),
    },
    async (params) => {
      try {
        const action = await sdk.getAction(params.actionId);
        const data = formatActionForResponse(action);
        return successResult({
          ...data,
          message: `Action ${params.actionId} is currently ${action.status}.`,
        });
      } catch (err) {
        return errorResult(
          `NullSpend API error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  );
}
