import { getDb } from "@/lib/db/client";
import { auditEvents } from "@nullspend/db";

/**
 * Write an audit event. Fire-and-forget — never throws, never blocks the request.
 */
export function logAuditEvent(params: {
  orgId: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
}): void {
  const db = getDb();
  db.insert(auditEvents)
    .values({
      orgId: params.orgId,
      actorId: params.actorId,
      action: params.action,
      resourceType: params.resourceType,
      resourceId: params.resourceId ?? null,
      metadata: params.metadata ?? null,
    })
    .then(() => {})
    .catch((err) => {
      console.error("[audit] Failed to write audit event:", err);
    });
}
