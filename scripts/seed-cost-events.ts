/**
 * Seeds 25-30 realistic cost events for the first user found in the system.
 * Uses actual pricing data from the cost engine for accurate costs.
 *
 * Usage:  pnpm tsx --env-file=.env.local scripts/seed-cost-events.ts
 * Requires DATABASE_URL in .env.local
 */
import crypto from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { inArray, isNull } from "drizzle-orm";
import * as schema from "../packages/db/src/schema";

const { actions, apiKeys, costEvents } = schema;

interface ModelProfile {
  model: string;
  inputPerMTok: number;
  cachedInputPerMTok: number;
  outputPerMTok: number;
  inputRange: [number, number];
  outputRange: [number, number];
  cacheChance: number;
  reasoningChance: number;
  durationRange: [number, number];
}

const MODEL_PROFILES: ModelProfile[] = [
  {
    model: "gpt-4o",
    inputPerMTok: 2.5,
    cachedInputPerMTok: 1.25,
    outputPerMTok: 10.0,
    inputRange: [500, 4000],
    outputRange: [100, 1500],
    cacheChance: 0.3,
    reasoningChance: 0,
    durationRange: [800, 4000],
  },
  {
    model: "gpt-4o-mini",
    inputPerMTok: 0.15,
    cachedInputPerMTok: 0.075,
    outputPerMTok: 0.6,
    inputRange: [1000, 5000],
    outputRange: [200, 2000],
    cacheChance: 0.25,
    reasoningChance: 0,
    durationRange: [500, 2000],
  },
  {
    model: "gpt-4.1",
    inputPerMTok: 2.0,
    cachedInputPerMTok: 0.5,
    outputPerMTok: 8.0,
    inputRange: [300, 3000],
    outputRange: [100, 1200],
    cacheChance: 0.35,
    reasoningChance: 0,
    durationRange: [700, 3500],
  },
  {
    model: "o3-mini",
    inputPerMTok: 1.1,
    cachedInputPerMTok: 0.55,
    outputPerMTok: 4.4,
    inputRange: [800, 3500],
    outputRange: [400, 1800],
    cacheChance: 0.2,
    reasoningChance: 0.8,
    durationRange: [2000, 8000],
  },
];

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickModel(): ModelProfile {
  const r = Math.random();
  if (r < 0.4) return MODEL_PROFILES[0]; // gpt-4o 40%
  if (r < 0.7) return MODEL_PROFILES[1]; // gpt-4o-mini 30%
  if (r < 0.85) return MODEL_PROFILES[2]; // gpt-4.1 15%
  return MODEL_PROFILES[3]; // o3-mini 15%
}

function computeCostMicrodollars(
  profile: ModelProfile,
  inputTokens: number,
  cachedInputTokens: number,
  outputTokens: number,
): number {
  const uncachedInput = inputTokens - cachedInputTokens;
  const inputCost = (uncachedInput / 1_000_000) * profile.inputPerMTok;
  const cachedCost =
    (cachedInputTokens / 1_000_000) * profile.cachedInputPerMTok;
  const outputCost = (outputTokens / 1_000_000) * profile.outputPerMTok;
  return Math.round((inputCost + cachedCost + outputCost) * 1_000_000);
}

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
    console.error(
      "No API keys found. Create at least one API key first via the dashboard.",
    );
    await sqlClient.end();
    process.exit(1);
  }

  const userId = existingKeys[0].userId;
  console.log(`Found user: ${userId} with ${existingKeys.length} key(s)`);

  const eligibleActions = await db
    .select({ id: actions.id })
    .from(actions)
    .where(inArray(actions.status, ["executed", "failed"]));

  if (eligibleActions.length === 0) {
    console.log(
      "Warning: No executed/failed actions found — seeding cost events without action correlation. Create actions first via the SDK to test the CostCard.",
    );
  } else {
    console.log(`Found ${eligibleActions.length} executed/failed action(s) for correlation`);
  }

  // Clear old seed data before re-seeding
  const deleted = await db.delete(costEvents);
  console.log(`Cleared ${deleted.length} existing cost event(s)`);

  const eventCount = randInt(80, 120);
  const now = Date.now();
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

  const events = Array.from({ length: eventCount }, () => {
    const profile = pickModel();
    const inputTokens = randInt(...profile.inputRange);
    const outputTokens = randInt(...profile.outputRange);

    const cachedInputTokens =
      Math.random() < profile.cacheChance
        ? randInt(
            Math.floor(inputTokens * 0.3),
            Math.floor(inputTokens * 0.5),
          )
        : 0;

    const reasoningTokens =
      Math.random() < profile.reasoningChance
        ? randInt(
            Math.floor(outputTokens * 0.2),
            Math.floor(outputTokens * 0.4),
          )
        : 0;

    const costMicro = computeCostMicrodollars(
      profile,
      inputTokens,
      cachedInputTokens,
      outputTokens,
    );
    const durationMs = randInt(...profile.durationRange);
    const createdAt = new Date(now - randInt(0, thirtyDaysMs));
    const apiKey = existingKeys[randInt(0, existingKeys.length - 1)];

    let actionId: string | null = null;
    if (eligibleActions.length > 0 && Math.random() < 0.35) {
      actionId =
        eligibleActions[randInt(0, eligibleActions.length - 1)].id;
    }

    return {
      requestId: crypto.randomUUID(),
      apiKeyId: apiKey.id,
      userId,
      provider: "openai" as const,
      model: profile.model,
      inputTokens,
      outputTokens,
      cachedInputTokens,
      reasoningTokens,
      costMicrodollars: costMicro,
      durationMs,
      actionId,
      createdAt,
    };
  });

  events.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  for (const event of events) {
    await db
      .insert(costEvents)
      .values(event)
      .onConflictDoNothing({
        target: [costEvents.requestId, costEvents.provider],
      });
  }

  console.log(`\nDone. Seeded ${events.length} cost event(s).`);
  const correlated = events.filter((e) => e.actionId !== null).length;
  console.log(`Action-correlated: ${correlated} / ${events.length}`);
  console.log("Models used:");
  const modelCounts = new Map<string, number>();
  for (const e of events) {
    modelCounts.set(e.model, (modelCounts.get(e.model) ?? 0) + 1);
  }
  for (const [model, count] of modelCounts) {
    console.log(`  ${model}: ${count}`);
  }

  await sqlClient.end();
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
