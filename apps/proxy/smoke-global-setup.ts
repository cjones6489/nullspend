/**
 * Global setup for smoke tests.
 *
 * Ensures a permanent "ceiling" budget exists for the smoke test API key
 * so the DO always has at least one budget entity to enforce against.
 *
 * The ceiling budget ($1B on api_key entity) never blocks requests —
 * individual tests create tighter user-entity budgets that actually
 * enforce. The ceiling budget is never deleted (survives teardown).
 */
import postgres from "postgres";

export async function setup() {
  const dbUrl = process.env.DATABASE_URL;
  const keyId = process.env.NULLSPEND_SMOKE_KEY_ID;
  if (!dbUrl || !keyId) return;

  const sql = postgres(dbUrl, { max: 1, idle_timeout: 5 });
  try {
    await sql`
      INSERT INTO budgets (entity_type, entity_id, max_budget_microdollars, spend_microdollars, policy)
      VALUES ('api_key', ${keyId}, 1000000000000, 0, 'strict_block')
      ON CONFLICT (entity_type, entity_id)
      DO UPDATE SET max_budget_microdollars = 1000000000000,
                    spend_microdollars = 0,
                    updated_at = NOW()
    `;
  } finally {
    await sql.end();
  }
}
