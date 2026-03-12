/**
 * Idempotent migration: ensures slack_user_id column exists on slack_configs.
 *
 * Usage:  pnpm tsx --env-file=.env.local scripts/migrate-add-slack-user-id.ts
 */
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const pg = postgres(databaseUrl);

async function run() {
  await pg.unsafe(
    `ALTER TABLE "slack_configs" ADD COLUMN IF NOT EXISTS "slack_user_id" text;`,
  );
  console.log("Done. slack_user_id column ensured on slack_configs.");
  await pg.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
