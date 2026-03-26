"use client";

import { History, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuditLog, type AuditEventRecord } from "@/lib/queries/audit-log";
import { formatRelativeTime, formatTimestamp } from "@/lib/utils/format";

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  "org.created": { label: "Org Created", color: "bg-green-500/10 text-green-400 border-green-500/20" },
  "org.deleted": { label: "Org Deleted", color: "bg-red-500/10 text-red-400 border-red-500/20" },
  "org.ownership_transferred": { label: "Ownership Transferred", color: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  "member.role_changed": { label: "Role Changed", color: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  "member.removed": { label: "Member Removed", color: "bg-red-500/10 text-red-400 border-red-500/20" },
  "member.left": { label: "Member Left", color: "bg-muted text-muted-foreground border-border/50" },
  "invitation.created": { label: "Invitation Sent", color: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  "invitation.revoked": { label: "Invitation Revoked", color: "bg-muted text-muted-foreground border-border/50" },
  "invitation.accepted": { label: "Invitation Accepted", color: "bg-green-500/10 text-green-400 border-green-500/20" },
};

const ALL_ACTIONS = "all";

function ActionBadge({ action }: { action: string }) {
  const config = ACTION_LABELS[action];
  if (!config) {
    return (
      <Badge variant="outline" className="text-[11px]">
        {action}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className={`text-[11px] ${config.color}`}>
      {config.label}
    </Badge>
  );
}

const KNOWN_META_KEYS = new Set(["email", "role", "newRole", "newOwnerUserId", "name", "slug"]);

function formatMetadata(event: AuditEventRecord): string | null {
  if (!event.metadata || Object.keys(event.metadata).length === 0) return null;

  const parts: string[] = [];
  const m = event.metadata;

  if (m.email) parts.push(`${m.email}`);
  if (m.role) parts.push(`role: ${m.role}`);
  if (m.newRole) parts.push(`new role: ${m.newRole}`);
  if (m.newOwnerUserId) parts.push(`to: ${String(m.newOwnerUserId).slice(0, 8)}...`);
  if (m.name) parts.push(`"${m.name}"`);

  // Show any unknown metadata keys so new event types aren't silently dropped
  for (const [k, v] of Object.entries(m)) {
    if (!KNOWN_META_KEYS.has(k) && v != null) {
      parts.push(`${k}: ${String(v)}`);
    }
  }

  return parts.length > 0 ? parts.join(", ") : null;
}

export default function AuditLogPage() {
  const [actionFilter, setActionFilter] = useState(ALL_ACTIONS);

  const filters = actionFilter !== ALL_ACTIONS ? { action: actionFilter } : {};
  const { data, isLoading, error, hasNextPage, fetchNextPage, isFetchingNextPage } = useAuditLog(filters);

  const events = useMemo(
    () => data?.pages.flatMap((p) => p.data) ?? [],
    [data],
  );

  return (
    <Card className="border-border/50 bg-card">
      <CardHeader className="flex flex-row items-center justify-between pb-4">
        <div>
          <CardTitle className="text-sm font-medium text-foreground">
            Audit Log
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Organization membership and security events. Visible to admins and owners.
          </p>
        </div>
        <Select value={actionFilter} onValueChange={(v) => setActionFilter(v ?? ALL_ACTIONS)}>
          <SelectTrigger className="h-8 w-48 border-border/50 bg-background text-[12px]">
            <SelectValue placeholder="All events" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_ACTIONS} className="text-[12px]">All events</SelectItem>
            {Object.entries(ACTION_LABELS).map(([action, { label }]) => (
              <SelectItem key={action} value={action} className="text-[12px]">
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardHeader>

      <CardContent className="p-0">
        {isLoading && <AuditLogSkeleton />}

        {error && (
          <div className="m-4 rounded-lg border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-400">
            {error.message?.includes("403") || error.message?.includes("forbidden")
              ? "You don't have permission to view the audit log. Admin or owner role required."
              : "Failed to load audit log."}
          </div>
        )}

        {!isLoading && !error && events.length === 0 && <EmptyAuditLog />}

        {events.length > 0 && (
          <div className="border-t border-border/30">
            <Table>
              <TableHeader>
                <TableRow className="border-border/30 hover:bg-transparent">
                  <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Time
                  </TableHead>
                  <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Event
                  </TableHead>
                  <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Actor
                  </TableHead>
                  <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Details
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((event) => (
                  <TableRow
                    key={event.id}
                    className="border-border/30 transition-colors hover:bg-accent/40"
                  >
                    <TableCell
                      className="text-[13px] text-muted-foreground"
                      title={formatTimestamp(event.createdAt)}
                    >
                      {formatRelativeTime(event.createdAt)}
                    </TableCell>
                    <TableCell>
                      <ActionBadge action={event.action} />
                    </TableCell>
                    <TableCell className="font-mono text-[12px] text-muted-foreground">
                      {event.actorId.slice(0, 8)}...
                    </TableCell>
                    <TableCell className="text-[12px] text-muted-foreground">
                      {formatMetadata(event) ?? "--"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {hasNextPage && (
              <div className="flex justify-center border-t border-border/30 py-3">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                  className="text-xs text-muted-foreground"
                >
                  {isFetchingNextPage ? (
                    <><Loader2 className="mr-1.5 h-3 w-3 animate-spin" />Loading...</>
                  ) : (
                    "Load more"
                  )}
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EmptyAuditLog() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 border-t border-border/30 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary/50">
        <History className="h-5 w-5 text-muted-foreground" />
      </div>
      <div>
        <p className="text-sm font-medium text-foreground">No audit events</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Organization events will appear here as they occur.
        </p>
      </div>
    </div>
  );
}

function AuditLogSkeleton() {
  return (
    <div className="space-y-2 border-t border-border/30 p-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full rounded-lg bg-secondary/50" />
      ))}
    </div>
  );
}
