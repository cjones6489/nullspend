import { describe, expect, it, vi } from "vitest";

import {
  resolveOrgTier,
  assertCountBelowLimit,
  assertAmountBelowCap,
  type OrgTierInfo,
} from "@/lib/stripe/feature-gate";
import { LimitExceededError, SpendCapExceededError } from "@/lib/utils/http";

vi.mock("@/lib/stripe/subscription", () => ({
  getSubscriptionByOrgId: vi.fn(),
}));

import { getSubscriptionByOrgId } from "@/lib/stripe/subscription";

const mockedGetSubscription = vi.mocked(getSubscriptionByOrgId);

describe("resolveOrgTier", () => {
  it("returns free tier when no subscription exists", async () => {
    mockedGetSubscription.mockResolvedValue(null as unknown as Awaited<ReturnType<typeof getSubscriptionByOrgId>>);

    const result = await resolveOrgTier("org-1");

    expect(result.tier).toBe("free");
    expect(result.label).toBe("Free");
  });

  it("returns pro tier for active pro subscription", async () => {
    mockedGetSubscription.mockResolvedValue({
      tier: "pro",
      status: "active",
    } as Awaited<ReturnType<typeof getSubscriptionByOrgId>>);

    const result = await resolveOrgTier("org-1");

    expect(result.tier).toBe("pro");
    expect(result.label).toBe("Pro");
  });

  it("returns free for cancelled subscription", async () => {
    mockedGetSubscription.mockResolvedValue({
      tier: "pro",
      status: "canceled",
    } as Awaited<ReturnType<typeof getSubscriptionByOrgId>>);

    const result = await resolveOrgTier("org-1");

    expect(result.tier).toBe("free");
  });
});

describe("assertCountBelowLimit", () => {
  const freeInfo: OrgTierInfo = { tier: "free", label: "Free" };
  const proInfo: OrgTierInfo = { tier: "pro", label: "Pro" };

  it("does not throw when count is below limit", () => {
    expect(() =>
      assertCountBelowLimit(freeInfo, "maxApiKeys", 5, "API keys"),
    ).not.toThrow();
  });

  it("throws LimitExceededError when count reaches limit", () => {
    expect(() =>
      assertCountBelowLimit(freeInfo, "maxApiKeys", 10, "API keys"),
    ).toThrow(LimitExceededError);
  });

  it("throws with descriptive message including tier and limit", () => {
    expect(() =>
      assertCountBelowLimit(freeInfo, "maxApiKeys", 10, "API keys"),
    ).toThrow(/10.*API keys.*Free/);
  });

  it("skips check when limit is Infinity (paid tier)", () => {
    expect(() =>
      assertCountBelowLimit(proInfo, "maxBudgets", 999, "budgets"),
    ).not.toThrow();
  });

  it("enforces maxTeamMembers for free tier", () => {
    expect(() =>
      assertCountBelowLimit(freeInfo, "maxTeamMembers", 3, "team members"),
    ).toThrow(LimitExceededError);
  });

  it("does not throw at limit - 1 (boundary)", () => {
    // maxApiKeys for free = 10, so 9 should pass
    expect(() =>
      assertCountBelowLimit(freeInfo, "maxApiKeys", 9, "API keys"),
    ).not.toThrow();
  });

  it("throws at exactly the limit (boundary)", () => {
    // maxApiKeys for free = 10, so 10 should fail (>= check)
    expect(() =>
      assertCountBelowLimit(freeInfo, "maxApiKeys", 10, "API keys"),
    ).toThrow(LimitExceededError);
  });
});

describe("assertAmountBelowCap", () => {
  const freeInfo: OrgTierInfo = { tier: "free", label: "Free" };
  const proInfo: OrgTierInfo = { tier: "pro", label: "Pro" };
  const enterpriseInfo: OrgTierInfo = {
    tier: "enterprise",
    label: "Enterprise",
  };

  it("does not throw when amount is within cap", () => {
    expect(() =>
      assertAmountBelowCap(freeInfo, "spendCapMicrodollars", 1_000_000_000),
    ).not.toThrow();
  });

  it("throws SpendCapExceededError when amount exceeds cap", () => {
    expect(() =>
      assertAmountBelowCap(
        freeInfo,
        "spendCapMicrodollars",
        999_000_000_000,
      ),
    ).toThrow(SpendCapExceededError);
  });

  it("includes tier label in error message", () => {
    expect(() =>
      assertAmountBelowCap(
        freeInfo,
        "spendCapMicrodollars",
        999_000_000_000,
      ),
    ).toThrow(/Free/);
  });

  it("skips check when cap is Infinity (enterprise)", () => {
    expect(() =>
      assertAmountBelowCap(
        enterpriseInfo,
        "spendCapMicrodollars",
        999_000_000_000_000,
      ),
    ).not.toThrow();
  });

  it("pro tier has $50K cap", () => {
    // $50K = 50_000_000_000 microdollars
    expect(() =>
      assertAmountBelowCap(
        proInfo,
        "spendCapMicrodollars",
        50_000_000_001,
      ),
    ).toThrow(SpendCapExceededError);
  });

  it("allows amount exactly at the cap (boundary)", () => {
    // Free cap = 5_000_000_000 microdollars ($5,000). Exact match = allowed (> check, not >=).
    expect(() =>
      assertAmountBelowCap(freeInfo, "spendCapMicrodollars", 5_000_000_000),
    ).not.toThrow();
  });

  it("blocks amount one microdollar above the cap (boundary)", () => {
    expect(() =>
      assertAmountBelowCap(freeInfo, "spendCapMicrodollars", 5_000_000_001),
    ).toThrow(SpendCapExceededError);
  });

  it("error message shows correct dollar amount", () => {
    // Free cap = $5,000. Error message should show "$5,000", not "$5".
    try {
      assertAmountBelowCap(freeInfo, "spendCapMicrodollars", 999_000_000_000);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as Error).message).toContain("$5,000");
    }
  });
});
