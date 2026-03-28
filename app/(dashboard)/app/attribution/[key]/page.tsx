"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAttributionDetail } from "@/lib/queries/attribution";
import { formatChartDollars, formatMicrodollars } from "@/lib/utils/format";

type Period = "7d" | "30d" | "90d";

const chartConfig = {
  cost: {
    label: "Spend",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig;

function formatDateLabel(dateStr: string) {
  const [year, month, day] = dateStr.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export default function AttributionDetailPage() {
  const params = useParams<{ key: string }>();
  const searchParams = useSearchParams();
  const [period, setPeriod] = useState<Period>("30d");

  const key = params.key;
  const groupBy = searchParams.get("groupBy") ?? "api_key";

  const { data, isLoading, isError } = useAttributionDetail(groupBy, key, period);

  const totalModelCost = data?.models.reduce((sum, m) => sum + m.cost, 0) ?? 0;

  const sortedModels = data
    ? [...data.models].sort((a, b) => b.cost - a.cost)
    : [];

  return (
    <div className="space-y-6">
      <Link
        href="/app/attribution"
        className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to Attribution
      </Link>

      {isLoading && <DetailSkeleton />}

      {isError && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-400">
          Failed to load attribution detail. Please try again.
        </div>
      )}

      {data && (
        <>
          <div>
            <h1 className="font-mono text-xl font-semibold tracking-tight text-foreground">
              {data.key || <span className="italic text-muted-foreground">(no key)</span>}
            </h1>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {groupBy === "api_key" ? "API Key" : groupBy}
              {" "}&middot;{" "}
              {formatMicrodollars(data.totalCostMicrodollars)} total
              {" "}&middot;{" "}
              {period === "7d" ? "7 days" : period === "30d" ? "30 days" : "90 days"}
              {" "}&middot;{" "}
              {data.requestCount.toLocaleString()} requests
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <StatCard
              label="Total Spend"
              value={formatMicrodollars(data.totalCostMicrodollars)}
              hero
            />
            <StatCard
              label="Total Requests"
              value={data.requestCount.toLocaleString()}
            />
            <StatCard
              label="Avg Cost / Request"
              value={formatMicrodollars(data.avgCostMicrodollars)}
            />
          </div>

          <Tabs value={period} onValueChange={(v) => setPeriod(v as Period)}>
            <TabsList className="h-8 bg-secondary/50 p-0.5">
              <TabsTrigger value="7d">7 days</TabsTrigger>
              <TabsTrigger value="30d">30 days</TabsTrigger>
              <TabsTrigger value="90d">90 days</TabsTrigger>
            </TabsList>
          </Tabs>

          {data.daily.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">Daily Spend</CardTitle>
              </CardHeader>
              <CardContent>
                <ChartContainer config={chartConfig} className="min-h-[200px] w-full">
                  <AreaChart data={data.daily} accessibilityLayer>
                    <CartesianGrid vertical={false} />
                    <XAxis
                      dataKey="date"
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={formatDateLabel}
                      tickMargin={8}
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={formatChartDollars}
                      width={60}
                    />
                    <ChartTooltip
                      content={
                        <ChartTooltipContent
                          labelFormatter={formatDateLabel}
                          formatter={(value) => formatMicrodollars(value as number)}
                        />
                      }
                    />
                    <defs>
                      <linearGradient id="fillDetailSpend" x1="0" y1="0" x2="0" y2="1">
                        <stop
                          offset="5%"
                          stopColor="var(--color-cost)"
                          stopOpacity={0.8}
                        />
                        <stop
                          offset="95%"
                          stopColor="var(--color-cost)"
                          stopOpacity={0.1}
                        />
                      </linearGradient>
                    </defs>
                    <Area
                      dataKey="cost"
                      type="monotone"
                      fill="url(#fillDetailSpend)"
                      stroke="var(--color-cost)"
                      strokeWidth={2}
                      animationDuration={800}
                      animationEasing="ease-out"
                    />
                  </AreaChart>
                </ChartContainer>
              </CardContent>
            </Card>
          )}

          {data.daily.length === 0 && (
            <div className="rounded-lg border border-dashed border-border/50 py-12 text-center">
              <p className="text-sm text-muted-foreground">
                No data for this key in the selected period.
              </p>
            </div>
          )}

          {sortedModels.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">Model Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-hidden rounded-lg border border-border/50">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-border/50 hover:bg-transparent">
                        <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                          Model
                        </TableHead>
                        <TableHead className="text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                          Requests
                        </TableHead>
                        <TableHead className="text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                          Cost
                        </TableHead>
                        <TableHead className="text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                          % of Total
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortedModels.map((model) => {
                        const pct = totalModelCost > 0
                          ? ((model.cost / totalModelCost) * 100).toFixed(1)
                          : "0.0";
                        return (
                          <TableRow
                            key={model.model}
                            className="border-border/30"
                          >
                            <TableCell className="font-mono text-[13px] text-foreground">
                              {model.model}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-[13px] text-foreground">
                              {model.count.toLocaleString()}
                            </TableCell>
                            <TableCell className="text-right font-mono tabular-nums text-[13px] text-foreground">
                              {formatMicrodollars(model.cost)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-[13px] text-muted-foreground">
                              {pct}%
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-6 w-48 rounded bg-secondary/50" />
      <div className="grid grid-cols-3 gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-lg bg-secondary/50" />
        ))}
      </div>
      <Skeleton className="h-[240px] w-full rounded-lg bg-secondary/50" />
      <Skeleton className="h-[200px] w-full rounded-lg bg-secondary/50" />
    </div>
  );
}
