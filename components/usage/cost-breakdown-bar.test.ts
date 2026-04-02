import { describe, expect, it } from "vitest";

import { formatBreakdownTitle } from "./cost-breakdown-bar";

// ---------------------------------------------------------------------------
// formatBreakdownTitle — tests the decomposition and formatting logic
// ---------------------------------------------------------------------------

describe("formatBreakdownTitle", () => {
  it("returns null for null breakdown", () => {
    expect(formatBreakdownTitle(null)).toBeNull();
  });

  it("returns null for undefined breakdown", () => {
    expect(formatBreakdownTitle(undefined)).toBeNull();
  });

  it("returns null when all values are zero", () => {
    expect(
      formatBreakdownTitle({ input: 0, output: 0, cached: 0, reasoning: 0, toolDefinition: 0 }),
    ).toBeNull();
  });

  it("returns null for empty object", () => {
    expect(formatBreakdownTitle({})).toBeNull();
  });

  it("formats single component", () => {
    expect(formatBreakdownTitle({ output: 100_000 })).toBe("Output: $0.10");
  });

  it("formats input-only breakdown", () => {
    expect(formatBreakdownTitle({ input: 50_000 })).toBe("Input: $0.05");
  });

  it("formats multiple components with pipe separator", () => {
    const result = formatBreakdownTitle({ input: 50_000, output: 100_000 });
    expect(result).toBe("Input: $0.05 | Output: $0.10");
  });

  it("includes cached when present", () => {
    const result = formatBreakdownTitle({ input: 50_000, output: 100_000, cached: 20_000 });
    expect(result).toBe("Input: $0.05 | Output: $0.10 | Cached: $0.02");
  });

  // Decomposition: reasoning is subset of output
  it("decomposes reasoning from output", () => {
    // output=200k includes reasoning=80k → Output segment=120k, Reasoning=80k
    const result = formatBreakdownTitle({ output: 200_000, reasoning: 80_000 });
    expect(result).toBe("Output: $0.12 | Reasoning: $0.08");
  });

  // Decomposition: toolDefinition is subset of input
  it("decomposes toolDefinition from input", () => {
    // input=150k includes toolDef=30k → Input segment=120k, Tool Definition=30k
    const result = formatBreakdownTitle({ input: 150_000, toolDefinition: 30_000 });
    expect(result).toBe("Input: $0.12 | Tool Definition: $0.03");
  });

  it("omits zero-value segments", () => {
    const result = formatBreakdownTitle({ input: 100_000, output: 0, cached: 0 });
    expect(result).toBe("Input: $0.10");
  });

  // Defensive: clamp to zero if subtraction is negative
  it("clamps negative subtraction (toolDefinition > input)", () => {
    // toolDefinition=50k > input=10k → Input segment clamped to 0, only Tool Definition shows
    const result = formatBreakdownTitle({ input: 10_000, toolDefinition: 50_000, output: 100_000 });
    // Input segment is 0 (omitted), Tool Definition=50k, Output=100k
    expect(result).toBe("Tool Definition: $0.05 | Output: $0.10");
  });

  it("clamps negative subtraction (reasoning > output)", () => {
    const result = formatBreakdownTitle({ input: 100_000, output: 10_000, reasoning: 50_000 });
    // Output segment is 0 (omitted), Reasoning=50k, Input=100k
    expect(result).toBe("Input: $0.10 | Reasoning: $0.05");
  });

  // Full 5-component decomposition
  it("decomposes all 5 components correctly", () => {
    const result = formatBreakdownTitle({
      input: 100_000,     // 100k - 20k toolDef = 80k input
      toolDefinition: 20_000,
      output: 200_000,    // 200k - 50k reasoning = 150k output
      reasoning: 50_000,
      cached: 30_000,
    });
    expect(result).toBe(
      "Input: $0.08 | Tool Definition: $0.02 | Output: $0.15 | Reasoning: $0.05 | Cached: $0.03",
    );
  });

  // Sub-cent values
  it("handles sub-cent values", () => {
    const result = formatBreakdownTitle({ input: 500, output: 300 });
    expect(result).toBe("Input: $0.0005 | Output: $0.0003");
  });

  it("handles very small values below display threshold", () => {
    const result = formatBreakdownTitle({ input: 5, output: 100_000 });
    expect(result).toBe("Input: <$0.0001 | Output: $0.10");
  });

  // Anthropic-style: no reasoning field
  it("handles Anthropic events (no reasoning)", () => {
    const result = formatBreakdownTitle({ input: 80_000, output: 120_000, cached: 10_000 });
    expect(result).toBe("Input: $0.08 | Output: $0.12 | Cached: $0.01");
  });
});
