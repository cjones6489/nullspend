"use client";

import { Activity, ArrowDown, ArrowUp, ArrowUpDown, Download, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { formatBreakdownTitle } from "@/components/usage/cost-breakdown-bar";
import {
  formatDuration,
  formatMicrodollars,
  formatModelName,
  formatProviderName,
  formatRelativeTime,
  formatTokens,
  truncateId,
} from "@/lib/utils/format";

interface RecentActivityProps {
  keys: { id: string; name: string }[];
  initialProvider?: string;
}

const ALL_KEYS = "all";
const ALL_PROVIDERS = "all";
const ALL_SOURCES = "all";
const ALL_BUDGET_STATUS = "all";

const SOURCE_LABELS: Record<string, string> = {
  proxy: "Proxy",
  api: "SDK",
  mcp: "MCP",
};

type SortField = "createdAt" | "cost" | "toks" | "latency" | "input" | "output";
type SortDir = "asc" | "desc";

function SortIcon({ field, active, dir }: { field: string; active: string | null; dir: SortDir }) {
  if (active !== field) return <ArrowUpDown className="ml-1 inline h-3 w-3 opacity-50" />;
  return dir === "asc"
    ? <ArrowUp className="ml-1 inline h-3 w-3" />
    : <ArrowDown className="ml-1 inline h-3 w-3" />;
}

export function RecentActivity({ keys, initialProvider }: RecentActivityProps) {
  const router = useRouter();
  const [selectedKeyId, setSelectedKeyId] = useState(ALL_KEYS);
  const [selectedProvider, setSelectedProvider] = useState(initialProvider ?? ALL_PROVIDERS);
  const [selectedSource, setSelectedSource] = useState(ALL_SOURCES);
  const [selectedBudgetStatus, setSelectedBudgetStatus] = useState(ALL_BUDGET_STATUS);
  const [modelFilter, setModelFilter] = useState("");
  const [modelInput, setModelInput] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    debounceRef.current = setTimeout(() => setModelFilter(modelInput.trim()), 400);
    return () => clearTimeout(debounceRef.current);
  }, [modelInput]);
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
    ...(selectedSource !== ALL_SOURCES
      ? { source: selectedSource as "proxy" | "api" | "mcp" }
      : {}),
    ...(selectedBudgetStatus !== ALL_BUDGET_STATUS
      ? { budgetStatus: selectedBudgetStatus as "skipped" | "approved" | "denied" }
      : {}),
    ...(modelFilter ? { model: modelFilter } : {}),
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

  const events = useMemo(() => {
    const rawEvents = data?.pages.flatMap((p) => p.data) ?? [];
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
  }, [data, sortField, sortDir]);
  const hasFilter =
    selectedKeyId !== ALL_KEYS || selectedProvider !== ALL_PROVIDERS || selectedSource !== ALL_SOURCES || selectedBudgetStatus !== ALL_BUDGET_STATUS || !!modelFilter;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={async () => {
            const params = new URLSearchParams();
            if (selectedProvider !== ALL_PROVIDERS) params.set("provider", selectedProvider);
            if (selectedSource !== ALL_SOURCES) params.set("source", selectedSource);
            if (modelFilter) params.set("model", modelFilter);
            if (selectedKeyId !== ALL_KEYS) params.set("apiKeyId", selectedKeyId);
            const qs = params.toString();
            const url = `/api/cost-events/export${qs ? `?${qs}` : ""}`;
            try {
              const res = await fetch(url);
              if (!res.ok) {
                toast.error(res.status === 401 ? "Session expired — please log in again" : "Export failed");
                return;
              }
              const blob = await res.blob();
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = res.headers.get("content-disposition")?.match(/filename="(.+)"/)?.[1] ?? "nullspend-export.csv";
              a.click();
              URL.revokeObjectURL(a.href);
              toast.success("Export downloaded");
            } catch {
              toast.error("Export failed — check your connection");
            }
          }}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="Export as CSV"
          aria-label="Export as CSV"
        >
          <Download className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
          title="Refresh data"
          aria-label="Refresh data"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching && !isFetchingNextPage ? "animate-spin" : ""}`} />
        </button>
        <Select
          value={selectedProvider}
          onValueChange={(v) => setSelectedProvider(v ?? ALL_PROVIDERS)}
          items={[
            { value: ALL_PROVIDERS, label: "All providers" },
            { value: "openai", label: "OpenAI" },
            { value: "anthropic", label: "Anthropic" },
          ]}
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
        <Select
          value={selectedSource}
          onValueChange={(v) => setSelectedSource(v ?? ALL_SOURCES)}
        >
          <SelectTrigger className="h-8 w-[120px] text-xs">
            <SelectValue placeholder="All sources" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_SOURCES}>All sources</SelectItem>
            <SelectItem value="proxy">Proxy</SelectItem>
            <SelectItem value="api">SDK</SelectItem>
            <SelectItem value="mcp">MCP</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={selectedBudgetStatus}
          onValueChange={(v) => setSelectedBudgetStatus(v ?? ALL_BUDGET_STATUS)}
        >
          <SelectTrigger className="h-8 w-[130px] text-xs">
            <SelectValue placeholder="All status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_BUDGET_STATUS}>All status</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="denied">Denied</SelectItem>
            <SelectItem value="skipped">Skipped</SelectItem>
          </SelectContent>
        </Select>
        <Input
          type="text"
          placeholder="Filter by model..."
          value={modelInput}
          onChange={(e) => setModelInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              clearTimeout(debounceRef.current);
              setModelFilter(modelInput.trim());
            }
          }}
          className="h-8 w-[160px] text-xs"
        />
        {modelFilter && (
          <button
            type="button"
            onClick={() => { setModelFilter(""); setModelInput(""); }}
            className="text-xs text-muted-foreground hover:text-foreground"
            title="Clear model filter"
          >
            &times;
          </button>
        )}
        {keys.length > 0 && (
          <Select
            value={selectedKeyId}
            onValueChange={(v) => setSelectedKeyId(v ?? ALL_KEYS)}
            items={[
              { value: ALL_KEYS, label: "All keys" },
              ...keys.map((key) => ({ value: key.id, label: key.name })),
            ]}
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
                <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Source
                </TableHead>
                <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Key
                </TableHead>
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
                <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Session
                </TableHead>
                <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Trace
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((event) => (
                <TableRow
                  key={event.id}
                  className="border-border/30 cursor-pointer transition-colors hover:bg-accent/40"
                  onClick={(e) => {
                    const url = `/app/cost-events/${event.id}?from=activity`;
                    if (e.metaKey || e.ctrlKey || e.button === 1) {
                      window.open(url, "_blank");
                    } else {
                      router.push(url);
                    }
                  }}
                  onAuxClick={(e) => {
                    if (e.button === 1) {
                      window.open(`/app/cost-events/${event.id}?from=activity`, "_blank");
                    }
                  }}
                >
                  <TableCell
                    className="text-[13px] text-muted-foreground"
                    title={new Date(event.createdAt).toLocaleString()}
                  >
                    {formatRelativeTime(event.createdAt)}
                  </TableCell>
                  <TableCell className="max-w-[180px]">
                    <p className="text-[11px] text-muted-foreground">
                      {formatProviderName(event.provider)}
                    </p>
                    <p className="truncate font-mono text-[13px] text-foreground" title={event.model}>
                      {formatModelName(event.model)}
                    </p>
                  </TableCell>
                  <TableCell>
                    <SourceBadge source={event.source} />
                  </TableCell>
                  <TableCell className="max-w-[140px] truncate text-[13px] text-muted-foreground" title={event.keyName ?? undefined}>
                    {selectedKeyId === ALL_KEYS ? event.keyName : "—"}
                  </TableCell>
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
                  <TableCell
                    className="text-right font-mono tabular-nums text-[13px] text-foreground"
                    title={formatBreakdownTitle(event.costBreakdown) ?? undefined}
                  >
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
                  <TableCell className="font-mono text-[11px] text-muted-foreground">
                    {event.sessionId ? (
                      <Link
                        href={`/app/sessions/${encodeURIComponent(event.sessionId)}`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-primary underline-offset-2 hover:underline"
                        title={event.sessionId}
                      >
                        {truncateId(event.sessionId)}
                      </Link>
                    ) : "—"}
                  </TableCell>
                  <TableCell
                    className="font-mono text-[11px] text-muted-foreground"
                    title={event.traceId ?? undefined}
                  >
                    {event.traceId ? event.traceId.slice(0, 8) : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {hasNextPage ? (
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
          ) : events.length > 0 && (
            <div className="py-3 text-center text-[11px] text-muted-foreground/50">
              End of results
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
            : "Set your OPENAI_BASE_URL to proxy.nullspend.dev/v1 and costs will appear here within seconds."}
        </p>
      </div>
    </div>
  );
}

const SOURCE_STYLES: Record<string, string> = {
  proxy: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  api: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  mcp: "bg-orange-500/10 text-orange-400 border-orange-500/20",
};

function SourceBadge({ source }: { source: string }) {
  const style = SOURCE_STYLES[source] ?? "bg-secondary text-muted-foreground border-border/50";
  const label = SOURCE_LABELS[source] ?? source;
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${style}`}>
      {label}
    </span>
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
