import { eq } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { slackConfigs } from "@agentseam/db";
import { buildPendingMessage, buildTestMessage } from "@/lib/slack/message";
import type { ActionRecord } from "@/lib/validations/actions";

function getDashboardUrl(): string {
  return process.env.AGENTSEAM_URL || process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
}

async function postToWebhook(
  webhookUrl: string,
  body: object,
): Promise<void> {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Slack webhook error ${response.status}: ${text}`);
  }
}

export async function sendSlackNotification(
  action: ActionRecord,
  ownerUserId: string,
): Promise<void> {
  const db = getDb();
  const [config] = await db
    .select()
    .from(slackConfigs)
    .where(eq(slackConfigs.userId, ownerUserId))
    .limit(1);

  if (!config || !config.isActive) {
    return;
  }

  const dashboardUrl = getDashboardUrl();
  const message = buildPendingMessage(action, dashboardUrl);
  await postToWebhook(config.webhookUrl, message);
}

export async function sendSlackTestNotification(
  ownerUserId: string,
): Promise<void> {
  const db = getDb();
  const [config] = await db
    .select()
    .from(slackConfigs)
    .where(eq(slackConfigs.userId, ownerUserId))
    .limit(1);

  if (!config) {
    throw new Error("No Slack configuration found.");
  }

  const dashboardUrl = getDashboardUrl();
  const message = buildTestMessage(dashboardUrl);
  await postToWebhook(config.webhookUrl, message);
}
