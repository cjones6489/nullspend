import { costEvents, type NewCostEventRow } from "@nullspend/db";
import { emitMetric } from "./metrics.js";
import { getDb } from "./db.js";

/**
 * Persist a cost event to Postgres via Hyperdrive.
 * Uses the shared postgres.js pool via getDb() with Drizzle ORM
 * for type-safe inserts.
 * Never throws — this runs inside waitUntil().
 *
 * When skipDbWrites is true (local dev without Hyperdrive), falls back
 * to console logging to avoid workerd crashes from unreachable Postgres.
 */
export async function logCostEvent(
  connectionString: string,
  event: Omit<NewCostEventRow, "id" | "createdAt">,
  options?: { throwOnError?: boolean; skipDbWrites?: boolean },
): Promise<void> {
  if (options?.skipDbWrites) {
    console.log("[cost-logger] Local dev — cost event (not persisted):", {
      requestId: event.requestId,
      provider: event.provider,
      model: event.model,
      inputTokens: event.inputTokens,
      outputTokens: event.outputTokens,
      costMicrodollars: event.costMicrodollars,
      durationMs: event.durationMs,
      eventType: event.eventType,
      toolName: event.toolName,
      sessionId: event.sessionId,
      traceId: event.traceId,
    });
    return;
  }

  try {
    const db = getDb(connectionString);
    await db.insert(costEvents).values(event).onConflictDoNothing({ target: [costEvents.requestId, costEvents.provider] });
  } catch (err) {
    emitMetric("cost_event_drop", { reason: "pg_error" });
    console.error(
      "[cost-logger] Failed to write cost event:",
      err instanceof Error ? err.message : "Unknown error",
    );
    if (options?.throwOnError) throw err;
  }
}

/**
 * Persist multiple cost events in a single multi-row INSERT.
 * Same guarantees as logCostEvent: uses shared pool,
 * never throws, falls back to console in local dev.
 */
export async function logCostEventsBatch(
  connectionString: string,
  events: Omit<NewCostEventRow, "id" | "createdAt">[],
  options?: { throwOnError?: boolean; skipDbWrites?: boolean },
): Promise<void> {
  if (events.length === 0) return;

  if (options?.skipDbWrites) {
    for (const event of events) {
      console.log("[cost-logger] Local dev — cost event (not persisted):", {
        requestId: event.requestId,
        provider: event.provider,
        model: event.model,
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
        costMicrodollars: event.costMicrodollars,
        durationMs: event.durationMs,
        eventType: event.eventType,
        toolName: event.toolName,
        sessionId: event.sessionId,
        traceId: event.traceId,
      });
    }
    return;
  }

  try {
    const db = getDb(connectionString);
    await db.insert(costEvents).values(events).onConflictDoNothing({ target: [costEvents.requestId, costEvents.provider] });
  } catch (err) {
    emitMetric("cost_event_drop", { reason: "batch_pg_error", count: events.length });
    console.error(
      "[cost-logger] Failed to write cost event batch:",
      err instanceof Error ? err.message : "Unknown error",
      `(${events.length} events)`,
    );
    if (options?.throwOnError) throw err;
  }
}
