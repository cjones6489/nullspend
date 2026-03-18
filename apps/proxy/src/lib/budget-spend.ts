import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql, eq, and } from "drizzle-orm";
import { budgets } from "@nullspend/db";
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

/**
 * Reset budget period in Postgres: set spend=0 and update currentPeriodStart.
 * Called when the DO detects an expired budget period.
 * Runs inside `waitUntil` — never throws.
 */
export async function resetBudgetPeriod(
  connectionString: string,
  resets: Array<{ entityType: string; entityId: string; newPeriodStart: number }>,
): Promise<void> {
  if (resets.length === 0) return;

  if (isLocalConnection(connectionString)) {
    console.log("[budget-spend] Local dev — period reset (not persisted):", { resets });
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
        for (const reset of resets) {
          await tx
            .update(budgets)
            .set({
              spendMicrodollars: 0,
              currentPeriodStart: new Date(reset.newPeriodStart),
              updatedAt: sql`NOW()`,
            })
            .where(
              and(
                eq(budgets.entityType, reset.entityType),
                eq(budgets.entityId, reset.entityId),
              ),
            );
        }
      });
    } catch (err) {
      console.error(
        "[budget-spend] Failed to reset period:",
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
