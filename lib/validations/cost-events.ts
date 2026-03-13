import { z } from "zod";

export const costEventRecordSchema = z.object({
  id: z.string().uuid(),
  requestId: z.string(),
  apiKeyId: z.string().uuid().nullable(),
  provider: z.string(),
  model: z.string(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  cachedInputTokens: z.number().int(),
  reasoningTokens: z.number().int(),
  costMicrodollars: z.number(),
  durationMs: z.number().int().nullable(),
  createdAt: z.string(),
  keyName: z.string(),
});

const cursorSchema = z.object({
  createdAt: z.string().datetime(),
  id: z.string().uuid(),
});

export const listCostEventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z
    .string()
    .transform((s) => JSON.parse(s))
    .pipe(cursorSchema)
    .optional(),
  apiKeyId: z.string().uuid().optional(),
  model: z.string().optional(),
  provider: z.string().optional(),
});

export const listCostEventsResponseSchema = z.object({
  data: z.array(costEventRecordSchema),
  cursor: cursorSchema.nullable(),
});

export type CostEventRecord = z.infer<typeof costEventRecordSchema>;
export type ListCostEventsQuery = z.infer<typeof listCostEventsQuerySchema>;
export type ListCostEventsResponse = z.infer<typeof listCostEventsResponseSchema>;
