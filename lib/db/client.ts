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
