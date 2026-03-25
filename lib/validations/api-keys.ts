import { z } from "zod";

import { nsIdInput, nsIdOutput } from "@/lib/ids/prefixed-id";

/** @deprecated Tier limits are enforced server-side. Use TIERS[tier].maxApiKeys. */
export const MAX_KEYS_PER_USER = Infinity;

const tagKeySchema = z.string().regex(/^[a-zA-Z0-9_-]+$/, "Tag keys must be alphanumeric, underscore, or hyphen.").max(64);
const tagValueSchema = z.string().max(256).refine(s => !s.includes("\0"), "Values must not contain null bytes.");

const defaultTagsSchema = z.record(tagKeySchema, tagValueSchema)
  .refine(obj => Object.keys(obj).length <= 10, "Maximum 10 default tags.")
  .refine(obj => !Object.keys(obj).some(k => k.startsWith("_ns_")), "Tags starting with _ns_ are reserved.")
  .default({});

export const keyIdParamsSchema = z.object({
  id: nsIdInput("key"),
});

export const createApiKeyInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(50, "Name must be 50 characters or fewer."),
  defaultTags: defaultTagsSchema,
});

const updateDefaultTagsSchema = z.record(tagKeySchema, tagValueSchema)
  .refine(obj => Object.keys(obj).length <= 10, "Maximum 10 default tags.")
  .refine(obj => !Object.keys(obj).some(k => k.startsWith("_ns_")), "Tags starting with _ns_ are reserved.");

export const updateApiKeyInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(50, "Name must be 50 characters or fewer.").optional(),
  defaultTags: updateDefaultTagsSchema.optional(),
}).refine(obj => obj.name !== undefined || obj.defaultTags !== undefined, "At least one field (name or defaultTags) is required.");

export const apiKeyRecordSchema = z.object({
  id: nsIdOutput("key"),
  name: z.string(),
  keyPrefix: z.string(),
  defaultTags: z.record(z.string(), z.string()),
  lastUsedAt: z.string().nullable(),
  createdAt: z.string(),
});

export const createApiKeyResponseSchema = z.object({
  id: nsIdOutput("key"),
  name: z.string(),
  keyPrefix: z.string(),
  defaultTags: z.record(z.string(), z.string()),
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
export type UpdateApiKeyInput = z.infer<typeof updateApiKeyInputSchema>;
export type ApiKeyRecord = z.infer<typeof apiKeyRecordSchema>;
export type CreateApiKeyResponse = z.infer<typeof createApiKeyResponseSchema>;
