import { eq, and } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/lib/db/client";
import { costEvents } from "@nullspend/db";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export const costEventInputSchema = z.object({
  provider: z.string().min(1).max(100),
  model: z.string().min(1).max(200),
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  cachedInputTokens: z.number().int().min(0).optional(),
  reasoningTokens: z.number().int().min(0).optional(),
  costMicrodollars: z.number().int().min(0),
  durationMs: z.number().int().min(0).optional(),
  sessionId: z.string().max(200).optional(),
  eventType: z.enum(["llm", "tool", "custom"]).optional(),
  toolName: z.string().max(200).optional(),
  toolServer: z.string().max(200).optional(),
  idempotencyKey: z.string().max(200).optional(),
});

export type CostEventInput = z.infer<typeof costEventInputSchema>;

export const costEventBatchInputSchema = z.object({
  events: z.array(costEventInputSchema).min(1).max(100),
});

// ---------------------------------------------------------------------------
// Insert helpers
// ---------------------------------------------------------------------------

interface InsertContext {
  userId: string;
  apiKeyId: string | null;
}

/**
 * Resolve the request_id for a cost event.
 * Priority: Idempotency-Key header > idempotencyKey in body > auto-generated.
 */
function resolveRequestId(
  idempotencyHeader: string | null,
  bodyKey: string | undefined,
): string {
  if (idempotencyHeader) return idempotencyHeader;
  if (bodyKey) return bodyKey;
  return `sdk_${crypto.randomUUID()}`;
}

function buildInsertValues(input: CostEventInput, requestId: string, ctx: InsertContext) {
  return {
    requestId,
    apiKeyId: ctx.apiKeyId,
    userId: ctx.userId,
    provider: input.provider,
    model: input.model,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    cachedInputTokens: input.cachedInputTokens ?? 0,
    reasoningTokens: input.reasoningTokens ?? 0,
    costMicrodollars: input.costMicrodollars,
    durationMs: input.durationMs ?? null,
    eventType: input.eventType ?? "custom",
    toolName: input.toolName ?? null,
    toolServer: input.toolServer ?? null,
    sessionId: input.sessionId ?? null,
    source: "api" as const,
  };
}

/**
 * Insert a single cost event, deduplicating on (request_id, provider).
 *
 * Uses INSERT ... ON CONFLICT DO NOTHING ... RETURNING to avoid the
 * TOCTOU race of SELECT-then-INSERT. If ON CONFLICT skips the row
 * (duplicate), RETURNING is empty and we fall back to a SELECT.
 */
export async function insertCostEvent(
  input: CostEventInput,
  ctx: InsertContext,
  idempotencyHeader: string | null,
): Promise<{ id: string; createdAt: string; deduplicated: boolean }> {
  const db = getDb();
  const requestId = resolveRequestId(idempotencyHeader, input.idempotencyKey);
  const values = buildInsertValues(input, requestId, ctx);

  const rows = await db
    .insert(costEvents)
    .values(values)
    .onConflictDoNothing({ target: [costEvents.requestId, costEvents.provider] })
    .returning({ id: costEvents.id, createdAt: costEvents.createdAt });

  if (rows.length > 0) {
    return {
      id: rows[0].id,
      createdAt: rows[0].createdAt.toISOString(),
      deduplicated: false,
    };
  }

  // ON CONFLICT skipped — fetch the existing row
  const [existing] = await db
    .select({ id: costEvents.id, createdAt: costEvents.createdAt })
    .from(costEvents)
    .where(
      and(
        eq(costEvents.requestId, requestId),
        eq(costEvents.provider, input.provider),
      ),
    )
    .limit(1);

  return {
    id: existing.id,
    createdAt: existing.createdAt.toISOString(),
    deduplicated: true,
  };
}

/** Row shape returned from batch insert for webhook dispatch. */
export interface InsertedCostEventRow {
  id: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  costMicrodollars: number;
  durationMs: number | null;
  eventType: string;
  toolName: string | null;
  toolServer: string | null;
  sessionId: string | null;
  requestId: string;
  source: string;
}

/**
 * Insert a batch of cost events in a single multi-row INSERT.
 * Generates request IDs for events without idempotency keys.
 * Returns data for actually-inserted rows (not duplicates).
 */
export async function insertCostEventsBatch(
  events: CostEventInput[],
  ctx: InsertContext,
): Promise<{ ids: string[]; inserted: number; rows: InsertedCostEventRow[] }> {
  const db = getDb();

  const values = events.map((input) =>
    buildInsertValues(input, input.idempotencyKey || `sdk_${crypto.randomUUID()}`, ctx),
  );

  const rows = await db
    .insert(costEvents)
    .values(values)
    .onConflictDoNothing({ target: [costEvents.requestId, costEvents.provider] })
    .returning({
      id: costEvents.id,
      provider: costEvents.provider,
      model: costEvents.model,
      inputTokens: costEvents.inputTokens,
      outputTokens: costEvents.outputTokens,
      cachedInputTokens: costEvents.cachedInputTokens,
      costMicrodollars: costEvents.costMicrodollars,
      durationMs: costEvents.durationMs,
      eventType: costEvents.eventType,
      toolName: costEvents.toolName,
      toolServer: costEvents.toolServer,
      sessionId: costEvents.sessionId,
      requestId: costEvents.requestId,
      source: costEvents.source,
    });

  return {
    ids: rows.map((r) => r.id),
    inserted: rows.length,
    rows,
  };
}
