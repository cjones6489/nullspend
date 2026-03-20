"use client";

import { Wrench } from "lucide-react";
import { useMemo, useState } from "react";

import { EditToolCostDialog } from "@/components/tool-costs/edit-tool-cost-dialog";
import { ToolCostTable } from "@/components/tool-costs/tool-cost-table";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToolCosts } from "@/lib/queries/tool-costs";
import { formatMicrodollars } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import type { ToolCostResponse } from "@/lib/validations/tool-costs";

export default function ToolCostsPage() {
  const { data, isLoading, error } = useToolCosts();
  const [editToolCost, setEditToolCost] = useState<ToolCostResponse | null>(null);
  const [serverFilter, setServerFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const toolCosts = useMemo(() => data?.data ?? [], [data]);

  const servers = useMemo(() => {
    const set = new Set(toolCosts.map((tc) => tc.serverName));
    return [...set].sort();
  }, [toolCosts]);

  const totalTools = toolCosts.length;
  const totalServers = servers.length;
  const totalCost = toolCosts.reduce((sum, tc) => sum + tc.costMicrodollars, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Tool Costs
        </h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Configure per-tool cost tracking for MCP servers.
        </p>
      </div>

      {isLoading && <ToolCostsSkeleton />}

      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-400">
          Failed to load tool costs. Please try again.
        </div>
      )}

      {data && toolCosts.length === 0 && <EmptyToolCosts />}

      {data && toolCosts.length > 0 && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <StatCard label="Tracked tools" value={String(totalTools)} />
            <StatCard label="Servers" value={String(totalServers)} />
            <StatCard label="Avg cost / tool" value={totalTools > 0 ? formatMicrodollars(Math.round(totalCost / totalTools)) : "$0.00"} />
          </div>

          <div className="flex items-center gap-3">
            <Select value={serverFilter} onValueChange={(v) => setServerFilter(v && v !== "all" ? v : "")}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="All Servers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Servers</SelectItem>
                {servers.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={sourceFilter} onValueChange={(v) => setSourceFilter(v && v !== "all" ? v : "")}>
              <SelectTrigger className="w-36">
                <SelectValue placeholder="All Sources" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sources</SelectItem>
                <SelectItem value="manual">Manual</SelectItem>
                <SelectItem value="discovered">Default</SelectItem>
              </SelectContent>
            </Select>

            <Input
              placeholder="Search tools..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 w-48 border-border/50 bg-background text-[13px] placeholder:text-muted-foreground/50"
            />
          </div>

          <ToolCostTable
            toolCosts={toolCosts}
            serverFilter={serverFilter}
            sourceFilter={sourceFilter}
            searchQuery={searchQuery}
            onRowClick={setEditToolCost}
          />
        </>
      )}

      <EditToolCostDialog
        key={editToolCost?.id ?? "closed"}
        toolCost={editToolCost}
        onClose={() => setEditToolCost(null)}
      />
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
      <p className={cn("text-lg font-semibold tabular-nums text-foreground", className)}>
        {value}
      </p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

function EmptyToolCosts() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-border/50 py-20 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary/50">
        <Wrench className="h-5 w-5 text-muted-foreground" />
      </div>
      <div>
        <p className="text-sm font-medium text-foreground">
          No MCP tools discovered yet.
        </p>
        <p className="mt-1 max-w-sm text-xs text-muted-foreground">
          Connect an MCP server through the NullSpend proxy to automatically
          discover and track tool costs.
        </p>
      </div>
    </div>
  );
}

function ToolCostsSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-lg bg-secondary/50" />
        ))}
      </div>
      <Skeleton className="h-10 w-full rounded-lg bg-secondary/50" />
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full rounded-lg bg-secondary/50" />
      ))}
    </div>
  );
}
