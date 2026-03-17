import type { Redis } from "@upstash/redis/cloudflare";
import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql, eq, and, getTableColumns } from "drizzle-orm";
import { budgets } from "@nullspend/db";
import { populateCache } from "./budget.js";
import { withDbConnection } from "./db-semaphore.js";

const BUDGET_CACHE_TTL = 60;
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

/**
 * Look up budget configurations for the given API key and/or user.
 *
 * Fast path: pipeline HGETALL + negative-cache GET for each entity in a
 * single Redis round-trip. Slow path (cache miss): query Postgres, then
 * atomically populate the Redis cache via the populateCache Lua script
 * (Fix 9 – skip-if-exists).
 */
export async function lookupBudgets(
  redis: Redis,
  connectionString: string,
  identity: { keyId: string | null; userId: string | null },
): Promise<BudgetEntity[]> {
  const { keyId, userId } = identity;
  const entities: { type: string; id: string; redisKey: string; noneKey: string }[] = [];

  if (keyId) {
    entities.push({
      type: "api_key",
      id: keyId,
      redisKey: `{budget}:api_key:${keyId}`,
      noneKey: `{budget}:api_key:${keyId}:none`,
    });
  }
  if (userId) {
    entities.push({
      type: "user",
      id: userId,
      redisKey: `{budget}:user:${userId}`,
      noneKey: `{budget}:user:${userId}:none`,
    });
  }

  if (entities.length === 0) return [];

  const p = redis.pipeline();
  for (const e of entities) {
    p.hgetall(e.redisKey);
    p.get(e.noneKey);
  }
  const pipelineResults = await p.exec();

  const result: BudgetEntity[] = [];
  const misses: typeof entities = [];

  for (let i = 0; i < entities.length; i++) {
    const hashResult = pipelineResults[i * 2] as Record<string, unknown> | null;
    const noneMarker = pipelineResults[i * 2 + 1] as string | null;

    if (hashResult !== null && hashResult.maxBudget !== undefined) {
      result.push({
        entityKey: entities[i].redisKey,
        entityType: entities[i].type,
        entityId: entities[i].id,
        maxBudget: Number(hashResult.maxBudget),
        spend: Number(hashResult.spend),
        reserved: Number(hashResult.reserved),
        policy: String(hashResult.policy),
      });
    } else if (noneMarker !== null) {
      // Negative cache hit – entity has no budget configured, skip
    } else {
      misses.push(entities[i]);
    }
  }

  if (misses.length === 0) return result;

  // Slow path: query Postgres for cache misses (through semaphore)
  await withDbConnection(async () => {
    let client: Client | null = null;
    try {
      client = new Client({
        connectionString,
        connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
      });
      client.on("error", (err) => {
        console.error("[budget-lookup] pg client error:", err.message);
      });
      await client.connect();
      const db = drizzle({ client });

      for (const miss of misses) {
        const rows = await db
          .select({
            ...getTableColumns(budgets),
            _ts: sql`NOW()`.as("_ts"),
          })
          .from(budgets)
          .where(
            and(
              eq(budgets.entityType, miss.type),
              eq(budgets.entityId, miss.id),
            ),
          );

        if (rows.length > 0) {
          const row = rows[0];
          await populateCache(
            redis,
            miss.redisKey,
            row.maxBudgetMicrodollars,
            row.spendMicrodollars,
            row.policy,
            BUDGET_CACHE_TTL,
          );
          result.push({
            entityKey: miss.redisKey,
            entityType: miss.type,
            entityId: miss.id,
            maxBudget: row.maxBudgetMicrodollars,
            spend: row.spendMicrodollars,
            reserved: 0,
            policy: row.policy,
          });
        } else {
          // Fix 10: negative cache – no budget configured for this entity
          await redis.set(miss.noneKey, "1", { ex: BUDGET_CACHE_TTL });
        }
      }
    } catch (err) {
      console.error(
        "[budget-lookup] Postgres lookup failed:",
        err instanceof Error ? err.message : "Unknown error",
      );
      // Re-throw so the caller can decide failure mode (fail-closed for budget)
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
