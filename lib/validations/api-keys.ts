import { z } from "zod";

import { nsIdInput, nsIdOutput } from "@/lib/ids/prefixed-id";

export const MAX_KEYS_PER_USER = 20;

export const keyIdParamsSchema = z.object({
  id: nsIdInput("key"),
});

export const createApiKeyInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(50, "Name must be 50 characters or fewer."),
});

export const apiKeyRecordSchema = z.object({
  id: nsIdOutput("key"),
  name: z.string(),
  keyPrefix: z.string(),
  lastUsedAt: z.string().nullable(),
  createdAt: z.string(),
});

export const createApiKeyResponseSchema = z.object({
  id: nsIdOutput("key"),
  name: z.string(),
  keyPrefix: z.string(),
  rawKey: z.string(),
  createdAt: z.string(),
});

const apiKeyCursorInputSchema = z.object({
  createdAt: z.string().datetime(),
  id: nsIdInput("key"),
});

const apiKeyCursorOutputSchema = z.object({
  createdAt: z.string().datetime(),
  id: nsIdOutput("key"),
});

export const listApiKeysQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().transform((s) => JSON.parse(s)).pipe(apiKeyCursorInputSchema).optional(),
});

export const listApiKeysResponseSchema = z.object({
  data: z.array(apiKeyRecordSchema),
  cursor: apiKeyCursorOutputSchema.nullable(),
});

export const deleteApiKeyResponseSchema = z.object({
  id: nsIdOutput("key"),
  revokedAt: z.string(),
});

export type CreateApiKeyInput = z.infer<typeof createApiKeyInputSchema>;
export type ApiKeyRecord = z.infer<typeof apiKeyRecordSchema>;
export type CreateApiKeyResponse = z.infer<typeof createApiKeyResponseSchema>;
