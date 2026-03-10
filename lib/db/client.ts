import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

import * as schema from "@agentseam/db";

declare global {
  var __agentseamSql: postgres.Sql | undefined;
}

function getDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is not set. Point it at your Supabase Postgres connection string.",
    );
  }

  return databaseUrl;
}

function getSqlClient(): postgres.Sql {
  if (!globalThis.__agentseamSql) {
    globalThis.__agentseamSql = postgres(getDatabaseUrl(), {
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
