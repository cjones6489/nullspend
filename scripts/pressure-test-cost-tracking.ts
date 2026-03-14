/**
 * Comprehensive pressure test for the NullSpend cost-tracking pipeline.
 *
 * Tests:
 *  1. Multi-model live calls (gpt-4o-mini, gpt-4.1-nano, gpt-4o, o4-mini)
 *  2. Math verification — hand-computed expected costs vs actual
 *  3. Streaming vs non-streaming responses
 *  4. Reasoning token tracking (o4-mini)
 *  5. Cached token detection (duplicate prompt)
 *  6. Large token volume
 *  7. Cost-engine edge cases (zero tokens, unknown model)
 *  8. Aggregation verification — DB totals match sum of inserted events
 *  9. Date serialization round-trip
 * 10. Concurrent requests (parallel model calls)
 *
 * Usage:  pnpm tsx --env-file=.env.local scripts/pressure-test-cost-tracking.ts
 */
import crypto from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, isNull, inArray, gte, desc, sql } from "drizzle-orm";
import * as schema from "../packages/db/src/schema";
import {
  getModelPricing,
  costComponent,
  isKnownModel,
} from "../packages/cost-engine/src/pricing";

const { apiKeys, costEvents } = schema;

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

// ────────────────────────────────────────────────
// Test infrastructure
// ────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, label: string) {
  if (condition) {
    passed++;
    console.log(`  [PASS] ${label}`);
  } else {
    failed++;
    failures.push(label);
    console.log(`  [FAIL] ${label}`);
  }
}

function assertApprox(actual: number, expected: number, tolerance: number, label: string) {
  const diff = Math.abs(actual - expected);
  if (diff <= tolerance) {
    passed++;
    console.log(`  [PASS] ${label} (actual=${actual}, expected=${expected}, diff=${diff})`);
  } else {
    failed++;
    failures.push(`${label} (actual=${actual}, expected=${expected}, diff=${diff})`);
    console.log(`  [FAIL] ${label} (actual=${actual}, expected=${expected}, diff=${diff})`);
  }
}

// ────────────────────────────────────────────────
// OpenAI helpers
// ────────────────────────────────────────────────

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

async function callOpenAI(
  apiKey: string,
  model: string,
  prompt: string,
  options: {
    maxTokens?: number;
    stream?: boolean;
    isReasoning?: boolean;
  } = {},
): Promise<{ response: OpenAIResponse; durationMs: number }> {
  const body: Record<string, unknown> = {
    model,
    messages: [{ role: "user", content: prompt }],
  };

  if (options.isReasoning) {
    body.max_completion_tokens = options.maxTokens ?? 100;
  } else {
    body.max_tokens = options.maxTokens ?? 50;
  }

  if (options.stream) {
    body.stream = true;
    body.stream_options = { include_usage: true };
  }

  const startTime = performance.now();
  const res = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`OpenAI ${res.status}: ${errorBody}`);
  }

  let data: OpenAIResponse;
  const durationMs = Math.round(performance.now() - startTime);

  if (options.stream) {
    data = await parseStreamResponse(res);
  } else {
    data = await res.json();
  }

  return { response: data, durationMs };
}

async function parseStreamResponse(res: Response): Promise<OpenAIResponse> {
  const text = await res.text();
  const lines = text.split("\n").filter((l) => l.startsWith("data: "));

  let lastData: OpenAIResponse | null = null;
  let content = "";

  for (const line of lines) {
    const jsonStr = line.slice(6).trim();
    if (jsonStr === "[DONE]") continue;
    try {
      const chunk = JSON.parse(jsonStr);
      if (chunk.choices?.[0]?.delta?.content) {
        content += chunk.choices[0].delta.content;
      }
      if (chunk.usage) {
        lastData = {
          id: chunk.id,
          model: chunk.model,
          choices: [{ message: { role: "assistant", content } }],
          usage: chunk.usage,
        };
      }
    } catch { /* skip malformed chunks */ }
  }

  if (!lastData) throw new Error("No usage data in stream response");
  return lastData;
}

function computeCost(
  model: string,
  usage: OpenAIUsage,
): { costMicrodollars: number; pricing: ReturnType<typeof getModelPricing> } {
  const pricing = getModelPricing("openai", model);
  if (!pricing) return { costMicrodollars: 0, pricing: null };

  const cachedTokens = usage.prompt_tokens_details?.cached_tokens ?? 0;
  const uncached = usage.prompt_tokens - cachedTokens;

  const costMicrodollars = Math.round(
    costComponent(uncached, pricing.inputPerMTok) +
    costComponent(cachedTokens, pricing.cachedInputPerMTok) +
    costComponent(usage.completion_tokens, pricing.outputPerMTok),
  );

  return { costMicrodollars, pricing };
}

// ────────────────────────────────────────────────
// Test functions
// ────────────────────────────────────────────────

interface TestContext {
  openaiKey: string;
  db: ReturnType<typeof drizzle>;
  apiKeyId: string;
  userId: string;
  insertedIds: string[];
}

async function testMultiModelCalls(ctx: TestContext) {
  console.log("\n════════════════════════════════════════");
  console.log("TEST 1: Multi-Model Live Calls");
  console.log("════════════════════════════════════════");

  const models = [
    { name: "gpt-4o-mini", maxTokens: 30 },
    { name: "gpt-4.1-nano", maxTokens: 30 },
    { name: "gpt-4o", maxTokens: 30 },
    { name: "gpt-4.1-mini", maxTokens: 30 },
  ];

  for (const { name, maxTokens } of models) {
    console.log(`\n  Calling ${name}...`);
    try {
      const { response, durationMs } = await callOpenAI(
        ctx.openaiKey,
        name,
        `Reply with exactly: "Model ${name} test OK." Nothing else.`,
        { maxTokens },
      );

      const { costMicrodollars } = computeCost(name, response.usage);

      assert(response.usage.prompt_tokens > 0, `${name}: has prompt tokens`);
      assert(response.usage.completion_tokens > 0, `${name}: has completion tokens`);
      assert(costMicrodollars > 0, `${name}: cost > 0 (${costMicrodollars} µ$)`);
      assert(durationMs > 0, `${name}: duration > 0 (${durationMs}ms)`);

      const [inserted] = await ctx.db
        .insert(costEvents)
        .values({
          requestId: response.id ?? crypto.randomUUID(),
          apiKeyId: ctx.apiKeyId,
          userId: ctx.userId,
          provider: "openai",
          model: response.model,
          inputTokens: response.usage.prompt_tokens,
          outputTokens: response.usage.completion_tokens,
          cachedInputTokens: response.usage.prompt_tokens_details?.cached_tokens ?? 0,
          reasoningTokens: response.usage.completion_tokens_details?.reasoning_tokens ?? 0,
          costMicrodollars,
          durationMs,
          actionId: null,
        })
        .returning();

      ctx.insertedIds.push(inserted.id);
      assert(!!inserted.id, `${name}: DB insert succeeded`);

      console.log(
        `    ${response.usage.prompt_tokens}in/${response.usage.completion_tokens}out = ${costMicrodollars}µ$ in ${durationMs}ms`,
      );
    } catch (err) {
      assert(false, `${name}: API call failed — ${(err as Error).message}`);
    }
  }
}

async function testMathVerification(ctx: TestContext) {
  console.log("\n════════════════════════════════════════");
  console.log("TEST 2: Cost Math Verification");
  console.log("════════════════════════════════════════");

  const scenarios = [
    {
      label: "gpt-4o: 1000 input, 500 output, 0 cached",
      model: "gpt-4o",
      input: 1000, output: 500, cached: 0,
      expected: Math.round(
        1000 * 2.50 + // input
        0 * 1.25 +    // cached
        500 * 10.00,  // output
      ),
    },
    {
      label: "gpt-4o-mini: 5000 input, 2000 output, 1000 cached",
      model: "gpt-4o-mini",
      input: 5000, output: 2000, cached: 1000,
      expected: Math.round(
        4000 * 0.15 +  // uncached input
        1000 * 0.075 + // cached
        2000 * 0.60,   // output
      ),
    },
    {
      label: "o3-mini: 800 input, 1200 output, 200 cached",
      model: "o3-mini",
      input: 800, output: 1200, cached: 200,
      expected: Math.round(
        600 * 1.10 +  // uncached
        200 * 0.55 +  // cached
        1200 * 4.40,  // output
      ),
    },
    {
      label: "gpt-4.1-nano: 10000 input, 5000 output, 3000 cached",
      model: "gpt-4.1-nano",
      input: 10000, output: 5000, cached: 3000,
      expected: Math.round(
        7000 * 0.10 +   // uncached
        3000 * 0.025 +  // cached
        5000 * 0.40,    // output
      ),
    },
    {
      label: "o1: 100 input, 50 output, 0 cached (premium model)",
      model: "o1",
      input: 100, output: 50, cached: 0,
      expected: Math.round(
        100 * 15.00 + // input
        0 * 7.50 +    // cached
        50 * 60.00,   // output
      ),
    },
    {
      label: "gpt-4o-mini: 1 input, 1 output (minimum tokens)",
      model: "gpt-4o-mini",
      input: 1, output: 1, cached: 0,
      expected: Math.round(
        1 * 0.15 +   // input
        1 * 0.60,    // output
      ),
    },
    {
      label: "gpt-4o: 1000000 input, 500000 output (max volume)",
      model: "gpt-4o",
      input: 1_000_000, output: 500_000, cached: 0,
      expected: Math.round(
        1_000_000 * 2.50 +   // input
        500_000 * 10.00,     // output
      ),
    },
  ];

  for (const s of scenarios) {
    const usage: OpenAIUsage = {
      prompt_tokens: s.input,
      completion_tokens: s.output,
      prompt_tokens_details: s.cached > 0 ? { cached_tokens: s.cached } : undefined,
      total_tokens: s.input + s.output,
    };
    const { costMicrodollars } = computeCost(s.model, usage);
    assertApprox(costMicrodollars, s.expected, 1, s.label);
  }
}

async function testStreaming(ctx: TestContext) {
  console.log("\n════════════════════════════════════════");
  console.log("TEST 3: Streaming vs Non-Streaming");
  console.log("════════════════════════════════════════");

  const prompt = "Count from 1 to 5, comma separated. Nothing else.";

  console.log("  Calling gpt-4o-mini (non-streaming)...");
  const { response: nonStream, durationMs: nsDur } = await callOpenAI(
    ctx.openaiKey,
    "gpt-4o-mini",
    prompt,
    { maxTokens: 30, stream: false },
  );

  console.log("  Calling gpt-4o-mini (streaming)...");
  const { response: stream, durationMs: sDur } = await callOpenAI(
    ctx.openaiKey,
    "gpt-4o-mini",
    prompt,
    { maxTokens: 30, stream: true },
  );

  assert(nonStream.usage.prompt_tokens > 0, "Non-streaming: has prompt tokens");
  assert(stream.usage.prompt_tokens > 0, "Streaming: has prompt tokens");
  assert(nonStream.usage.completion_tokens > 0, "Non-streaming: has completion tokens");
  assert(stream.usage.completion_tokens > 0, "Streaming: has completion tokens");

  const nsCost = computeCost("gpt-4o-mini", nonStream.usage).costMicrodollars;
  const sCost = computeCost("gpt-4o-mini", stream.usage).costMicrodollars;

  assert(nsCost > 0, `Non-streaming cost: ${nsCost}µ$`);
  assert(sCost > 0, `Streaming cost: ${sCost}µ$`);

  // Same prompt → similar token counts (within ±50% since output may vary)
  const promptDiff = Math.abs(nonStream.usage.prompt_tokens - stream.usage.prompt_tokens);
  assert(promptDiff <= 5, `Prompt tokens similar (diff=${promptDiff})`);

  // Insert both
  for (const [label, resp, dur] of [
    ["non-stream", nonStream, nsDur],
    ["stream", stream, sDur],
  ] as const) {
    const cost = computeCost("gpt-4o-mini", resp.usage).costMicrodollars;
    const [ins] = await ctx.db
      .insert(costEvents)
      .values({
        requestId: resp.id ?? crypto.randomUUID(),
        apiKeyId: ctx.apiKeyId,
        userId: ctx.userId,
        provider: "openai",
        model: resp.model,
        inputTokens: resp.usage.prompt_tokens,
        outputTokens: resp.usage.completion_tokens,
        cachedInputTokens: resp.usage.prompt_tokens_details?.cached_tokens ?? 0,
        reasoningTokens: resp.usage.completion_tokens_details?.reasoning_tokens ?? 0,
        costMicrodollars: cost,
        durationMs: dur,
        actionId: null,
      })
      .returning();
    ctx.insertedIds.push(ins.id);
    assert(!!ins.id, `${label}: inserted to DB`);
  }

  console.log(`  Non-stream: "${nonStream.choices[0].message.content}" (${nsDur}ms)`);
  console.log(`  Stream:     "${stream.choices[0].message.content}" (${sDur}ms)`);
}

async function testReasoningTokens(ctx: TestContext) {
  console.log("\n════════════════════════════════════════");
  console.log("TEST 4: Reasoning Token Tracking (o4-mini)");
  console.log("════════════════════════════════════════");

  try {
    console.log("  Calling o4-mini with reasoning task...");
    const { response, durationMs } = await callOpenAI(
      ctx.openaiKey,
      "o4-mini",
      "What is 17 * 23? Reply with just the number.",
      { maxTokens: 256, isReasoning: true },
    );

    const reasoningTokens =
      response.usage.completion_tokens_details?.reasoning_tokens ?? 0;

    assert(response.usage.prompt_tokens > 0, "o4-mini: has prompt tokens");
    assert(response.usage.completion_tokens > 0, "o4-mini: has completion tokens");
    assert(reasoningTokens > 0, `o4-mini: has reasoning tokens (${reasoningTokens})`);
    assert(
      reasoningTokens <= response.usage.completion_tokens,
      "o4-mini: reasoning tokens <= completion tokens",
    );

    const { costMicrodollars } = computeCost("o4-mini", response.usage);
    assert(costMicrodollars > 0, `o4-mini: cost > 0 (${costMicrodollars}µ$)`);

    const [ins] = await ctx.db
      .insert(costEvents)
      .values({
        requestId: response.id ?? crypto.randomUUID(),
        apiKeyId: ctx.apiKeyId,
        userId: ctx.userId,
        provider: "openai",
        model: response.model,
        inputTokens: response.usage.prompt_tokens,
        outputTokens: response.usage.completion_tokens,
        cachedInputTokens: response.usage.prompt_tokens_details?.cached_tokens ?? 0,
        reasoningTokens,
        costMicrodollars,
        durationMs,
        actionId: null,
      })
      .returning();
    ctx.insertedIds.push(ins.id);
    assert(!!ins.id, "o4-mini: DB insert succeeded");

    console.log(
      `    Answer: "${response.choices[0].message.content}", reasoning=${reasoningTokens} tokens, cost=${costMicrodollars}µ$`,
    );
  } catch (err) {
    assert(false, `o4-mini: failed — ${(err as Error).message}`);
  }
}

async function testCachedTokens(ctx: TestContext) {
  console.log("\n════════════════════════════════════════");
  console.log("TEST 5: Cached Token Detection");
  console.log("════════════════════════════════════════");

  const longPrompt =
    "You are a helpful assistant. " +
    "This is a test of the NullSpend cost tracking system. ".repeat(20) +
    "What is 2 + 2?";

  console.log("  Call 1 (cold)...");
  const { response: r1 } = await callOpenAI(ctx.openaiKey, "gpt-4o-mini", longPrompt, {
    maxTokens: 10,
  });
  const cached1 = r1.usage.prompt_tokens_details?.cached_tokens ?? 0;
  console.log(`    Prompt tokens: ${r1.usage.prompt_tokens}, cached: ${cached1}`);

  console.log("  Call 2 (warm — same prompt)...");
  const { response: r2 } = await callOpenAI(ctx.openaiKey, "gpt-4o-mini", longPrompt, {
    maxTokens: 10,
  });
  const cached2 = r2.usage.prompt_tokens_details?.cached_tokens ?? 0;
  console.log(`    Prompt tokens: ${r2.usage.prompt_tokens}, cached: ${cached2}`);

  assert(
    r1.usage.prompt_tokens === r2.usage.prompt_tokens,
    "Same prompt → same prompt token count",
  );

  // Cached tokens may or may not appear depending on OpenAI's caching behavior.
  // We verify the field is tracked regardless.
  const cost1 = computeCost("gpt-4o-mini", r1.usage).costMicrodollars;
  const cost2 = computeCost("gpt-4o-mini", r2.usage).costMicrodollars;

  assert(cost1 > 0, `Call 1 cost: ${cost1}µ$`);
  assert(cost2 > 0, `Call 2 cost: ${cost2}µ$`);

  if (cached2 > 0) {
    assert(cost2 <= cost1, "Cached call should be same or cheaper");
    console.log("  Cache hit detected — cost reduction confirmed!");
  } else {
    console.log("  No cache hit (OpenAI caching is opportunistic) — tracking logic verified.");
  }

  // Verify cost-engine correctly discounts cached tokens
  const pricingMini = getModelPricing("openai", "gpt-4o-mini")!;
  const syntheticCostFull = Math.round(
    costComponent(500, pricingMini.inputPerMTok) +
    costComponent(0, pricingMini.cachedInputPerMTok) +
    costComponent(100, pricingMini.outputPerMTok),
  );
  const syntheticCostCached = Math.round(
    costComponent(250, pricingMini.inputPerMTok) +
    costComponent(250, pricingMini.cachedInputPerMTok) +
    costComponent(100, pricingMini.outputPerMTok),
  );
  assert(
    syntheticCostCached < syntheticCostFull,
    `Cache discount math: full=${syntheticCostFull}µ$ > cached=${syntheticCostCached}µ$`,
  );
}

async function testLargeTokenVolume(ctx: TestContext) {
  console.log("\n════════════════════════════════════════");
  console.log("TEST 6: Large Token Volume");
  console.log("════════════════════════════════════════");

  const bigPrompt =
    "Summarize the following text in exactly one sentence:\n\n" +
    "The quick brown fox jumped over the lazy dog. ".repeat(100) +
    "\n\nSummary:";

  console.log("  Calling gpt-4o-mini with large prompt...");
  const { response, durationMs } = await callOpenAI(
    ctx.openaiKey,
    "gpt-4o-mini",
    bigPrompt,
    { maxTokens: 100 },
  );

  assert(response.usage.prompt_tokens > 500, `Large prompt tokens: ${response.usage.prompt_tokens}`);
  assert(response.usage.completion_tokens > 0, `Large output tokens: ${response.usage.completion_tokens}`);

  const { costMicrodollars } = computeCost("gpt-4o-mini", response.usage);
  assert(costMicrodollars > 0, `Large volume cost: ${costMicrodollars}µ$`);

  // Manual verification
  const cachedTokens = response.usage.prompt_tokens_details?.cached_tokens ?? 0;
  const uncached = response.usage.prompt_tokens - cachedTokens;
  const pricing = getModelPricing("openai", "gpt-4o-mini")!;
  const expectedCost = Math.round(
    costComponent(uncached, pricing.inputPerMTok) +
    costComponent(cachedTokens, pricing.cachedInputPerMTok) +
    costComponent(response.usage.completion_tokens, pricing.outputPerMTok),
  );
  assertApprox(costMicrodollars, expectedCost, 1, "Large volume math matches manual calc");

  const [ins] = await ctx.db
    .insert(costEvents)
    .values({
      requestId: response.id ?? crypto.randomUUID(),
      apiKeyId: ctx.apiKeyId,
      userId: ctx.userId,
      provider: "openai",
      model: response.model,
      inputTokens: response.usage.prompt_tokens,
      outputTokens: response.usage.completion_tokens,
      cachedInputTokens: cachedTokens,
      reasoningTokens: response.usage.completion_tokens_details?.reasoning_tokens ?? 0,
      costMicrodollars,
      durationMs,
      actionId: null,
    })
    .returning();
  ctx.insertedIds.push(ins.id);

  console.log(`    ${response.usage.prompt_tokens}in/${response.usage.completion_tokens}out = ${costMicrodollars}µ$ in ${durationMs}ms`);
}

async function testCostEngineEdgeCases() {
  console.log("\n════════════════════════════════════════");
  console.log("TEST 7: Cost-Engine Edge Cases");
  console.log("════════════════════════════════════════");

  assert(costComponent(0, 2.50) === 0, "Zero tokens → zero cost");
  assert(costComponent(100, 0) === 0, "Zero rate → zero cost");
  assert(costComponent(-10, 2.50) === 0, "Negative tokens → zero cost");
  assert(costComponent(100, -1.0) === 0, "Negative rate → zero cost");
  assert(costComponent(1, 0.15) > 0, "1 token at min rate → nonzero");

  // Unknown model returns null pricing
  assert(getModelPricing("openai", "nonexistent-model") === null, "Unknown model → null pricing");
  assert(getModelPricing("unknown-provider", "gpt-4o") === null, "Unknown provider → null pricing");
  assert(isKnownModel("openai", "gpt-4o") === true, "isKnownModel: gpt-4o = true");
  assert(isKnownModel("openai", "gpt-4o-mini") === true, "isKnownModel: gpt-4o-mini = true");
  assert(isKnownModel("openai", "nonexistent") === false, "isKnownModel: nonexistent = false");
  assert(isKnownModel("anthropic", "claude-sonnet-4-6") === true, "isKnownModel: claude-sonnet-4-6 = true");
  assert(isKnownModel("google", "gemini-2.5-flash") === true, "isKnownModel: gemini-2.5-flash = true");

  // Verify all catalog models have non-zero pricing
  const catalogModels = [
    "openai/gpt-4o", "openai/gpt-4o-mini", "openai/gpt-4.1",
    "openai/gpt-4.1-mini", "openai/gpt-4.1-nano", "openai/o4-mini",
    "openai/o3", "openai/o3-mini", "openai/o1",
    "anthropic/claude-sonnet-4-6", "anthropic/claude-haiku-3.5",
    "anthropic/claude-opus-4", "google/gemini-2.5-pro", "google/gemini-2.5-flash",
  ];

  for (const key of catalogModels) {
    const [provider, model] = key.split("/");
    const pricing = getModelPricing(provider, model);
    assert(pricing !== null, `Pricing exists: ${key}`);
    if (pricing) {
      assert(pricing.inputPerMTok > 0, `${key}: inputPerMTok > 0`);
      assert(pricing.outputPerMTok > 0, `${key}: outputPerMTok > 0`);
      assert(pricing.cachedInputPerMTok > 0, `${key}: cachedInputPerMTok > 0`);
      assert(
        pricing.cachedInputPerMTok <= pricing.inputPerMTok,
        `${key}: cached rate <= full rate`,
      );
    }
  }
}

async function testAggregationVerification(ctx: TestContext) {
  console.log("\n════════════════════════════════════════");
  console.log("TEST 8: Aggregation Verification");
  console.log("════════════════════════════════════════");

  if (ctx.insertedIds.length === 0) {
    console.log("  Skipping — no events inserted");
    return;
  }

  const inserted = await ctx.db
    .select()
    .from(costEvents)
    .where(inArray(costEvents.id, ctx.insertedIds));

  assert(
    inserted.length === ctx.insertedIds.length,
    `All ${ctx.insertedIds.length} events readable from DB`,
  );

  const totalCost = inserted.reduce((sum, e) => sum + e.costMicrodollars, 0);
  const totalInput = inserted.reduce((sum, e) => sum + e.inputTokens, 0);
  const totalOutput = inserted.reduce((sum, e) => sum + e.outputTokens, 0);
  const totalCached = inserted.reduce((sum, e) => sum + e.cachedInputTokens, 0);
  const totalReasoning = inserted.reduce((sum, e) => sum + e.reasoningTokens, 0);

  assert(totalCost > 0, `Total cost across events: ${totalCost}µ$ ($${(totalCost / 1_000_000).toFixed(6)})`);
  assert(totalInput > 0, `Total input tokens: ${totalInput}`);
  assert(totalOutput > 0, `Total output tokens: ${totalOutput}`);

  console.log(`  Cached tokens: ${totalCached}`);
  console.log(`  Reasoning tokens: ${totalReasoning}`);

  // Verify DB aggregate matches JS sum
  const [dbAgg] = await ctx.db
    .select({
      totalCost: sql`cast(coalesce(sum(${costEvents.costMicrodollars}), 0) as bigint)`.mapWith(Number),
      totalInput: sql`cast(coalesce(sum(${costEvents.inputTokens}), 0) as bigint)`.mapWith(Number),
      totalOutput: sql`cast(coalesce(sum(${costEvents.outputTokens}), 0) as bigint)`.mapWith(Number),
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(costEvents)
    .where(inArray(costEvents.id, ctx.insertedIds));

  assertApprox(dbAgg.totalCost, totalCost, 0, "DB SUM(cost) matches JS sum");
  assertApprox(dbAgg.totalInput, totalInput, 0, "DB SUM(input) matches JS sum");
  assertApprox(dbAgg.totalOutput, totalOutput, 0, "DB SUM(output) matches JS sum");
  assertApprox(dbAgg.count, ctx.insertedIds.length, 0, "DB COUNT matches inserted count");

  // Verify per-model grouping
  const modelGroups = await ctx.db
    .select({
      model: costEvents.model,
      count: sql<number>`cast(count(*) as int)`,
      totalCost: sql`cast(coalesce(sum(${costEvents.costMicrodollars}), 0) as bigint)`.mapWith(Number),
    })
    .from(costEvents)
    .where(inArray(costEvents.id, ctx.insertedIds))
    .groupBy(costEvents.model)
    .orderBy(desc(sql`sum(${costEvents.costMicrodollars})`));

  assert(modelGroups.length > 0, `Model breakdown has ${modelGroups.length} groups`);
  const groupTotal = modelGroups.reduce((sum, g) => sum + g.totalCost, 0);
  assertApprox(groupTotal, totalCost, 0, "Model group totals sum to overall total");

  console.log("  Model breakdown:");
  for (const g of modelGroups) {
    console.log(`    ${g.model.padEnd(24)} ${g.count} req  ${g.totalCost}µ$`);
  }
}

async function testDateSerialization(ctx: TestContext) {
  console.log("\n════════════════════════════════════════");
  console.log("TEST 9: Date Serialization Round-Trip");
  console.log("════════════════════════════════════════");

  if (ctx.insertedIds.length === 0) {
    console.log("  Skipping — no events inserted");
    return;
  }

  const [event] = await ctx.db
    .select()
    .from(costEvents)
    .where(eq(costEvents.id, ctx.insertedIds[0]));

  assert(event.createdAt instanceof Date, "createdAt is a Date object");
  const iso = event.createdAt.toISOString();
  assert(iso.endsWith("Z"), "ISO string ends with Z");
  assert(!isNaN(new Date(iso).getTime()), "ISO string parses back to valid Date");

  const roundTripped = new Date(iso);
  assertApprox(
    roundTripped.getTime(),
    event.createdAt.getTime(),
    1000,
    "Round-trip preserves timestamp (within 1s)",
  );
}

async function testConcurrentRequests(ctx: TestContext) {
  console.log("\n════════════════════════════════════════");
  console.log("TEST 10: Concurrent Requests");
  console.log("════════════════════════════════════════");

  const concurrentModels = ["gpt-4o-mini", "gpt-4.1-nano", "gpt-4o-mini"];

  console.log(`  Firing ${concurrentModels.length} parallel requests...`);
  const startTime = performance.now();

  const results = await Promise.allSettled(
    concurrentModels.map((model, i) =>
      callOpenAI(
        ctx.openaiKey,
        model,
        `Concurrent test ${i + 1}: say "OK ${i + 1}"`,
        { maxTokens: 15 },
      ),
    ),
  );

  const totalDuration = Math.round(performance.now() - startTime);
  console.log(`  All completed in ${totalDuration}ms`);

  let successCount = 0;
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "fulfilled") {
      successCount++;
      const { costMicrodollars } = computeCost(concurrentModels[i], r.value.response.usage);

      const [ins] = await ctx.db
        .insert(costEvents)
        .values({
          requestId: r.value.response.id ?? crypto.randomUUID(),
          apiKeyId: ctx.apiKeyId,
          userId: ctx.userId,
          provider: "openai",
          model: r.value.response.model,
          inputTokens: r.value.response.usage.prompt_tokens,
          outputTokens: r.value.response.usage.completion_tokens,
          cachedInputTokens: r.value.response.usage.prompt_tokens_details?.cached_tokens ?? 0,
          reasoningTokens: r.value.response.usage.completion_tokens_details?.reasoning_tokens ?? 0,
          costMicrodollars,
          durationMs: r.value.durationMs,
          actionId: null,
        })
        .returning();
      ctx.insertedIds.push(ins.id);
    } else {
      console.log(`  Request ${i + 1} failed: ${r.reason}`);
    }
  }

  assert(successCount === concurrentModels.length, `All ${concurrentModels.length} concurrent requests succeeded`);
}

// ────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────

async function main() {
  const openaiKey = process.env.OPENAI_API_KEY;
  const databaseUrl = process.env.DATABASE_URL;

  if (!openaiKey) { console.error("OPENAI_API_KEY not set"); process.exit(1); }
  if (!databaseUrl) { console.error("DATABASE_URL not set"); process.exit(1); }

  const sqlClient = postgres(databaseUrl, { prepare: false });
  const db = drizzle(sqlClient, { schema });

  const existingKeys = await db
    .select({ userId: apiKeys.userId, id: apiKeys.id, name: apiKeys.name })
    .from(apiKeys)
    .where(isNull(apiKeys.revokedAt));

  if (existingKeys.length === 0) {
    console.error("No API keys found. Create one via the dashboard first.");
    await sqlClient.end();
    process.exit(1);
  }

  const apiKey = existingKeys[0];
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║   NullSpend Cost-Tracking Pressure Test Suite    ║");
  console.log("╚══════════════════════════════════════════════════╝");
  console.log(`API Key: "${apiKey.name}" (${apiKey.id.slice(0, 8)}...)`);
  console.log(`User: ${apiKey.userId}`);

  const ctx: TestContext = {
    openaiKey,
    db,
    apiKeyId: apiKey.id,
    userId: apiKey.userId,
    insertedIds: [],
  };

  await testMultiModelCalls(ctx);
  await testMathVerification(ctx);
  await testStreaming(ctx);
  await testReasoningTokens(ctx);
  await testCachedTokens(ctx);
  await testLargeTokenVolume(ctx);
  await testCostEngineEdgeCases();
  await testAggregationVerification(ctx);
  await testDateSerialization(ctx);
  await testConcurrentRequests(ctx);

  // ── Final summary ──
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║                 RESULTS SUMMARY                  ║");
  console.log("╚══════════════════════════════════════════════════╝");
  console.log(`  Total tests:  ${passed + failed}`);
  console.log(`  Passed:       ${passed}`);
  console.log(`  Failed:       ${failed}`);
  console.log(`  Events in DB: ${ctx.insertedIds.length}`);

  if (failures.length > 0) {
    console.log("\n  Failures:");
    for (const f of failures) {
      console.log(`    - ${f}`);
    }
  }

  console.log(
    `\n  Total OpenAI spend: check your dashboard at /app/analytics`,
  );
  console.log(
    failed === 0
      ? "\n  === ALL TESTS PASSED ==="
      : `\n  === ${failed} TEST(S) FAILED ===`,
  );

  await sqlClient.end();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Pressure test crashed:", err);
  process.exit(1);
});
