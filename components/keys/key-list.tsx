"use client";

import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/utils/format";
import type { ApiKeyRecord } from "@/lib/validations/api-keys";

interface KeyListProps {
  keys: ApiKeyRecord[];
  selectedKeyId: string | null;
  onSelect: (id: string) => void;
}

export function KeyList({ keys, selectedKeyId, onSelect }: KeyListProps) {
  return (
    <div className="w-72 shrink-0 overflow-y-auto rounded-md border border-border/50 bg-card">
      <div className="flex flex-col">
        {keys.map((key) => {
          const isSelected = key.id === selectedKeyId;
          const hasRestrictions = key.allowedProviders !== null || key.allowedModels !== null;

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
              <div className="flex items-center gap-2 pl-3.5">
                <span className="truncate font-mono text-[11px] text-muted-foreground">
                  {key.keyPrefix}...
                </span>
                {hasRestrictions && (
                  <span className="shrink-0 rounded bg-amber-500/10 px-1 py-0.5 text-[9px] font-medium uppercase tracking-wider text-amber-500">
                    Policy
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
