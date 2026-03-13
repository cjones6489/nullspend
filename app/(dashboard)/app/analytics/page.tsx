"use client";

import { BarChart3 } from "lucide-react";
import { useState } from "react";

import { KeyBreakdown } from "@/components/analytics/key-breakdown";
import { ModelBreakdown } from "@/components/analytics/model-breakdown";
import { ProviderBreakdown } from "@/components/analytics/provider-breakdown";
import { SpendChart } from "@/components/analytics/spend-chart";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCostSummary } from "@/lib/queries/cost-event-summary";
import { formatMicrodollars } from "@/lib/utils/format";
import { cn } from "@/lib/utils";

type Period = "7d" | "30d" | "90d";

export default function AnalyticsPage() {
  const [period, setPeriod] = useState<Period>("30d");
  const { data, isLoading, isError } = useCostSummary(period);

  const isEmpty = data && data.totals.totalRequests === 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Analytics
        </h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Spend breakdown and usage trends.
        </p>
      </div>

      <Tabs value={period} onValueChange={(v) => setPeriod(v as Period)}>
        <TabsList className="h-8 bg-secondary/50 p-0.5">
          <TabsTrigger value="7d">7 days</TabsTrigger>
          <TabsTrigger value="30d">30 days</TabsTrigger>
          <TabsTrigger value="90d">90 days</TabsTrigger>
        </TabsList>
      </Tabs>

      {isLoading && <AnalyticsSkeleton />}

      {isError && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4">
          <p className="text-[13px] text-red-400">
            Failed to load analytics. Please try again.
          </p>
        </div>
      )}

      {isEmpty && (
        <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-border/50 py-20 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary/50">
            <BarChart3 className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">
              No API calls during this period
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Try a longer time range, or run the seed script for test data.
            </p>
          </div>
        </div>
      )}

      {data && !isEmpty && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <StatCard
              label="Total Spend"
              value={formatMicrodollars(data.totals.totalCostMicrodollars)}
            />
            <StatCard
              label="Total Requests"
              value={data.totals.totalRequests.toLocaleString()}
            />
            <StatCard
              label="Avg Cost / Request"
              value={
                data.totals.totalRequests > 0
                  ? formatMicrodollars(
                      Math.round(
                        data.totals.totalCostMicrodollars /
                          data.totals.totalRequests,
                      ),
                    )
                  : "$0.00"
              }
            />
          </div>

          <SpendChart data={data.daily} />

          <ProviderBreakdown data={data.providers} />

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <ModelBreakdown data={data.models} />
            <KeyBreakdown data={data.keys} />
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className="rounded-lg border border-border/30 bg-background p-3">
      <p
        className={cn(
          "text-lg font-semibold tabular-nums text-foreground",
          className,
        )}
      >
        {value}
      </p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

function AnalyticsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-lg bg-secondary/50" />
        ))}
      </div>
      <Skeleton className="h-[240px] w-full rounded-lg bg-secondary/50" />
      <Skeleton className="h-[200px] w-full rounded-lg bg-secondary/50" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Skeleton className="h-[300px] w-full rounded-lg bg-secondary/50" />
        <Skeleton className="h-[300px] w-full rounded-lg bg-secondary/50" />
      </div>
    </div>
  );
}
