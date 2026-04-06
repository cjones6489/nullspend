interface DailyEntry {
  date: string;
  totalCostMicrodollars: number;
}

export interface TrendDelta {
  percent: number;
  direction: "up" | "down";
}

/**
 * Calculate 7-day trend delta by comparing two 3-day windows.
 * Excludes today (last entry) since it's partial.
 * Returns null if insufficient data or older period sums to zero.
 */
export function calculateTrendDelta(daily: DailyEntry[]): TrendDelta | null {
  if (daily.length < 7) return null;

  // Exclude today (last entry), take 6 most recent complete days
  const complete = daily.slice(0, -1).slice(-6);
  if (complete.length < 6) return null;

  const olderSum =
    complete[0].totalCostMicrodollars +
    complete[1].totalCostMicrodollars +
    complete[2].totalCostMicrodollars;

  const recentSum =
    complete[3].totalCostMicrodollars +
    complete[4].totalCostMicrodollars +
    complete[5].totalCostMicrodollars;

  if (olderSum === 0) return null;

  const delta = ((recentSum - olderSum) / olderSum) * 100;
  const percent = Math.round(Math.abs(delta));

  // No meaningful change — hide the delta
  if (percent === 0) return null;

  return {
    percent,
    direction: delta < 0 ? "down" : "up",
  };
}

interface BudgetEntry {
  maxBudgetMicrodollars: number;
  spendMicrodollars: number;
}

/**
 * Sort budgets by utilization descending so the most critical surface first.
 * Budgets with zero limit sort to the end.
 */
export function sortBudgetsByUtilization<T extends BudgetEntry>(budgets: T[]): T[] {
  return [...budgets].sort((a, b) => {
    const aUtil = a.maxBudgetMicrodollars > 0 ? a.spendMicrodollars / a.maxBudgetMicrodollars : 0;
    const bUtil = b.maxBudgetMicrodollars > 0 ? b.spendMicrodollars / b.maxBudgetMicrodollars : 0;
    return bUtil - aUtil;
  });
}

/**
 * Count budgets exceeding 90% utilization.
 * Skips budgets with zero limit to avoid division by zero.
 */
export function getAlertCount(budgets: BudgetEntry[]): number {
  return budgets.filter(
    (b) =>
      b.maxBudgetMicrodollars > 0 &&
      b.spendMicrodollars / b.maxBudgetMicrodollars >= 0.9,
  ).length;
}

/**
 * Budget progress bar color based on utilization percentage.
 */
export function getBudgetColor(percent: number): "green" | "amber" | "red" {
  if (percent >= 90) return "red";
  if (percent >= 70) return "amber";
  return "green";
}

/**
 * Format a date string as relative time ("2m ago", "1h ago", "3d ago").
 */
export function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();

  if (Number.isNaN(then)) return "just now";

  const diffMs = now - then;

  if (diffMs < 0) return "just now";

  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "just now";

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}
