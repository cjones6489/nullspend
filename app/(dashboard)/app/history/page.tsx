"use client";

import { Clock, Loader2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { StatusBadge } from "@/components/actions/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useActionsInfinite } from "@/lib/queries/actions";
import { formatActionType, formatRelativeTime } from "@/lib/utils/format";
import type { ActionStatus } from "@/lib/utils/status";

const STATUS_TABS: { value: string; label: string }[] = [
  { value: "all", label: "All" },
  { value: "executed", label: "Executed" },
  { value: "executing", label: "Executing" },
  { value: "failed", label: "Failed" },
  { value: "rejected", label: "Rejected" },
  { value: "expired", label: "Expired" },
  { value: "approved", label: "Approved" },
];

const HISTORY_STATUSES: ActionStatus[] = [
  "approved",
  "executed",
  "executing",
  "failed",
  "rejected",
  "expired",
];

export default function HistoryPage() {
  const [activeTab, setActiveTab] = useState("all");
  const [search, setSearch] = useState("");

  const queryOptions =
    activeTab === "all"
      ? { statuses: HISTORY_STATUSES }
      : { status: activeTab as ActionStatus };

  const {
    data,
    isLoading,
    error,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useActionsInfinite(queryOptions);

  const allActions = data?.pages.flatMap((p) => p.data) ?? [];

  const filtered = allActions.filter((action) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      action.agentId.toLowerCase().includes(q) ||
      action.actionType.toLowerCase().includes(q) ||
      formatActionType(action.actionType).toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          History
        </h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Browse past agent actions and their outcomes.
        </p>
      </div>

      <div className="flex items-center gap-4">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="h-8 bg-secondary/50 p-0.5">
            {STATUS_TABS.map((tab) => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="h-7 rounded-sm px-3 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm"
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <Input
          placeholder="Filter by agent or type..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 max-w-[220px] border-border/50 bg-secondary/50 text-xs placeholder:text-muted-foreground/50"
          aria-label="Filter by agent or action type"
        />
      </div>

      {error ? (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-400">
          Failed to load actions. Please try again.
        </div>
      ) : isLoading ? (
        <LoadingSkeleton />
      ) : null}

      {!isLoading && !error && filtered.length === 0 && (
        <EmptyState hasSearch={!!search.trim()} />
      )}

      {filtered.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border/50 bg-card">
          <Table>
            <TableHeader>
              <TableRow className="border-border/50 hover:bg-transparent">
                <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Action Type
                </TableHead>
                <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Agent
                </TableHead>
                <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Status
                </TableHead>
                <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Environment
                </TableHead>
                <TableHead className="text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Created
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((action) => (
                <TableRow
                  key={action.id}
                  className="group border-border/30 transition-colors hover:bg-accent/40"
                >
                  <TableCell>
                    <Link
                      href={`/app/actions/${action.id}?from=history`}
                      className="text-[13px] font-medium text-foreground transition-colors hover:text-primary"
                    >
                      {formatActionType(action.actionType)}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {action.agentId}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={action.status} />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {action.environment ?? "—"}
                  </TableCell>
                  <TableCell
                    className="text-right text-xs text-muted-foreground cursor-default"
                    title={new Date(action.createdAt).toLocaleString()}
                  >
                    {formatRelativeTime(action.createdAt)}
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

function LoadingSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full rounded-lg bg-secondary/50" />
      ))}
    </div>
  );
}

function EmptyState({ hasSearch }: { hasSearch: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-border/50 py-20 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary/50">
        <Clock className="h-5 w-5 text-muted-foreground" />
      </div>
      <div>
        <p className="text-sm font-medium text-foreground">
          {hasSearch ? "No matching actions" : "No history yet"}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {hasSearch
            ? "Try adjusting your search or filter."
            : "Completed agent actions will appear here."}
        </p>
      </div>
    </div>
  );
}
