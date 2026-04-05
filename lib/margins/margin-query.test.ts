import { describe, it, expect } from "vitest";
import { computeHealthTier } from "./margin-query";

describe("computeHealthTier", () => {
  it("returns healthy for >= 50%", () => {
    expect(computeHealthTier(50)).toBe("healthy");
    expect(computeHealthTier(100)).toBe("healthy");
    expect(computeHealthTier(75)).toBe("healthy");
  });

  it("returns moderate for 20-49%", () => {
    expect(computeHealthTier(49)).toBe("moderate");
    expect(computeHealthTier(20)).toBe("moderate");
    expect(computeHealthTier(35)).toBe("moderate");
  });

  it("returns at_risk for 0-19%", () => {
    expect(computeHealthTier(19)).toBe("at_risk");
    expect(computeHealthTier(0)).toBe("at_risk");
    expect(computeHealthTier(10)).toBe("at_risk");
  });

  it("returns critical for < 0%", () => {
    expect(computeHealthTier(-1)).toBe("critical");
    expect(computeHealthTier(-50)).toBe("critical");
    expect(computeHealthTier(-0.01)).toBe("critical");
  });

  it("handles boundary values exactly", () => {
    expect(computeHealthTier(50)).toBe("healthy");
    expect(computeHealthTier(49.99)).toBe("moderate");
    expect(computeHealthTier(20)).toBe("moderate");
    expect(computeHealthTier(19.99)).toBe("at_risk");
    expect(computeHealthTier(0)).toBe("at_risk");
    expect(computeHealthTier(-0.001)).toBe("critical");
  });
});
