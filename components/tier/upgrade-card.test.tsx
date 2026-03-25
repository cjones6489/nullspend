import { describe, expect, it } from "vitest";

import { TIERS, type Tier } from "@/lib/stripe/tiers";

// UpgradeCard is a React component. Test the data and logic it relies on.
// Component rendering tests would require @testing-library/react.

describe("UpgradeCard data", () => {
  it("pro tier has a numeric price", () => {
    expect(TIERS.pro.price).toBe(49);
  });

  it("enterprise tier has null price (custom pricing)", () => {
    expect(TIERS.enterprise.price).toBeNull();
  });

  it("all tiers have a label", () => {
    for (const key of Object.keys(TIERS) as Tier[]) {
      expect(TIERS[key].label).toBeDefined();
      expect(typeof TIERS[key].label).toBe("string");
      expect(TIERS[key].label.length).toBeGreaterThan(0);
    }
  });

  it("free tier limits are finite", () => {
    expect(TIERS.free.maxBudgets).toBe(3);
    expect(TIERS.free.maxApiKeys).toBe(10);
    expect(TIERS.free.maxWebhookEndpoints).toBe(2);
    expect(TIERS.free.maxTeamMembers).toBe(3);
  });

  it("pro tier unlocks unlimited budgets and keys", () => {
    expect(TIERS.pro.maxBudgets).toBe(Infinity);
    expect(TIERS.pro.maxApiKeys).toBe(Infinity);
  });

  it("pro tier still has a webhook endpoint limit", () => {
    expect(TIERS.pro.maxWebhookEndpoints).toBe(25);
    expect(Number.isFinite(TIERS.pro.maxWebhookEndpoints)).toBe(true);
  });

  it("enterprise tier has all Infinity limits", () => {
    expect(TIERS.enterprise.maxBudgets).toBe(Infinity);
    expect(TIERS.enterprise.maxApiKeys).toBe(Infinity);
    expect(TIERS.enterprise.maxWebhookEndpoints).toBe(Infinity);
    expect(TIERS.enterprise.maxTeamMembers).toBe(Infinity);
  });
});
