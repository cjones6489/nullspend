"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  RefreshCw,
  Trash2,
  TrendingDown,
  X,
  XCircle,
} from "lucide-react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
} from "recharts";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/ui/stat-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useMarginTable,
  useSyncNow,
  useConnectStripe,
  useUnmatchedCustomers,
  useCustomerMappings,
  useCreateMapping,
  useDeleteMapping,
  type HealthTier,
  type SparklinePoint,
  type UnmatchedStripeCustomer,
  type UnmappedTagValue,
  type PendingAutoMatch,
  type CustomerMappingResponse,
} from "@/lib/queries/margins";
import { formatMicrodollars } from "@/lib/utils/format";
import { cn } from "@/lib/utils";

type SortField = "customer" | "revenue" | "cost" | "marginPercent" | "marginDollars";
type SortDir = "asc" | "desc";

function currentPeriod(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function previousPeriods(count: number): string[] {
  const now = new Date();
  const periods: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    periods.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return periods;
}

const HEALTH_CONFIG: Record<HealthTier, { label: string; color: string; bg: string; icon: typeof Check }> = {
  healthy: { label: "Healthy", color: "text-green-400", bg: "bg-green-400/10", icon: Check },
  moderate: { label: "Moderate", color: "text-blue-400", bg: "bg-blue-400/10", icon: ArrowDown },
  at_risk: { label: "At Risk", color: "text-amber-400", bg: "bg-amber-400/10", icon: AlertTriangle },
  critical: { label: "Critical", color: "text-red-400", bg: "bg-red-400/10", icon: XCircle },
};

function HealthBadge({ tier }: { tier: HealthTier }) {
  const config = HEALTH_CONFIG[tier];
  const Icon = config.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", config.bg, config.color)}>
      <Icon className="h-3 w-3" />
      {config.label}
    </span>
  );
}

function MiniSparkline({ id, data }: { id: string; data: SparklinePoint[] }) {
  // Use the last actual (non-projected) point for color
  const lastActual = [...data].reverse().find((d) => !d.projected);
  const color = lastActual && lastActual.marginPercent < 0
    ? "var(--color-destructive, #ef4444)"
    : "var(--color-primary, #22c55e)";

  const gradientId = `spark-${id}`;
  const hasProjection = data.some((d) => d.projected);

  // For the projected dashed line, we need actual + projected as separate series.
  // "actual" has marginPercent for non-projected points, null for projected.
  // "projected" has null for all but last actual + projected points (to connect them).
  const chartData = data.map((d, i) => ({
    period: d.period,
    actual: d.projected ? null : d.marginPercent,
    projected: (d.projected || (hasProjection && i === data.length - 2)) ? d.marginPercent : null,
  }));

  return (
    <div className="h-6 w-16">
      <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
        <AreaChart data={hasProjection ? chartData : data}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.3} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            dataKey={hasProjection ? "actual" : "marginPercent"}
            stroke={color}
            fill={`url(#${gradientId})`}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
            connectNulls={false}
          />
          {hasProjection && (
            <Area
              dataKey="projected"
              stroke={color}
              fill="none"
              strokeWidth={1.5}
              strokeDasharray="3 3"
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function SortIcon({ field, active, dir }: { field: string; active: string; dir: SortDir }) {
  if (active !== field) return <ArrowUpDown className="ml-1 inline h-3 w-3 opacity-30" />;
  return dir === "asc"
    ? <ArrowUp className="ml-1 inline h-3 w-3" />
    : <ArrowDown className="ml-1 inline h-3 w-3" />;
}

export default function MarginsPage() {
  const router = useRouter();
  const periods = useMemo(() => previousPeriods(6), []);
  const [period, setPeriod] = useState(currentPeriod());
  const [sortField, setSortField] = useState<SortField>("marginPercent");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [stripeKey, setStripeKey] = useState("");

  const { data, isLoading, isError, refetch, isFetching } = useMarginTable(period);
  const syncNow = useSyncNow();
  const connectStripe = useConnectStripe();

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortField(field);
      setSortDir(field === "customer" ? "asc" : "desc");
    }
  }

  const sorted = useMemo(() => {
    if (!data?.customers) return [];
    const items = [...data.customers];
    items.sort((a, b) => {
      let aVal: number | string, bVal: number | string;
      switch (sortField) {
        case "customer": aVal = a.customerName ?? a.tagValue; bVal = b.customerName ?? b.tagValue; break;
        case "revenue": aVal = a.revenueMicrodollars; bVal = b.revenueMicrodollars; break;
        case "cost": aVal = a.costMicrodollars; bVal = b.costMicrodollars; break;
        case "marginPercent": aVal = a.marginPercent; bVal = b.marginPercent; break;
        case "marginDollars": aVal = a.marginMicrodollars; bVal = b.marginMicrodollars; break;
        default: return 0;
      }
      if (typeof aVal === "string") {
        return sortDir === "asc" ? aVal.localeCompare(bVal as string) : (bVal as string).localeCompare(aVal);
      }
      return sortDir === "asc" ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
    });
    return items;
  }, [data, sortField, sortDir]);

  const summary = data?.summary;
  const isEmpty = data && data.customers.length === 0;
  const isDisconnected = summary?.syncStatus === "disconnected";

  const handleSync = () => {
    syncNow.mutate(undefined, {
      onSuccess: () => {
        toast.success("Sync complete");
        refetch();
      },
      onError: () => toast.error("Sync failed"),
    });
  };

  const handleConnect = () => {
    if (!stripeKey.trim()) return;
    connectStripe.mutate(stripeKey.trim(), {
      onSuccess: () => {
        toast.success("Stripe connected");
        setStripeKey("");
        // Refetch connection status first so the Sync Now button appears,
        // then trigger sync so the user sees the spinner.
        refetch().then(() => {
          syncNow.mutate(undefined, {
            onSuccess: () => {
              toast.success("Initial sync complete");
              refetch();
            },
            onError: () => toast.error("Initial sync failed — try Sync Now"),
          });
        });
      },
      onError: (err) => toast.error(err.message),
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Margins</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {summary && !isDisconnected && !isEmpty
              ? `${summary.blendedMarginPercent.toFixed(0)}% margin | ${summary.criticalCount} critical, ${summary.atRiskCount} at risk`
              : "Customer profitability by Stripe revenue vs AI cost."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={period} onValueChange={(v) => v && setPeriod(v)}>
            <SelectTrigger className="h-8 w-[140px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {periods.map((p) => {
                const d = new Date(p + "-01");
                return (
                  <SelectItem key={p} value={p}>
                    {d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          {!isDisconnected && data && data.customers.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => window.open(`/api/margins?period=${period}&format=csv`, "_blank")}
            >
              <Download className="mr-1.5 h-3 w-3" />
              CSV
            </Button>
          )}
          {!isDisconnected && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={handleSync}
              disabled={syncNow.isPending || isFetching}
            >
              <RefreshCw className={cn("mr-1.5 h-3 w-3", syncNow.isPending && "animate-spin")} />
              Sync Now
            </Button>
          )}
        </div>
      </div>

      {/* Loading */}
      {isLoading && <MarginsSkeleton />}

      {/* Error */}
      {isError && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-400">
          Failed to load margin data. Please try again.
        </div>
      )}

      {/* Empty state: no Stripe or no data */}
      {isDisconnected && (
        <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-border/50 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary/50">
            <TrendingDown className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">Connect Stripe to see margins</p>
            <p className="mt-1 max-w-sm text-xs text-muted-foreground">
              Paste a Stripe restricted key with invoice and customer read access.
              We&apos;ll sync your revenue and match customers to AI costs.
            </p>
          </div>
          <div className="flex gap-2">
            <input
              type="password"
              placeholder="rk_live_..."
              value={stripeKey}
              onChange={(e) => setStripeKey(e.target.value)}
              className="h-9 w-72 rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/50"
            />
            <Button
              size="sm"
              className="h-9"
              onClick={handleConnect}
              disabled={connectStripe.isPending || !stripeKey.trim()}
            >
              {connectStripe.isPending ? "Connecting..." : "Connect"}
            </Button>
          </div>
        </div>
      )}

      {/* Connection error/revoked state */}
      {(summary?.syncStatus === "error" || summary?.syncStatus === "revoked") && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-400">
          {summary.syncStatus === "revoked"
            ? "Your Stripe key was revoked. Disconnect and reconnect with a new restricted key."
            : `Sync error: ${summary.lastSyncAt ? "Last successful sync " + new Date(summary.lastSyncAt).toLocaleString() : "Never synced successfully"}.`}
        </div>
      )}

      {/* Multi-currency banner */}
      {summary?.skippedCurrencies && Object.keys(summary.skippedCurrencies).length > 0 && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-400">
          {(() => {
            const entries = Object.entries(summary.skippedCurrencies);
            const parts = entries.map(([curr, count]) =>
              `${count} ${count === 1 ? "invoice" : "invoices"} in ${curr.toUpperCase()}`
            );
            return `${parts.join(", ")} skipped. Margins show USD revenue only.`;
          })()}
        </div>
      )}

      {/* Customer Mapping Management — visible when Stripe is connected and healthy */}
      {!isDisconnected && !isLoading && summary?.syncStatus !== "error" && summary?.syncStatus !== "revoked" && (
        <CustomerMappingsSection />
      )}

      {isEmpty && !isDisconnected && (
        <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-border/50 py-16 text-center">
          <p className="text-sm font-medium text-foreground">No customer mappings yet</p>
          <p className="mt-1 max-w-sm text-xs text-muted-foreground">
            Tag your API requests with <code className="rounded bg-muted px-1">X-NullSpend-Tags: customer=acme-corp</code> to
            see per-customer margins.
          </p>
        </div>
      )}

      {/* Data loaded */}
      {data && !isEmpty && !isDisconnected && (
        <>
          {/* Summary stats */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard
              label="Blended Margin"
              value={`${summary!.blendedMarginPercent.toFixed(1)}%`}
              hero
            />
            <StatCard
              label="Revenue"
              value={formatMicrodollars(summary!.totalRevenueMicrodollars)}
            />
            <StatCard
              label="AI Cost"
              value={formatMicrodollars(summary!.totalCostMicrodollars)}
            />
            <StatCard
              label="Critical / At Risk"
              value={`${summary!.criticalCount} / ${summary!.atRiskCount}`}
            />
          </div>

          {/* Table — desktop */}
          <div className="hidden md:block overflow-hidden rounded-lg border border-border/50 bg-card">
            <Table>
              <TableHeader>
                <TableRow className="border-border/50 hover:bg-transparent">
                  <TableHead
                    className="cursor-pointer select-none text-[11px] font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground"
                    onClick={() => toggleSort("customer")}
                  >
                    Customer <SortIcon field="customer" active={sortField} dir={sortDir} />
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground"
                    onClick={() => toggleSort("revenue")}
                  >
                    Revenue <SortIcon field="revenue" active={sortField} dir={sortDir} />
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground"
                    onClick={() => toggleSort("cost")}
                  >
                    AI Cost <SortIcon field="cost" active={sortField} dir={sortDir} />
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground"
                    onClick={() => toggleSort("marginPercent")}
                  >
                    Margin % <SortIcon field="marginPercent" active={sortField} dir={sortDir} />
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground"
                    onClick={() => toggleSort("marginDollars")}
                  >
                    Margin $ <SortIcon field="marginDollars" active={sortField} dir={sortDir} />
                  </TableHead>
                  <TableHead className="text-center text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Health
                  </TableHead>
                  <TableHead className="text-center text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Trend
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((c) => (
                  <TableRow
                    key={c.tagValue}
                    className="border-border/30 cursor-pointer transition-colors hover:bg-accent/40"
                    onClick={() => router.push(`/app/margins/${encodeURIComponent(c.tagValue)}`)}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {c.avatarUrl ? (
                          <img src={c.avatarUrl} alt="" className="h-6 w-6 rounded-full" />
                        ) : (
                          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground">
                            {(c.customerName ?? c.tagValue).charAt(0).toUpperCase()}
                          </div>
                        )}
                        <span className="text-[13px] font-medium text-foreground">
                          {c.customerName ?? c.tagValue}
                        </span>
                      </div>
                      {/* Budget suggestion banner */}
                      {c.budgetSuggestionMicrodollars !== null && (
                        <div className="mt-1 text-[11px] text-amber-400">
                          Set a {formatMicrodollars(c.budgetSuggestionMicrodollars)}/mo budget cap to restore margin →
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-[13px]">
                      {formatMicrodollars(c.revenueMicrodollars)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-[13px]">
                      {formatMicrodollars(c.costMicrodollars)}
                    </TableCell>
                    <TableCell className={cn(
                      "text-right font-mono tabular-nums text-[13px] font-medium",
                      c.marginPercent < 0 ? "text-red-400" : c.marginPercent < 20 ? "text-amber-400" : "text-foreground",
                    )}>
                      {c.marginPercent.toFixed(1)}%
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-[13px]">
                      {formatMicrodollars(c.marginMicrodollars)}
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="inline-flex items-center gap-1">
                        <HealthBadge tier={c.healthTier} />
                        {c.projectedTierWorsening && (
                          <span title="Projected to worsen">
                            <TrendingDown className="h-3 w-3 text-amber-400" />
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <MiniSparkline id={c.tagValue} data={c.sparkline} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile card layout */}
          <div className="flex flex-col gap-3 md:hidden">
            {sorted.map((c) => (
              <Link
                key={c.tagValue}
                href={`/app/margins/${encodeURIComponent(c.tagValue)}`}
                className="rounded-lg border border-border/50 bg-card p-4 transition-colors hover:bg-accent/40"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {c.avatarUrl ? (
                      <img src={c.avatarUrl} alt="" className="h-8 w-8 rounded-full" />
                    ) : (
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">
                        {(c.customerName ?? c.tagValue).charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div>
                      <p className="text-sm font-medium text-foreground">{c.customerName ?? c.tagValue}</p>
                      <HealthBadge tier={c.healthTier} />
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={cn(
                      "font-mono text-lg font-semibold tabular-nums",
                      c.marginPercent < 0 ? "text-red-400" : "text-foreground",
                    )}>
                      {c.marginPercent.toFixed(1)}%
                    </p>
                    <MiniSparkline id={c.tagValue} data={c.sparkline} />
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <div>
                    <p className="text-[10px] text-muted-foreground">Revenue</p>
                    <p className="font-mono text-xs tabular-nums">{formatMicrodollars(c.revenueMicrodollars)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground">AI Cost</p>
                    <p className="font-mono text-xs tabular-nums">{formatMicrodollars(c.costMicrodollars)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground">Margin</p>
                    <p className="font-mono text-xs tabular-nums">{formatMicrodollars(c.marginMicrodollars)}</p>
                  </div>
                </div>
                {c.budgetSuggestionMicrodollars !== null && (
                  <div className="mt-2 rounded bg-amber-400/10 px-2 py-1 text-[11px] text-amber-400">
                    Budget cap suggestion: {formatMicrodollars(c.budgetSuggestionMicrodollars)}/mo
                  </div>
                )}
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Customer Mapping Management ─────────────────────────────────────

function CustomerMappingsSection() {
  const [open, setOpen] = useState(true);
  const { data: unmatched, isLoading, isError } = useUnmatchedCustomers();
  const { data: mappings } = useCustomerMappings();
  const createMapping = useCreateMapping();
  const deleteMapping = useDeleteMapping();

  const customerNames = unmatched?.customerNames ?? {};
  const confirmedMappings = mappings?.filter((m) => m.matchType === "manual" && m.tagKey === "customer") ?? [];
  const isMutating = createMapping.isPending || deleteMapping.isPending;

  const hasPending = (unmatched?.pendingAutoMatches.length ?? 0) > 0;
  const hasUnmatched = (unmatched?.unmatchedStripeCustomers.length ?? 0) > 0;
  const hasConfirmed = confirmedMappings.length > 0;
  const totalCount =
    (unmatched?.pendingAutoMatches.length ?? 0) +
    (unmatched?.unmatchedStripeCustomers.length ?? 0) +
    confirmedMappings.length;

  if (isLoading) return null;
  // If unmatched endpoint errors but we have confirmed mappings, still show them
  if (isError && !hasConfirmed) {
    return (
      <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-xs text-red-400">
        Failed to load customer mapping data.
      </div>
    );
  }
  if (!hasPending && !hasUnmatched && !hasConfirmed) return null;

  const handleConfirm = (match: PendingAutoMatch) => {
    createMapping.mutate(
      { stripeCustomerId: match.stripeCustomerId, tagValue: match.tagValue },
      {
        onSuccess: () => toast.success(`Confirmed mapping for ${match.customerName ?? match.stripeCustomerId}`),
        onError: () => toast.error("Failed to confirm mapping"),
      },
    );
  };

  const handleReject = (match: PendingAutoMatch) => {
    deleteMapping.mutate(match.id, {
      onSuccess: () => toast.success("Auto-match rejected"),
      onError: () => toast.error("Failed to reject mapping"),
    });
  };

  const handleManualMap = (customer: UnmatchedStripeCustomer, tagValue: string) => {
    createMapping.mutate(
      { stripeCustomerId: customer.stripeCustomerId, tagValue },
      {
        onSuccess: () => toast.success(`Mapped ${customer.customerName ?? customer.stripeCustomerId} → ${tagValue}`),
        onError: () => toast.error("Failed to create mapping"),
      },
    );
  };

  const handleRemove = (mapping: CustomerMappingResponse) => {
    deleteMapping.mutate(mapping.id, {
      onSuccess: () => toast.success("Mapping removed"),
      onError: () => toast.error("Failed to remove mapping"),
    });
  };

  return (
    <div className="rounded-lg border border-border/50 bg-card">
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-3 text-left"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="text-sm font-medium text-foreground">
          Customer Mappings
          <span className="ml-2 text-xs text-muted-foreground">({totalCount})</span>
        </span>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>

      {open && (
        <div className="space-y-4 border-t border-border/50 px-4 py-4">
          {/* Inline error when unmatched endpoint fails but confirmed mappings loaded */}
          {isError && (
            <div className="rounded-md border border-red-500/20 bg-red-500/5 p-2 text-xs text-red-400">
              Could not load unmatched customers and auto-matches.
            </div>
          )}

          {/* Pending Auto-Matches */}
          {hasPending && (
            <div>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Pending Auto-Matches ({unmatched!.pendingAutoMatches.length})
              </p>
              <div className="space-y-2">
                {unmatched!.pendingAutoMatches.map((match) => (
                  <div
                    key={match.id}
                    className="flex items-center justify-between rounded-md border border-border/30 bg-background px-3 py-2"
                  >
                    <div className="flex items-center gap-2 text-[13px]">
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-400/10 text-[10px] font-bold text-blue-400">
                        {(match.customerName ?? match.stripeCustomerId).charAt(0).toUpperCase()}
                      </div>
                      <span className="font-medium text-foreground">
                        {match.customerName ?? match.stripeCustomerId}
                      </span>
                      <span className="text-muted-foreground">→</span>
                      <code className="rounded bg-muted px-1 text-xs">{match.tagValue}</code>
                      {match.confidence !== null && (
                        <span className="text-[11px] text-muted-foreground">
                          ({(match.confidence * 100).toFixed(0)}%)
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-green-400 hover:bg-green-400/10 hover:text-green-300"
                        onClick={() => handleConfirm(match)}
                        disabled={isMutating}
                      >
                        <Check className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-red-400 hover:bg-red-400/10 hover:text-red-300"
                        onClick={() => handleReject(match)}
                        disabled={isMutating}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Unmatched Stripe Customers */}
          {hasUnmatched && (
            <div>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Unmatched Stripe Customers ({unmatched!.unmatchedStripeCustomers.length})
              </p>
              <div className="space-y-2">
                {unmatched!.unmatchedStripeCustomers.map((customer) => (
                  <UnmatchedCustomerRow
                    key={customer.stripeCustomerId}
                    customer={customer}
                    tagOptions={unmatched!.unmappedTagValues}
                    onMap={handleManualMap}
                    disabled={isMutating}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Confirmed Mappings */}
          {hasConfirmed && (
            <div>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Confirmed Mappings ({confirmedMappings.length})
              </p>
              <div className="space-y-2">
                {confirmedMappings.map((mapping) => (
                  <div
                    key={mapping.id}
                    className="flex items-center justify-between rounded-md border border-border/30 bg-background px-3 py-2"
                  >
                    <div className="flex items-center gap-2 text-[13px]">
                      <span className="font-medium text-foreground">
                        {customerNames[mapping.stripeCustomerId] ?? mapping.stripeCustomerId}
                      </span>
                      <span className="text-muted-foreground">→</span>
                      <code className="rounded bg-muted px-1 text-xs">{mapping.tagValue}</code>
                      <span className="text-[11px] text-muted-foreground">({mapping.matchType})</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-red-400"
                      onClick={() => handleRemove(mapping)}
                      disabled={isMutating}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function UnmatchedCustomerRow({
  customer,
  tagOptions,
  onMap,
  disabled,
}: {
  customer: UnmatchedStripeCustomer;
  tagOptions: UnmappedTagValue[];
  onMap: (customer: UnmatchedStripeCustomer, tagValue: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border/30 bg-background px-3 py-2">
      <div className="flex items-center gap-2 text-[13px]">
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground">
          {(customer.customerName ?? customer.stripeCustomerId).charAt(0).toUpperCase()}
        </div>
        <div>
          <span className="font-medium text-foreground">
            {customer.customerName ?? customer.stripeCustomerId}
          </span>
          <span className="ml-2 text-[11px] text-muted-foreground">
            ({formatMicrodollars(customer.totalRevenueMicrodollars)} revenue)
          </span>
        </div>
      </div>
      <div className="w-56">
        {tagOptions.length > 0 ? (
          <Select
            defaultValue=""
            onValueChange={(v) => { if (v) onMap(customer, v); }}
            disabled={disabled}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Select tag value..." />
            </SelectTrigger>
            <SelectContent>
              {tagOptions.map((t) => (
                <SelectItem key={t.tagValue} value={t.tagValue}>
                  {t.tagValue} ({formatMicrodollars(t.totalCostMicrodollars)})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="text-xs text-muted-foreground">No unmapped tags</span>
        )}
      </div>
    </div>
  );
}

function MarginsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-lg bg-secondary/50" />
        ))}
      </div>
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full rounded-lg bg-secondary/50" />
        ))}
      </div>
    </div>
  );
}
