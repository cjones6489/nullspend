import { z } from "zod";

export const slackConfigInputSchema = z.object({
  webhookUrl: z
    .string()
    .url()
    .refine((url) => url.startsWith("https://hooks.slack.com/"), {
      message: "Webhook URL must start with https://hooks.slack.com/",
    }),
  channelName: z.string().trim().max(80).optional(),
  isActive: z.boolean().optional(),
});

export type SlackConfigInput = z.infer<typeof slackConfigInputSchema>;

export const slackConfigRecordSchema = z.object({
  id: z.string().uuid(),
  webhookUrl: z.string(),
  channelName: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type SlackConfigRecord = z.infer<typeof slackConfigRecordSchema>;
