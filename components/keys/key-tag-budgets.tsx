"use client";

import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useBudgets } from "@/lib/queries/budgets";
import { formatMicrodollars } from "@/lib/utils/format";

interface KeyTagBudgetsProps {
  defaultTags: Record<string, string>;
}

interface BudgetRecord {
  id: string;
  entityType: string;
  entityId: string;
  maxBudgetMicrodollars: number;
  spendMicrodollars: number;
  resetInterval: string | null;
  velocityLimitMicrodollars: number | null;
  sessionLimitMicrodollars: number | null;
}

export function KeyTagBudgets({ defaultTags }: KeyTagBudgetsProps) {
  const { data: budgetsData } = useBudgets();

  const tagEntries = Object.entries(defaultTags);
  if (tagEntries.length === 0) return null;

  const allBudgets = (budgetsData?.data ?? []) as BudgetRecord[];
  const tagBudgets = allBudgets.filter((b) => b.entityType === "tag");

  // Match this key's default tags against existing tag budgets
  const matched: { tagKey: string; tagValue: string; budget: BudgetRecord }[] = [];
  const unmatched: { tagKey: string; tagValue: string }[] = [];

  for (const [k, v] of tagEntries) {
    const entityId = `${k}=${v}`;
    const budget = tagBudgets.find((b) => b.entityId === entityId);
    if (budget) {
      matched.push({ tagKey: k, tagValue: v, budget });
    } else {
      unmatched.push({ tagKey: k, tagValue: v });
    }
  }

  if (matched.length === 0 && unmatched.length === 0) return null;

  return (
    <Card className="border-border/50 bg-card">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Tag Budgets
          </CardTitle>
          <Link
            href="/app/budgets"
            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            Manage →
          </Link>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-[11px] text-muted-foreground">
          Budgets matching this key's default tags. Every request from this key counts toward these limits.
        </p>

        {matched.map(({ tagKey, tagValue, budget }) => {
          const spendPercent = budget.maxBudgetMicrodollars > 0
            ? Math.min(100, (budget.spendMicrodollars / budget.maxBudgetMicrodollars) * 100)
            : 0;

          return (
            <div key={budget.id} className="rounded-md border border-border/30 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <Badge variant="secondary" className="font-mono text-[11px]">
                  {tagKey}={tagValue}
                </Badge>
                {budget.resetInterval && (
                  <span className="text-[10px] capitalize text-muted-foreground">
                    {budget.resetInterval}
                  </span>
                )}
              </div>
              <div className="flex items-baseline justify-between">
                <span className="font-mono text-sm font-medium tabular-nums text-foreground">
                  {formatMicrodollars(budget.spendMicrodollars)}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  of {formatMicrodollars(budget.maxBudgetMicrodollars)}
                </span>
              </div>
              <Progress
                value={spendPercent}
                className={spendPercent >= 80 ? "[&>div]:bg-amber-500" : ""}
              />
            </div>
          );
        })}

        {unmatched.length > 0 && (
          <div className="space-y-1">
            {unmatched.map(({ tagKey, tagValue }) => (
              <div key={`${tagKey}=${tagValue}`} className="flex items-center justify-between text-[11px]">
                <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">
                  {tagKey}={tagValue}
                </Badge>
                <span className="text-muted-foreground/70">No budget</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
