"use client";

import { DollarSign, Zap } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatRelativeTime, formatMicrodollars } from "@/lib/utils/format";
import type { ApiKeyRecord } from "@/lib/validations/api-keys";

interface BudgetRecord {
  id: string;
  entityType: string;
  entityId: string;
  maxBudgetMicrodollars: number;
  resetInterval: string | null;
  velocityLimitMicrodollars: number | null;
}

interface KeyListProps {
  keys: ApiKeyRecord[];
  budgets: BudgetRecord[];
  selectedKeyId: string | null;
  onSelect: (id: string) => void;
}

function providerLabel(providers: string[] | null): string | null {
  if (!providers) return null;
  if (providers.length === 1) return `${providers[0]} only`;
  if (providers.length === 2) return "2 providers";
  return null;
}

function modelLabel(models: string[] | null): string | null {
  if (!models) return null;
  if (models.length === 1) return models[0];
  if (models.length > 1) return `${models.length} models`;
  return "no models";
}

export function KeyList({ keys, budgets, selectedKeyId, onSelect }: KeyListProps) {
  return (
    <div className="w-72 shrink-0 overflow-y-auto rounded-md border border-border/50 bg-card">
      <div className="flex flex-col">
        {keys.map((key) => {
          const isSelected = key.id === selectedKeyId;
          const keyBudget = budgets.find(
            (b) => b.entityType === "api_key" && b.entityId === key.id,
          );
          const pLabel = providerLabel(key.allowedProviders);
          const mLabel = modelLabel(key.allowedModels);

          return (
            <button
              key={key.id}
              type="button"
              onClick={() => onSelect(key.id)}
              className={cn(
                "flex flex-col gap-0.5 border-b border-border/30 px-3 py-2.5 text-left transition-colors",
                isSelected
                  ? "border-l-2 border-l-primary bg-accent"
                  : "border-l-2 border-l-transparent hover:bg-accent/50",
              )}
            >
              <div className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                <span className="truncate text-[13px] font-medium text-foreground">
                  {key.name}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1 pl-3.5">
                <span className="truncate font-mono text-[11px] text-muted-foreground">
                  {key.keyPrefix}...
                </span>
                {pLabel && (
                  <span className="shrink-0 rounded bg-blue-500/10 px-1 py-0.5 text-[9px] font-medium capitalize text-blue-400">
                    {pLabel}
                  </span>
                )}
                {mLabel && (
                  <span className="shrink-0 rounded bg-purple-500/10 px-1 py-0.5 text-[9px] font-medium text-purple-400">
                    {mLabel}
                  </span>
                )}
                {keyBudget && (
                  <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-emerald-500/10 px-1 py-0.5 text-[9px] font-medium text-emerald-400">
                    <DollarSign className="h-2 w-2" />
                    {keyBudget.resetInterval
                      ? `${formatMicrodollars(keyBudget.maxBudgetMicrodollars)}/${keyBudget.resetInterval.slice(0, 2)}`
                      : formatMicrodollars(keyBudget.maxBudgetMicrodollars)}
                  </span>
                )}
                {keyBudget?.velocityLimitMicrodollars != null && (
                  <span className="shrink-0 rounded bg-amber-500/10 px-1 py-0.5 text-[9px] text-amber-400">
                    <Zap className="inline h-2 w-2" />
                  </span>
                )}
              </div>
              <p className="pl-3.5 text-[11px] text-muted-foreground/70">
                {key.lastUsedAt
                  ? `Used ${formatRelativeTime(key.lastUsedAt)}`
                  : "Never used"}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
