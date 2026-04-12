import { eq, desc } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { slackConfigs } from "@nullspend/db";
import { getLogger } from "@/lib/observability";

const log = getLogger("budget-threshold-slack");

interface SlackBlock {
  type: string;
  [key: string]: unknown;
}

interface SlackMessage {
  text: string;
  blocks: SlackBlock[];
}

type ThresholdSeverity = "warning" | "critical" | "exceeded";

const SEVERITY_EMOJI: Record<ThresholdSeverity, string> = {
  warning: ":warning:",
  critical: ":red_circle:",
  exceeded: ":rotating_light:",
};

function getDashboardUrl(): string {
  return process.env.NULLSPEND_URL || process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
}

/** Escape Slack mrkdwn special characters. */
function escapeSlack(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Map webhook event type to severity for display.
 */
function eventTypeToSeverity(eventType: string): ThresholdSeverity {
  if (eventType === "budget.exceeded") return "exceeded";
  if (eventType === "budget.threshold.critical") return "critical";
  return "warning";
}

export function buildBudgetThresholdMessage(data: {
  eventType: string;
  entityType: string;
  entityId: string;
  thresholdPercent: number;
  spendMicrodollars: number;
  limitMicrodollars: number;
}): SlackMessage {
  const dashboardUrl = getDashboardUrl();
  const severity = eventTypeToSeverity(data.eventType);
  const emoji = SEVERITY_EMOJI[severity];
  const entityLabel = escapeSlack(data.entityId);
  const spend = (data.spendMicrodollars / 1_000_000).toFixed(2);
  const limit = (data.limitMicrodollars / 1_000_000).toFixed(2);
  const percent = data.eventType === "budget.exceeded"
    ? "100%+"
    : `${data.thresholdPercent}%`;

  const severityLabel = severity === "exceeded"
    ? "Budget Exceeded"
    : severity === "critical"
      ? "Critical Threshold"
      : "Warning Threshold";

  const text = `${emoji} Budget ${severityLabel}: ${data.entityType}/${entityLabel} at ${percent} ($${spend}/$${limit})`;

  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `Budget ${severityLabel}`,
        emoji: true,
      },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Entity:*\n${escapeSlack(data.entityType)}/${entityLabel}` },
        { type: "mrkdwn", text: `*Severity:*\n${emoji} ${severityLabel}` },
      ],
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Spend:*\n$${spend}` },
        { type: "mrkdwn", text: `*Limit:*\n$${limit}` },
      ],
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Threshold:*\n${percent}` },
        { type: "mrkdwn", text: `*Usage:*\n${data.limitMicrodollars > 0 ? Math.min(Math.floor((data.spendMicrodollars / data.limitMicrodollars) * 100), 999) : 0}%` },
      ],
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "View Budgets", emoji: true },
          url: `${dashboardUrl}/app/budgets`,
        },
      ],
    },
  ];

  return { text, blocks };
}

/**
 * Send budget threshold alert to Slack for an org. Non-fatal — returns silently on any error.
 * Uses the org's Slack webhook config (same as margins and budget notifications).
 */
export async function dispatchBudgetThresholdSlackAlert(
  orgId: string,
  message: SlackMessage,
): Promise<void> {
  const db = getDb();
  const [config] = await db
    .select()
    .from(slackConfigs)
    .where(eq(slackConfigs.orgId, orgId))
    .orderBy(desc(slackConfigs.createdAt))
    .limit(1);

  if (!config || !config.isActive || !config.webhookUrl) {
    return; // No Slack config — skip silently
  }

  // SSRF defense: only POST to HTTPS Slack webhook URLs
  if (!config.webhookUrl.startsWith("https://")) {
    log.warn({ orgId }, "Slack webhook URL is not HTTPS — skipping budget threshold alert");
    return;
  }

  const response = await fetch(config.webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    log.warn({ orgId, status: response.status, detail }, "Budget threshold Slack alert failed");
  }
}
