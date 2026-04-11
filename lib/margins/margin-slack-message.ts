import { eq } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { slackConfigs } from "@nullspend/db";
import { getLogger } from "@/lib/observability";
import type { HealthTier } from "./margin-query";

const log = getLogger("margin-slack");

interface SlackBlock {
  type: string;
  [key: string]: unknown;
}

interface SlackMessage {
  text: string;
  blocks: SlackBlock[];
}

const TIER_EMOJI: Record<HealthTier, string> = {
  healthy: ":large_green_circle:",
  moderate: ":large_blue_circle:",
  at_risk: ":warning:",
  critical: ":red_circle:",
};

function getDashboardUrl(): string {
  return process.env.NULLSPEND_URL || process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
}

/** Escape Slack mrkdwn special characters. */
function escapeSlack(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function buildMarginAlertMessage(data: {
  customerName: string | null;
  tagValue: string;
  previousMarginPercent: number;
  currentMarginPercent: number;
  previousTier: HealthTier;
  currentTier: HealthTier;
  revenueMicrodollars: number;
  costMicrodollars: number;
  period: string;
}): SlackMessage {
  const dashboardUrl = getDashboardUrl();
  // MRG-4: Escape both customer name AND tagValue to prevent mrkdwn injection
  const name = data.customerName ? escapeSlack(data.customerName) : escapeSlack(data.tagValue);
  const revenue = (data.revenueMicrodollars / 1_000_000).toFixed(2);
  const cost = (data.costMicrodollars / 1_000_000).toFixed(2);

  const text = `Margin alert: ${name} moved from ${data.previousTier} to ${data.currentTier} (${data.currentMarginPercent.toFixed(1)}%)`;

  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "Margin Threshold Crossed",
        emoji: true,
      },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Customer:*\n${name}` },
        { type: "mrkdwn", text: `*Period:*\n${data.period}` },
      ],
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Previous:*\n${TIER_EMOJI[data.previousTier]} ${data.previousMarginPercent.toFixed(1)}% (${data.previousTier})` },
        { type: "mrkdwn", text: `*Current:*\n${TIER_EMOJI[data.currentTier]} ${data.currentMarginPercent.toFixed(1)}% (${data.currentTier})` },
      ],
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Revenue:*\n$${revenue}` },
        { type: "mrkdwn", text: `*AI Cost:*\n$${cost}` },
      ],
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "View Margins", emoji: true },
          url: `${dashboardUrl}/app/margins/${encodeURIComponent(data.tagValue)}`,
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Set Budget Cap", emoji: true },
          url: `${dashboardUrl}/app/budgets/new?entity=tag:customer=${encodeURIComponent(data.tagValue)}`,
        },
      ],
    },
  ];

  return { text, blocks };
}

/**
 * Send margin alert to Slack for an org. Non-fatal — returns silently on any error.
 * Uses the org's Slack webhook config (same as budget notifications).
 */
export async function dispatchMarginSlackAlert(
  orgId: string,
  message: SlackMessage,
): Promise<void> {
  const db = getDb();
  const [config] = await db
    .select()
    .from(slackConfigs)
    .where(eq(slackConfigs.orgId, orgId))
    .limit(1);

  if (!config || !config.isActive || !config.webhookUrl) {
    return; // No Slack config — skip silently
  }

  // SSRF defense: only POST to HTTPS Slack webhook URLs
  if (!config.webhookUrl.startsWith("https://")) {
    log.warn({ orgId }, "Slack webhook URL is not HTTPS — skipping margin alert");
    return;
  }

  const response = await fetch(config.webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    log.warn({ orgId, status: response.status, detail }, "Margin Slack alert failed");
  }
}
