/**
 * Live OpenAI cost-tracking test.
 *
 * Makes a real API call to OpenAI, calculates the cost using our cost-engine,
 * inserts a cost event into the database, then verifies it was recorded.
 *
 * Usage:  pnpm tsx --env-file=.env.local scripts/live-openai-cost-test.ts
 *
 * Requires:
 *   - OPENAI_API_KEY in .env.local
 *   - DATABASE_URL in .env.local (Supabase)
 */
import crypto from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, isNull, desc } from "drizzle-orm";
import * as schema from "../packages/db/src/schema";
import { getModelPricing, costComponent } from "../packages/cost-engine/src/pricing";

const { apiKeys, costEvents } = schema;

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-4o-mini";
const MAX_TOKENS = 50;

interface OpenAIUsage {
  prompt_tokens: number;
  completion_tokens: number;
  prompt_tokens_details?: { cached_tokens?: number };
  completion_tokens_details?: { reasoning_tokens?: number };
  total_tokens: number;
}

interface OpenAIResponse {
  id: string;
  model: string;
  choices: { message: { role: string; content: string } }[];
  usage: OpenAIUsage;
}

async function main() {
  const openaiKey = process.env.OPENAI_API_KEY;
  const databaseUrl = process.env.DATABASE_URL;

  if (!openaiKey) {
    console.error("OPENAI_API_KEY is not set in .env.local");
    process.exit(1);
  }
  if (!databaseUrl) {
    console.error("DATABASE_URL is not set in .env.local");
    process.exit(1);
  }

  const sqlClient = postgres(databaseUrl, { prepare: false });
  const db = drizzle(sqlClient, { schema });

  // Find an existing API key to attribute the cost event to
  const existingKeys = await db
    .select({ userId: apiKeys.userId, id: apiKeys.id, name: apiKeys.name })
    .from(apiKeys)
    .where(isNull(apiKeys.revokedAt));

  if (existingKeys.length === 0) {
    console.error("No API keys found. Create at least one via the dashboard.");
    await sqlClient.end();
    process.exit(1);
  }

  const apiKey = existingKeys[0];
  console.log(`Using API key: "${apiKey.name}" (${apiKey.id.slice(0, 8)}...)`);
  console.log(`User ID: ${apiKey.userId}`);

  // --- Step 1: Make a real OpenAI API call ---
  console.log(`\n--- Step 1: Calling OpenAI (${MODEL}, max_tokens=${MAX_TOKENS}) ---`);
  const startTime = performance.now();

  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openaiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        {
          role: "user",
          content:
            "Say exactly: 'NullSpend live cost tracking test successful.' Nothing else.",
        },
      ],
      max_tokens: MAX_TOKENS,
    }),
  });

  const durationMs = Math.round(performance.now() - startTime);

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`OpenAI API error (${response.status}):`, errorBody);
    await sqlClient.end();
    process.exit(1);
  }

  const data: OpenAIResponse = await response.json();
  const usage = data.usage;

  console.log(`Response: "${data.choices[0].message.content}"`);
  console.log(`Model returned: ${data.model}`);
  console.log(`Duration: ${durationMs}ms`);
  console.log(`Tokens — input: ${usage.prompt_tokens}, output: ${usage.completion_tokens}, total: ${usage.total_tokens}`);

  // --- Step 2: Calculate cost using our cost-engine ---
  console.log("\n--- Step 2: Calculating cost via @nullspend/cost-engine ---");

  const pricing = getModelPricing("openai", MODEL);
  if (!pricing) {
    console.error(`No pricing data for openai/${MODEL}`);
    await sqlClient.end();
    process.exit(1);
  }

  const cachedInputTokens = usage.prompt_tokens_details?.cached_tokens ?? 0;
  const reasoningTokens = usage.completion_tokens_details?.reasoning_tokens ?? 0;
  const uncachedInputTokens = usage.prompt_tokens - cachedInputTokens;

  const inputCost = costComponent(uncachedInputTokens, pricing.inputPerMTok);
  const cachedCost = costComponent(cachedInputTokens, pricing.cachedInputPerMTok);
  const outputCost = costComponent(usage.completion_tokens, pricing.outputPerMTok);
  const totalCostMicrodollars = Math.round(inputCost + cachedCost + outputCost);

  console.log(`Pricing (per MTok): input=$${pricing.inputPerMTok}, cached=$${pricing.cachedInputPerMTok}, output=$${pricing.outputPerMTok}`);
  console.log(`Cached input tokens: ${cachedInputTokens}`);
  console.log(`Reasoning tokens: ${reasoningTokens}`);
  console.log(`Cost: ${totalCostMicrodollars} microdollars ($${(totalCostMicrodollars / 1_000_000).toFixed(6)})`);

  // --- Step 3: Insert cost event into database ---
  console.log("\n--- Step 3: Inserting cost event into Supabase ---");

  const requestId = data.id ?? crypto.randomUUID();

  const [inserted] = await db
    .insert(costEvents)
    .values({
      requestId,
      apiKeyId: apiKey.id,
      userId: apiKey.userId,
      provider: "openai",
      model: data.model,
      inputTokens: usage.prompt_tokens,
      outputTokens: usage.completion_tokens,
      cachedInputTokens,
      reasoningTokens,
      costMicrodollars: totalCostMicrodollars,
      durationMs,
      actionId: null,
    })
    .returning();

  console.log(`Inserted cost event: ${inserted.id}`);
  console.log(`Request ID: ${requestId}`);

  // --- Step 4: Verify the event can be read back ---
  console.log("\n--- Step 4: Verifying cost event in database ---");

  const [verified] = await db
    .select()
    .from(costEvents)
    .where(eq(costEvents.id, inserted.id));

  if (!verified) {
    console.error("FAILED: Could not read back the inserted cost event!");
    await sqlClient.end();
    process.exit(1);
  }

  console.log("Verified cost event:");
  console.log(`  ID:           ${verified.id}`);
  console.log(`  Provider:     ${verified.provider}`);
  console.log(`  Model:        ${verified.model}`);
  console.log(`  Input:        ${verified.inputTokens} tokens`);
  console.log(`  Output:       ${verified.outputTokens} tokens`);
  console.log(`  Cached:       ${verified.cachedInputTokens} tokens`);
  console.log(`  Reasoning:    ${verified.reasoningTokens} tokens`);
  console.log(`  Cost:         ${verified.costMicrodollars} µ$ ($${(verified.costMicrodollars / 1_000_000).toFixed(6)})`);
  console.log(`  Duration:     ${verified.durationMs}ms`);
  console.log(`  API Key:      ${verified.apiKeyId?.slice(0, 8)}...`);
  console.log(`  Created:      ${verified.createdAt.toISOString()}`);

  // --- Step 5: Check recent cost events count ---
  console.log("\n--- Step 5: Checking recent cost events ---");

  const recentEvents = await db
    .select()
    .from(costEvents)
    .where(eq(costEvents.userId, apiKey.userId))
    .orderBy(desc(costEvents.createdAt))
    .limit(5);

  console.log(`Recent cost events for this user: ${recentEvents.length}`);
  for (const e of recentEvents) {
    const isNew = e.id === inserted.id ? " <-- NEW" : "";
    console.log(
      `  ${e.model.padEnd(16)} ${String(e.costMicrodollars).padStart(8)} µ$  ${e.createdAt.toISOString()}${isNew}`,
    );
  }

  console.log("\n=== LIVE TEST PASSED === ");
  console.log("The cost event is now visible in your dashboard at /app/analytics");

  await sqlClient.end();
}

main().catch((err) => {
  console.error("Live test failed:", err);
  process.exit(1);
});
