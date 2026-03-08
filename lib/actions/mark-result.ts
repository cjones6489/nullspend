import { and, eq } from "drizzle-orm";

import {
  ActionNotFoundError,
  StaleActionError,
} from "@/lib/actions/errors";
import { assertActionTransition } from "@/lib/actions/transitions";
import { getDb } from "@/lib/db/client";
import { actions } from "@/lib/db/schema";
import type { MarkResultInput } from "@/lib/validations/actions";

export async function markResult(
  actionId: string,
  input: MarkResultInput,
  ownerUserId: string,
) {
  const db = getDb();

  return db.transaction(async (tx) => {
    const [existingAction] = await tx
      .select({
        id: actions.id,
        status: actions.status,
      })
      .from(actions)
      .where(and(eq(actions.id, actionId), eq(actions.ownerUserId, ownerUserId)))
      .limit(1);

    if (!existingAction) {
      throw new ActionNotFoundError(actionId);
    }

    assertActionTransition(existingAction.status, input.status);

    const updatedRows = await tx
      .update(actions)
      .set({
        status: input.status,
        resultJson: input.result ?? null,
        errorMessage: input.errorMessage ?? null,
        executedAt:
          input.status === "executed" || input.status === "failed"
            ? new Date()
            : null,
      })
      .where(
        and(
          eq(actions.id, actionId),
          eq(actions.ownerUserId, ownerUserId),
          eq(actions.status, existingAction.status),
        ),
      )
      .returning({
        id: actions.id,
        status: actions.status,
        executedAt: actions.executedAt,
      });

    if (updatedRows.length === 0) {
      throw new StaleActionError(actionId);
    }

    const updatedAction = updatedRows[0];

    return {
      id: updatedAction.id,
      status: updatedAction.status,
      executedAt: updatedAction.executedAt?.toISOString() ?? null,
    };
  });
}
