import { and, eq } from "drizzle-orm";

import {
  ActionExpiredError,
  ActionNotFoundError,
  StaleActionError,
} from "@/lib/actions/errors";
import { isActionExpired } from "@/lib/actions/expiration";
import { assertActionTransition } from "@/lib/actions/transitions";
import { getDb } from "@/lib/db/client";
import { actions } from "@agentseam/db";
import type { ApproveActionInput } from "@/lib/validations/actions";

export async function approveAction(
  actionId: string,
  input: ApproveActionInput,
  ownerUserId: string,
) {
  const db = getDb();

  return db.transaction(async (tx) => {
    const [existingAction] = await tx
      .select({
        id: actions.id,
        status: actions.status,
        expiresAt: actions.expiresAt,
      })
      .from(actions)
      .where(and(eq(actions.id, actionId), eq(actions.ownerUserId, ownerUserId)))
      .limit(1);

    if (!existingAction) {
      throw new ActionNotFoundError(actionId);
    }

    if (isActionExpired(existingAction)) {
      await tx
        .update(actions)
        .set({ status: "expired", expiredAt: new Date() })
        .where(
          and(
            eq(actions.id, actionId),
            eq(actions.status, "pending"),
          ),
        );
      throw new ActionExpiredError(actionId);
    }

    assertActionTransition(existingAction.status, "approved");

    const updatedRows = await tx
      .update(actions)
      .set({
        status: "approved",
        approvedAt: new Date(),
        approvedBy: input.approvedBy,
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
        approvedAt: actions.approvedAt,
      });

    if (updatedRows.length === 0) {
      throw new StaleActionError(actionId);
    }

    const updatedAction = updatedRows[0];

    return {
      id: updatedAction.id,
      status: updatedAction.status,
      approvedAt: updatedAction.approvedAt?.toISOString() ?? null,
    };
  });
}
