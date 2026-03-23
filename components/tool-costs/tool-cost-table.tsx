"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatMicrodollars, formatRelativeTime } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import type { ToolCostResponse } from "@/lib/validations/tool-costs";

interface ToolCostTableProps {
  toolCosts: ToolCostResponse[];
  serverFilter: string;
  sourceFilter: string;
  searchQuery: string;
  onRowClick: (tc: ToolCostResponse) => void;
}

export function ToolCostTable({
  toolCosts,
  serverFilter,
  sourceFilter,
  searchQuery,
  onRowClick,
}: ToolCostTableProps) {
  const filtered = toolCosts.filter((tc) => {
    if (serverFilter && tc.serverName !== serverFilter) return false;
    if (sourceFilter && tc.source !== sourceFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (!tc.toolName.toLowerCase().includes(q) && !tc.serverName.toLowerCase().includes(q)) {
        return false;
      }
    }
    return true;
  });

  // Group by server
  const grouped = new Map<string, ToolCostResponse[]>();
  for (const tc of filtered) {
    const list = grouped.get(tc.serverName) ?? [];
    list.push(tc);
    grouped.set(tc.serverName, list);
  }

  // Sort servers alphabetically, tools within each server alphabetically
  const sortedServers = [...grouped.keys()].sort();

  if (filtered.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/50 py-10 text-center">
        <p className="text-sm text-muted-foreground">
          No tools match your filters.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border/50 bg-card">
      <Table>
        <TableHeader>
          <TableRow className="border-border/50 hover:bg-transparent">
            <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Server / Tool
            </TableHead>
            <TableHead className="text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Cost
            </TableHead>
            <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Source
            </TableHead>
            <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Last Seen
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedServers.flatMap((serverName) => {
            const tools = grouped.get(serverName)!.sort((a, b) =>
              a.toolName.localeCompare(b.toolName),
            );

            return [
              <TableRow
                key={`server-${serverName}`}
                className="border-border/30 bg-secondary/30 hover:bg-secondary/30"
              >
                <TableCell
                  colSpan={4}
                  className="py-1.5 text-[12px] font-semibold text-foreground"
                >
                  {serverName}
                </TableCell>
              </TableRow>,
              ...tools.map((tc) => (
                <TableRow
                  key={tc.id}
                  className="cursor-pointer border-border/30 transition-colors hover:bg-accent/40"
                  onClick={() => onRowClick(tc)}
                >
                  <TableCell className="pl-8">
                    <p className="text-[13px] font-medium text-foreground">{tc.toolName}</p>
                    {tc.description && (
                      <p className="text-[11px] text-muted-foreground line-clamp-1">
                        {tc.description}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-[13px] tabular-nums text-foreground">
                    {tc.costMicrodollars === 0 && tc.source === "discovered" ? (
                      <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-400">
                        Unpriced
                      </span>
                    ) : (
                      formatMicrodollars(tc.costMicrodollars)
                    )}
                  </TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[11px] font-medium",
                        tc.source === "manual"
                          ? "bg-blue-500/10 text-blue-400"
                          : "bg-secondary text-muted-foreground",
                      )}
                    >
                      {tc.source === "manual" ? "manual" : "discovered"}
                    </span>
                  </TableCell>
                  <TableCell className="text-[12px] text-muted-foreground">
                    {tc.lastSeenAt ? formatRelativeTime(tc.lastSeenAt) : "--"}
                  </TableCell>
                </TableRow>
              )),
            ];
          })}
        </TableBody>
      </Table>
    </div>
  );
}
