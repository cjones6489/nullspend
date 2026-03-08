import { getDb } from "@/lib/db/client";
import { actions } from "@/lib/db/schema";
import type { CreateActionInput } from "@/lib/validations/actions";

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
) {
  const db = getDb();
  const [createdAction] = await db
    .insert(actions)
    .values({
      ownerUserId,
      // agentId is caller-supplied display metadata, not an auth boundary.
      agentId: input.agentId,
      actionType: input.actionType,
      status: "pending",
      payloadJson: input.payload,
      metadataJson: input.metadata ?? null,
      environment: pickMetadataField(input.metadata, "environment"),
      sourceFramework: pickMetadataField(input.metadata, "sourceFramework"),
    })
    .returning({
      id: actions.id,
      status: actions.status,
    });

  return createdAction;
}
