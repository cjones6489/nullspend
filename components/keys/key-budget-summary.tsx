"use client";

import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useBudgets } from "@/lib/queries/budgets";
import { formatMicrodollars } from "@/lib/utils/format";
import { getBudgetColor } from "@/lib/utils/dashboard";

interface KeyBudgetSummaryProps {
  keyId: string;
}

interface BudgetRecord {
  id: string;
  entityType: string;
  entityId: string;
  maxBudgetMicrodollars: number;
  spendMicrodollars: number;
  policy: string;
  resetInterval: string | null;
  velocityLimitMicrodollars: number | null;
  sessionLimitMicrodollars: number | null;
}

export function KeyBudgetSummary({ keyId }: KeyBudgetSummaryProps) {
  const { data: budgetsData, isLoading, isError } = useBudgets();

  if (isLoading) {
    return (
      <Card className="border-border/50 bg-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Budget
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-3 w-24" />
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card className="border-border/50 bg-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Budget
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-[13px] text-muted-foreground">Unable to load budget</p>
          <Link
            href="/app/budgets"
            className="mt-1 inline-block text-[11px] text-primary hover:underline"
          >
            View Budgets →
          </Link>
        </CardContent>
      </Card>
    );
  }

  const keyBudget = (budgetsData?.data ?? []).find(
    (b: BudgetRecord) => b.entityType === "api_key" && b.entityId === keyId,
  ) as BudgetRecord | undefined;

  if (!keyBudget) {
    return (
      <Card className="border-border/50 bg-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Budget
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-[13px] text-muted-foreground">No budget set</p>
          <Link
            href={`/app/budgets?create=api_key&entityId=${keyId}`}
            className="mt-1 inline-block text-[11px] text-primary hover:underline"
          >
            Set budget →
          </Link>
        </CardContent>
      </Card>
    );
  }

  const spendPercent = keyBudget.maxBudgetMicrodollars > 0
    ? Math.min(100, (keyBudget.spendMicrodollars / keyBudget.maxBudgetMicrodollars) * 100)
    : 0;

  const color = getBudgetColor(spendPercent);
  const progressClass = color === "red"
    ? "[&>div]:bg-red-500"
    : color === "amber"
      ? "[&>div]:bg-amber-500"
      : "";

  return (
    <Card className="border-border/50 bg-card">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Budget
        </CardTitle>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[10px] capitalize">
            {keyBudget.policy.replace("_", " ")}
          </Badge>
          {keyBudget.resetInterval && (
            <Badge variant="secondary" className="text-[10px] capitalize">
              {keyBudget.resetInterval}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-baseline justify-between">
          <span className="text-2xl font-semibold tabular-nums text-foreground">
            {formatMicrodollars(keyBudget.spendMicrodollars)}
          </span>
          <span className="text-[13px] text-muted-foreground">
            of {formatMicrodollars(keyBudget.maxBudgetMicrodollars)}
          </span>
        </div>
        <Progress value={spendPercent} className={progressClass} />

        <div className="flex items-center gap-3">
          {keyBudget.velocityLimitMicrodollars != null && (
            <span className="text-[10px] text-muted-foreground">
              Velocity: {formatMicrodollars(keyBudget.velocityLimitMicrodollars)}/window
            </span>
          )}
          {keyBudget.sessionLimitMicrodollars != null && (
            <span className="text-[10px] text-muted-foreground">
              Session: {formatMicrodollars(keyBudget.sessionLimitMicrodollars)}/session
            </span>
          )}
        </div>

        <Link
          href={`/app/budgets?selected=${keyBudget.id}`}
          className="inline-block text-[11px] text-primary hover:underline"
        >
          Manage budget →
        </Link>
      </CardContent>
    </Card>
  );
}
