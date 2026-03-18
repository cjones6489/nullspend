import { z } from "zod";

export const createBudgetInputSchema = z.object({
  entityType: z.enum(["api_key", "user"]),
  entityId: z.string().uuid(),
  maxBudgetMicrodollars: z.number().int().positive(),
  resetInterval: z.enum(["daily", "weekly", "monthly"]).optional(),
});

export type CreateBudgetInput = z.infer<typeof createBudgetInputSchema>;

export const budgetResponseSchema = z.object({
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
});

export const listBudgetsResponseSchema = z.object({
  data: z.array(budgetResponseSchema),
});

// ---------------------------------------------------------------------------
// Budget status (Phase 2D — API-key-authenticated read)
// ---------------------------------------------------------------------------

export const budgetEntitySchema = z.object({
  entityType: z.string(),
  entityId: z.string(),
  limitMicrodollars: z.number(),
  spendMicrodollars: z.number(),
  remainingMicrodollars: z.number().min(0),
  policy: z.string(),
  resetInterval: z.string().nullable(),
  currentPeriodStart: z.string().nullable(),
});

export const budgetStatusResponseSchema = z.object({
  hasBudgets: z.boolean(),
  source: z.literal("postgres"),
  entities: z.array(budgetEntitySchema),
});

export type BudgetEntity = z.infer<typeof budgetEntitySchema>;
export type BudgetStatusResponse = z.infer<typeof budgetStatusResponseSchema>;
