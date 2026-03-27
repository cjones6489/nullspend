"use client";

import { use, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronDown, ChevronRight, Loader2 } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PayloadViewer } from "@/components/actions/payload-viewer";
import { useSession, useCostEventBodies } from "@/lib/queries/cost-events";
import {
  formatMicrodollars,
  formatModelName,
  formatTokens,
  formatDuration,
} from "@/lib/utils/format";
import type { CostEventRecord } from "@/lib/validations/cost-events";

function formatTime(isoString: string): string {
  return new Date(isoString).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatSessionDuration(startedAt: string | null, endedAt: string | null): string {
  if (!startedAt || !endedAt) return "--";
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.round((ms % 60_000) / 1000);
  return `${mins}m ${secs}s`;
}

function ExpandableEvent({ event }: { event: CostEventRecord }) {
  const [expanded, setExpanded] = useState(false);
  const { data: bodiesData, isLoading: bodiesLoading } = useCostEventBodies(
    event.id,
    expanded,
  );
  const bodies = bodiesData?.data;

  return (
    <div className="border-b border-border/30 last:border-b-0">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/30"
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}

        <span className="shrink-0 font-mono text-xs text-muted-foreground">
          {formatTime(event.createdAt)}
        </span>

        <span className="shrink-0">
          <Badge variant="outline" className="font-mono text-[11px]">
            {formatModelName(event.model)}
          </Badge>
        </span>

        <span className="flex-1 text-right font-mono text-xs text-muted-foreground">
          {formatTokens(event.inputTokens)} &rarr; {formatTokens(event.outputTokens)}
        </span>

        <span className="shrink-0 text-right font-mono text-sm tabular-nums">
          {formatMicrodollars(event.costMicrodollars)}
        </span>

        <span className="shrink-0 text-right text-xs text-muted-foreground w-16">
          {formatDuration(event.durationMs)}
        </span>

        <Link
          href={`/app/cost-events/${event.id}?from=session`}
          onClick={(e) => e.stopPropagation()}
          className="shrink-0 text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          detail
        </Link>
      </button>

      {expanded && (
        <div className="space-y-3 px-4 pb-4 pt-1">
          {bodiesLoading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading bodies...
            </div>
          )}
          {bodies?.requestBody && (
            <PayloadViewer title="Request Body" data={bodies.requestBody} />
          )}
          {bodies?.responseBody && (
            <PayloadViewer title="Response Body" data={bodies.responseBody} />
          )}
          {!bodiesLoading && !bodies?.requestBody && !bodies?.responseBody && (
            <p className="text-xs text-muted-foreground">
              No request/response bodies available for this event.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function SessionSkeleton() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-8 w-64" />
      <div className="grid grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

export default function SessionReplayPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = use(params);
  const { data, isLoading, error } = useSession(sessionId);

  if (isLoading) return <SessionSkeleton />;

  if (error) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <Link
          href="/app/activity"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Activity
        </Link>
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-6">
          <h2 className="text-lg font-semibold text-red-400">
            Failed to load session
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            This session may not exist or you may not have access.
          </p>
        </div>
      </div>
    );
  }

  const { summary, events } = data!;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Back link */}
      <Link
        href="/app/activity"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to Activity
      </Link>

      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold">Session Replay</h1>
        <p className="mt-0.5 font-mono text-sm text-muted-foreground">
          {sessionId}
        </p>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card className="border-border/50 bg-card">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total Cost</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {formatMicrodollars(summary.totalCostMicrodollars)}
            </p>
          </CardContent>
        </Card>
        <Card className="border-border/50 bg-card">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Events</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {summary.eventCount}
            </p>
          </CardContent>
        </Card>
        <Card className="border-border/50 bg-card">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Duration</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {formatSessionDuration(summary.startedAt, summary.endedAt)}
            </p>
          </CardContent>
        </Card>
        <Card className="border-border/50 bg-card">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Tokens</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {formatTokens(summary.totalInputTokens + summary.totalOutputTokens)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Timeline */}
      {events.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/50 py-12 text-center">
          <p className="text-sm text-muted-foreground">
            No events found for this session.
          </p>
        </div>
      ) : (
        <Card className="border-border/50 bg-card overflow-hidden">
          <CardHeader className="pb-0">
            <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Timeline
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 pt-3">
            {events.map((event) => (
              <ExpandableEvent key={event.id} event={event} />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
