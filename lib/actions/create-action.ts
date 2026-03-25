import { computeExpiresAt } from "@/lib/actions/expiration";
import { serializeAction } from "@/lib/actions/serialize-action";
import { getDb } from "@/lib/db/client";
import { addSentryBreadcrumb } from "@/lib/observability/sentry";
import { actions } from "@nullspend/db";
import type { CreateActionInput, RawActionRecord } from "@/lib/validations/actions";

function pickMetadataField(
  metadata: Record<string, unknown> | undefined,
  key: "environment" | "sourceFramework",
): string | null {
  const value = metadata?.[key];

  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export async function createAction(
  input: CreateActionInput,
  ownerUserId: string,
  orgId: string,
): Promise<RawActionRecord> {
  const db = getDb();
  const expiresAt = computeExpiresAt(input.expiresInSeconds);

  const [row] = await db
    .insert(actions)
    .values({
      ownerUserId,
      orgId,
      agentId: input.agentId,
      actionType: input.actionType,
      status: "pending",
      payloadJson: input.payload,
      metadataJson: input.metadata ?? null,
      expiresAt,
      environment: pickMetadataField(input.metadata, "environment"),
      sourceFramework: pickMetadataField(input.metadata, "sourceFramework"),
    })
    .returning();

  const action = serializeAction(row);
  addSentryBreadcrumb("action", "Action created", { actionId: action.id, actionType: input.actionType });
  return action;
}
