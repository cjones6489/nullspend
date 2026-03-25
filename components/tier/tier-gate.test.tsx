import { describe, expect, it } from "vitest";

import { isAtLeastTier } from "@/lib/hooks/use-org-tier";
import type { Tier } from "@/lib/stripe/tiers";

// TierGate is a React component — test its gating logic via isAtLeastTier.
// Component rendering tests would require @testing-library/react which isn't in this project.

describe("TierGate logic", () => {
  const scenarios: Array<{
    current: Tier;
    required: Tier;
    shouldShow: boolean;
  }> = [
    { current: "free", required: "free", shouldShow: true },
    { current: "free", required: "pro", shouldShow: false },
    { current: "free", required: "enterprise", shouldShow: false },
    { current: "pro", required: "free", shouldShow: true },
    { current: "pro", required: "pro", shouldShow: true },
    { current: "pro", required: "enterprise", shouldShow: false },
    { current: "enterprise", required: "free", shouldShow: true },
    { current: "enterprise", required: "pro", shouldShow: true },
    { current: "enterprise", required: "enterprise", shouldShow: true },
  ];

  for (const { current, required, shouldShow } of scenarios) {
    it(`${current} user ${shouldShow ? "sees" : "is gated from"} ${required}-tier feature`, () => {
      expect(isAtLeastTier(current, required)).toBe(shouldShow);
    });
  }
});
