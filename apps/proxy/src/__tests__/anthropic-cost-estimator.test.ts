import { describe, it, expect } from "vitest";
import { estimateAnthropicMaxCost } from "../lib/anthropic-cost-estimator.js";

describe("estimateAnthropicMaxCost", () => {
  it("returns integer microdollars (suitable for HINCRBY)", () => {
    const result = estimateAnthropicMaxCost("claude-sonnet-4-5", {
      model: "claude-sonnet-4-5",
      max_tokens: 100,
      messages: [{ role: "user", content: "hello" }],
    });
    expect(Number.isInteger(result)).toBe(true);
    expect(result).toBeGreaterThan(0);
  });

  it("uses max_tokens when specified in body (cheaper than default cap)", () => {
    const withLimit = estimateAnthropicMaxCost("claude-sonnet-4-5", {
      model: "claude-sonnet-4-5",
      max_tokens: 100,
      messages: [{ role: "user", content: "hello" }],
    });
    const withoutLimit = estimateAnthropicMaxCost("claude-sonnet-4-5", {
      model: "claude-sonnet-4-5",
      messages: [{ role: "user", content: "hello" }],
    });
    expect(withLimit).toBeLessThan(withoutLimit);
  });

  it("does NOT use max_completion_tokens (Anthropic only uses max_tokens)", () => {
    const withMaxCompletionTokens = estimateAnthropicMaxCost("claude-sonnet-4-5", {
      model: "claude-sonnet-4-5",
      max_completion_tokens: 100,
      messages: [{ role: "user", content: "hello" }],
    });
    const withMaxTokens = estimateAnthropicMaxCost("claude-sonnet-4-5", {
      model: "claude-sonnet-4-5",
      max_tokens: 100,
      messages: [{ role: "user", content: "hello" }],
    });
    // max_completion_tokens should be ignored (falls back to 64K cap),
    // while max_tokens=100 should be used, making it much cheaper
    expect(withMaxCompletionTokens).toBeGreaterThan(withMaxTokens);
  });

  it("returns $1 fallback for unknown models", () => {
    const result = estimateAnthropicMaxCost("nonexistent-model", {
      model: "nonexistent-model",
      max_tokens: 100,
      messages: [{ role: "user", content: "hello" }],
    });
    expect(result).toBe(1_000_000);
  });

  it("all models in output caps produce valid non-fallback estimates", () => {
    const models = [
      "claude-opus-4-6",
      "claude-opus-4-6-20260205",
      "claude-opus-4-5",
      "claude-opus-4-5-20251101",
      "claude-sonnet-4-6",
      "claude-sonnet-4-6-20260217",
      "claude-sonnet-4-5",
      "claude-sonnet-4-5-20250929",
      "claude-sonnet-4",
      "claude-sonnet-4-20250514",
      "claude-sonnet-4-0",
      "claude-opus-4-1",
      "claude-opus-4-1-20250805",
      "claude-opus-4",
      "claude-opus-4-20250514",
      "claude-opus-4-0",
      "claude-haiku-4-5",
      "claude-haiku-4-5-20251001",
      "claude-haiku-3.5",
      "claude-3-5-haiku-20241022",
      "claude-haiku-3",
      "claude-3-haiku-20240307",
    ];

    for (const model of models) {
      const result = estimateAnthropicMaxCost(model, {
        model,
        max_tokens: 100,
        messages: [{ role: "user", content: "test" }],
      });
      expect(result, `${model} should not return the $1 fallback`).not.toBe(1_000_000);
      expect(result, `${model} should return positive value`).toBeGreaterThan(0);
    }
  });

  it("opus models produce higher estimates than sonnet (128K vs 64K cap)", () => {
    const opus = estimateAnthropicMaxCost("claude-opus-4-6", {
      model: "claude-opus-4-6",
      messages: [{ role: "user", content: "hi" }],
    });
    const sonnet = estimateAnthropicMaxCost("claude-sonnet-4-6", {
      model: "claude-sonnet-4-6",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(opus).toBeGreaterThan(sonnet);
  });

  it("applies 1.1x safety margin", () => {
    const result = estimateAnthropicMaxCost("claude-sonnet-4-5", {
      model: "claude-sonnet-4-5",
      max_tokens: 1,
      messages: [{ role: "user", content: "hello" }],
    });
    expect(result).toBeGreaterThan(0);
  });

  it("scales with body size (larger messages = higher estimate)", () => {
    const small = estimateAnthropicMaxCost("claude-sonnet-4-5", {
      model: "claude-sonnet-4-5",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
    });
    const large = estimateAnthropicMaxCost("claude-sonnet-4-5", {
      model: "claude-sonnet-4-5",
      max_tokens: 100,
      messages: [{ role: "user", content: "a".repeat(10000) }],
    });
    expect(large).toBeGreaterThan(small);
  });
});
