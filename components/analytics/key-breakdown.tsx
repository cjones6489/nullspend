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
import { formatChartDollars, formatMicrodollars } from "@/lib/utils/format";
import type { KeyBreakdown as KeyBreakdownData } from "@/lib/validations/cost-event-summary";

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

const chartConfig = {
  totalCostMicrodollars: {
    label: "Cost",
  },
} satisfies ChartConfig;

export function KeyBreakdown({ data }: { data: KeyBreakdownData[] }) {
  const chartData = data.map((d, i) => ({
    ...d,
    fill: CHART_COLORS[i % CHART_COLORS.length],
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">Spend by API Key</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {chartData.length > 0 && (
          <ChartContainer config={chartConfig} className="min-h-[160px] w-full">
            <BarChart data={chartData} layout="vertical" accessibilityLayer>
              <XAxis
                type="number"
                tickLine={false}
                axisLine={false}
                tickFormatter={formatChartDollars}
              />
              <YAxis
                type="category"
                dataKey="keyName"
                tickLine={false}
                axisLine={false}
                width={120}
                tick={{ fontSize: 11 }}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    formatter={(value) => formatMicrodollars(value as number)}
                  />
                }
              />
              <Bar dataKey="totalCostMicrodollars" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ChartContainer>
        )}

        <div className="overflow-hidden rounded-md border border-border/50">
          <Table>
            <TableHeader>
              <TableRow className="border-border/50 hover:bg-transparent">
                <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Key
                </TableHead>
                <TableHead className="text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Requests
                </TableHead>
                <TableHead className="text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Cost
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((row) => (
                <TableRow key={row.apiKeyId} className="border-border/30">
                  <TableCell className="text-[13px] font-medium text-foreground">
                    {row.keyName}
                  </TableCell>
                  <TableCell className="text-right text-[13px] tabular-nums text-foreground">
                    {row.requestCount.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right text-[13px] tabular-nums text-foreground">
                    {formatMicrodollars(row.totalCostMicrodollars)}
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
