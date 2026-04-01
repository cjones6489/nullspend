import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PayloadViewer } from "@/components/actions/payload-viewer";
import { cn } from "@/lib/utils";
import { budgetIncreasePayloadSchema } from "@/lib/validations/actions";
import { formatMicrodollars } from "@/lib/utils/format";

function spendColor(ratio: number): string {
  if (ratio > 0.9) return "bg-red-500";
  if (ratio > 0.7) return "bg-amber-500";
  return "bg-emerald-500";
}

interface BudgetIncreaseCardProps {
  payload: Record<string, unknown>;
  status?: string;
}

export function BudgetIncreaseCard({ payload, status }: BudgetIncreaseCardProps) {
  const parsed = budgetIncreasePayloadSchema.safeParse(payload);

  if (!parsed.success) {
    return <PayloadViewer title="Payload" data={payload} />;
  }

  const {
    entityType,
    entityId,
    requestedAmountMicrodollars,
    currentLimitMicrodollars,
    currentSpendMicrodollars,
    reason,
  } = parsed.data;

  const newLimit = currentLimitMicrodollars + requestedAmountMicrodollars;
  const spendRatio =
    currentLimitMicrodollars > 0
      ? currentSpendMicrodollars / currentLimitMicrodollars
      : 0;
  const spendPercent = Math.min(Math.round(spendRatio * 100), 100);

  return (
    <Card className="border-border/50 bg-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Budget Increase Request
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Current budget stats */}
        <div className="space-y-3">
          <Row label="Current Limit" value={formatMicrodollars(currentLimitMicrodollars)} />
          <Row
            label="Current Spend"
            value={`${formatMicrodollars(currentSpendMicrodollars)}  (${spendPercent}%)`}
          />
          {/* Progress bar */}
          <div
            role="progressbar"
            aria-label="Budget spend"
            aria-valuenow={spendPercent}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-1.5 w-full overflow-hidden rounded-full bg-secondary/50"
          >
            <div
              className={`h-full rounded-full transition-all ${spendColor(spendRatio)}`}
              style={{ width: `${spendPercent}%` }}
            />
          </div>
        </div>

        {/* Request details */}
        <div className="space-y-3 border-t border-border/30 pt-4">
          <Row
            label="Requested Increase"
            value={`+${formatMicrodollars(requestedAmountMicrodollars)}`}
            valueClassName="font-semibold text-amber-400"
          />
          <Row
            label={status === "approved" || status === "executed" ? "New Limit (Approved)" : "New Limit if Approved"}
            value={formatMicrodollars(newLimit)}
            valueClassName="text-emerald-400"
          />
        </div>

        {/* Entity */}
        <div className="border-t border-border/30 pt-4">
          <Row label="Entity" value={`${entityType} / ${entityId}`} />
        </div>

        {/* Reason */}
        <div className="border-t border-border/30 pt-4">
          <p className="text-[11px] text-muted-foreground/70">Reason</p>
          <p className="mt-1 rounded-md border border-border/30 bg-secondary/20 px-3 py-2 text-[13px] text-foreground/80">
            {reason}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function Row({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div>
      <p className="text-[11px] text-muted-foreground/70">{label}</p>
      <p className={cn("text-[13px] text-foreground", valueClassName)}>{value}</p>
    </div>
  );
}
