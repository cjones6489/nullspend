"use client";

import { ArrowLeft } from "lucide-react";
import { CopyButton } from "@/components/ui/copy-button";
import Link from "next/link";
import { Suspense, use } from "react";
import { useSearchParams } from "next/navigation";

import { ActionTimeline } from "@/components/actions/action-timeline";
import { BudgetIncreaseCard } from "@/components/actions/budget-increase-card";
import { CostCard } from "@/components/actions/cost-card";
import { DecisionControls } from "@/components/actions/decision-controls";
import { PayloadViewer } from "@/components/actions/payload-viewer";
import { StatusBadge } from "@/components/actions/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAction } from "@/lib/queries/actions";
import { formatActionType, formatExpiresAt, formatTimestamp } from "@/lib/utils/format";

export default function ActionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data: action, isLoading, error } = useAction(id);

  if (isLoading) {
    return <DetailSkeleton />;
  }

  if (error || !action) {
    return (
      <div className="space-y-4">
        <Suspense fallback={<BackLinkFallback />}>
        <BackLink />
      </Suspense>
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-6 text-center text-sm text-red-400">
          {error?.message || "Action not found."}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Suspense fallback={<BackLinkFallback />}>
        <BackLink />
      </Suspense>

      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            {formatActionType(action.actionType)}
          </h1>
          <p className="text-xs text-muted-foreground">
            <span className="font-mono">{action.agentId}</span>
            <span className="mx-1.5 text-border">&middot;</span>
            {formatTimestamp(action.createdAt)}
          </p>
        </div>
        <StatusBadge status={action.status} className="mt-1" />
      </div>

      {action.status === "pending" && (
        <div className="sticky top-0 z-10 rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 backdrop-blur-sm">
          <div className="flex items-center justify-between gap-4">
            <p className="text-[13px] text-amber-400/90">
              This action is awaiting your decision.
            </p>
            <DecisionControls
              actionId={action.id}
              actionType={action.actionType}
              payload={action.payload}
            />
          </div>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-4 md:col-span-2">
          {action.actionType === "budget_increase" ? (
            <BudgetIncreaseCard payload={action.payload} status={action.status} />
          ) : (
            <PayloadViewer title="Payload" data={action.payload} />
          )}
          <PayloadViewer title="Metadata" data={action.metadata} />

          {action.result && (
            <PayloadViewer title="Result" data={action.result} />
          )}

          {action.errorMessage && (
            <Card className="border-red-500/20 bg-card">
              <CardHeader className="pb-3">
                <CardTitle className="text-xs font-medium uppercase tracking-wider text-red-400">
                  Error
                </CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="overflow-x-auto rounded-md border border-red-500/10 bg-red-500/5 p-4 font-mono text-[13px] text-red-400">
                  {action.errorMessage}
                </pre>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card className="border-border/50 bg-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <DetailRow label="Action ID" value={action.id} mono />
              <DetailRow label="Agent" value={action.agentId} />
              <DetailRow
                label="Type"
                value={formatActionType(action.actionType)}
              />
              <DetailRow
                label="Expires"
                value={
                  action.status === "expired"
                    ? "Expired"
                    : formatExpiresAt(action.expiresAt) ?? "Never"
                }
              />
              <DetailRow label="Environment" value={action.environment} />
              <DetailRow label="Framework" value={action.sourceFramework} />
            </CardContent>
          </Card>

          {["executing", "executed", "failed"].includes(action.status) && (
            <CostCard actionId={action.id} />
          )}

          <Card className="border-border/50 bg-card">
            <CardContent className="pt-6">
              <ActionTimeline action={action} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function BackLinkFallback() {
  return (
    <Link
      href="/app/inbox"
      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="h-3.5 w-3.5" />
      Back to inbox
    </Link>
  );
}

function BackLink() {
  const searchParams = useSearchParams();
  const from = searchParams.get("from");
  const href = from === "history" ? "/app/history" : "/app/inbox";
  const label = from === "history" ? "Back to history" : "Back to inbox";

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

function DetailRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
}) {
  return (
    <div>
      <p className="text-[11px] text-muted-foreground/70">{label}</p>
      <div className="flex items-center gap-1">
        <p
          className={
            mono
              ? "truncate font-mono text-xs text-foreground/80"
              : "text-[13px] text-foreground"
          }
          title={mono && value ? value : undefined}
        >
          {value ?? "—"}
        </p>
        {mono && value && <CopyButton value={value} />}
      </div>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Skeleton className="h-5 w-28 bg-secondary/50" />
      <Skeleton className="h-10 w-64 bg-secondary/50" />
      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-4 md:col-span-2">
          <Skeleton className="h-48 w-full rounded-lg bg-secondary/50" />
        </div>
        <div className="space-y-4">
          <Skeleton className="h-48 w-full rounded-lg bg-secondary/50" />
        </div>
      </div>
    </div>
  );
}
