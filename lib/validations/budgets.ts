import { z } from "zod";

import { nsIdInput, toExternalId, fromExternalIdOfType } from "@/lib/ids/prefixed-id";

export const budgetIdParamsSchema = z.object({
  id: nsIdInput("bgt"),
});

const entityTypeSchema = z.enum(["api_key", "user"]);

function entityIdPrefixForType(entityType: "api_key" | "user"): "key" | "usr" {
  return entityType === "api_key" ? "key" : "usr";
}

export const createBudgetInputSchema = z
  .object({
    entityType: entityTypeSchema,
    entityId: z.string(),
    maxBudgetMicrodollars: z.number().int().positive(),
    resetInterval: z.enum(["daily", "weekly", "monthly"]).optional(),
    thresholdPercentages: z
      .array(z.number().int().min(1).max(100))
      .max(10)
      .refine(
        (arr) => {
          for (let i = 1; i < arr.length; i++) {
            if (arr[i] <= arr[i - 1]) return false;
          }
          return true;
        },
        { message: "thresholdPercentages must be sorted ascending with no duplicates" },
      )
      .optional(),
    velocityLimitMicrodollars: z.number().int().positive().nullable().optional(),
    velocityWindowSeconds: z.number().int().min(10).max(3600).optional(),
    velocityCooldownSeconds: z.number().int().min(10).max(3600).optional(),
  })
  .superRefine((val, ctx) => {
    const prefix = entityIdPrefixForType(val.entityType);
    try {
      fromExternalIdOfType(prefix, val.entityId);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["entityId"],
        message: `entityId must be a valid prefixed ID for entityType "${val.entityType}" (expected prefix "ns_${prefix}_")`,
      });
    }
  })
  .transform((val) => ({
    ...val,
    entityId: fromExternalIdOfType(entityIdPrefixForType(val.entityType), val.entityId),
  }));

export type CreateBudgetInput = z.infer<typeof createBudgetInputSchema>;

function prefixEntityId(entityType: string, entityId: string): string {
  const prefix = entityType === "api_key" ? "key" : "usr";
  return toExternalId(prefix, entityId);
}

export const budgetResponseSchema = z
  .object({
    id: z.string().uuid(),
    entityType: z.string(),
    entityId: z.string(),
    maxBudgetMicrodollars: z.number(),
    spendMicrodollars: z.number(),
    policy: z.string(),
    resetInterval: z.string().nullable(),
    currentPeriodStart: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    thresholdPercentages: z.array(z.number()),
    velocityLimitMicrodollars: z.number().nullable(),
    velocityWindowSeconds: z.number().nullable(),
    velocityCooldownSeconds: z.number().nullable(),
  })
  .transform((val) => ({
    ...val,
    id: toExternalId("bgt", val.id),
    entityId: prefixEntityId(val.entityType, val.entityId),
  }));

export const listBudgetsResponseSchema = z.object({
  data: z.array(budgetResponseSchema),
});

// ---------------------------------------------------------------------------
// Budget status (Phase 2D — API-key-authenticated read)
// ---------------------------------------------------------------------------

export const budgetEntitySchema = z
  .object({
    entityType: z.string(),
    entityId: z.string(),
    limitMicrodollars: z.number(),
    spendMicrodollars: z.number(),
    remainingMicrodollars: z.number().min(0),
    policy: z.string(),
    resetInterval: z.string().nullable(),
    currentPeriodStart: z.string().nullable(),
    thresholdPercentages: z.array(z.number()),
    velocityLimitMicrodollars: z.number().nullable(),
    velocityWindowSeconds: z.number().nullable(),
    velocityCooldownSeconds: z.number().nullable(),
  })
  .transform((val) => ({
    ...val,
    entityId: prefixEntityId(val.entityType, val.entityId),
  }));

export const budgetStatusResponseSchema = z.object({
  entities: z.array(budgetEntitySchema),
});

export type BudgetEntity = z.infer<typeof budgetEntitySchema>;
export type BudgetStatusResponse = z.infer<typeof budgetStatusResponseSchema>;
