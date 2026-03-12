import { CheckCircle2, Circle, Clock, XCircle } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatTimestamp } from "@/lib/utils/format";
import type { ActionRecord } from "@/lib/validations/actions";

interface TimelineEvent {
  label: string;
  timestamp: string | null;
  icon: React.ElementType;
  iconColor: string;
  actor?: string | null;
}

function getTimelineEvents(action: ActionRecord): TimelineEvent[] {
  const events: TimelineEvent[] = [
    {
      label: "Created",
      timestamp: action.createdAt,
      icon: Circle,
      iconColor: "text-muted-foreground",
    },
  ];

  if (action.approvedAt) {
    events.push({
      label: "Approved",
      timestamp: action.approvedAt,
      icon: CheckCircle2,
      iconColor: "text-blue-400",
      actor: action.approvedBy,
    });
  }

  if (action.rejectedAt) {
    events.push({
      label: "Rejected",
      timestamp: action.rejectedAt,
      icon: XCircle,
      iconColor: "text-red-400",
      actor: action.rejectedBy,
    });
  }

  if (action.expiredAt) {
    events.push({
      label: "Expired",
      timestamp: action.expiredAt,
      icon: Clock,
      iconColor: "text-zinc-400",
    });
  }

  if (action.executedAt) {
    events.push({
      label: action.status === "failed" ? "Failed" : "Executed",
      timestamp: action.executedAt,
      icon: action.status === "failed" ? XCircle : CheckCircle2,
      iconColor: action.status === "failed" ? "text-red-400" : "text-emerald-400",
    });
  }

  return events;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function formatActor(actor: string | null | undefined): string | null {
  if (!actor) return null;
  if (UUID_RE.test(actor)) return "Dashboard";
  return actor;
}

interface ActionTimelineProps {
  action: ActionRecord;
}

export function ActionTimeline({ action }: ActionTimelineProps) {
  const events = getTimelineEvents(action);

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Timeline
      </h3>
      <div className="relative space-y-0">
        {events.map((event, i) => (
          <div key={i} className="relative flex gap-3 pb-4 last:pb-0">
            {i < events.length - 1 && (
              <div className="absolute left-[7px] top-5 h-[calc(100%-8px)] w-px bg-border/50" />
            )}
            {action.status === "pending" && i === events.length - 1 && (
              <div className="absolute left-[7px] top-5 h-[calc(100%+8px)] w-px bg-border/30" />
            )}
            <event.icon className={cn("mt-0.5 h-4 w-4 shrink-0", event.iconColor)} />
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-foreground">{event.label}</p>
              {event.timestamp && (
                <p className="text-[11px] text-muted-foreground">
                  {formatTimestamp(event.timestamp)}
                  {formatActor(event.actor) && (
                    <span className="ml-1 text-muted-foreground/70">
                      by {formatActor(event.actor)}
                    </span>
                  )}
                </p>
              )}
            </div>
          </div>
        ))}
        {action.status === "pending" && (
          <div className="relative flex gap-3 pt-1">
            <Clock className="mt-0.5 h-4 w-4 shrink-0 animate-pulse text-amber-400" />
            <p className="text-[13px] text-muted-foreground">
              Awaiting decision...
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
