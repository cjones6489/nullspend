import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  calculateTrendDelta,
  getAlertCount,
  getBudgetColor,
  formatRelativeTime,
  sortBudgetsByUtilization,
} from "./dashboard";

describe("calculateTrendDelta", () => {
  const day = (date: string, cost: number) => ({
    date,
    totalCostMicrodollars: cost,
  });

  it("returns null for fewer than 7 days", () => {
    const daily = [day("2026-04-03", 100), day("2026-04-04", 200), day("2026-04-05", 50)];
    expect(calculateTrendDelta(daily)).toBeNull();
  });

  it("returns null when older period sums to zero", () => {
    const daily = [
      day("2026-03-30", 0),
      day("2026-03-31", 0),
      day("2026-04-01", 0),
      day("2026-04-02", 100),
      day("2026-04-03", 200),
      day("2026-04-04", 300),
      day("2026-04-05", 50), // today, excluded
    ];
    expect(calculateTrendDelta(daily)).toBeNull();
  });

  it("returns null when both halves are equal (0% change)", () => {
    const daily = [
      day("2026-03-30", 100),
      day("2026-03-31", 200),
      day("2026-04-01", 300),
      day("2026-04-02", 100),
      day("2026-04-03", 200),
      day("2026-04-04", 300),
      day("2026-04-05", 999), // today, excluded
    ];
    expect(calculateTrendDelta(daily)).toBeNull();
  });

  it("shows spend up when recent > older", () => {
    const daily = [
      day("2026-03-30", 100),
      day("2026-03-31", 100),
      day("2026-04-01", 100),
      day("2026-04-02", 200),
      day("2026-04-03", 200),
      day("2026-04-04", 200),
      day("2026-04-05", 50), // today, excluded
    ];
    const result = calculateTrendDelta(daily);
    // older: 300, recent: 600 → +100%
    expect(result).toEqual({ percent: 100, direction: "up" });
  });

  it("shows spend down when recent < older", () => {
    const daily = [
      day("2026-03-30", 200),
      day("2026-03-31", 200),
      day("2026-04-01", 200),
      day("2026-04-02", 100),
      day("2026-04-03", 100),
      day("2026-04-04", 100),
      day("2026-04-05", 50), // today, excluded
    ];
    const result = calculateTrendDelta(daily);
    // older: 600, recent: 300 → -50%
    expect(result).toEqual({ percent: 50, direction: "down" });
  });

  it("excludes today (last entry) from calculation", () => {
    // Today's value is huge but should not affect the result
    const daily = [
      day("2026-03-30", 100),
      day("2026-03-31", 100),
      day("2026-04-01", 100),
      day("2026-04-02", 100),
      day("2026-04-03", 100),
      day("2026-04-04", 100),
      day("2026-04-05", 999_999), // today, excluded
    ];
    // older: 300, recent: 300 → 0% → null
    expect(calculateTrendDelta(daily)).toBeNull();
  });

  it("handles small fractional delta that rounds to zero", () => {
    // older: 1000+1000+1000 = 3000, recent: 1001+1000+1000 = 3001
    // delta = 0.033% → rounds to 0 → null
    const daily = [
      day("2026-03-30", 1000),
      day("2026-03-31", 1000),
      day("2026-04-01", 1000),
      day("2026-04-02", 1001),
      day("2026-04-03", 1000),
      day("2026-04-04", 1000),
      day("2026-04-05", 0),
    ];
    expect(calculateTrendDelta(daily)).toBeNull();
  });
});

describe("sortBudgetsByUtilization", () => {
  const b = (id: string, spend: number, max: number) => ({
    id,
    entityId: id,
    spendMicrodollars: spend,
    maxBudgetMicrodollars: max,
  });

  it("sorts highest utilization first", () => {
    const budgets = [
      b("low", 200, 1000),    // 20%
      b("critical", 950, 1000), // 95%
      b("mid", 700, 1000),    // 70%
    ];
    const sorted = sortBudgetsByUtilization(budgets);
    expect(sorted.map((x) => x.id)).toEqual(["critical", "mid", "low"]);
  });

  it("puts zero-limit budgets at the end", () => {
    const budgets = [
      b("no-limit", 500, 0),    // 0 (zero limit)
      b("critical", 950, 1000), // 95%
    ];
    const sorted = sortBudgetsByUtilization(budgets);
    expect(sorted.map((x) => x.id)).toEqual(["critical", "no-limit"]);
  });

  it("surfaces overspent budgets above at-limit budgets", () => {
    const budgets = [
      b("at-limit", 1000, 1000),   // 100%
      b("overspent", 1500, 1000),  // 150%
    ];
    const sorted = sortBudgetsByUtilization(budgets);
    expect(sorted.map((x) => x.id)).toEqual(["overspent", "at-limit"]);
  });

  it("does not mutate the original array", () => {
    const budgets = [b("b", 900, 1000), b("a", 100, 1000)];
    const sorted = sortBudgetsByUtilization(budgets);
    expect(sorted).not.toBe(budgets);
    expect(budgets[0].id).toBe("b");
  });

  it("handles empty array", () => {
    expect(sortBudgetsByUtilization([])).toEqual([]);
  });

  it("sorts negative spend below zero-utilization budgets", () => {
    const budgets = [
      b("negative", -200, 1000),  // -20%
      b("healthy", 300, 1000),    // 30%
      b("zero", 0, 1000),         // 0%
    ];
    const sorted = sortBudgetsByUtilization(budgets);
    expect(sorted.map((x) => x.id)).toEqual(["healthy", "zero", "negative"]);
  });
});

describe("getAlertCount", () => {
  it("returns 0 for empty array", () => {
    expect(getAlertCount([])).toBe(0);
  });

  it("counts budgets at or over 90% utilization", () => {
    const budgets = [
      { maxBudgetMicrodollars: 1000, spendMicrodollars: 950 }, // 95%
      { maxBudgetMicrodollars: 1000, spendMicrodollars: 500 }, // 50%
      { maxBudgetMicrodollars: 1000, spendMicrodollars: 910 }, // 91%
    ];
    expect(getAlertCount(budgets)).toBe(2);
  });

  it("includes budgets at exactly 90%", () => {
    const budgets = [
      { maxBudgetMicrodollars: 1000, spendMicrodollars: 900 }, // exactly 90%
    ];
    expect(getAlertCount(budgets)).toBe(1);
  });

  it("skips budgets with zero limit", () => {
    const budgets = [
      { maxBudgetMicrodollars: 0, spendMicrodollars: 100 },
      { maxBudgetMicrodollars: 1000, spendMicrodollars: 950 },
    ];
    expect(getAlertCount(budgets)).toBe(1);
  });

  it("handles negative spend without counting as alert", () => {
    const budgets = [
      { maxBudgetMicrodollars: 1000, spendMicrodollars: -50 },
    ];
    expect(getAlertCount(budgets)).toBe(0);
  });

  it("counts overspent budgets (>100%) as alerts", () => {
    const budgets = [
      { maxBudgetMicrodollars: 1000, spendMicrodollars: 1500 }, // 150%
    ];
    expect(getAlertCount(budgets)).toBe(1);
  });
});

describe("getBudgetColor", () => {
  it("returns green below 70%", () => {
    expect(getBudgetColor(0)).toBe("green");
    expect(getBudgetColor(50)).toBe("green");
    expect(getBudgetColor(69.9)).toBe("green");
  });

  it("returns amber at 70% boundary and above", () => {
    expect(getBudgetColor(70)).toBe("amber");
    expect(getBudgetColor(85)).toBe("amber");
    expect(getBudgetColor(89.9)).toBe("amber");
  });

  it("returns red at 90% and above", () => {
    expect(getBudgetColor(90)).toBe("red");
    expect(getBudgetColor(95)).toBe("red");
    expect(getBudgetColor(100)).toBe("red");
  });

  it("returns red above 100% (overspent)", () => {
    expect(getBudgetColor(150)).toBe("red");
  });
});

describe("formatRelativeTime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-05T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'just now' for times under 60 seconds ago", () => {
    expect(formatRelativeTime("2026-04-05T11:59:30Z")).toBe("just now");
  });

  it("returns minutes ago", () => {
    expect(formatRelativeTime("2026-04-05T11:55:00Z")).toBe("5m ago");
  });

  it("returns hours ago", () => {
    expect(formatRelativeTime("2026-04-05T09:00:00Z")).toBe("3h ago");
  });

  it("returns days ago", () => {
    expect(formatRelativeTime("2026-04-03T12:00:00Z")).toBe("2d ago");
  });

  it("returns 'just now' for future timestamps", () => {
    expect(formatRelativeTime("2026-04-05T13:00:00Z")).toBe("just now");
  });

  it("returns 'just now' for invalid date string", () => {
    expect(formatRelativeTime("not-a-date")).toBe("just now");
  });

  it("returns 'just now' for empty string", () => {
    expect(formatRelativeTime("")).toBe("just now");
  });
});
