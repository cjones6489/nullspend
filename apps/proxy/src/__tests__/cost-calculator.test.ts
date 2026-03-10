import { describe, it, expect } from "vitest";
import { calculateOpenAICost } from "../lib/cost-calculator.js";

describe("calculateOpenAICost", () => {
  it("calculates cost for GPT-4o with cached tokens", () => {
    const result = calculateOpenAICost(
      "gpt-4o",
      "gpt-4o-2024-11-20",
      {
        prompt_tokens: 1000,
        completion_tokens: 500,
        prompt_tokens_details: { cached_tokens: 200 },
        completion_tokens_details: { reasoning_tokens: 0 },
      },
      "req-123",
      150,
    );

    expect(result.provider).toBe("openai");
    expect(result.model).toBe("gpt-4o");
    expect(result.inputTokens).toBe(1000);
    expect(result.outputTokens).toBe(500);
    expect(result.cachedInputTokens).toBe(200);
    expect(result.reasoningTokens).toBe(0);
    expect(result.costMicrodollars).toBeGreaterThan(0);
    expect(result.requestId).toBe("req-123");
    expect(result.durationMs).toBe(150);
    expect(result.userId).toBeNull();
    expect(result.apiKeyId).toBeNull();

    // Cost breakdown:
    // normalInput: 800 tokens * 2.50 $/MTok = 2000
    // cached: 200 tokens * 1.25 $/MTok = 250
    // output: 500 tokens * 10.00 $/MTok = 5000
    // total: 7250 microdollars
    expect(result.costMicrodollars).toBe(7250);
  });

  it("calculates cost for o3-mini with reasoning tokens", () => {
    const result = calculateOpenAICost(
      "o3-mini",
      null,
      {
        prompt_tokens: 100,
        completion_tokens: 2000,
        completion_tokens_details: { reasoning_tokens: 1500 },
      },
      "req-456",
      300,
    );

    expect(result.reasoningTokens).toBe(1500);
    // reasoning_tokens are included in completion_tokens — same output rate
    // input: 100 * 1.10 = 110
    // output: 2000 * 4.40 = 8800
    // total: 8910
    expect(result.costMicrodollars).toBe(8910);
  });

  it("calculates cost for GPT-4.1 standard call", () => {
    const result = calculateOpenAICost(
      "gpt-4.1",
      "gpt-4.1",
      {
        prompt_tokens: 500,
        completion_tokens: 200,
      },
      "req-789",
      100,
    );

    // input: 500 * 2.00 = 1000
    // output: 200 * 8.00 = 1600
    // total: 2600
    expect(result.costMicrodollars).toBe(2600);
  });

  it("returns costMicrodollars: 0 for unknown model", () => {
    const result = calculateOpenAICost(
      "unknown-model-xyz",
      null,
      {
        prompt_tokens: 100,
        completion_tokens: 50,
      },
      "req-unknown",
      50,
    );

    expect(result.costMicrodollars).toBe(0);
    expect(result.model).toBe("unknown-model-xyz");
  });

  it("handles missing usage fields gracefully (defaults to 0)", () => {
    const result = calculateOpenAICost(
      "gpt-4o",
      null,
      {
        prompt_tokens: 100,
        completion_tokens: 50,
      } as any,
      "req-defaults",
      75,
    );

    expect(result.cachedInputTokens).toBe(0);
    expect(result.reasoningTokens).toBe(0);
    // input: 100 * 2.50 = 250
    // output: 50 * 10.00 = 500
    // total: 750
    expect(result.costMicrodollars).toBe(750);
  });

  it("falls back to response model when request model has no pricing", () => {
    const result = calculateOpenAICost(
      "gpt-4o-2024-11-20",
      "gpt-4o",
      {
        prompt_tokens: 100,
        completion_tokens: 50,
      },
      "req-fallback",
      60,
    );

    // "gpt-4o-2024-11-20" is not in our pricing keys, fallback to "gpt-4o"
    expect(result.model).toBe("gpt-4o");
    expect(result.costMicrodollars).toBeGreaterThan(0);
  });
});
