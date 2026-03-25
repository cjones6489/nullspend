import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getTierForUser, tierFromPriceId, isValidPriceId, TIERS } from "./tiers";

describe("getTierForUser", () => {
  it("returns 'free' when subscription is null", () => {
    expect(getTierForUser(null)).toBe("free");
  });

  it("returns 'free' when status is not active or past_due", () => {
    expect(getTierForUser({ tier: "pro", status: "canceled" })).toBe("free");
    expect(getTierForUser({ tier: "team", status: "trialing" })).toBe("free");
    expect(getTierForUser({ tier: "pro", status: "incomplete" })).toBe("free");
  });

  it("returns the tier when status is active", () => {
    expect(getTierForUser({ tier: "pro", status: "active" })).toBe("pro");
    expect(getTierForUser({ tier: "enterprise", status: "active" })).toBe("enterprise");
  });

  it("returns the tier when status is past_due (grace period)", () => {
    expect(getTierForUser({ tier: "pro", status: "past_due" })).toBe("pro");
    expect(getTierForUser({ tier: "enterprise", status: "past_due" })).toBe("enterprise");
  });
});

describe("tierFromPriceId", () => {
  beforeEach(() => {
    vi.stubEnv("STRIPE_PRO_PRICE_ID", "price_pro_test");
    vi.stubEnv("STRIPE_ENTERPRISE_PRICE_ID", "price_enterprise_test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 'pro' for the pro price ID", () => {
    expect(tierFromPriceId("price_pro_test")).toBe("pro");
  });

  it("returns 'enterprise' for the enterprise price ID", () => {
    expect(tierFromPriceId("price_enterprise_test")).toBe("enterprise");
  });

  it("returns null for an unrecognized price ID", () => {
    expect(tierFromPriceId("price_unknown")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(tierFromPriceId("")).toBeNull();
  });
});

describe("isValidPriceId", () => {
  beforeEach(() => {
    vi.stubEnv("STRIPE_PRO_PRICE_ID", "price_pro_test");
    vi.stubEnv("STRIPE_ENTERPRISE_PRICE_ID", "price_enterprise_test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns true for valid price IDs", () => {
    expect(isValidPriceId("price_pro_test")).toBe(true);
    expect(isValidPriceId("price_enterprise_test")).toBe(true);
  });

  it("returns false for invalid price IDs", () => {
    expect(isValidPriceId("price_invalid")).toBe(false);
    expect(isValidPriceId("")).toBe(false);
  });
});

describe("TIERS", () => {
  it("has correct structure for free tier", () => {
    expect(TIERS.free.maxBudgets).toBe(3);
    expect(TIERS.free.price).toBe(0);
    expect(TIERS.free.retentionDays).toBe(30);
    expect(TIERS.free.maxApiKeys).toBe(10);
    expect(TIERS.free.maxWebhookEndpoints).toBe(2);
    expect(TIERS.free.maxTeamMembers).toBe(3);
  });

  it("has unlimited budgets for paid tiers", () => {
    expect(TIERS.pro.maxBudgets).toBe(Infinity);
    expect(TIERS.enterprise.maxBudgets).toBe(Infinity);
  });

  it("has increasing spend caps", () => {
    expect(TIERS.free.spendCapMicrodollars).toBeLessThan(
      TIERS.pro.spendCapMicrodollars,
    );
    expect(TIERS.pro.spendCapMicrodollars).toBeLessThan(
      TIERS.enterprise.spendCapMicrodollars as number,
    );
  });
});
