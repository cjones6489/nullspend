import { z } from "zod";

import { nsIdOutputNullable } from "@/lib/ids/prefixed-id";

const safeIdentifier = z.string().min(1).max(100).regex(
  /^[a-zA-Z_][a-zA-Z0-9_-]*$/,
  "Must be alphanumeric, underscore, or hyphen (start with letter or underscore)",
);

export const attributionQuerySchema = z.object({
  groupBy: safeIdentifier,
  period: z.enum(["7d", "30d", "90d"]).default("30d"),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  excludeEstimated: z.enum(["true", "false"]).default("false"),
  format: z.enum(["json", "csv"]).default("json"),
});

export const attributionGroupSchema = z.object({
  key: z.string(),
  keyId: nsIdOutputNullable("key"),
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
  groupBy: safeIdentifier,
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
