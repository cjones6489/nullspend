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
      prepare: false,
      max: 3,               // Serverless-friendly pool size (Supabase pooler has limits)
      idle_timeout: 20,     // Close idle connections after 20s
      connect_timeout: 10,  // Fail fast on connection issues
    });
  }

  return globalThis.__nullspendSql;
}

export function getDb() {
  return drizzle(getSqlClient(), { schema });
}

export async function closeDbConnection() {
  if (!globalThis.__nullspendSql) {
    return;
  }

  await globalThis.__nullspendSql.end();
  globalThis.__nullspendSql = undefined;
}
