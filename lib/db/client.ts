import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

import * as schema from "@agentseam/db";
import { getEnv } from "@/lib/env";

declare global {
  var __agentseamSql: postgres.Sql | undefined;
}

function getSqlClient(): postgres.Sql {
  if (!globalThis.__agentseamSql) {
    globalThis.__agentseamSql = postgres(getEnv().DATABASE_URL, {
      prepare: false,
    });
  }

  return globalThis.__agentseamSql;
}

export function getDb() {
  return drizzle(getSqlClient(), { schema });
}

export async function closeDbConnection() {
  if (!globalThis.__agentseamSql) {
    return;
  }

  await globalThis.__agentseamSql.end();
  globalThis.__agentseamSql = undefined;
}
