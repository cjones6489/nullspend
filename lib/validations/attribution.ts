import { z } from "zod";

export const attributionQuerySchema = z.object({
  groupBy: z.string().min(1).max(100),
  period: z.enum(["7d", "30d", "90d"]).default("30d"),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  excludeEstimated: z.enum(["true", "false"]).default("false"),
  format: z.enum(["json", "csv"]).default("json"),
});

export const attributionGroupSchema = z.object({
  key: z.string(),
  keyId: z.string().nullable(),
  totalCostMicrodollars: z.number().nonnegative(),
  requestCount: z.number().int().nonnegative(),
  avgCostMicrodollars: z.number().nonnegative(),
});

export const attributionResponseSchema = z.object({
  groups: z.array(attributionGroupSchema),
  period: z.enum(["7d", "30d", "90d"]),
  groupBy: z.string(),
  totalGroups: z.number().int().nonnegative(),
  hasMore: z.boolean(),
  totals: z.object({
    totalCostMicrodollars: z.number().nonnegative(),
    totalRequests: z.number().int().nonnegative(),
  }),
});

export const attributionDetailQuerySchema = z.object({
  groupBy: z.string().min(1).max(100),
  period: z.enum(["7d", "30d", "90d"]).default("30d"),
  excludeEstimated: z.enum(["true", "false"]).default("false"),
});

export const attributionDetailDailySchema = z.object({
  date: z.string(),
  cost: z.number().nonnegative(),
  count: z.number().int().nonnegative(),
});

export const attributionDetailModelSchema = z.object({
  model: z.string(),
  cost: z.number().nonnegative(),
  count: z.number().int().nonnegative(),
});

export const attributionDetailResponseSchema = z.object({
  key: z.string(),
  totalCostMicrodollars: z.number().nonnegative(),
  requestCount: z.number().int().nonnegative(),
  avgCostMicrodollars: z.number().nonnegative(),
  daily: z.array(attributionDetailDailySchema),
  models: z.array(attributionDetailModelSchema),
});

export type AttributionQuery = z.infer<typeof attributionQuerySchema>;
export type AttributionGroup = z.infer<typeof attributionGroupSchema>;
export type AttributionResponse = z.infer<typeof attributionResponseSchema>;
export type AttributionDetailQuery = z.infer<typeof attributionDetailQuerySchema>;
export type AttributionDetailDaily = z.infer<typeof attributionDetailDailySchema>;
export type AttributionDetailModel = z.infer<typeof attributionDetailModelSchema>;
export type AttributionDetailResponse = z.infer<typeof attributionDetailResponseSchema>;
