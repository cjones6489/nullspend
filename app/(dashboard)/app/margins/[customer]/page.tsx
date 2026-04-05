"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowLeft, Shield } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useCustomerDetail, type HealthTier } from "@/lib/queries/margins";
import { formatMicrodollars, formatModelName } from "@/lib/utils/format";
import { cn } from "@/lib/utils";

const HEALTH_COLORS: Record<HealthTier, string> = {
  healthy: "text-green-400",
  moderate: "text-blue-400",
  at_risk: "text-amber-400",
  critical: "text-red-400",
};

const HEALTH_LABELS: Record<HealthTier, string> = {
  healthy: "Healthy",
  moderate: "Moderate",
  at_risk: "At Risk",
  critical: "Critical",
};

function currentPeriod(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default function CustomerDetailPage() {
  const params = useParams<{ customer: string }>();
  const tagValue = decodeURIComponent(params.customer);
  const [period] = useState(currentPeriod());

  const { data, isLoading, isError } = useCustomerDetail(tagValue, period);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-[250px] w-full rounded-lg bg-secondary/50" />
        <Skeleton className="h-[200px] w-full rounded-lg bg-secondary/50" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="space-y-4">
        <Link href="/app/margins" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3 w-3" /> Back to Margins
        </Link>
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-400">
          Customer not found or data unavailable.
        </div>
      </div>
    );
  }

  const chartData = data.revenueOverTime.map((d) => ({
    period: d.period,
    revenue: d.revenue / 1_000_000,
    cost: d.cost / 1_000_000,
  }));

  return (
    <div className="space-y-6">
      {/* Back link + header */}
      <Link href="/app/margins" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3 w-3" /> Back to Margins
      </Link>

      <div className="flex items-center gap-3">
        {data.avatarUrl ? (
          <img src={data.avatarUrl} alt="" className="h-10 w-10 rounded-full" />
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-sm font-bold text-muted-foreground">
            {(data.customerName ?? tagValue).charAt(0).toUpperCase()}
          </div>
        )}
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            {data.customerName ?? tagValue}
          </h1>
          <div className="flex items-center gap-2 mt-0.5">
            <span className={cn("text-sm font-medium", HEALTH_COLORS[data.healthTier])}>
              {HEALTH_LABELS[data.healthTier]}
            </span>
            <span className="text-sm text-muted-foreground">
              {data.marginPercent.toFixed(1)}% margin
            </span>
          </div>
        </div>
      </div>

      {/* Summary row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-border/30 bg-background p-4">
          <p className="font-mono text-lg font-bold tabular-nums text-foreground">
            {formatMicrodollars(data.revenueMicrodollars)}
          </p>
          <p className="text-[11px] text-muted-foreground">Revenue</p>
        </div>
        <div className="rounded-lg border border-border/30 bg-background p-4">
          <p className="font-mono text-lg font-bold tabular-nums text-foreground">
            {formatMicrodollars(data.costMicrodollars)}
          </p>
          <p className="text-[11px] text-muted-foreground">AI Cost</p>
        </div>
        <div className="rounded-lg border border-border/30 bg-background p-4">
          <p className={cn(
            "font-mono text-lg font-bold tabular-nums",
            data.marginPercent < 0 ? "text-red-400" : "text-foreground",
          )}>
            {formatMicrodollars(data.revenueMicrodollars - data.costMicrodollars)}
          </p>
          <p className="text-[11px] text-muted-foreground">Margin</p>
        </div>
      </div>

      {/* Revenue vs Cost chart */}
      <div className="rounded-lg border border-border/50 bg-card p-4">
        <p className="mb-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Revenue vs AI Cost
        </p>
        <div className="h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="fillRevenue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#22c55e" stopOpacity={0.2} />
                  <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="fillCost" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ef4444" stopOpacity={0.2} />
                  <stop offset="100%" stopColor="#ef4444" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
              <XAxis
                dataKey="period"
                tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tickFormatter={(v: number) => `$${v}`}
                tick={{ fontSize: 11, fill: "var(--muted-foreground)", fontFamily: "var(--font-mono)" }}
                axisLine={false}
                tickLine={false}
                width={50}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload as { period: string; revenue: number; cost: number };
                  return (
                    <div className="rounded-md border border-border/50 bg-popover px-3 py-2 shadow-md">
                      <p className="text-[11px] text-muted-foreground">{d.period}</p>
                      <p className="text-xs text-green-400">Revenue: ${d.revenue.toFixed(2)}</p>
                      <p className="text-xs text-red-400">Cost: ${d.cost.toFixed(2)}</p>
                    </div>
                  );
                }}
              />
              <Area dataKey="revenue" stroke="#22c55e" fill="url(#fillRevenue)" strokeWidth={1.5} dot={false} />
              <Area dataKey="cost" stroke="#ef4444" fill="url(#fillCost)" strokeWidth={1.5} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Model breakdown */}
      {data.modelBreakdown.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border/50 bg-card">
          <div className="border-b border-border/30 px-4 py-2">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Cost by Model
            </p>
          </div>
          <Table>
            <TableHeader>
              <TableRow className="border-border/50 hover:bg-transparent">
                <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Model</TableHead>
                <TableHead className="text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Cost</TableHead>
                <TableHead className="text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Requests</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.modelBreakdown.map((m) => (
                <TableRow key={m.model} className="border-border/30">
                  <TableCell className="text-[13px] font-medium text-foreground">
                    {formatModelName(m.model)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums text-[13px]">
                    {formatMicrodollars(m.cost)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-[13px] text-muted-foreground">
                    {m.requestCount.toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Budget CTA for critical */}
      {data.healthTier === "critical" && data.revenueMicrodollars > 0 && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-red-400" />
            <p className="text-sm font-medium text-red-400">This customer is unprofitable</p>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Set a budget cap of {formatMicrodollars(Math.round(data.revenueMicrodollars * 0.5))}/mo to restore 50% margin.
          </p>
          <Link
            href={`/app/budgets?prefill=tag&entityId=customer%3D${encodeURIComponent(tagValue)}&maxBudget=${Math.round(data.revenueMicrodollars * 0.5)}`}
            className="mt-2 inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Set Budget Cap
          </Link>
        </div>
      )}
    </div>
  );
}
