"use client";

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
import { formatChartDollars, formatMicrodollars } from "@/lib/utils/format";
import type { DailySpend } from "@/lib/validations/cost-event-summary";

const chartConfig = {
  totalCostMicrodollars: {
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

export function SpendChart({ data }: { data: DailySpend[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">Daily Spend</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="min-h-[200px] w-full">
          <AreaChart data={data} accessibilityLayer>
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
              tick={{ fontFamily: "var(--font-mono)" }}
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
              <linearGradient id="fillSpend" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor="var(--color-totalCostMicrodollars)"
                  stopOpacity={0.8}
                />
                <stop
                  offset="95%"
                  stopColor="var(--color-totalCostMicrodollars)"
                  stopOpacity={0.1}
                />
              </linearGradient>
            </defs>
            <Area
              dataKey="totalCostMicrodollars"
              type="monotone"
              fill="url(#fillSpend)"
              stroke="var(--color-totalCostMicrodollars)"
              strokeWidth={2}
              animationDuration={800}
              animationEasing="ease-out"
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
