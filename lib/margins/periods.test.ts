import { describe, it, expect } from "vitest";
import {
  monthStart,
  currentMonthStart,
  previousMonthStarts,
  formatPeriod,
  parsePeriod,
  periodLabel,
} from "./periods";

describe("monthStart", () => {
  it("returns first day of month at UTC midnight", () => {
    const d = monthStart(2026, 3); // April (0-indexed)
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(3);
    expect(d.getUTCDate()).toBe(1);
    expect(d.getUTCHours()).toBe(0);
  });

  it("handles January correctly", () => {
    const d = monthStart(2026, 0);
    expect(d.getUTCMonth()).toBe(0);
    expect(d.getUTCFullYear()).toBe(2026);
  });
});

describe("currentMonthStart", () => {
  it("returns a date on the 1st", () => {
    const d = currentMonthStart();
    expect(d.getUTCDate()).toBe(1);
  });
});

describe("previousMonthStarts", () => {
  it("returns N months most recent first", () => {
    const months = previousMonthStarts(3);
    expect(months).toHaveLength(3);
    // Most recent first
    expect(months[0].getTime()).toBeGreaterThan(months[1].getTime());
    expect(months[1].getTime()).toBeGreaterThan(months[2].getTime());
  });
});

describe("formatPeriod", () => {
  it("formats as YYYY-MM", () => {
    expect(formatPeriod(new Date(Date.UTC(2026, 3, 1)))).toBe("2026-04");
  });

  it("zero-pads single-digit months", () => {
    expect(formatPeriod(new Date(Date.UTC(2026, 0, 1)))).toBe("2026-01");
  });
});

describe("parsePeriod", () => {
  it("parses YYYY-MM to Date", () => {
    const d = parsePeriod("2026-04");
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(3); // 0-indexed
    expect(d.getUTCDate()).toBe(1);
  });
});

describe("periodLabel", () => {
  it("returns human-readable label", () => {
    const label = periodLabel(new Date(Date.UTC(2026, 3, 1)));
    expect(label).toContain("Apr");
    expect(label).toContain("2026");
  });
});
