import { describe, it, expect, vi, afterEach } from "vitest";

import { formatChartDollars, formatMicrodollars, fillDateGaps } from "./format";

describe("formatMicrodollars", () => {
  it("returns $0.00 for zero", () => {
    expect(formatMicrodollars(0)).toBe("$0.00");
  });

  it("formats standard amounts with two decimals", () => {
    expect(formatMicrodollars(10_000)).toBe("$0.01");
    expect(formatMicrodollars(100_000)).toBe("$0.10");
    expect(formatMicrodollars(1_000_000)).toBe("$1.00");
    expect(formatMicrodollars(5_500_000)).toBe("$5.50");
  });

  it("formats sub-cent amounts with up to four decimals", () => {
    expect(formatMicrodollars(5_000)).toBe("$0.005");
    expect(formatMicrodollars(1_000)).toBe("$0.001");
    expect(formatMicrodollars(500)).toBe("$0.0005");
    expect(formatMicrodollars(100)).toBe("$0.0001");
    expect(formatMicrodollars(50)).toBe("$0.0001");
  });

  it("shows <$0.0001 for values below display threshold", () => {
    expect(formatMicrodollars(1)).toBe("<$0.0001");
    expect(formatMicrodollars(5)).toBe("<$0.0001");
    expect(formatMicrodollars(10)).toBe("<$0.0001");
    expect(formatMicrodollars(49)).toBe("<$0.0001");
  });

  it("returns Unlimited for non-finite values", () => {
    expect(formatMicrodollars(Infinity)).toBe("Unlimited");
    expect(formatMicrodollars(-Infinity)).toBe("Unlimited");
    expect(formatMicrodollars(NaN)).toBe("Unlimited");
  });

  it("handles exact boundary at $0.01", () => {
    expect(formatMicrodollars(10_000)).toBe("$0.01");
    expect(formatMicrodollars(9_999)).toBe("$0.01");
  });

  it("handles negative microdollars", () => {
    expect(formatMicrodollars(-500_000)).toBe("$-0.50");
  });
});

describe("formatChartDollars", () => {
  it("returns $0 for zero", () => {
    expect(formatChartDollars(0)).toBe("$0");
  });

  it("formats sub-dollar amounts with two decimals", () => {
    expect(formatChartDollars(500_000)).toBe("$0.50");
    expect(formatChartDollars(10_000)).toBe("$0.01");
    expect(formatChartDollars(990_000)).toBe("$0.99");
  });

  it("formats clean dollar amounts without decimals", () => {
    expect(formatChartDollars(5_000_000)).toBe("$5");
    expect(formatChartDollars(100_000_000)).toBe("$100");
  });

  it("formats fractional dollar amounts with two decimals", () => {
    expect(formatChartDollars(1_500_000)).toBe("$1.50");
    expect(formatChartDollars(99_990_000)).toBe("$99.99");
  });

  it("formats thousands with K suffix", () => {
    expect(formatChartDollars(1_000_000_000)).toBe("$1K");
    expect(formatChartDollars(1_200_000_000)).toBe("$1.2K");
    expect(formatChartDollars(5_500_000_000)).toBe("$5.5K");
    expect(formatChartDollars(10_000_000_000)).toBe("$10K");
  });

  it("handles very small amounts", () => {
    expect(formatChartDollars(1_000)).toBe("$0.00");
  });

  it("handles boundary at exactly $1", () => {
    expect(formatChartDollars(1_000_000)).toBe("$1");
  });

  it("handles boundary at exactly $1000", () => {
    expect(formatChartDollars(1_000_000_000)).toBe("$1K");
  });
});

describe("fillDateGaps", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns correct number of entries for the period", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T12:00:00Z"));

    const result = fillDateGaps([], 7);
    expect(result).toHaveLength(7);
  });

  it("fills missing dates with zero cost", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T12:00:00Z"));

    const data = [{ date: "2026-03-08", totalCostMicrodollars: 5_000_000 }];
    const result = fillDateGaps(data, 7);

    expect(result).toHaveLength(7);
    const mar8 = result.find((d) => d.date === "2026-03-08");
    expect(mar8?.totalCostMicrodollars).toBe(5_000_000);

    const zeros = result.filter((d) => d.totalCostMicrodollars === 0);
    expect(zeros).toHaveLength(6);
  });

  it("preserves existing data entries", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T00:00:00Z"));

    const data = [
      { date: "2026-03-04", totalCostMicrodollars: 1_000_000 },
      { date: "2026-03-07", totalCostMicrodollars: 2_000_000 },
      { date: "2026-03-10", totalCostMicrodollars: 3_000_000 },
    ];
    const result = fillDateGaps(data, 7);

    expect(result.find((d) => d.date === "2026-03-04")?.totalCostMicrodollars).toBe(1_000_000);
    expect(result.find((d) => d.date === "2026-03-07")?.totalCostMicrodollars).toBe(2_000_000);
    expect(result.find((d) => d.date === "2026-03-10")?.totalCostMicrodollars).toBe(3_000_000);
  });

  it("returns dates in ascending chronological order", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T00:00:00Z"));

    const result = fillDateGaps([], 7);
    const dates = result.map((d) => d.date);

    expect(dates).toEqual([
      "2026-03-04",
      "2026-03-05",
      "2026-03-06",
      "2026-03-07",
      "2026-03-08",
      "2026-03-09",
      "2026-03-10",
    ]);
  });

  it("handles a 1-day period (today only)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T00:00:00Z"));

    const result = fillDateGaps([], 1);
    expect(result).toHaveLength(1);
    expect(result[0].date).toBe("2026-03-10");
  });

  it("handles a 30-day period", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T00:00:00Z"));

    const result = fillDateGaps([], 30);
    expect(result).toHaveLength(30);
    expect(result[0].date).toBe("2026-02-09");
    expect(result[29].date).toBe("2026-03-10");
  });

  it("handles 90-day period spanning year boundary", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-01T00:00:00Z"));

    const result = fillDateGaps([], 90);
    expect(result).toHaveLength(90);
    expect(result[0].date).toBe("2025-11-04");
    expect(result[89].date).toBe("2026-02-01");
  });

  it("uses UTC dates to avoid timezone-related off-by-one errors", () => {
    vi.useFakeTimers();
    // Set time near midnight UTC to test boundary behavior
    vi.setSystemTime(new Date("2026-03-10T23:59:59Z"));

    const result = fillDateGaps([], 3);
    expect(result).toHaveLength(3);
    expect(result[2].date).toBe("2026-03-10");
    expect(result[1].date).toBe("2026-03-09");
    expect(result[0].date).toBe("2026-03-08");
  });

  it("ignores data entries outside the period range", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T00:00:00Z"));

    const data = [
      { date: "2026-02-01", totalCostMicrodollars: 999_999 },
      { date: "2026-03-10", totalCostMicrodollars: 1_000_000 },
    ];
    const result = fillDateGaps(data, 7);

    expect(result.find((d) => d.date === "2026-02-01")).toBeUndefined();
    expect(result.find((d) => d.date === "2026-03-10")?.totalCostMicrodollars).toBe(1_000_000);
  });

  it("returns all zeros when data array is empty", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T00:00:00Z"));

    const result = fillDateGaps([], 7);
    expect(result.every((d) => d.totalCostMicrodollars === 0)).toBe(true);
  });

  it("handles data with all dates present (no gaps to fill)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-05T00:00:00Z"));

    const data = [
      { date: "2026-03-03", totalCostMicrodollars: 100 },
      { date: "2026-03-04", totalCostMicrodollars: 200 },
      { date: "2026-03-05", totalCostMicrodollars: 300 },
    ];
    const result = fillDateGaps(data, 3);

    expect(result).toEqual(data);
  });
});
