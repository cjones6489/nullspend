/**
 * Calendar month period helpers for margin calculations.
 */

/** Get the first day of a calendar month as a Date (UTC midnight). */
export function monthStart(year: number, month: number): Date {
  return new Date(Date.UTC(year, month, 1));
}

/** Get the current calendar month start. */
export function currentMonthStart(): Date {
  const now = new Date();
  return monthStart(now.getUTCFullYear(), now.getUTCMonth());
}

/** Get the previous N calendar month starts (most recent first). */
export function previousMonthStarts(count: number): Date[] {
  const now = new Date();
  const result: Date[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    result.push(d);
  }
  return result;
}

/** Format a Date as "YYYY-MM" period string. */
export function formatPeriod(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** Parse a "YYYY-MM" period string into a Date. */
export function parsePeriod(period: string): Date {
  const [year, month] = period.split("-").map(Number);
  return monthStart(year, month - 1);
}

/** Get display label for a period. */
export function periodLabel(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}
