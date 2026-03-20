import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, and, getTableColumns } from "drizzle-orm";
import { budgets } from "@nullspend/db";
import { withDbConnection } from "./db-semaphore.js";

const CONNECTION_TIMEOUT_MS = 5_000;

export interface BudgetEntity {
  entityKey: string;
  entityType: string;
  entityId: string;
  maxBudget: number;
  spend: number;
  reserved: number;
  policy: string;
}

export interface DOBudgetEntity {
  entityType: string;
  entityId: string;
  maxBudget: number;
  spend: number;
  policy: string;
  resetInterval: string | null;
  periodStart: number; // epoch ms
  velocityLimit: number | null;
  velocityWindow: number; // ms (default 60000)
  velocityCooldown: number; // ms (default 60000)
}

/**
 * Query Postgres directly for budget entities with all DO-required fields.
 * Throws on error (caller decides fail mode).
 */
export async function lookupBudgetsForDO(
  connectionString: string,
  identity: { keyId: string | null; userId: string | null },
): Promise<DOBudgetEntity[]> {
  const { keyId, userId } = identity;
  const entities: { type: string; id: string }[] = [];

  if (keyId) {
    entities.push({ type: "api_key", id: keyId });
  }
  if (userId) {
    entities.push({ type: "user", id: userId });
  }

  if (entities.length === 0) return [];

  const result: DOBudgetEntity[] = [];

  await withDbConnection(async () => {
    let client: Client | null = null;
    try {
      client = new Client({
        connectionString,
        connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
      });
      client.on("error", (err) => {
        console.error("[budget-do-lookup] pg client error:", err.message);
      });
      await client.connect();
      const db = drizzle({ client });

      for (const entity of entities) {
        const rows = await db
          .select(getTableColumns(budgets))
          .from(budgets)
          .where(
            and(
              eq(budgets.entityType, entity.type),
              eq(budgets.entityId, entity.id),
            ),
          );

        if (rows.length > 0) {
          const row = rows[0];
          result.push({
            entityType: entity.type,
            entityId: entity.id,
            maxBudget: row.maxBudgetMicrodollars,
            spend: row.spendMicrodollars,
            policy: row.policy,
            resetInterval: row.resetInterval ?? null,
            periodStart: row.currentPeriodStart?.getTime() ?? 0,
            velocityLimit: row.velocityLimitMicrodollars ?? null,
            velocityWindow: (row.velocityWindowSeconds ?? 60) * 1000,
            velocityCooldown: (row.velocityCooldownSeconds ?? 60) * 1000,
          });
        }
      }
    } catch (err) {
      console.error(
        "[budget-do-lookup] Postgres lookup failed:",
        err instanceof Error ? err.message : "Unknown error",
      );
      throw err;
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

  return result;
}
