import { describe, it, expect } from "vitest";
import { buildMarginThresholdPayload, detectWorseningCrossings } from "./webhook";

describe("buildMarginThresholdPayload", () => {
  it("builds correct payload shape", () => {
    const payload = buildMarginThresholdPayload({
      stripeCustomerId: "cus_123",
      customerName: "Acme Corp",
      tagValue: "acme",
      previousMarginPercent: 12,
      currentMarginPercent: -5,
      revenueMicrodollars: 50_000_000,
      costMicrodollars: 52_500_000,
      period: "2026-04",
    });

    expect(payload.type).toBe("margin.threshold_crossed");
    expect(payload.id).toMatch(/^evt_/);
    expect(payload.data.object).toMatchObject({
      customer: { stripeId: "cus_123", name: "Acme Corp", tagValue: "acme" },
      margin: {
        previous: 0.12,
        current: -0.05,
        previousTier: "at_risk",
        currentTier: "critical",
      },
      revenue_microdollars: 50_000_000,
      cost_microdollars: 52_500_000,
      period: "2026-04",
    });
  });

  it("uses correct API version", () => {
    const payload = buildMarginThresholdPayload({
      stripeCustomerId: "cus_1",
      customerName: null,
      tagValue: "test",
      previousMarginPercent: 50,
      currentMarginPercent: 30,
      revenueMicrodollars: 1_000_000,
      costMicrodollars: 700_000,
      period: "2026-04",
    });
    expect(payload.api_version).toBe("2026-04-01");
  });

  it("generates unique event IDs", () => {
    const a = buildMarginThresholdPayload({
      stripeCustomerId: "cus_1",
      customerName: null,
      tagValue: "test",
      previousMarginPercent: 50,
      currentMarginPercent: 30,
      revenueMicrodollars: 1_000_000,
      costMicrodollars: 700_000,
      period: "2026-04",
    });
    const b = buildMarginThresholdPayload({
      stripeCustomerId: "cus_1",
      customerName: null,
      tagValue: "test",
      previousMarginPercent: 50,
      currentMarginPercent: 30,
      revenueMicrodollars: 1_000_000,
      costMicrodollars: 700_000,
      period: "2026-04",
    });
    expect(a.id).not.toBe(b.id);
  });
});

describe("detectWorseningCrossings", () => {
  it("detects worsening from at_risk to critical", () => {
    const crossings = detectWorseningCrossings(
      [{ tagValue: "acme", marginPercent: 10 }],
      [{ tagValue: "acme", marginPercent: -5 }],
    );
    expect(crossings).toHaveLength(1);
    expect(crossings[0].tagValue).toBe("acme");
    expect(crossings[0].previousMarginPercent).toBe(10);
    expect(crossings[0].currentMarginPercent).toBe(-5);
  });

  it("does NOT fire on improvement (critical to at_risk)", () => {
    const crossings = detectWorseningCrossings(
      [{ tagValue: "acme", marginPercent: -5 }],
      [{ tagValue: "acme", marginPercent: 10 }],
    );
    expect(crossings).toHaveLength(0);
  });

  it("does NOT fire when staying in same tier", () => {
    const crossings = detectWorseningCrossings(
      [{ tagValue: "acme", marginPercent: 55 }],
      [{ tagValue: "acme", marginPercent: 60 }],
    );
    expect(crossings).toHaveLength(0);
  });

  it("detects multiple crossings", () => {
    const crossings = detectWorseningCrossings(
      [
        { tagValue: "acme", marginPercent: 55 },
        { tagValue: "beta", marginPercent: 25 },
      ],
      [
        { tagValue: "acme", marginPercent: 30 },
        { tagValue: "beta", marginPercent: -10 },
      ],
    );
    expect(crossings).toHaveLength(2);
  });

  it("ignores new customers (no previous data)", () => {
    const crossings = detectWorseningCrossings(
      [],
      [{ tagValue: "new-customer", marginPercent: -20 }],
    );
    expect(crossings).toHaveLength(0);
  });

  it("detects healthy to moderate", () => {
    const crossings = detectWorseningCrossings(
      [{ tagValue: "a", marginPercent: 60 }],
      [{ tagValue: "a", marginPercent: 30 }],
    );
    expect(crossings).toHaveLength(1);
  });

  it("detects moderate to at_risk", () => {
    const crossings = detectWorseningCrossings(
      [{ tagValue: "a", marginPercent: 30 }],
      [{ tagValue: "a", marginPercent: 10 }],
    );
    expect(crossings).toHaveLength(1);
  });

  it("detects multi-tier jump (healthy to critical)", () => {
    const crossings = detectWorseningCrossings(
      [{ tagValue: "a", marginPercent: 60 }],
      [{ tagValue: "a", marginPercent: -10 }],
    );
    expect(crossings).toHaveLength(1);
  });
});
