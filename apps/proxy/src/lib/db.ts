import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

/**
 * Module-level postgres.js instance.
 *
 * Replaces the per-query `new pg.Client()` + `connect()` + `end()` pattern
 * and the manual db-semaphore. postgres.js handles connection pooling internally
 * via the `max` setting (matches the 6-connection Workers limit with 1 headroom).
 *
 * The connectionString comes from env.HYPERDRIVE.connectionString which provides
 * connection pooling at the Cloudflare infrastructure level. postgres.js adds
 * application-level pooling on top.
 */
let _sql: ReturnType<typeof postgres> | null = null;
let _connStr: string | null = null;

export function getSql(connectionString: string): ReturnType<typeof postgres> {
  // Reuse if same connection string (normal case within a Worker isolate)
  if (_sql && _connStr === connectionString) {
    return _sql;
  }

  // Close old pool if connection string changed (defensive — unlikely in practice)
  if (_sql) {
    _sql.end({ timeout: 0 }).catch(() => {});
  }

  _sql = postgres(connectionString, {
    max: 5,              // matches old db-semaphore MAX_CONCURRENT; Workers have 6 connection limit
    idle_timeout: 20,    // seconds before idle connections are closed
    connect_timeout: 5,  // seconds to wait for connection
    prepare: false,      // required for Hyperdrive compatibility (PgBouncer-style pooling)
    fetch_types: false,  // skip pg_type catalog round-trip — no array types used
  });
  _connStr = connectionString;

  return _sql;
}

/**
 * Get a Drizzle ORM instance backed by the shared postgres.js pool.
 * Used by budget-spend, budget-do-lookup, and cost-logger for type-safe queries.
 */
export function getDb(connectionString: string) {
  return drizzle(getSql(connectionString));
}
