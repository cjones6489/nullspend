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
import type { SourceBreakdown as SourceBreakdownData } from "@/lib/validations/cost-event-summary";

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

const SOURCE_LABELS: Record<string, string> = {
  proxy: "Proxy",
  api: "SDK",
  mcp: "MCP",
};

const chartConfig = {
  totalCostMicrodollars: {
    label: "Cost",
  },
} satisfies ChartConfig;

export function SourceBreakdown({
  data,
}: {
  data: SourceBreakdownData[];
}) {
  if (data.length === 0) return null;

  const chartData = data.map((d, i) => ({
    ...d,
    displayName: SOURCE_LABELS[d.source] ?? d.source,
    fill: CHART_COLORS[i % CHART_COLORS.length],
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">
          Spend by Source
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
              dataKey="displayName"
              tickLine={false}
              axisLine={false}
              width={60}
              tick={{ fontSize: 11 }}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(value) => formatMicrodollars(value as number)}
                />
              }
            />
            <Bar dataKey="totalCostMicrodollars" radius={[0, 4, 4, 0]} animationDuration={800} animationEasing="ease-out" />
          </BarChart>
        </ChartContainer>

        <div className="overflow-hidden rounded-md border border-border/50">
          <Table>
            <TableHeader>
              <TableRow className="border-border/50 hover:bg-transparent">
                <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Source
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
                <TableRow key={row.source} className="border-border/30 transition-colors hover:bg-accent/40">
                  <TableCell className="text-[13px] font-medium text-foreground">
                    {SOURCE_LABELS[row.source] ?? row.source}
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
