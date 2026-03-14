import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql, eq, and } from "drizzle-orm";
import { budgets } from "@agentseam/db";
import { isLocalConnection } from "./cost-logger.js";
import { withDbConnection } from "./db-semaphore.js";

const CONNECTION_TIMEOUT_MS = 5_000;

/**
 * Atomically increment `spend_microdollars` on each budget entity in Postgres.
 * Runs inside `waitUntil` — never throws.
 *
 * Ensures Postgres spend stays current so Redis cache rebuilds after TTL
 * expiry start from an accurate baseline (Fix 2).
 */
export async function updateBudgetSpend(
  connectionString: string,
  entities: { entityType: string; entityId: string }[],
  actualCostMicrodollars: number,
): Promise<void> {
  if (actualCostMicrodollars <= 0 || entities.length === 0) return;

  if (isLocalConnection(connectionString)) {
    console.log("[budget-spend] Local dev — spend update (not persisted):", {
      entities,
      actualCostMicrodollars,
    });
    return;
  }

  await withDbConnection(async () => {
    let client: Client | null = null;

    try {
      client = new Client({
        connectionString,
        connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
      });
      client.on("error", (err) => {
        console.error("[budget-spend] pg client error:", err.message);
      });
      await client.connect();
      const db = drizzle({ client });

      await db.transaction(async (tx) => {
        for (const entity of entities) {
          await tx
            .update(budgets)
            .set({
              spendMicrodollars: sql`${budgets.spendMicrodollars} + ${actualCostMicrodollars}`,
              updatedAt: sql`NOW()`,
            })
            .where(
              and(
                eq(budgets.entityType, entity.entityType),
                eq(budgets.entityId, entity.entityId),
              ),
            );
        }
      });
    } catch (err) {
      console.error(
        "[budget-spend] Failed to update spend:",
        err instanceof Error ? err.message : "Unknown error",
      );
    } finally {
      if (client) {
        try {
          await client.end();
        } catch {
          // already closed
        }
      }
    }
  });
}
