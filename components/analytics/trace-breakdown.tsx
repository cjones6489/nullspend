"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatMicrodollars } from "@/lib/utils/format";
import type { TraceBreakdown as TraceBreakdownData } from "@/lib/validations/cost-event-summary";

export function TraceBreakdown({ data }: { data: TraceBreakdownData[] }) {
  if (data.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">Top Traces by Cost</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-hidden rounded-md border border-border/50">
          <Table>
            <TableHeader>
              <TableRow className="border-border/50 hover:bg-transparent">
                <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Trace ID
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
                <TableRow key={row.traceId} className="border-border/30">
                  <TableCell
                    className="cursor-default font-mono text-[13px] text-foreground"
                    title={row.traceId}
                  >
                    {row.traceId.slice(0, 12)}…
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
