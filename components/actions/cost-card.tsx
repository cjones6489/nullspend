import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useActionCosts } from "@/lib/queries/cost-events";
import {
  formatDuration,
  formatMicrodollars,
  formatTokens,
} from "@/lib/utils/format";
import type { CostEventRecord } from "@/lib/validations/cost-events";

interface CostCardProps {
  actionId: string;
}

export function CostCard({ actionId }: CostCardProps) {
  const { data, isLoading } = useActionCosts(actionId);
  const events = data?.data ?? [];

  if (isLoading) return <CostCardSkeleton />;
  if (events.length === 0) return <CostCardEmpty />;
  if (events.length === 1) return <SingleCostView event={events[0]} />;

  return <MultiCostView events={events} />;
}

function SingleCostView({ event }: { event: CostEventRecord }) {
  return (
    <Card className="border-border/50 bg-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Cost
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-baseline justify-between">
          <p className="text-lg font-semibold tabular-nums text-foreground">
            {formatMicrodollars(event.costMicrodollars)}
          </p>
          <p className="text-xs text-muted-foreground">{event.model}</p>
        </div>
        <TokenBreakdown event={event} />
        <DetailRow label="Duration" value={formatDuration(event.durationMs)} />
      </CardContent>
    </Card>
  );
}

function MultiCostView({ events }: { events: CostEventRecord[] }) {
  const totalCost = events.reduce((sum, e) => sum + e.costMicrodollars, 0);
  const totalDuration = events.reduce((sum, e) => sum + (e.durationMs ?? 0), 0);

  return (
    <Card className="border-border/50 bg-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Cost
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-baseline justify-between">
          <p className="text-lg font-semibold tabular-nums text-foreground">
            {formatMicrodollars(totalCost)}
          </p>
          <p className="text-xs text-muted-foreground">
            {events.length} calls
          </p>
        </div>
        <DetailRow label="Total duration" value={formatDuration(totalDuration)} />

        <div className="space-y-3 border-t border-border/30 pt-3">
          {events.map((event) => (
            <div key={event.id} className="space-y-1.5">
              <div className="flex items-baseline justify-between">
                <p className="text-[13px] font-medium tabular-nums text-foreground">
                  {formatMicrodollars(event.costMicrodollars)}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {event.model}
                </p>
              </div>
              <TokenBreakdown event={event} />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function TokenBreakdown({ event }: { event: CostEventRecord }) {
  return (
    <div className="space-y-1">
      <DetailRow
        label="Input"
        value={formatTokens(event.inputTokens)}
        sub={
          event.cachedInputTokens > 0
            ? `${formatTokens(event.cachedInputTokens)} cached`
            : undefined
        }
      />
      <DetailRow
        label="Output"
        value={formatTokens(event.outputTokens)}
        sub={
          event.reasoningTokens > 0
            ? `${formatTokens(event.reasoningTokens)} reasoning`
            : undefined
        }
      />
    </div>
  );
}

function DetailRow({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="flex items-baseline justify-between text-[13px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums text-foreground">
        {value}
        {sub && (
          <span className="ml-1 text-[11px] text-muted-foreground/70">
            ({sub})
          </span>
        )}
      </span>
    </div>
  );
}

function CostCardEmpty() {
  return (
    <Card className="border-border/50 bg-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Cost
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground">
          No cost data linked. Include{" "}
          <code className="rounded bg-secondary px-1 py-0.5 font-mono text-[11px]">
            x-nullspend-action-id
          </code>{" "}
          in proxy calls to correlate costs.
        </p>
      </CardContent>
    </Card>
  );
}

function CostCardSkeleton() {
  return (
    <Card className="border-border/50 bg-card">
      <CardHeader className="pb-3">
        <Skeleton className="h-3 w-10 bg-secondary/50" />
      </CardHeader>
      <CardContent className="space-y-2">
        <Skeleton className="h-6 w-20 bg-secondary/50" />
        <Skeleton className="h-3 w-full bg-secondary/50" />
        <Skeleton className="h-3 w-3/4 bg-secondary/50" />
      </CardContent>
    </Card>
  );
}
