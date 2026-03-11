import { z } from "zod";

const ALLOWED_SLACK_PATH_PREFIXES = ["/services/", "/workflows/", "/triggers/"];

function isSlackWebhookUrl(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }

  if (parsed.protocol !== "https:") return false;
  if (parsed.hostname !== "hooks.slack.com") return false;
  if (parsed.port !== "") return false;
  if (parsed.username || parsed.password) return false;
  if (parsed.search || parsed.hash) return false;

  return ALLOWED_SLACK_PATH_PREFIXES.some((p) => parsed.pathname.startsWith(p));
}

export const slackConfigInputSchema = z.object({
  webhookUrl: z
    .string()
    .url()
    .refine(isSlackWebhookUrl, {
      message:
        "Webhook URL must be a valid https://hooks.slack.com/ URL with a /services/, /workflows/, or /triggers/ path",
    }),
  channelName: z.string().trim().max(80).optional(),
  slackUserId: z.string().trim().min(1).max(30).optional(),
  isActive: z.boolean().optional(),
});

export type SlackConfigInput = z.infer<typeof slackConfigInputSchema>;

export const slackConfigRecordSchema = z.object({
  id: z.string().uuid(),
  webhookUrl: z.string(),
  channelName: z.string().nullable(),
  slackUserId: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type SlackConfigRecord = z.infer<typeof slackConfigRecordSchema>;
