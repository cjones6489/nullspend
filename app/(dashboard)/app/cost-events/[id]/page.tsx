"use client";

import { use, Suspense } from "react";
import Link from "next/link";
import { ArrowLeft, Zap, Clock, Tag, FileText } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CopyButton } from "@/components/ui/copy-button";
import { PayloadViewer } from "@/components/actions/payload-viewer";
import { useCostEvent, useCostEventBodies } from "@/lib/queries/cost-events";
import {
  formatTimestamp,
  formatMicrodollars,
  formatTokens,
  formatDuration,
  formatModelName,
  formatProviderName,
} from "@/lib/utils/format";

function DetailRow({
  label,
  value,
  mono,
  copyable,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
  copyable?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-2 py-1.5">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span
        className={`truncate text-right text-sm ${mono ? "font-mono text-xs" : ""}`}
        title={value ?? undefined}
      >
        {value ?? "--"}
        {value && copyable && <CopyButton value={value} className="ml-1.5 inline" />}
      </span>
    </div>
  );
}

function TokenBar({
  label,
  value,
  sublabel,
}: {
  label: string;
  value: number;
  sublabel?: string;
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <div>
        <span className="text-xs text-muted-foreground">{label}</span>
        {sublabel && (
          <span className="ml-1.5 text-[10px] text-muted-foreground/60">
            {sublabel}
          </span>
        )}
      </div>
      <span className="font-mono text-sm">{formatTokens(value)}</span>
    </div>
  );
}

function TagBadge({ name, value }: { name: string; value: string }) {
  // Hide internal _ns_ tags
  if (name.startsWith("_ns_")) return null;
  return (
    <Badge variant="outline" className="font-mono text-[11px]">
      {name}={value}
    </Badge>
  );
}

function BackLink({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const params = use(searchParams);
  const from = params.from;
  const href = from === "analytics" ? "/app/analytics" : "/app/activity";
  const label = from === "analytics" ? "Back to Analytics" : "Back to Activity";

  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="h-3.5 w-3.5" />
      {label}
    </Link>
  );
}

function DetailSkeleton() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-8 w-64" />
      <div className="grid gap-6 md:grid-cols-3">
        <div className="space-y-4 md:col-span-2">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  );
}

export default function CostEventDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  const { id } = use(params);
  const { data, isLoading, error } = useCostEvent(id);
  const event = data?.data;

  // Only fetch bodies if event loaded (needs the event to exist)
  const { data: bodiesData, isLoading: bodiesLoading, error: bodiesError } = useCostEventBodies(
    id,
    !!event,
  );
  const bodies = bodiesData?.data;

  if (isLoading) return <DetailSkeleton />;

  if (error || !event) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <Suspense fallback={<Skeleton className="h-4 w-32" />}>
          <BackLink searchParams={searchParams} />
        </Suspense>
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-6">
          <h2 className="text-lg font-semibold text-red-400">
            Cost event not found
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            This event may have been deleted or you may not have access.
          </p>
        </div>
      </div>
    );
  }

  const tokPerSec =
    event.durationMs && event.durationMs > 0
      ? Math.round((event.outputTokens / event.durationMs) * 1000)
      : null;

  const userTags = Object.entries(event.tags).filter(
    ([k]) => !k.startsWith("_ns_"),
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Back link */}
      <Suspense fallback={<Skeleton className="h-4 w-32" />}>
        <BackLink searchParams={searchParams} />
      </Suspense>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">
            {formatModelName(event.model)}
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {formatProviderName(event.provider)} &middot;{" "}
            {formatTimestamp(event.createdAt)}
          </p>
        </div>
        <div className="text-right">
          <span className="text-2xl font-semibold tabular-nums">
            {formatMicrodollars(event.costMicrodollars)}
          </span>
          <p className="text-xs text-muted-foreground">
            {formatDuration(event.durationMs)}
          </p>
        </div>
      </div>

      {/* Main grid */}
      <div className="grid gap-6 md:grid-cols-3">
        {/* Left column — tokens + bodies */}
        <div className="space-y-4 md:col-span-2">
          {/* Token breakdown */}
          <Card className="border-border/50 bg-card">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <Zap className="h-3.5 w-3.5" />
                Token Usage
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-0.5">
              <TokenBar label="Input tokens" value={event.inputTokens} />
              {event.cachedInputTokens > 0 && (
                <TokenBar
                  label="Cached input"
                  value={event.cachedInputTokens}
                  sublabel="(cache hit)"
                />
              )}
              <TokenBar label="Output tokens" value={event.outputTokens} />
              {event.reasoningTokens > 0 && (
                <TokenBar
                  label="Reasoning tokens"
                  value={event.reasoningTokens}
                  sublabel="(internal)"
                />
              )}
              {tokPerSec !== null && (
                <div className="flex items-center justify-between border-t border-border/30 pt-2 mt-1">
                  <span className="text-xs text-muted-foreground">
                    Throughput
                  </span>
                  <span className="font-mono text-sm">
                    {formatTokens(tokPerSec)} tok/s
                  </span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Tags */}
          {userTags.length > 0 && (
            <Card className="border-border/50 bg-card">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <Tag className="h-3.5 w-3.5" />
                  Tags
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-1.5">
                  {userTags.map(([k, v]) => (
                    <TagBadge key={k} name={k} value={v} />
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Request/Response Bodies */}
          {bodiesLoading && (
            <Card className="border-border/50 bg-card">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <FileText className="h-3.5 w-3.5" />
                  Request & Response
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Skeleton className="h-24 w-full" />
              </CardContent>
            </Card>
          )}

          {bodiesError && (
            <p className="text-xs text-muted-foreground">
              Failed to load request/response bodies.
            </p>
          )}

          {bodies?.requestBody && (
            <PayloadViewer title="Request Body" data={bodies.requestBody} />
          )}
          {bodies?.responseBody && (
            <PayloadViewer title="Response Body" data={bodies.responseBody} />
          )}
        </div>

        {/* Right column — details sidebar */}
        <div className="space-y-4">
          <Card className="border-border/50 bg-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-0.5">
              <DetailRow label="Event ID" value={event.id} mono copyable />
              <DetailRow
                label="Request ID"
                value={event.requestId}
                mono
                copyable
              />
              <DetailRow label="Provider" value={formatProviderName(event.provider)} />
              <DetailRow label="Model" value={event.model} mono />
              <DetailRow label="Source" value={event.source} />
              {event.keyName && (
                <DetailRow label="API Key" value={event.keyName} />
              )}
              {event.apiKeyId && (
                <DetailRow
                  label="Key ID"
                  value={event.apiKeyId}
                  mono
                  copyable
                />
              )}
              {event.traceId && (
                <DetailRow
                  label="Trace ID"
                  value={event.traceId}
                  mono
                  copyable
                />
              )}
            </CardContent>
          </Card>

          {/* Cost breakdown */}
          <Card className="border-border/50 bg-card">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                Timing & Cost
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-0.5">
              <DetailRow
                label="Total Cost"
                value={formatMicrodollars(event.costMicrodollars)}
              />
              <DetailRow
                label="Latency"
                value={formatDuration(event.durationMs)}
              />
              <DetailRow
                label="Timestamp"
                value={formatTimestamp(event.createdAt)}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
