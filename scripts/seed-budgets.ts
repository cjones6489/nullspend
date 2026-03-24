/**
 * Seeds 3 realistic budgets for the first user found in the system.
 * Creates additional API keys if needed to have enough entities.
 *
 * Usage:  pnpm tsx --env-file=.env.local scripts/seed-budgets.ts
 * Requires DATABASE_URL in .env.local
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql as dsql, isNull } from "drizzle-orm";
import * as schema from "../packages/db/src/schema";
import { generateRawKey, hashKey, extractPrefix } from "../lib/auth/api-key";

const { apiKeys, budgets } = schema;

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is not set. Add it to .env or .env.local");
    process.exit(1);
  }

  const sqlClient = postgres(databaseUrl, { prepare: false });
  const db = drizzle(sqlClient, { schema });

  const existingKeys = await db
    .select({ userId: apiKeys.userId, id: apiKeys.id, name: apiKeys.name })
    .from(apiKeys)
    .where(isNull(apiKeys.revokedAt));

  if (existingKeys.length === 0) {
    console.error("No API keys found. Create at least one API key first via the dashboard.");
    await sqlClient.end();
    process.exit(1);
  }

  const userId = existingKeys[0].userId;
  console.log(`Found user: ${userId}`);

  const keys = [...existingKeys];
  const seedKeyNames = ["Production Agent", "Staging Agent"];
  while (keys.length < 3) {
    const name = seedKeyNames[keys.length - 1] || `Seed Key ${keys.length}`;
    const rawKey = generateRawKey();
    const [newKey] = await db
      .insert(apiKeys)
      .values({
        userId,
        name,
        keyHash: hashKey(rawKey),
        keyPrefix: extractPrefix(rawKey),
      })
      .returning({ id: apiKeys.id, name: apiKeys.name, userId: apiKeys.userId });

    keys.push(newKey);
    console.log(`  Created seed API key: "${name}"`);
    console.log(`    Raw key: ${rawKey}`);
  }

  console.log(`Using ${keys.length} API key(s)`);

  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const seedBudgets = [
    {
      userId,
      entityType: "user",
      entityId: userId,
      maxBudgetMicrodollars: 50_000_000,
      spendMicrodollars: 15_000_000,
      resetInterval: "monthly",
      currentPeriodStart: periodStart,
      label: "User account — healthy (30%)",
    },
    {
      userId,
      entityType: "api_key",
      entityId: keys[1].id,
      maxBudgetMicrodollars: 20_000_000,
      spendMicrodollars: 15_000_000,
      resetInterval: "weekly",
      currentPeriodStart: periodStart,
      label: `API key "${keys[1].name}" — warning (75%)`,
    },
    {
      userId,
      entityType: "api_key",
      entityId: keys[2].id,
      maxBudgetMicrodollars: 100_000_000,
      spendMicrodollars: 92_000_000,
      resetInterval: "monthly",
      currentPeriodStart: periodStart,
      label: `API key "${keys[2].name}" — critical (92%)`,
    },
  ];

  for (const budget of seedBudgets) {
    const { label, ...values } = budget;
    await db
      .insert(budgets)
      .values(values)
      .onConflictDoUpdate({
        target: [budgets.userId, budgets.entityType, budgets.entityId],
        set: {
          maxBudgetMicrodollars: values.maxBudgetMicrodollars,
          spendMicrodollars: values.spendMicrodollars,
          resetInterval: values.resetInterval,
          currentPeriodStart: values.currentPeriodStart,
          updatedAt: dsql`NOW()`,
        },
      });

    console.log(`  Seeded: ${label}`);
  }

  console.log(`\nDone. Seeded ${seedBudgets.length} budget(s).`);
  await sqlClient.end();
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
