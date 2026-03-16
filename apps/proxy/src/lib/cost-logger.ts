import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { costEvents, type NewCostEventRow } from "@nullspend/db";
import { withDbConnection } from "./db-semaphore.js";

const CONNECTION_TIMEOUT_MS = 5_000;

/**
 * Check if DB writes should be skipped.
 * In local dev WITHOUT Hyperdrive, pg's raw TCP socket errors crash
 * the workerd process. We skip writes unless __FORCE_DB_PERSIST is set.
 *
 * Hyperdrive rewrites connection strings to local-looking addresses
 * (127.0.0.1) in BOTH production and local dev, so hostname-based
 * detection is unreliable. Instead we use an explicit opt-out flag.
 */
export function isLocalConnection(connectionString: string): boolean {
  const globals = globalThis as Record<string, unknown>;
  if (globals.__FORCE_DB_PERSIST) return false;
  if (globals.__SKIP_DB_PERSIST) return true;
  return false;
}

/**
 * Persist a cost event to Postgres via Hyperdrive.
 * Creates a per-request pg.Client, wraps it with Drizzle for
 * type-safe inserts, and cleans up after the write.
 * Never throws — this runs inside waitUntil().
 *
 * In local dev (localhost connection string), falls back to console
 * logging to avoid workerd crashes from unreachable Postgres.
 */
export async function logCostEvent(
  connectionString: string,
  event: Omit<NewCostEventRow, "id" | "createdAt">,
): Promise<void> {
  if (isLocalConnection(connectionString)) {
    console.log("[cost-logger] Local dev — cost event (not persisted):", {
      requestId: event.requestId,
      provider: event.provider,
      model: event.model,
      inputTokens: event.inputTokens,
      outputTokens: event.outputTokens,
      costMicrodollars: event.costMicrodollars,
      durationMs: event.durationMs,
    });
    return;
  }

  try {
    await withDbConnection(async () => {
      let client: Client | null = null;

      try {
        client = new Client({
          connectionString,
          connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
        });

        client.on("error", (err) => {
          console.error("[cost-logger] pg client error event:", err.message);
        });

        await client.connect();

        const db = drizzle({ client });
        await db.insert(costEvents).values(event);
      } catch (err) {
        console.error(
          "[cost-logger] Failed to write cost event:",
          err instanceof Error ? err.message : "Unknown error",
        );
      } finally {
        if (client) {
          try {
            await client.end();
          } catch {
            // already closed or never connected
          }
        }
      }
    });
  } catch (err) {
    console.error(
      "[cost-logger] Semaphore rejected cost event:",
      err instanceof Error ? err.message : "Unknown error",
    );
  }
}

/**
 * Persist multiple cost events in a single multi-row INSERT.
 * Same guarantees as logCostEvent: uses withDbConnection semaphore,
 * never throws, falls back to console in local dev.
 */
export async function logCostEventsBatch(
  connectionString: string,
  events: Omit<NewCostEventRow, "id" | "createdAt">[],
): Promise<void> {
  if (events.length === 0) return;

  if (isLocalConnection(connectionString)) {
    for (const event of events) {
      console.log("[cost-logger] Local dev — cost event (not persisted):", {
        requestId: event.requestId,
        provider: event.provider,
        model: event.model,
        costMicrodollars: event.costMicrodollars,
        durationMs: event.durationMs,
      });
    }
    return;
  }

  try {
    await withDbConnection(async () => {
      let client: Client | null = null;
      try {
        client = new Client({
          connectionString,
          connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
        });
        client.on("error", (err) => {
          console.error("[cost-logger] pg client error event:", err.message);
        });
        await client.connect();
        const db = drizzle({ client });
        await db.insert(costEvents).values(events);
      } catch (err) {
        console.error(
          "[cost-logger] Failed to write cost event batch:",
          err instanceof Error ? err.message : "Unknown error",
          `(${events.length} events)`,
        );
      } finally {
        if (client) {
          try {
            await client.end();
          } catch {
            // already closed or never connected
          }
        }
      }
    });
  } catch (err) {
    console.error(
      "[cost-logger] Semaphore rejected cost event batch:",
      err instanceof Error ? err.message : "Unknown error",
      `(${events.length} events)`,
    );
  }
}
