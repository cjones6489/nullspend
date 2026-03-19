import { z } from "zod";

import { nsIdInput, nsIdOutput } from "@/lib/ids/prefixed-id";
import { isWithinJsonDepth, MAX_JSON_DEPTH } from "@/lib/validations/actions";

// --- Request schemas ---

const MAX_COST = Number.MAX_SAFE_INTEGER; // 2^53 - 1; prevents bigint precision loss

const serverNameSchema = z.string().trim().min(1).refine((s) => !s.includes("/"), {
  message: "serverName must not contain '/'",
});

export const upsertToolCostInputSchema = z.object({
  serverName: serverNameSchema,
  toolName: z.string().trim().min(1),
  costMicrodollars: z.number().int().nonnegative().max(MAX_COST),
});

export type UpsertToolCostInput = z.infer<typeof upsertToolCostInputSchema>;

const discoverToolSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().nullable().optional(),
  annotations: z.record(z.string(), z.unknown())
    .refine(
      (val) => isWithinJsonDepth(val, MAX_JSON_DEPTH),
      { message: `Annotations must not exceed ${MAX_JSON_DEPTH} levels of nesting.` },
    )
    .nullable().optional(),
  tierCost: z.number().int().nonnegative().max(MAX_COST),
});

export const discoverToolCostsInputSchema = z.object({
  serverName: serverNameSchema,
  tools: z.array(discoverToolSchema).min(1).max(500).refine(
    (tools) => {
      const names = new Set<string>();
      for (const t of tools) {
        if (names.has(t.name)) return false;
        names.add(t.name);
      }
      return true;
    },
    { message: "tools array must not contain duplicate names" },
  ),
});

export type DiscoverToolCostsInput = z.infer<typeof discoverToolCostsInputSchema>;

// --- Response schemas ---

export const toolCostResponseSchema = z.object({
  id: nsIdOutput("tc"),
  userId: nsIdOutput("usr"),
  serverName: z.string(),
  toolName: z.string(),
  costMicrodollars: z.number(),
  source: z.string(),
  description: z.string().nullable(),
  annotations: z.record(z.string(), z.unknown()).nullable(),
  lastSeenAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ToolCostResponse = z.infer<typeof toolCostResponseSchema>;

export const listToolCostsResponseSchema = z.object({
  data: z.array(toolCostResponseSchema),
});

export const deleteToolCostResponseSchema = z.object({
  deleted: z.literal(true),
});

export const deleteRouteParamsSchema = z.object({
  id: nsIdInput("tc"),
});
