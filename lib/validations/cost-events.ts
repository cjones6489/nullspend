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
  source: z.enum(["proxy", "api", "mcp"]),
  traceId: z.string().nullable(),
  sessionId: z.string().nullable(),
  tags: z.record(z.string(), z.string()).default({}),
  customerId: z.string().max(256).nullable().optional(),
  keyName: z.string().nullable(),
  budgetStatus: z.enum(["skipped", "approved", "denied"]).nullable().optional(),
  stopReason: z.string().nullable().optional(),
  estimatedCostMicrodollars: z.number().nullable().optional(),
  costBreakdown: z.object({
    input: z.number().nullable().optional().transform((v) => v ?? undefined),
    output: z.number().nullable().optional().transform((v) => v ?? undefined),
    cached: z.number().nullable().optional().transform((v) => v ?? undefined),
    reasoning: z.number().nullable().optional().transform((v) => v ?? undefined),
    toolDefinition: z.number().nullable().optional().transform((v) => v ?? undefined),
  }).nullable().optional(),
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
  requestId: z.string().min(1).max(200).optional(),
  apiKeyId: nsIdInput("key").optional(),
  model: z.string().optional(),
  provider: z.string().optional(),
  source: z.enum(["proxy", "api", "mcp"]).optional(),
  budgetStatus: z.enum(["skipped", "approved", "denied"]).optional(),
  traceId: z.string().regex(/^[0-9a-f]{32}$/).optional(),
  sessionId: z.string().min(1).max(200).optional(),
  tags: z.record(z.string(), z.string()).optional(),
});

export const listCostEventsResponseSchema = z.object({
  data: z.array(costEventRecordSchema),
  cursor: cursorOutputSchema.nullable(),
});

export type CostEventRecord = z.infer<typeof costEventRecordSchema>;
export type RawCostEventRecord = z.input<typeof costEventRecordSchema>;
export type ListCostEventsQuery = z.infer<typeof listCostEventsQuerySchema>;
export type ListCostEventsResponse = z.infer<typeof listCostEventsResponseSchema>;
