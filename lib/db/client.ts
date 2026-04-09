import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

import * as schema from "@nullspend/db";
import { getEnv } from "@/lib/env";

declare global {
  var __nullspendSql: postgres.Sql | undefined;
}

function getSqlClient(): postgres.Sql {
  if (!globalThis.__nullspendSql) {
    globalThis.__nullspendSql = postgres(getEnv().DATABASE_URL, {
      // prepare: false + fetch_types: false are BOTH required for Supabase
      // Transaction mode pooler compatibility. Transaction mode doesn't support
      // long-lived session state, which breaks:
      //   - prepared statements (prepare: false disables them)
      //   - pg_type catalog introspection on first query
      //     (fetch_types: false skips it — built-in types like text[], int4[]
      //      still parse correctly via postgres.js defaults)
      //
      // Without fetch_types: false, the first parameterized query hangs or
      // errors because postgres.js tries to fetch pg_type OIDs over a
      // connection that's already been returned to the pool.
      //
      // Raw SQL queries like `db.execute(sql`SELECT 1`)` don't hit this because
      // they have no parameter types to introspect — which is why /api/health
      // passed but every drizzle query builder call 500'd silently until the
      // full /qa pass on 2026-04-08.
      //
      // Matches the proxy worker's apps/proxy/src/lib/db.ts config.
      prepare: false,
      fetch_types: false,
      max: 3,               // Serverless-friendly pool size (Supabase pooler has limits)
      idle_timeout: 20,     // Close idle connections after 20s
      connect_timeout: 10,  // Fail fast on connection issues
      transform: { undefined: null },        // drizzle undefined -> NULL
      connection: { statement_timeout: 10_000 }, // kill queries that hang > 10s
    });
  }

  return globalThis.__nullspendSql;
}

export function getDb() {
  return drizzle(getSqlClient(), { schema });
}

