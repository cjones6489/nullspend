import { z } from "zod";

import { nsIdOutput } from "@/lib/ids/prefixed-id";

export const costSummaryQuerySchema = z.object({
  period: z.enum(["7d", "30d", "90d"]).default("30d"),
  excludeEstimated: z.enum(["true", "false"]).default("false"),
});

export const dailySpendSchema = z.object({
  date: z.string(),
  totalCostMicrodollars: z.number().nonnegative(),
});

export const modelBreakdownSchema = z.object({
  provider: z.string(),
  model: z.string(),
  totalCostMicrodollars: z.number().nonnegative(),
  requestCount: z.number().int(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  cachedInputTokens: z.number().int(),
  reasoningTokens: z.number().int(),
});

export const providerBreakdownSchema = z.object({
  provider: z.string(),
  totalCostMicrodollars: z.number().nonnegative(),
  requestCount: z.number().int(),
});

export const keyBreakdownSchema = z.object({
  apiKeyId: nsIdOutput("key"),
  keyName: z.string(),
  totalCostMicrodollars: z.number().nonnegative(),
  requestCount: z.number().int(),
});

export const totalsSchema = z.object({
  totalCostMicrodollars: z.number().nonnegative(),
  totalRequests: z.number().int().nonnegative(),
});

export const toolBreakdownSchema = z.object({
  model: z.string(),
  totalCostMicrodollars: z.number().nonnegative(),
  requestCount: z.number().int(),
  avgDurationMs: z.number().int(),
});

export const sourceBreakdownSchema = z.object({
  source: z.enum(["proxy", "api", "mcp"]),
  totalCostMicrodollars: z.number().nonnegative(),
  requestCount: z.number().int(),
});

export const traceBreakdownSchema = z.object({
  traceId: z.string(),
  totalCostMicrodollars: z.number().nonnegative(),
  requestCount: z.number().int(),
});

export const costBreakdownTotalsSchema = z.object({
  inputCost: z.number().nonnegative(),
  outputCost: z.number().nonnegative(),
  cachedCost: z.number().nonnegative(),
  reasoningCost: z.number().nonnegative(),
});

export const costSummaryResponseSchema = z.object({
  daily: z.array(dailySpendSchema),
  models: z.array(modelBreakdownSchema),
  providers: z.array(providerBreakdownSchema),
  keys: z.array(keyBreakdownSchema),
  tools: z.array(toolBreakdownSchema),
  sources: z.array(sourceBreakdownSchema),
  totals: totalsSchema.extend({ period: z.enum(["7d", "30d", "90d"]) }),
  traces: z.array(traceBreakdownSchema),
  costBreakdown: costBreakdownTotalsSchema,
});

export type CostSummaryQuery = z.infer<typeof costSummaryQuerySchema>;
export type CostSummaryResponse = z.infer<typeof costSummaryResponseSchema>;
export type DailySpend = z.infer<typeof dailySpendSchema>;
export type ModelBreakdown = z.infer<typeof modelBreakdownSchema>;
export type ProviderBreakdown = z.infer<typeof providerBreakdownSchema>;
export type KeyBreakdown = z.infer<typeof keyBreakdownSchema>;
export type CostBreakdownTotals = z.infer<typeof costBreakdownTotalsSchema>;
export type ToolBreakdown = z.infer<typeof toolBreakdownSchema>;
export type SourceBreakdown = z.infer<typeof sourceBreakdownSchema>;
export type TraceBreakdown = z.infer<typeof traceBreakdownSchema>;
