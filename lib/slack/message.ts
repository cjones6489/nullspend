import { toExternalId } from "@/lib/ids/prefixed-id";
import type { RawActionRecord } from "@/lib/validations/actions";

interface SlackBlock {
  type: string;
  [key: string]: unknown;
}

interface SlackMessage {
  text: string;
  blocks: SlackBlock[];
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength
    ? value.slice(0, maxLength - 1) + "\u2026"
    : value;
}

function formatPayloadSummary(payload: Record<string, unknown>): string {
  const entries = Object.entries(payload).slice(0, 3);
  return entries
    .map(([key, value]) => {
      const formatted =
        typeof value === "string" ? value : JSON.stringify(value);
      return `*${key}:* ${truncate(String(formatted), 100)}`;
    })
    .join("\n");
}

export function buildPendingMessage(
  action: RawActionRecord,
  dashboardUrl: string,
): SlackMessage {
  const actionUrl = `${dashboardUrl}/app/actions/${toExternalId("act", action.id)}`;
  const summary = formatPayloadSummary(action.payload);

  const text = `New pending action: ${action.actionType} from ${action.agentId}`;

  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "New Action Pending Approval",
        emoji: true,
      },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Type:*\n${action.actionType}` },
        { type: "mrkdwn", text: `*Agent:*\n${action.agentId}` },
      ],
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: summary || "_No payload_",
      },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Approve", emoji: true },
          style: "primary",
          action_id: "approve_action",
          value: action.id,
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Reject", emoji: true },
          style: "danger",
          action_id: "reject_action",
          value: action.id,
        },
        {
          type: "button",
          text: { type: "plain_text", text: "View in Dashboard", emoji: true },
          url: actionUrl,
          action_id: "view_dashboard",
        },
      ],
    },
  ];

  return { text, blocks };
}

export function buildDecisionMessage(
  actionType: string,
  agentId: string,
  decision: "approved" | "rejected" | "expired",
  decidedBy: string,
  dashboardUrl: string,
  actionId: string,
): SlackMessage {
  const actionUrl = `${dashboardUrl}/app/actions/${toExternalId("act", actionId)}`;

  const statusEmoji =
    decision === "approved"
      ? "\u2705"
      : decision === "rejected"
        ? "\u274c"
        : "\u23f0";

  const statusLabel =
    decision.charAt(0).toUpperCase() + decision.slice(1);

  const text = `Action ${decision} by ${decidedBy}`;

  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `${statusEmoji} Action ${statusLabel}`,
        emoji: true,
      },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Type:*\n${actionType}` },
        { type: "mrkdwn", text: `*Agent:*\n${agentId}` },
      ],
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${statusLabel} by:* ${decidedBy}`,
      },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "View in Dashboard", emoji: true },
          url: actionUrl,
          action_id: "view_dashboard",
        },
      ],
    },
  ];

  return { text, blocks };
}

export function buildTestMessage(dashboardUrl: string): SlackMessage {
  return {
    text: "NullSpend Slack integration is working!",
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `:white_check_mark: *NullSpend Slack integration is working!*\nYou'll receive notifications here when new actions are pending approval.\n<${dashboardUrl}/app/inbox|Open Dashboard>`,
        },
      },
    ],
  };
}
