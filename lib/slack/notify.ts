import { and, eq, desc } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { actions, slackConfigs } from "@nullspend/db";
import {
  buildPendingMessage,
  buildBudgetIncreasePendingMessage,
  buildBudgetIncreaseCompletionMessage,
  buildTestMessage,
} from "@/lib/slack/message";
import { retryWithBackoff } from "@/lib/slack/retry";
import { getLogger } from "@/lib/observability";
import type { RawActionRecord } from "@/lib/validations/actions";

const log = getLogger("slack-notify");

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

/**
 * Send a message via Slack Web API (chat.postMessage).
 * Returns the thread_ts for threaded replies, or null on failure.
 */
async function sendSlackWebApiMessage(
  token: string,
  channel: string,
  message: { text: string; blocks: object[] },
  threadTs?: string,
): Promise<string | null> {
  const body: Record<string, unknown> = {
    channel,
    text: message.text,
    blocks: message.blocks,
  };
  if (threadTs) {
    body.thread_ts = threadTs;
  }

  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new SlackWebhookError(response.status, text);
  }

  const json = await response.json() as { ok: boolean; ts?: string; error?: string };
  if (!json.ok) {
    // Map Slack's "ratelimited" to 429 so retryWithBackoff treats it as retryable
    const status = json.error === "ratelimited" ? 429 : 400;
    throw new SlackWebhookError(status, json.error ?? "Slack API error");
  }

  return json.ts ?? null;
}

export async function sendSlackNotification(
  action: RawActionRecord,
  orgId: string,
): Promise<void> {
  const db = getDb();
  const [config] = await db
    .select()
    .from(slackConfigs)
    .where(eq(slackConfigs.orgId, orgId))
    .orderBy(desc(slackConfigs.createdAt))
    .limit(1);

  if (!config || !config.isActive) {
    return;
  }

  const dashboardUrl = getDashboardUrl();

  // Budget increase actions use Web API for threaded replies
  if (action.actionType === "budget_increase") {
    const token = process.env.SLACK_BOT_TOKEN;
    const channel = process.env.SLACK_CHANNEL_ID;

    if (token && channel) {
      try {
        const message = buildBudgetIncreasePendingMessage(action, dashboardUrl);
        const threadTs = await retryWithBackoff(() =>
          sendSlackWebApiMessage(token, channel, message),
        );

        // Store thread_ts on the action for later threaded replies
        if (threadTs) {
          await db
            .update(actions)
            .set({ slackThreadTs: threadTs })
            .where(and(eq(actions.id, action.id), eq(actions.orgId, orgId)));
        }
        return;
      } catch (err) {
        log.warn({ err, actionId: action.id }, "Slack Web API failed, falling back to webhook");
        // Fall through to webhook
      }
    }

    // Fallback: use webhook (no thread_ts, so approval/rejection won't appear as threaded replies)
    log.info({ actionId: action.id }, "Budget increase sent via webhook fallback — threaded replies unavailable");
    const message = buildBudgetIncreasePendingMessage(action, dashboardUrl);
    message.blocks?.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: "_Threaded updates unavailable — approve or reject from the dashboard._" }],
    });
    await retryWithBackoff(() => postToWebhook(config.webhookUrl, message));
    return;
  }

  // Non-budget_increase actions use the existing webhook flow
  const message = buildPendingMessage(action, dashboardUrl);
  await retryWithBackoff(() => postToWebhook(config.webhookUrl, message));
}

/**
 * Send a threaded Slack reply for a completed budget_increase action.
 * Looks up the action's slackThreadTs and posts a completion message.
 * No-ops if no thread_ts or no Slack Web API config.
 */
export async function sendBudgetIncreaseCompletionThread(
  actionId: string,
  orgId: string,
  remainingMicrodollars: number,
): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SLACK_CHANNEL_ID;
  if (!token || !channel) return;

  const db = getDb();
  const [action] = await db
    .select({ slackThreadTs: actions.slackThreadTs })
    .from(actions)
    .where(and(eq(actions.id, actionId), eq(actions.orgId, orgId)))
    .limit(1);

  if (!action?.slackThreadTs) return;

  try {
    const message = buildBudgetIncreaseCompletionMessage(remainingMicrodollars);
    await sendSlackWebApiMessage(token, channel, message, action.slackThreadTs);
  } catch (err) {
    log.warn({ err, actionId }, "Failed to send budget increase completion thread");
  }
}

export async function sendSlackTestNotification(
  orgId: string,
): Promise<void> {
  const db = getDb();
  const [config] = await db
    .select()
    .from(slackConfigs)
    .where(eq(slackConfigs.orgId, orgId))
    .orderBy(desc(slackConfigs.createdAt))
    .limit(1);

  if (!config) {
    throw new SlackConfigNotFoundError();
  }

  const dashboardUrl = getDashboardUrl();
  const message = buildTestMessage(dashboardUrl);
  await postToWebhook(config.webhookUrl, message);
}
