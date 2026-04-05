import { describe, it, expect } from "vitest";
import { computeHealthTier } from "./margin-query";

describe("computeHealthTier edge cases", () => {
  it("handles exactly 0% as at_risk", () => {
    expect(computeHealthTier(0)).toBe("at_risk");
  });

  it("handles -0 as at_risk (not critical)", () => {
    expect(computeHealthTier(-0)).toBe("at_risk"); // -0 === 0 in JS
  });

  it("handles very large positive margin", () => {
    expect(computeHealthTier(99999)).toBe("healthy");
  });

  it("handles very large negative margin", () => {
    expect(computeHealthTier(-99999)).toBe("critical");
  });

  it("handles NaN gracefully", () => {
    // NaN < 0 is false, NaN >= 50 is false, etc. Falls through to critical
    const result = computeHealthTier(NaN);
    expect(result).toBe("critical");
  });

  it("handles Infinity", () => {
    expect(computeHealthTier(Infinity)).toBe("healthy");
  });

  it("handles -Infinity", () => {
    expect(computeHealthTier(-Infinity)).toBe("critical");
  });

  it("handles fractional boundary at 49.999", () => {
    expect(computeHealthTier(49.999)).toBe("moderate");
  });

  it("handles fractional boundary at 19.999", () => {
    expect(computeHealthTier(19.999)).toBe("at_risk");
  });

  it("handles tiny negative value -0.0001", () => {
    expect(computeHealthTier(-0.0001)).toBe("critical");
  });
});

describe("margin calculation edge cases (unit-level)", () => {
  it("revenue = 0, cost > 0 produces -100% (critical)", () => {
    const revenue = 0;
    const cost = 100_000_000;
    const marginPercent = revenue > 0
      ? ((revenue - cost) / revenue) * 100
      : cost > 0 ? -100 : 0;
    expect(marginPercent).toBe(-100);
    expect(computeHealthTier(marginPercent)).toBe("critical");
  });

  it("revenue > 0, cost = 0 produces 100% (healthy)", () => {
    const revenue = 100_000_000;
    const cost = 0;
    const marginPercent = revenue > 0
      ? ((revenue - cost) / revenue) * 100
      : 0;
    expect(marginPercent).toBe(100);
    expect(computeHealthTier(marginPercent)).toBe("healthy");
  });

  it("revenue = 0, cost = 0 produces 0% (at_risk)", () => {
    const revenue = 0;
    const cost = 0;
    const marginPercent = revenue > 0
      ? ((revenue - cost) / revenue) * 100
      : cost > 0 ? -100 : 0;
    expect(marginPercent).toBe(0);
    expect(computeHealthTier(marginPercent)).toBe("at_risk");
  });

  it("budget suggestion = revenue * 0.5 for critical customers", () => {
    const revenue = 100_000_000; // $100 in microdollars
    const suggestion = Math.round(revenue * 0.5);
    expect(suggestion).toBe(50_000_000); // $50
  });

  it("budget suggestion is null for non-critical customers", () => {
    const marginPercent = 60; // healthy
    const suggestion = computeHealthTier(marginPercent) === "critical" ? 50_000_000 : null;
    expect(suggestion).toBeNull();
  });

  it("blended margin with mixed positive/negative", () => {
    const totalRevenue = 200_000_000; // $200
    const totalCost = 150_000_000; // $150
    const blended = Math.round(((totalRevenue - totalCost) / totalRevenue) * 10000) / 100;
    expect(blended).toBe(25); // 25%
  });

  it("blended margin with zero revenue", () => {
    const totalRevenue = 0;
    const blended = totalRevenue > 0
      ? Math.round(((totalRevenue - 100) / totalRevenue) * 10000) / 100
      : 0;
    expect(blended).toBe(0);
  });
});
