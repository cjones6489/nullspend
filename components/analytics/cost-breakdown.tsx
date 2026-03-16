"use client";

import { Bar, BarChart, XAxis, YAxis } from "recharts";

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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  formatChartDollars,
  formatMicrodollars,
} from "@/lib/utils/format";
import type { CostBreakdownTotals } from "@/lib/validations/cost-event-summary";

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
];

const chartConfig = {
  cost: {
    label: "Cost",
  },
} satisfies ChartConfig;

export function CostBreakdown({
  data,
}: {
  data: CostBreakdownTotals;
}) {
  const components = [
    { name: "Input", cost: data.inputCost },
    { name: "Output", cost: data.outputCost },
    { name: "Cached", cost: data.cachedCost },
    ...(data.reasoningCost > 0
      ? [{ name: "Reasoning", cost: data.reasoningCost }]
      : []),
  ];

  const allZero = components.every((c) => c.cost === 0);
  if (allZero) return null;

  // Use sum of breakdown components as denominator (not totalCostMicrodollars)
  // so percentages sum to 100% even when MCP/pre-deploy events lack breakdown data
  const breakdownTotal = data.inputCost + data.outputCost + data.cachedCost;

  const chartData = components.map((c, i) => ({
    ...c,
    fill: CHART_COLORS[i % CHART_COLORS.length],
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">
          Cost Breakdown by Token Type
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <ChartContainer
          config={chartConfig}
          className="min-h-[100px] w-full"
        >
          <BarChart data={chartData} layout="vertical" accessibilityLayer>
            <XAxis
              type="number"
              tickLine={false}
              axisLine={false}
              tickFormatter={formatChartDollars}
            />
            <YAxis
              type="category"
              dataKey="name"
              tickLine={false}
              axisLine={false}
              width={100}
              tick={{ fontSize: 11 }}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(value) => formatMicrodollars(value as number)}
                />
              }
            />
            <Bar dataKey="cost" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ChartContainer>

        <div className="overflow-hidden rounded-md border border-border/50">
          <Table>
            <TableHeader>
              <TableRow className="border-border/50 hover:bg-transparent">
                <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Component
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
              {components.map((row) => (
                <TableRow key={row.name} className="border-border/30">
                  <TableCell className="text-[13px] font-medium text-foreground">
                    {row.name}
                  </TableCell>
                  <TableCell className="text-right text-[13px] tabular-nums text-foreground">
                    {formatMicrodollars(row.cost)}
                  </TableCell>
                  <TableCell className="text-right text-[13px] tabular-nums text-foreground">
                    {breakdownTotal > 0
                      ? `${((row.cost / breakdownTotal) * 100).toFixed(1)}%`
                      : "0.0%"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
