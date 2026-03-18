"use client";

import { Activity, ArrowDown, ArrowUp, ArrowUpDown, Loader2, RefreshCw } from "lucide-react";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useCostEvents } from "@/lib/queries/cost-events";
import {
  formatDuration,
  formatMicrodollars,
  formatModelName,
  formatProviderName,
  formatRelativeTime,
  formatTokens,
} from "@/lib/utils/format";

interface RecentActivityProps {
  keys: { id: string; name: string }[];
  initialProvider?: string;
}

const ALL_KEYS = "all";
const ALL_PROVIDERS = "all";

type SortField = "createdAt" | "cost" | "toks" | "latency" | "input" | "output";
type SortDir = "asc" | "desc";

function SortIcon({ field, active, dir }: { field: string; active: string | null; dir: SortDir }) {
  if (active !== field) return <ArrowUpDown className="ml-1 inline h-3 w-3 opacity-30" />;
  return dir === "asc"
    ? <ArrowUp className="ml-1 inline h-3 w-3" />
    : <ArrowDown className="ml-1 inline h-3 w-3" />;
}

export function RecentActivity({ keys, initialProvider }: RecentActivityProps) {
  const [selectedKeyId, setSelectedKeyId] = useState(ALL_KEYS);
  const [selectedProvider, setSelectedProvider] = useState(initialProvider ?? ALL_PROVIDERS);
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  }

  const filters = {
    ...(selectedKeyId !== ALL_KEYS ? { apiKeyId: selectedKeyId } : {}),
    ...(selectedProvider !== ALL_PROVIDERS
      ? { provider: selectedProvider }
      : {}),
  };
  const {
    data,
    isLoading,
    error,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
    refetch,
    isFetching,
  } = useCostEvents(filters);

  const rawEvents = data?.pages.flatMap((p) => p.data) ?? [];

  const events = useMemo(() => {
    if (!sortField) return rawEvents;
    const sorted = [...rawEvents].sort((a, b) => {
      let aVal: number, bVal: number;
      switch (sortField) {
        case "createdAt": aVal = new Date(a.createdAt).getTime(); bVal = new Date(b.createdAt).getTime(); break;
        case "cost": aVal = a.costMicrodollars; bVal = b.costMicrodollars; break;
        case "input": aVal = a.inputTokens; bVal = b.inputTokens; break;
        case "output": aVal = a.outputTokens; bVal = b.outputTokens; break;
        case "toks": aVal = a.durationMs ? (a.outputTokens / a.durationMs) : 0; bVal = b.durationMs ? (b.outputTokens / b.durationMs) : 0; break;
        case "latency": aVal = a.durationMs ?? 0; bVal = b.durationMs ?? 0; break;
        default: return 0;
      }
      return sortDir === "asc" ? aVal - bVal : bVal - aVal;
    });
    return sorted;
  }, [rawEvents, sortField, sortDir]);
  const hasFilter =
    selectedKeyId !== ALL_KEYS || selectedProvider !== ALL_PROVIDERS;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
          title="Refresh data"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching && !isFetchingNextPage ? "animate-spin" : ""}`} />
        </button>
        <Select
          value={selectedProvider}
          onValueChange={(v) => setSelectedProvider(v ?? ALL_PROVIDERS)}
        >
          <SelectTrigger className="h-8 w-[150px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_PROVIDERS}>All providers</SelectItem>
            <SelectItem value="openai">OpenAI</SelectItem>
            <SelectItem value="anthropic">Anthropic</SelectItem>
          </SelectContent>
        </Select>
        {keys.length > 0 && (
          <Select
            value={selectedKeyId}
            onValueChange={(v) => setSelectedKeyId(v ?? ALL_KEYS)}
          >
            <SelectTrigger className="h-8 w-[180px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_KEYS}>All keys</SelectItem>
              {keys.map((key) => (
                <SelectItem key={key.id} value={key.id}>
                  {key.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {isLoading && <ActivitySkeleton />}

      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-400">
          Failed to load cost events. Please try again.
        </div>
      )}

      {!isLoading && !error && events.length === 0 && (
        <EmptyActivity hasFilter={hasFilter} />
      )}

      {!isLoading && !error && events.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border/50 bg-card">
          <Table>
            <TableHeader>
              <TableRow className="border-border/50 hover:bg-transparent">
                <TableHead
                  className="cursor-pointer select-none text-[11px] font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground"
                  onClick={() => toggleSort("createdAt")}
                >
                  Time <SortIcon field="createdAt" active={sortField} dir={sortDir} />
                </TableHead>
                <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Model
                </TableHead>
                {selectedKeyId === ALL_KEYS && (
                  <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Key
                  </TableHead>
                )}
                <TableHead
                  className="cursor-pointer select-none text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground"
                  onClick={() => toggleSort("input")}
                >
                  Input <SortIcon field="input" active={sortField} dir={sortDir} />
                </TableHead>
                <TableHead
                  className="cursor-pointer select-none text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground"
                  onClick={() => toggleSort("output")}
                >
                  Output <SortIcon field="output" active={sortField} dir={sortDir} />
                </TableHead>
                <TableHead
                  className="cursor-pointer select-none text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground"
                  onClick={() => toggleSort("cost")}
                >
                  Cost <SortIcon field="cost" active={sortField} dir={sortDir} />
                </TableHead>
                <TableHead
                  className="cursor-pointer select-none text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground"
                  onClick={() => toggleSort("toks")}
                  title="Output tokens per second — measures model throughput"
                >
                  Tok/s <SortIcon field="toks" active={sortField} dir={sortDir} />
                </TableHead>
                <TableHead
                  className="cursor-pointer select-none text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground"
                  onClick={() => toggleSort("latency")}
                >
                  Latency <SortIcon field="latency" active={sortField} dir={sortDir} />
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((event) => (
                <TableRow
                  key={event.id}
                  className="border-border/30 transition-colors hover:bg-accent/40"
                >
                  <TableCell
                    className="text-[13px] text-muted-foreground cursor-default"
                    title={new Date(event.createdAt).toLocaleString()}
                  >
                    {formatRelativeTime(event.createdAt)}
                  </TableCell>
                  <TableCell>
                    <p className="text-[11px] text-muted-foreground">
                      {formatProviderName(event.provider)}
                    </p>
                    <p className="font-mono text-[13px] text-foreground">
                      {formatModelName(event.model)}
                    </p>
                  </TableCell>
                  {selectedKeyId === ALL_KEYS && (
                    <TableCell className="text-[13px] text-muted-foreground">
                      {event.keyName}
                    </TableCell>
                  )}
                  <TableCell className="text-right">
                    <span className="tabular-nums text-[13px] text-foreground">
                      {formatTokens(event.inputTokens)}
                    </span>
                    {event.cachedInputTokens > 0 && (
                      <p className="text-[11px] text-muted-foreground">
                        {formatTokens(event.cachedInputTokens)} cached
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="tabular-nums text-[13px] text-foreground">
                      {formatTokens(event.outputTokens)}
                    </span>
                    {event.reasoningTokens > 0 && (
                      <p className="text-[11px] text-muted-foreground">
                        {formatTokens(event.reasoningTokens)} reasoning
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums text-[13px] text-foreground">
                    {formatMicrodollars(event.costMicrodollars)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-[13px] text-muted-foreground">
                    {event.durationMs && event.durationMs > 0
                      ? `${Math.round((event.outputTokens / event.durationMs) * 1000)}`
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-[13px] text-muted-foreground">
                    {formatDuration(event.durationMs)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {hasNextPage && (
            <div className="flex justify-center border-t border-border/30 py-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                className="text-xs"
              >
                {isFetchingNextPage ? (
                  <>
                    <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                    Loading...
                  </>
                ) : (
                  "Load More"
                )}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EmptyActivity({ hasFilter }: { hasFilter: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-border/50 py-20 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary/50">
        <Activity className="h-5 w-5 text-muted-foreground" />
      </div>
      <div>
        <p className="text-sm font-medium text-foreground">
          {hasFilter ? "No cost events match your filters" : "No API calls recorded yet"}
        </p>
        <p className="mt-1 max-w-xs text-xs text-muted-foreground">
          {hasFilter
            ? "Try adjusting your provider or API key filters."
            : "Set your OPENAI_BASE_URL to proxy.nullspend.com/v1 and costs will appear here within seconds."}
        </p>
      </div>
    </div>
  );
}

function ActivitySkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full rounded-lg bg-secondary/50" />
      ))}
    </div>
  );
}
