import { z } from "zod";

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

const jsonObjectSchema = z.record(z.string(), jsonValueSchema);

export const actionTypeSchema = z.enum(ACTION_TYPES);
export const actionStatusSchema = z.enum(ACTION_STATUSES);

export const actionMetadataSchema = jsonObjectSchema.optional();

export const createActionInputSchema = z.object({
  agentId: z.string().trim().min(1),
  actionType: actionTypeSchema,
  payload: jsonObjectSchema,
  metadata: actionMetadataSchema,
  expiresInSeconds: z.number().int().min(0).nullable().optional(),
});

export const actionIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const markResultInputSchema = z
  .object({
    status: z.enum(["executing", "executed", "failed"]),
    result: jsonObjectSchema.optional(),
    errorMessage: z.string().trim().min(1).optional(),
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
  id: z.string().uuid(),
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

const cursorSchema = z.object({
  createdAt: z.string().datetime(),
  id: z.string().uuid(),
});

export const listActionsQuerySchema = z.object({
  status: actionStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().transform((s) => JSON.parse(s)).pipe(cursorSchema).optional(),
});

export const listActionsResponseSchema = z.object({
  data: z.array(actionRecordSchema),
  cursor: cursorSchema.nullable(),
});

export const createActionResponseSchema = z.object({
  id: z.string().uuid(),
  status: z.literal("pending"),
  expiresAt: z.string().nullable(),
});

export const mutateActionResponseSchema = z.object({
  id: z.string().uuid(),
  status: actionStatusSchema,
  approvedAt: z.string().nullable().optional(),
  rejectedAt: z.string().nullable().optional(),
  executedAt: z.string().nullable().optional(),
});

export type CreateActionInput = z.infer<typeof createActionInputSchema>;
export type MarkResultInput = z.infer<typeof markResultInputSchema>;

export interface ApproveActionInput {
  approvedBy: string;
}

export interface RejectActionInput {
  rejectedBy: string;
}
export type ActionRecord = z.infer<typeof actionRecordSchema>;
export type ListActionsQuery = z.infer<typeof listActionsQuerySchema>;
