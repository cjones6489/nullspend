import { z } from "zod";

import { nsIdInput, nsIdOutput, nsIdOutputNullable } from "@/lib/ids/prefixed-id";

export const costEventRecordSchema = z.object({
  id: nsIdOutput("evt"),
  requestId: z.string(),
  apiKeyId: nsIdOutputNullable("key"),
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

const cursorInputSchema = z.object({
  createdAt: z.string().datetime(),
  id: nsIdInput("evt"),
});

const cursorOutputSchema = z.object({
  createdAt: z.string().datetime(),
  id: nsIdOutput("evt"),
});

export const listCostEventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z
    .string()
    .transform((s) => JSON.parse(s))
    .pipe(cursorInputSchema)
    .optional(),
  apiKeyId: nsIdInput("key").optional(),
  model: z.string().optional(),
  provider: z.string().optional(),
});

export const listCostEventsResponseSchema = z.object({
  data: z.array(costEventRecordSchema),
  cursor: cursorOutputSchema.nullable(),
});

export type CostEventRecord = z.infer<typeof costEventRecordSchema>;
export type RawCostEventRecord = z.input<typeof costEventRecordSchema>;
export type ListCostEventsQuery = z.infer<typeof listCostEventsQuerySchema>;
export type ListCostEventsResponse = z.infer<typeof listCostEventsResponseSchema>;
