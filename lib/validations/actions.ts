import { z } from "zod";

import { nsIdInput, nsIdOutput } from "@/lib/ids/prefixed-id";
import { ACTION_STATUSES, ACTION_TYPES } from "@/lib/utils/status";

const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

const MAX_PAYLOAD_BYTES = 64_000;
const MAX_METADATA_BYTES = 16_000;
const MAX_RESULT_BYTES = 64_000;
const MAX_EXPIRES_SECONDS = 2_592_000; // 30 days
const MAX_JSON_DEPTH = 20;

/**
 * Checks whether a JSON value exceeds the given nesting depth.
 * Returns `true` if the value is within the limit.
 */
export function isWithinJsonDepth(value: unknown, maxDepth: number = MAX_JSON_DEPTH): boolean {
  return checkDepth(value, maxDepth, 0);
}

function checkDepth(value: unknown, maxDepth: number, currentDepth: number): boolean {
  if (currentDepth > maxDepth) return false;
  if (value === null || value === undefined || typeof value !== "object") return true;

  if (Array.isArray(value)) {
    return value.every((item) => checkDepth(item, maxDepth, currentDepth + 1));
  }

  return Object.values(value as Record<string, unknown>).every(
    (v) => checkDepth(v, maxDepth, currentDepth + 1),
  );
}

const jsonObjectSchema = z.record(z.string(), jsonValueSchema);

const boundedPayloadSchema = jsonObjectSchema
  .refine(
    (val) => JSON.stringify(val).length <= MAX_PAYLOAD_BYTES,
    { message: `Payload must be at most ${MAX_PAYLOAD_BYTES} bytes when serialized.` },
  )
  .refine(
    (val) => isWithinJsonDepth(val, MAX_JSON_DEPTH),
    { message: `Payload must not exceed ${MAX_JSON_DEPTH} levels of nesting.` },
  );

const boundedMetadataSchema = jsonObjectSchema
  .refine(
    (val) => JSON.stringify(val).length <= MAX_METADATA_BYTES,
    { message: `Metadata must be at most ${MAX_METADATA_BYTES} bytes when serialized.` },
  )
  .refine(
    (val) => isWithinJsonDepth(val, MAX_JSON_DEPTH),
    { message: `Metadata must not exceed ${MAX_JSON_DEPTH} levels of nesting.` },
  )
  .optional();

const boundedResultSchema = jsonObjectSchema
  .refine(
    (val) => JSON.stringify(val).length <= MAX_RESULT_BYTES,
    { message: `Result must be at most ${MAX_RESULT_BYTES} bytes when serialized.` },
  )
  .refine(
    (val) => isWithinJsonDepth(val, MAX_JSON_DEPTH),
    { message: `Result must not exceed ${MAX_JSON_DEPTH} levels of nesting.` },
  )
  .optional();

export const actionTypeSchema = z.enum(ACTION_TYPES);
export const actionStatusSchema = z.enum(ACTION_STATUSES);

export const actionMetadataSchema = jsonObjectSchema.optional();

export const createActionInputSchema = z.object({
  agentId: z.string().trim().min(1).max(255),
  actionType: actionTypeSchema,
  payload: boundedPayloadSchema,
  metadata: boundedMetadataSchema,
  expiresInSeconds: z.number().int().min(0).max(MAX_EXPIRES_SECONDS).nullable().optional(),
});

export const actionIdParamsSchema = z.object({
  id: nsIdInput("act"),
});

export const markResultInputSchema = z
  .object({
    status: z.enum(["executing", "executed", "failed"]),
    result: boundedResultSchema,
    errorMessage: z.string().trim().min(1).max(4_000).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.status === "failed" && !value.errorMessage) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["errorMessage"],
        message: "errorMessage is required when status is failed.",
      });
    }

    if (value.status === "executing" && value.result) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["result"],
        message: "result cannot be set while status is executing.",
      });
    }

    if (value.status === "executing" && value.errorMessage) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["errorMessage"],
        message: "errorMessage cannot be set while status is executing.",
      });
    }

    if (value.status === "executed" && value.errorMessage) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["errorMessage"],
        message: "errorMessage cannot be set when status is executed.",
      });
    }
  });

export const actionRecordSchema = z.object({
  id: nsIdOutput("act"),
  agentId: z.string(),
  actionType: actionTypeSchema,
  status: actionStatusSchema,
  payload: jsonObjectSchema,
  metadata: jsonObjectSchema.nullable(),
  createdAt: z.string(),
  approvedAt: z.string().nullable(),
  rejectedAt: z.string().nullable(),
  executedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  expiredAt: z.string().nullable(),
  approvedBy: z.string().nullable(),
  rejectedBy: z.string().nullable(),
  result: jsonObjectSchema.nullable(),
  errorMessage: z.string().nullable(),
  environment: z.string().nullable(),
  sourceFramework: z.string().nullable(),
});

const cursorInputSchema = z.object({
  createdAt: z.string().datetime(),
  id: nsIdInput("act"),
});

const cursorOutputSchema = z.object({
  createdAt: z.string().datetime(),
  id: nsIdOutput("act"),
});

export const listActionsQuerySchema = z.object({
  status: actionStatusSchema.optional(),
  statuses: z
    .string()
    .transform((s) => s.split(","))
    .pipe(z.array(actionStatusSchema).min(1))
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().transform((s) => JSON.parse(s)).pipe(cursorInputSchema).optional(),
});

export const listActionsResponseSchema = z.object({
  data: z.array(actionRecordSchema),
  cursor: cursorOutputSchema.nullable(),
});

export const createActionResponseSchema = z.object({
  id: nsIdOutput("act"),
  status: z.literal("pending"),
  expiresAt: z.string().nullable(),
});

export const mutateActionResponseSchema = z.object({
  id: nsIdOutput("act"),
  status: actionStatusSchema,
  approvedAt: z.string().nullable().optional(),
  rejectedAt: z.string().nullable().optional(),
  executedAt: z.string().nullable().optional(),
  budgetIncrease: z
    .object({
      previousLimit: z.number(),
      newLimit: z.number(),
      amount: z.number(),
      requestedAmount: z.number(),
    })
    .optional(),
});

export { MAX_EXPIRES_SECONDS, MAX_JSON_DEPTH };
export type CreateActionInput = z.infer<typeof createActionInputSchema>;
export type MarkResultInput = z.infer<typeof markResultInputSchema>;

export const budgetIncreasePayloadSchema = z.object({
  entityType: z.string().min(1).max(50),
  entityId: z.string().min(1).max(255),
  requestedAmountMicrodollars: z.number().int().positive(),
  currentLimitMicrodollars: z.number().int().min(0),
  currentSpendMicrodollars: z.number().int().min(0),
  reason: z.string().min(1).max(2000),
});

export type BudgetIncreasePayload = z.infer<typeof budgetIncreasePayloadSchema>;

export interface ApproveActionInput {
  approvedBy: string;
  approvedAmountMicrodollars?: number;
}

export interface RejectActionInput {
  rejectedBy: string;
}
export type ActionRecord = z.infer<typeof actionRecordSchema>;
export type RawActionRecord = z.input<typeof actionRecordSchema>;
export type ListActionsQuery = z.infer<typeof listActionsQuerySchema>;
