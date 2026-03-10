import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { costEvents, type NewCostEventRow } from "@agentseam/db";

const CONNECTION_TIMEOUT_MS = 5_000;

/**
 * Check if a connection string points to a local/dev-only address.
 * In local dev, pg's raw TCP socket errors crash the workerd process
 * because they bypass all promise/event error handling. When the local
 * Postgres isn't running, we fall back to console logging.
 *
 * Hyperdrive rewrites connection strings in local dev, so we also
 * check for the `.hyperdrive.local` hostname that miniflare uses.
 */
function isLocalConnection(connectionString: string): boolean {
  try {
    const url = new URL(connectionString);
    const host = url.hostname;
    return (
      host === "127.0.0.1" ||
      host === "localhost" ||
      host === "::1" ||
      host === "[::1]" ||
      host.endsWith(".hyperdrive.local")
    );
  } catch {
    return false;
  }
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
    console.error("[cost-logger] Failed to write cost event:", err);
  } finally {
    if (client) {
      try {
        await client.end();
      } catch {
        // already closed or never connected
      }
    }
  }
}
