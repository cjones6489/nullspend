import { z } from "zod";

import { nsIdInput, toExternalId, fromExternalIdOfType } from "@/lib/ids/prefixed-id";

export const budgetIdParamsSchema = z.object({
  id: nsIdInput("bgt"),
});

const entityTypeSchema = z.enum(["api_key", "user", "tag"]);

function entityIdPrefixForType(entityType: "api_key" | "user"): "key" | "usr" {
  return entityType === "api_key" ? "key" : "usr";
}

const TAG_ENTITY_ID_REGEX = /^[a-zA-Z0-9_-]+=.+$/;

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
    sessionLimitMicrodollars: z.number().int().positive().nullable().optional(),
  })
  .superRefine((val, ctx) => {
    // Tag entity IDs are "key=value" strings, not prefixed UUIDs
    if (val.entityType === "tag") {
      if (!TAG_ENTITY_ID_REGEX.test(val.entityId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["entityId"],
          message: 'Tag entityId must be in "key=value" format (e.g., "project=openclaw")',
        });
      }
      if (val.entityId.length > 321) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["entityId"],
          message: "Tag entityId must be 321 characters or fewer",
        });
      }
      const tagKey = val.entityId.split("=")[0];
      if (tagKey.startsWith("_ns_")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["entityId"],
          message: "Tag keys starting with _ns_ are reserved",
        });
      }
      return;
    }

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
  .transform((val) => {
    // Tag entity IDs pass through as-is (not UUIDs, no prefix to strip)
    if (val.entityType === "tag") return val;
    return {
      ...val,
      entityId: fromExternalIdOfType(entityIdPrefixForType(val.entityType), val.entityId),
    };
  });

export type CreateBudgetInput = z.infer<typeof createBudgetInputSchema>;

/**
 * Convert a raw DB entityId to the external format.
 * - api_key: UUID → "ns_key_{uuid}"
 * - user: UUID → "ns_usr_{uuid}"
 * - tag: "key=value" → "key=value" (passthrough, not a UUID)
 */
function prefixEntityId(entityType: string, entityId: string): string {
  if (entityType === "tag") return entityId;
  if (entityType === "api_key") return toExternalId("key", entityId);
  if (entityType === "user") return toExternalId("usr", entityId);
  // Unknown type — return as-is rather than crash the entire response
  return entityId;
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
    sessionLimitMicrodollars: z.number().nullable(),
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
    sessionLimitMicrodollars: z.number().nullable(),
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
