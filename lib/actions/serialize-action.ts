import type { ActionRow } from "@nullspend/db";
import type { ActionRecord } from "@/lib/validations/actions";

function toIsoString(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export function serializeAction(row: ActionRow): ActionRecord {
  return {
    id: row.id,
    agentId: row.agentId,
    actionType: row.actionType,
    status: row.status,
    payload: row.payloadJson,
    metadata: row.metadataJson,
    createdAt: row.createdAt.toISOString(),
    approvedAt: toIsoString(row.approvedAt),
    rejectedAt: toIsoString(row.rejectedAt),
    executedAt: toIsoString(row.executedAt),
    expiresAt: toIsoString(row.expiresAt),
    expiredAt: toIsoString(row.expiredAt),
    approvedBy: row.approvedBy,
    rejectedBy: row.rejectedBy,
    result: row.resultJson,
    errorMessage: row.errorMessage,
    environment: row.environment,
    sourceFramework: row.sourceFramework,
  };
}
