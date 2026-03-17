import { Redis } from "@upstash/redis";
import { sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";

/**
 * Health check endpoint (public, unauthenticated).
 *
 * Checks:
 * - Database connectivity (SELECT 1)
 * - Schema completeness (critical tables and columns exist)
 *
 * Returns 200 if healthy, 503 if any check fails.
 * Detailed component status is only returned when the `?verbose=1` query
 * parameter is present (intended for internal/operator use).
 */

// Tables and columns that the application code requires.
// If any are missing, routes will 500 at runtime.
const REQUIRED_SCHEMA: Array<{ table: string; columns: string[] }> = [
  { table: "actions", columns: ["id", "owner_user_id", "status", "agent_id", "action_type", "payload_json"] },
  { table: "api_keys", columns: ["id", "user_id", "key_hash", "revoked_at"] },
  { table: "cost_events", columns: ["id", "user_id", "cost_microdollars", "cost_breakdown"] },
  { table: "budgets", columns: ["id", "entity_type", "entity_id", "max_budget_microdollars"] },
  { table: "webhook_endpoints", columns: ["id", "user_id", "url", "signing_secret"] },
  { table: "webhook_deliveries", columns: ["id", "endpoint_id", "event_id"] },
  { table: "subscriptions", columns: ["id", "user_id", "stripe_customer_id"] },
  { table: "tool_costs", columns: ["id", "user_id", "server_name", "tool_name"] },
  { table: "slack_configs", columns: ["id", "user_id"] },
];

interface ComponentStatus {
  status: "ok" | "error";
  error?: string;
}

export async function GET(request: Request) {
  const verbose = new URL(request.url).searchParams.get("verbose") === "1";
  const components: Record<string, ComponentStatus> = {};

  // 1. Database connectivity
  try {
    const db = getDb();
    await db.execute(sql`SELECT 1`);
    components.database = { status: "ok" };
  } catch (err) {
    components.database = {
      status: "error",
      error: verbose
        ? (err instanceof Error ? err.message : "Database unreachable")
        : "unavailable",
    };
  }

  // 2. Schema completeness — single query, only if DB is reachable
  if (components.database.status === "ok") {
    try {
      const db = getDb();
      const missing = await checkSchema(db);
      if (missing.length === 0) {
        components.schema = { status: "ok" };
      } else {
        components.schema = {
          status: "error",
          error: verbose
            ? `Missing: ${missing.join(", ")}`
            : `${missing.length} missing schema elements`,
        };
      }
    } catch (err) {
      components.schema = {
        status: "error",
        error: verbose
          ? (err instanceof Error ? err.message : "Schema check failed")
          : "check failed",
      };
    }
  }

  // 3. Redis connectivity (rate limiter)
  if (
    process.env.UPSTASH_REDIS_REST_URL &&
    process.env.UPSTASH_REDIS_REST_TOKEN
  ) {
    try {
      const redis = getRedis();
      await redis.ping();
      components.redis = { status: "ok" };
    } catch (err) {
      components.redis = {
        status: "error",
        error: verbose
          ? (err instanceof Error ? err.message : "Redis unreachable")
          : "unavailable",
      };
    }
  } else {
    components.redis = { status: "ok" };
  }

  // 4. Dev mode check
  if (process.env.NULLSPEND_DEV_MODE === "true") {
    components.devMode = {
      status: "error",
      error: "NULLSPEND_DEV_MODE is enabled — auth bypass active",
    };
  }

  const allOk = Object.values(components).every((c) => c.status === "ok");
  const status = allOk ? "ok" : "degraded";

  // Public response is minimal; verbose response includes component detail
  const body = verbose
    ? { status, components }
    : { status };

  return Response.json(body, { status: allOk ? 200 : 503 });
}

// ---------------------------------------------------------------------------
// Redis singleton — avoids creating new clients per health check poll
// ---------------------------------------------------------------------------

let _redis: Redis | undefined;
function getRedis(): Redis {
  if (!_redis) {
    _redis = Redis.fromEnv();
  }
  return _redis;
}

/** @internal Reset singleton for testing only */
export function _resetRedisForTesting() {
  _redis = undefined;
}

// ---------------------------------------------------------------------------
// Schema verification — single query
// ---------------------------------------------------------------------------

async function checkSchema(db: ReturnType<typeof getDb>): Promise<string[]> {
  const tableNames = REQUIRED_SCHEMA.map((r) => r.table);

  // One query to get all columns for all required tables.
  // Build IN clause with individual parameters to avoid array serialization issues.
  const inClause = sql.join(
    tableNames.map((t) => sql`${t}`),
    sql`, `,
  );
  const result = await db.execute(sql`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN (${inClause})
  `);

  // Build a set of "table.column" strings from the DB
  const existing = new Set<string>();
  for (const row of result) {
    const r = row as { table_name: string; column_name: string };
    existing.add(`${r.table_name}.${r.column_name}`);
  }

  // Check each required element
  const missing: string[] = [];
  for (const { table, columns } of REQUIRED_SCHEMA) {
    // If no columns at all for this table, the table doesn't exist
    const hasAnyColumn = columns.some((c) => existing.has(`${table}.${c}`));
    if (!hasAnyColumn && columns.length > 0) {
      // Could be missing table or all checked columns — check if ANY row exists for the table
      const tableExists = [...existing].some((k) => k.startsWith(`${table}.`));
      if (!tableExists) {
        missing.push(`table:${table}`);
        continue;
      }
    }

    for (const col of columns) {
      if (!existing.has(`${table}.${col}`)) {
        missing.push(`${table}.${col}`);
      }
    }
  }

  return missing;
}
