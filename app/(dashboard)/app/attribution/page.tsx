"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, Download, PieChart, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { useAttribution, useTagKeys } from "@/lib/queries/attribution";
import { formatMicrodollars } from "@/lib/utils/format";
import { cn } from "@/lib/utils";

type Period = "7d" | "30d" | "90d";
type SortField = "cost" | "requests" | "avg";
type SortDir = "asc" | "desc";

function SortIcon({ field, active, dir }: { field: string; active: string; dir: SortDir }) {
  if (active !== field) return <ArrowUpDown className="ml-1 inline h-3 w-3 opacity-30" />;
  return dir === "asc"
    ? <ArrowUp className="ml-1 inline h-3 w-3" />
    : <ArrowDown className="ml-1 inline h-3 w-3" />;
}

export default function AttributionPage() {
  const router = useRouter();
  const [period, setPeriod] = useState<Period>("30d");
  const [groupBy, setGroupBy] = useState<string>("api_key");
  const [sortField, setSortField] = useState<SortField>("cost");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const { data, isLoading, isError, refetch, isFetching } = useAttribution(groupBy, period);
  const { data: tagKeys } = useTagKeys();

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  }

  const totalCost = data?.groups.reduce((sum, g) => sum + g.totalCostMicrodollars, 0) ?? 0;
  const totalRequests = data?.groups.reduce((sum, g) => sum + g.requestCount, 0) ?? 0;

  const sorted = useMemo(() => {
    if (!data) return [];
    const groups = [...data.groups];
    groups.sort((a, b) => {
      let aVal: number, bVal: number;
      switch (sortField) {
        case "cost":
          aVal = a.totalCostMicrodollars;
          bVal = b.totalCostMicrodollars;
          break;
        case "requests":
          aVal = a.requestCount;
          bVal = b.requestCount;
          break;
        case "avg":
          aVal = a.avgCostMicrodollars;
          bVal = b.avgCostMicrodollars;
          break;
        default:
          return 0;
      }
      return sortDir === "asc" ? aVal - bVal : bVal - aVal;
    });
    return groups;
  }, [data, sortField, sortDir]);

  const isEmpty = data && data.groups.length === 0;

  const groupByOptions = [
    { value: "api_key", label: "API Key" },
    { value: "model", label: "Model" },
    { value: "provider", label: "Provider" },
    { value: "session", label: "Session" },
    ...(tagKeys ?? []).map((k) => ({ value: `tag:${k}`, label: `Tag: ${k}` })),
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            Attribution
          </h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Cost breakdown by customer, API key, or tag.
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

      <div className="flex items-center justify-between gap-4">
        <Tabs value={period} onValueChange={(v) => setPeriod(v as Period)}>
          <TabsList className="h-8 bg-secondary/50 p-0.5">
            <TabsTrigger value="7d">7 days</TabsTrigger>
            <TabsTrigger value="30d">30 days</TabsTrigger>
            <TabsTrigger value="90d">90 days</TabsTrigger>
          </TabsList>
        </Tabs>

        <Select
          value={groupBy}
          onValueChange={(v) => setGroupBy(v ?? "api_key")}
        >
          <SelectTrigger className="h-8 w-[180px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {groupByOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading && <AttributionSkeleton />}

      {isError && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-400">
          Failed to load attribution data. Please try again.
        </div>
      )}

      {isEmpty && (
        <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-border/50 py-20 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary/50">
            <PieChart className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">
              No cost data yet
            </p>
            <p className="mt-1 max-w-xs text-xs text-muted-foreground">
              Point your SDK at the NullSpend proxy and attribution data will
              appear here within seconds.
            </p>
          </div>
          <Link
            href="/app/settings/api-keys"
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
              value={formatMicrodollars(totalCost)}
              hero
            />
            <StatCard
              label="Total Requests"
              value={totalRequests.toLocaleString()}
            />
            <StatCard
              label="Avg Cost / Request"
              value={
                totalRequests > 0
                  ? formatMicrodollars(Math.round(totalCost / totalRequests))
                  : "$0.00"
              }
            />
          </div>

          <div className="overflow-hidden rounded-lg border border-border/50 bg-card">
            <div className="flex items-center justify-between border-b border-border/30 px-4 py-2">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Showing {sorted.length} of {data.totalGroups} groups
                {data.hasMore && " (load more below)"}
              </p>
              <button
                type="button"
                onClick={() => {
                  const params = new URLSearchParams();
                  params.set("groupBy", groupBy);
                  params.set("period", period);
                  params.set("format", "csv");
                  window.location.href = `/api/cost-events/attribution?${params.toString()}`;
                }}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                title="Export as CSV"
                aria-label="Export as CSV"
              >
                <Download className="h-3.5 w-3.5" />
              </button>
            </div>
            <Table>
              <TableHeader>
                <TableRow className="border-border/50 hover:bg-transparent">
                  <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Key
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground"
                    onClick={() => toggleSort("cost")}
                  >
                    Cost <SortIcon field="cost" active={sortField} dir={sortDir} />
                  </TableHead>
                  <TableHead className="text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    % of Total
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground"
                    onClick={() => toggleSort("requests")}
                  >
                    Requests <SortIcon field="requests" active={sortField} dir={sortDir} />
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground"
                    onClick={() => toggleSort("avg")}
                  >
                    Avg Cost <SortIcon field="avg" active={sortField} dir={sortDir} />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((group) => {
                  const pct = totalCost > 0
                    ? ((group.totalCostMicrodollars / totalCost) * 100).toFixed(1)
                    : "0.0";
                  return (
                    <TableRow
                      key={group.keyId ?? group.key}
                      className="border-border/30 cursor-pointer transition-colors hover:bg-accent/40"
                      onClick={(e) => {
                        const url = `/app/attribution/${encodeURIComponent(group.keyId || group.key)}?groupBy=${encodeURIComponent(groupBy)}`;
                        if (e.metaKey || e.ctrlKey || e.button === 1) {
                          window.open(url, "_blank");
                        } else {
                          router.push(url);
                        }
                      }}
                      onAuxClick={(e) => {
                        if (e.button === 1) {
                          window.open(
                            `/app/attribution/${encodeURIComponent(group.keyId || group.key)}?groupBy=${encodeURIComponent(groupBy)}`,
                            "_blank",
                          );
                        }
                      }}
                    >
                      <TableCell className="text-[13px] text-foreground">
                        {group.key ? (
                          <span className="font-mono">{group.key}</span>
                        ) : (
                          <span className="italic text-muted-foreground">(no key)</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums text-[13px] text-foreground">
                        {formatMicrodollars(group.totalCostMicrodollars)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-[13px] text-muted-foreground">
                        {pct}%
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-[13px] text-foreground">
                        {group.requestCount.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums text-[13px] text-muted-foreground">
                        {formatMicrodollars(group.avgCostMicrodollars)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}

function AttributionSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-lg bg-secondary/50" />
        ))}
      </div>
      <Skeleton className="h-[300px] w-full rounded-lg bg-secondary/50" />
    </div>
  );
}
