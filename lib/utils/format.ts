export function formatActionType(actionType: string): string {
  if (!actionType) return "Unknown";
  return actionType
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

export function formatTimestamp(dateString: string): string {
  return new Date(dateString).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatMicrodollars(microdollars: number): string {
  if (!Number.isFinite(microdollars)) return "Unlimited";
  const dollars = microdollars / 1_000_000;
  if (dollars >= 0.01 || dollars <= -0.01) return `$${dollars.toFixed(2)}`;
  if (dollars === 0) return "$0.00";
  if (Math.abs(dollars) < 0.00005) return "<$0.0001";
  return `$${dollars.toFixed(4).replace(/0+$/, "")}`;
}

export function formatTokens(n: number): string {
  return n.toLocaleString("en-US");
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return "--";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function budgetHealthColor(spent: number, limit: number): string {
  if (limit <= 0) return "bg-primary";
  const pct = (spent / limit) * 100;
  if (pct >= 90) return "bg-red-500";
  if (pct >= 70) return "bg-amber-500";
  return "bg-primary";
}

export function formatChartDollars(microdollars: number): string {
  const dollars = microdollars / 1_000_000;
  if (dollars === 0) return "$0";
  if (dollars >= 1000) return `$${(dollars / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  if (dollars >= 1) return `$${dollars.toFixed(dollars % 1 === 0 ? 0 : 2)}`;
  return `$${dollars.toFixed(2)}`;
}

const MS_PER_DAY = 86_400_000;

export function fillDateGaps(
  data: { date: string; totalCostMicrodollars: number }[],
  periodDays: number,
): { date: string; totalCostMicrodollars: number }[] {
  const lookup = new Map(data.map((d) => [d.date, d.totalCostMicrodollars]));
  const result: { date: string; totalCostMicrodollars: number }[] = [];
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  const todayMs = now.getTime();

  for (let i = periodDays - 1; i >= 0; i--) {
    const dateStr = new Date(todayMs - i * MS_PER_DAY).toISOString().slice(0, 10);
    result.push({ date: dateStr, totalCostMicrodollars: lookup.get(dateStr) ?? 0 });
  }

  return result;
}

const MODEL_DISPLAY_NAMES: Record<string, string> = {
  "gpt-4o": "GPT-4o",
  "gpt-4o-mini": "GPT-4o Mini",
  "gpt-4.1": "GPT-4.1",
  "gpt-4.1-mini": "GPT-4.1 Mini",
  "gpt-4.1-nano": "GPT-4.1 Nano",
  "o4-mini": "o4 Mini",
  "o3": "o3",
  "o3-mini": "o3 Mini",
  "o1": "o1",
  "gpt-5": "GPT-5",
  "gpt-5-mini": "GPT-5 Mini",
  "gpt-5-nano": "GPT-5 Nano",
  "gpt-5.1": "GPT-5.1",
  "gpt-5.2": "GPT-5.2",

  "claude-sonnet-4-6": "Claude Sonnet 4.6",
  "claude-sonnet-4-6-20260217": "Claude Sonnet 4.6",
  "claude-haiku-3.5": "Claude Haiku 3.5",
  "claude-3-5-haiku-20241022": "Claude Haiku 3.5",
  "claude-opus-4": "Claude Opus 4",
  "claude-opus-4-20250514": "Claude Opus 4",
  "claude-opus-4-0": "Claude Opus 4",
  "claude-opus-4-6": "Claude Opus 4.6",
  "claude-opus-4-6-20260205": "Claude Opus 4.6",
  "claude-sonnet-4-5": "Claude Sonnet 4.5",
  "claude-sonnet-4-5-20250929": "Claude Sonnet 4.5",
  "claude-opus-4-5": "Claude Opus 4.5",
  "claude-opus-4-5-20251101": "Claude Opus 4.5",
  "claude-opus-4-1": "Claude Opus 4.1",
  "claude-opus-4-1-20250805": "Claude Opus 4.1",
  "claude-sonnet-4": "Claude Sonnet 4",
  "claude-sonnet-4-20250514": "Claude Sonnet 4",
  "claude-sonnet-4-0": "Claude Sonnet 4",
  "claude-haiku-4-5": "Claude Haiku 4.5",
  "claude-haiku-4-5-20251001": "Claude Haiku 4.5",
  "claude-haiku-3": "Claude Haiku 3",
  "claude-3-haiku-20240307": "Claude Haiku 3",

  "gemini-2.5-pro": "Gemini 2.5 Pro",
  "gemini-2.5-flash": "Gemini 2.5 Flash",
};

export function formatModelName(model: string): string {
  return MODEL_DISPLAY_NAMES[model] ?? model;
}

const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
};

export function formatProviderName(provider: string): string {
  return (
    PROVIDER_DISPLAY_NAMES[provider] ??
    provider.charAt(0).toUpperCase() + provider.slice(1)
  );
}

export function formatExpiresAt(expiresAt: string | null): string | null {
  if (!expiresAt) return null;

  const expires = new Date(expiresAt);
  const now = new Date();
  const diffMs = expires.getTime() - now.getTime();

  if (diffMs <= 0) return "Expired";

  const diffMin = Math.floor(diffMs / 60_000);
  const diffHour = Math.floor(diffMin / 60);

  if (diffMin < 1) return "Expires in <1 min";
  if (diffMin < 60) return `Expires in ${diffMin} min`;
  if (diffHour < 24) return `Expires in ${diffHour}h ${diffMin % 60}m`;
  return `Expires in ${Math.floor(diffHour / 24)}d`;
}

export function truncateId(id: string, maxLen = 16): string {
  if (id.length <= maxLen) return id;
  return `${id.slice(0, maxLen)}\u2026`;
}
