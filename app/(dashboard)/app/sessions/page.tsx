"use client";

import Link from "next/link";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Loader2, MessageSquare } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiGet } from "@/lib/api/client";
import { formatMicrodollars, formatRelativeTime, truncateId } from "@/lib/utils/format";

interface SessionSummary {
  sessionId: string;
  eventCount: number;
  totalCostMicrodollars: number;
  firstEventAt: string;
  lastEventAt: string;
}

interface SessionsPage {
  data: SessionSummary[];
  cursor: string | null;
}

function useSessionList() {
  return useInfiniteQuery({
    queryKey: ["sessions", "list"],
    queryFn: ({ pageParam }): Promise<SessionsPage> => {
      const params = new URLSearchParams();
      if (pageParam) params.set("cursor", pageParam);
      const qs = params.toString();
      return apiGet(`/api/cost-events/sessions${qs ? `?${qs}` : ""}`);
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.cursor ?? undefined,
  });
}

export default function SessionsPage() {
  const { data, isLoading, error, hasNextPage, fetchNextPage, isFetchingNextPage } = useSessionList();
  const sessions = data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Sessions</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Track cost and usage across agent conversations.
        </p>
      </div>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-400">
          Failed to load sessions.
        </div>
      )}

      {data && sessions.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16">
          <MessageSquare className="h-8 w-8 text-muted-foreground/50" />
          <p className="mt-3 text-sm font-medium text-foreground">No sessions yet</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Sessions appear when agents send the x-nullspend-session header with their requests.
          </p>
        </div>
      )}

      {sessions.length > 0 && (
        <>
          <div className="rounded-md border border-border/50">
            <Table>
              <TableHeader>
                <TableRow className="border-border/30 hover:bg-transparent">
                  <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Session ID
                  </TableHead>
                  <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Requests
                  </TableHead>
                  <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Cost
                  </TableHead>
                  <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Last Activity
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map((session) => (
                  <TableRow key={session.sessionId} className="border-border/30">
                    <TableCell>
                      <Link
                        href={`/app/sessions/${encodeURIComponent(session.sessionId)}`}
                        className="font-mono text-[13px] text-foreground hover:text-primary transition-colors"
                      >
                        {truncateId(session.sessionId, 40)}
                      </Link>
                    </TableCell>
                    <TableCell className="tabular-nums text-[13px]">
                      {session.eventCount}
                    </TableCell>
                    <TableCell className="font-mono tabular-nums text-[13px]">
                      {formatMicrodollars(session.totalCostMicrodollars)}
                    </TableCell>
                    <TableCell className="text-[13px] text-muted-foreground">
                      {formatRelativeTime(session.lastEventAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {hasNextPage ? (
            <div className="flex justify-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                className="gap-1.5"
              >
                {isFetchingNextPage && <Loader2 className="h-3 w-3 animate-spin" />}
                Load more
              </Button>
            </div>
          ) : sessions.length > 0 && (
            <div className="py-3 text-center text-[11px] text-muted-foreground/50">
              End of results
            </div>
          )}
        </>
      )}
    </div>
  );
}
