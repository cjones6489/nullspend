import { Redis } from "@upstash/redis";
import { sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";

import { REQUIRED_SCHEMA } from "./required-schema";

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

// REQUIRED_SCHEMA lives in ./required-schema.ts so the test file can import it
// without pulling in the Next.js route handler. The regression test cross-checks
// it against the drizzle schema to prevent future drift.

interface ComponentStatus {
  status: "ok" | "error";
  error?: string;
  /** Additional debug context in verbose mode — underlying cause, postgres error code, etc. */
  debug?: Record<string, unknown>;
}

/**
 * Extract full debug context from an error — message, name, cause chain,
 * and postgres.js-specific fields (code, severity, detail, hint, position).
 * Used in verbose mode to diagnose DB connectivity issues in production
 * without having to tail logs or redeploy.
 */
function extractErrorDebug(err: unknown): Record<string, unknown> {
  if (!(err instanceof Error)) return { raw: String(err) };
  const debug: Record<string, unknown> = {
    name: err.name,
    message: err.message,
  };
  // postgres.js / libpq error fields
  const e = err as Error & {
    code?: string;
    severity?: string;
    detail?: string;
    hint?: string;
    position?: string;
    routine?: string;
    address?: string;
    port?: number;
    syscall?: string;
    errno?: number;
  };
  if (e.code) debug.code = e.code;
  if (e.severity) debug.severity = e.severity;
  if (e.detail) debug.detail = e.detail;
  if (e.hint) debug.hint = e.hint;
  if (e.routine) debug.routine = e.routine;
  if (e.address) debug.address = e.address;
  if (e.port) debug.port = e.port;
  if (e.syscall) debug.syscall = e.syscall;
  if (e.errno) debug.errno = e.errno;
  // Node error cause chain (AggregateError / ES2022 Error cause)
  if (err.cause !== undefined) {
    debug.cause = extractErrorDebug(err.cause);
  }
  return debug;
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
      ...(verbose ? { debug: extractErrorDebug(err) } : {}),
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
