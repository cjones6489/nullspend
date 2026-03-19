import { eq } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { slackConfigs } from "@nullspend/db";
import { buildPendingMessage, buildTestMessage } from "@/lib/slack/message";
import { retryWithBackoff } from "@/lib/slack/retry";
import type { RawActionRecord } from "@/lib/validations/actions";

export class SlackConfigNotFoundError extends Error {
  constructor() {
    super("No Slack configuration found.");
    this.name = "SlackConfigNotFoundError";
  }
}

export class SlackWebhookError extends Error {
  public readonly statusCode: number;

  constructor(statusCode: number, detail: string) {
    super(`Slack webhook error ${statusCode}: ${detail}`);
    this.name = "SlackWebhookError";
    this.statusCode = statusCode;
  }
}

function getDashboardUrl(): string {
  return process.env.NULLSPEND_URL || process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
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
    throw new SlackWebhookError(response.status, text);
  }
}

export async function sendSlackNotification(
  action: RawActionRecord,
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
  await retryWithBackoff(() => postToWebhook(config.webhookUrl, message));
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
    throw new SlackConfigNotFoundError();
  }

  const dashboardUrl = getDashboardUrl();
  const message = buildTestMessage(dashboardUrl);
  await postToWebhook(config.webhookUrl, message);
}
