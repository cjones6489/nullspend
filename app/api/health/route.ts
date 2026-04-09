import { Redis } from "@upstash/redis";
import { sql, eq, asc } from "drizzle-orm";

import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { getDb } from "@/lib/db/client";
import { organizations, orgMemberships } from "@nullspend/db";

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

  // 2b. Parameterized drizzle query — exercises the exact failure path
  // that was breaking dashboard API routes on 2026-04-08 (P0-E). If the
  // raw SELECT 1 in check #1 works but this parameterized query fails,
  // we know the issue is postgres.js type introspection on parameters
  // rather than a connection problem. extractErrorDebug captures the
  // underlying postgres error code.
  if (components.database.status === "ok") {
    try {
      const db = getDb();
      // Intentionally parameterized query. eq() generates a placeholder
      // so postgres.js has to resolve the parameter type.
      await db
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.id, "00000000-0000-0000-0000-000000000000"))
        .limit(1);
      components.parameterized_query = { status: "ok" };
    } catch (err) {
      components.parameterized_query = {
        status: "error",
        error: verbose
          ? (err instanceof Error ? err.message : "Parameterized query failed")
          : "check failed",
        ...(verbose ? { debug: extractErrorDebug(err) } : {}),
      };
    }
  }

  // 2c. JOIN query — exactly mirrors /api/orgs query shape (inner join +
  // where on text userId + orderBy). If this fails when 2b passes, the
  // issue is with JOIN semantics, text parameter binding, or orderBy
  // rather than basic parameterized queries.
  if (components.database.status === "ok") {
    try {
      const db = getDb();
      await db
        .select({
          id: organizations.id,
          role: orgMemberships.role,
        })
        .from(orgMemberships)
        .innerJoin(organizations, eq(orgMemberships.orgId, organizations.id))
        .where(eq(orgMemberships.userId, "00000000-0000-0000-0000-000000000000"))
        .orderBy(asc(organizations.createdAt));
      components.join_query = { status: "ok" };
    } catch (err) {
      components.join_query = {
        status: "error",
        error: verbose
          ? (err instanceof Error ? err.message : "JOIN query failed")
          : "check failed",
        ...(verbose ? { debug: extractErrorDebug(err) } : {}),
      };
    }
  }

  // 2d. Transaction diagnostic — mirrors ensurePersonalOrg() which is hit
  // on first-login cold path in lib/auth/session.ts. Uses an empty
  // transaction that rolls back so it doesn't touch any real data.
  // If this fails, drizzle + Supabase Transaction pooler has issues with
  // db.transaction() specifically, not just parameterized queries.
  if (components.database.status === "ok") {
    try {
      const db = getDb();
      await db.transaction(async (tx) => {
        // Do a simple query inside the transaction — enough to exercise the
        // BEGIN/COMMIT flow without modifying any data.
        await tx.execute(sql`SELECT 1`);
        // No INSERT/UPDATE/DELETE — the transaction COMMITs cleanly with no
        // side effects. If drizzle or postgres.js has issues with the
        // transaction control wire protocol on the pooler, this fails.
      });
      components.transaction = { status: "ok" };
    } catch (err) {
      components.transaction = {
        status: "error",
        error: verbose
          ? (err instanceof Error ? err.message : "Transaction failed")
          : "check failed",
        ...(verbose ? { debug: extractErrorDebug(err) } : {}),
      };
    }
  }

  // 2e. INSERT inside transaction — mirrors ensurePersonalOrg() exactly.
  // Rolls back so no real data is created. If this fails when check 2d
  // (empty transaction) passes, the issue is specifically with INSERTs
  // in Supabase Shared Pooler — possibly RLS, triggers, or constraints.
  if (components.database.status === "ok") {
    try {
      const db = getDb();
      await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(organizations)
          .values({
            name: "__health_probe__",
            slug: `__health_probe_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
            isPersonal: false,
            createdBy: "00000000-0000-0000-0000-000000000000",
          })
          .returning({ id: organizations.id });

        await tx.insert(orgMemberships).values({
          orgId: created.id,
          userId: "00000000-0000-0000-0000-000000000000",
          role: "owner",
        });

        // Force rollback — we don't want to create real rows.
        throw new Error("__rollback_health_probe__");
      });
      // If we reach here, the throw was swallowed — unexpected.
      components.insert_transaction = {
        status: "error",
        error: "rollback did not throw",
      };
    } catch (err) {
      if (err instanceof Error && err.message === "__rollback_health_probe__") {
        // Expected — rollback succeeded
        components.insert_transaction = { status: "ok" };
      } else {
        components.insert_transaction = {
          status: "error",
          error: verbose
            ? (err instanceof Error ? err.message : "INSERT transaction failed")
            : "check failed",
          ...(verbose ? { debug: extractErrorDebug(err) } : {}),
        };
      }
    }
  }

  // 2f. Supabase auth layer — creates the server-side Supabase client and
  // calls auth.getUser() with whatever cookies are present (or none).
  // This exercises the exact path that /api/auth/session and
  // resolveSessionContext() hit first. If this fails while all DB checks
  // pass, the 500s are coming from the Supabase client layer, not from
  // drizzle.
  try {
    const supabase = await createServerSupabaseClient();
    const { error: authError } = await supabase.auth.getUser();
    // Missing session is expected for public health check hits — only
    // structural errors (env misconfig, client init failure, thrown
    // exceptions) are a problem.
    const isMissingSession =
      authError?.message === "Auth session missing!" ||
      authError?.name === "AuthSessionMissingError";
    if (!authError || isMissingSession) {
      components.supabase_auth = { status: "ok" };
    } else {
      components.supabase_auth = {
        status: "error",
        error: verbose ? authError.message : "supabase auth error",
        ...(verbose ? { debug: { name: authError.name, message: authError.message } } : {}),
      };
    }
  } catch (err) {
    components.supabase_auth = {
      status: "error",
      error: verbose
        ? (err instanceof Error ? err.message : "Supabase client init failed")
        : "check failed",
      ...(verbose ? { debug: extractErrorDebug(err) } : {}),
    };
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
