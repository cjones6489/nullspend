import { describe, it, expect } from "vitest";

import { computeHealthTier } from "@/lib/margins/margin-query";

/**
 * Regression: $0 revenue + cost > 0 showed -100% margin in the UI.
 * Fixed to show 0% margin while still classifying as "critical" health tier.
 * Found by /qa stress testing on 2026-04-10.
 *
 * The margin calculation change is in margin-query.ts (two locations):
 *   - getMarginTable line ~242
 *   - getCustomerDetail line ~431
 * Both now return 0 instead of -100 when revenue is 0.
 * Health tier is forced to "critical" when revenue=0 and cost>0.
 */
describe("zero-revenue margin edge cases", () => {
  describe("computeHealthTier", () => {
    it("0% margin is at_risk (boundary)", () => {
      expect(computeHealthTier(0)).toBe("at_risk");
    });

    it("negative margin is critical", () => {
      expect(computeHealthTier(-1)).toBe("critical");
      expect(computeHealthTier(-100)).toBe("critical");
    });

    it("50% exactly is healthy", () => {
      expect(computeHealthTier(50)).toBe("healthy");
    });

    it("20% exactly is moderate", () => {
      expect(computeHealthTier(20)).toBe("moderate");
    });

    it("19.9% is at_risk", () => {
      expect(computeHealthTier(19.9)).toBe("at_risk");
    });
  });

  describe("margin calculation contract", () => {
    it("margin-query.ts must NOT use -100 for zero-revenue customers", async () => {
      const { readFileSync } = await import("fs");
      const source = readFileSync("lib/margins/margin-query.ts", "utf-8");

      // The old code had: `periodCost > 0 ? -100 : 0`
      // The fix removed -100 entirely: `: 0; // No revenue → margin undefined`
      const lines = source.split("\n");
      const negativeHundredLines = lines.filter(
        (l) => l.includes("-100") && l.includes("margin") && !l.includes("//") && !l.includes("test"),
      );
      expect(negativeHundredLines).toHaveLength(0);
    });

    it("zero-revenue customers are marked critical via explicit health tier override", async () => {
      const { readFileSync } = await import("fs");
      const source = readFileSync("lib/margins/margin-query.ts", "utf-8");

      // Both getMarginTable and getCustomerDetail must have the override:
      // periodRevenue === 0 && periodCost > 0 ? "critical" : computeHealthTier(marginPercent)
      const overrideCount = (source.match(/periodRevenue === 0 && periodCost > 0/g) || []).length;
      expect(overrideCount).toBeGreaterThanOrEqual(2);
    });
  });
});
