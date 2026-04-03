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

// ---------------------------------------------------------------------------
// Budget increase messages
// ---------------------------------------------------------------------------

function formatDollars(microdollars: number): string {
  return `$${(microdollars / 1_000_000).toFixed(2)}`;
}

export function buildBudgetIncreasePendingMessage(
  action: RawActionRecord,
  dashboardUrl: string,
): SlackMessage {
  const actionUrl = `${dashboardUrl}/app/actions/${toExternalId("act", action.id)}`;
  const payload = action.payload as {
    entityType?: string;
    entityId?: string;
    requestedAmountMicrodollars?: number;
    currentLimitMicrodollars?: number;
    currentSpendMicrodollars?: number;
    reason?: string;
  };

  const currentLimit = payload.currentLimitMicrodollars ?? 0;
  const currentSpend = payload.currentSpendMicrodollars ?? 0;
  const requested = payload.requestedAmountMicrodollars ?? 0;
  const newLimit = currentLimit + requested;

  const text = `Budget increase requested by ${action.agentId}: +${formatDollars(requested)}`;

  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "Budget Increase Requested",
        emoji: true,
      },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Current budget:*\n${formatDollars(currentLimit)} / ${formatDollars(currentSpend)} spent` },
        { type: "mrkdwn", text: `*Requested increase:*\n+${formatDollars(requested)}` },
      ],
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*New limit if approved:*\n${formatDollars(newLimit)}` },
        { type: "mrkdwn", text: `*Agent:*\n${action.agentId}` },
      ],
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Reason:* ${truncate(payload.reason ?? "No reason provided", 500)}`,
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

export function buildBudgetIncreaseDecisionMessage(
  decision: "approved" | "rejected",
  previousLimit: number,
  newLimit: number,
  decidedBy: string,
): SlackMessage {
  const isApproved = decision === "approved";
  const emoji = isApproved ? "\u2705" : "\u274c";
  const label = isApproved
    ? `Budget increased from ${formatDollars(previousLimit)} to ${formatDollars(newLimit)}`
    : "Budget increase rejected";

  const text = `${emoji} ${label}`;

  const blocks: SlackBlock[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${emoji} *${label}*\nDecided by: ${decidedBy}`,
      },
    },
  ];

  return { text, blocks };
}

export function buildBudgetIncreaseCompletionMessage(
  remainingMicrodollars: number,
): SlackMessage {
  const text = `Task completed. Budget remaining: ${formatDollars(remainingMicrodollars)}.`;

  const blocks: SlackBlock[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text,
      },
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
