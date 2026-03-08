import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ActionStatus } from "@/lib/utils/status";

const statusConfig: Record<
  ActionStatus,
  { label: string; dot: string; className: string }
> = {
  pending: {
    label: "Pending",
    dot: "bg-amber-400",
    className: "border-amber-500/20 bg-amber-500/10 text-amber-400",
  },
  approved: {
    label: "Approved",
    dot: "bg-blue-400",
    className: "border-blue-500/20 bg-blue-500/10 text-blue-400",
  },
  rejected: {
    label: "Rejected",
    dot: "bg-red-400",
    className: "border-red-500/20 bg-red-500/10 text-red-400",
  },
  executing: {
    label: "Executing",
    dot: "bg-violet-400 animate-pulse",
    className: "border-violet-500/20 bg-violet-500/10 text-violet-400",
  },
  executed: {
    label: "Executed",
    dot: "bg-emerald-400",
    className: "border-emerald-500/20 bg-emerald-500/10 text-emerald-400",
  },
  failed: {
    label: "Failed",
    dot: "bg-red-400",
    className: "border-red-500/20 bg-red-500/10 text-red-400",
  },
  expired: {
    label: "Expired",
    dot: "bg-zinc-500",
    className: "border-zinc-500/20 bg-zinc-500/10 text-zinc-400",
  },
};

interface StatusBadgeProps {
  status: ActionStatus;
  className?: string;
}

const fallbackConfig = {
  label: "Unknown",
  dot: "bg-zinc-500",
  className: "border-zinc-500/20 bg-zinc-500/10 text-zinc-400",
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = statusConfig[status] ?? fallbackConfig;

  return (
    <Badge
      variant="outline"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium",
        config.className,
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", config.dot)} />
      {config.label}
    </Badge>
  );
}
