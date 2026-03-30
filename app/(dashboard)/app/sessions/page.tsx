"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { MessageSquare } from "lucide-react";

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
import { formatMicrodollars, formatRelativeTime } from "@/lib/utils/format";

interface SessionSummary {
  sessionId: string;
  eventCount: number;
  totalCostMicrodollars: number;
  firstEventAt: string;
  lastEventAt: string;
}

function useSessionList() {
  return useQuery<{ data: SessionSummary[] }>({
    queryKey: ["sessions", "list"],
    queryFn: () => apiGet("/api/cost-events/sessions"),
  });
}

export default function SessionsPage() {
  const { data, isLoading, error } = useSessionList();
  const sessions = data?.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Sessions</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Agent sessions tracked via the x-nullspend-session header.
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
                      {session.sessionId.length > 40
                        ? `${session.sessionId.slice(0, 40)}...`
                        : session.sessionId}
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
      )}
    </div>
  );
}
