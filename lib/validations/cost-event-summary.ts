import { z } from "zod";

export const costSummaryQuerySchema = z.object({
  period: z.enum(["7d", "30d", "90d"]).default("30d"),
});

export const dailySpendSchema = z.object({
  date: z.string(),
  totalCostMicrodollars: z.number(),
});

export const modelBreakdownSchema = z.object({
  model: z.string(),
  totalCostMicrodollars: z.number(),
  requestCount: z.number().int(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  cachedInputTokens: z.number().int(),
  reasoningTokens: z.number().int(),
});

export const keyBreakdownSchema = z.object({
  apiKeyId: z.string().uuid(),
  keyName: z.string(),
  totalCostMicrodollars: z.number(),
  requestCount: z.number().int(),
});

export const totalsSchema = z.object({
  totalCostMicrodollars: z.number(),
  totalRequests: z.number().int(),
});

export const costSummaryResponseSchema = z.object({
  daily: z.array(dailySpendSchema),
  models: z.array(modelBreakdownSchema),
  keys: z.array(keyBreakdownSchema),
  totals: totalsSchema.extend({ period: z.string() }),
});

export type CostSummaryQuery = z.infer<typeof costSummaryQuerySchema>;
export type CostSummaryResponse = z.infer<typeof costSummaryResponseSchema>;
export type DailySpend = z.infer<typeof dailySpendSchema>;
export type ModelBreakdown = z.infer<typeof modelBreakdownSchema>;
export type KeyBreakdown = z.infer<typeof keyBreakdownSchema>;
