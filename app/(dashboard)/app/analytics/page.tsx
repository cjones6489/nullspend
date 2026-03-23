"use client";

import { BarChart3, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { CostBreakdown } from "@/components/analytics/cost-breakdown";
import { KeyBreakdown } from "@/components/analytics/key-breakdown";
import { ModelBreakdown } from "@/components/analytics/model-breakdown";
import { ProviderBreakdown } from "@/components/analytics/provider-breakdown";
import { SpendChart } from "@/components/analytics/spend-chart";
import { ToolBreakdown } from "@/components/analytics/tool-breakdown";
import { TraceBreakdown } from "@/components/analytics/trace-breakdown";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCostSummary } from "@/lib/queries/cost-event-summary";
import { formatMicrodollars } from "@/lib/utils/format";
import { cn } from "@/lib/utils";

type Period = "7d" | "30d" | "90d";

export default function AnalyticsPage() {
  const [period, setPeriod] = useState<Period>("30d");
  const { data, isLoading, isError, refetch, isFetching } = useCostSummary(period);

  const isEmpty = data && data.totals.totalRequests === 0;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            Analytics
          </h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Spend breakdown and usage trends.
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground"
          onClick={() => refetch()}
          disabled={isFetching}
          title="Refresh data"
          aria-label="Refresh data"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
        </Button>
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
            <p className="mt-1 max-w-xs text-xs text-muted-foreground">
              Point your SDK at the NullSpend proxy and costs will appear here
              within seconds.
            </p>
          </div>
          <Link
            href="/app/settings"
            className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Create API Key
          </Link>
        </div>
      )}

      {data && !isEmpty && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <StatCard
              label="Total Spend"
              value={formatMicrodollars(data.totals.totalCostMicrodollars)}
              hero
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

          {(data.costBreakdown.inputCost > 0 ||
            data.costBreakdown.outputCost > 0) && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard
                label="Input Tokens"
                value={formatMicrodollars(data.costBreakdown.inputCost)}
                className="text-base"
              />
              <StatCard
                label="Output Tokens"
                value={formatMicrodollars(data.costBreakdown.outputCost)}
                className="text-base"
              />
              <StatCard
                label="Cached Tokens"
                value={formatMicrodollars(data.costBreakdown.cachedCost)}
                className="text-base"
              />
              {data.costBreakdown.reasoningCost > 0 && (
                <StatCard
                  label="Reasoning Tokens"
                  value={formatMicrodollars(data.costBreakdown.reasoningCost)}
                  className="text-base"
                />
              )}
            </div>
          )}

          <CostBreakdown data={data.costBreakdown} />

          <SpendChart data={data.daily} />

          <ProviderBreakdown data={data.providers} />

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <ModelBreakdown data={data.models} />
            <KeyBreakdown data={data.keys} />
          </div>

          {data.tools.length > 0 && <ToolBreakdown data={data.tools} />}

          <TraceBreakdown data={data.traces} />
        </>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  className,
  hero,
}: {
  label: string;
  value: string;
  className?: string;
  hero?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-4 transition-colors",
        hero
          ? "border-primary/30 bg-primary/5"
          : "border-border/30 bg-background",
      )}
    >
      <p
        className={cn(
          "font-bold tabular-nums text-foreground",
          hero ? "text-3xl leading-tight" : "text-lg",
          className,
        )}
      >
        {value}
      </p>
      <p className={cn("text-muted-foreground", hero ? "mt-1 text-xs" : "text-[11px]")}>{label}</p>
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
