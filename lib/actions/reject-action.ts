import { and, eq } from "drizzle-orm";

import {
  ActionExpiredError,
  ActionNotFoundError,
  StaleActionError,
} from "@/lib/actions/errors";
import { isActionExpired } from "@/lib/actions/expiration";
import { assertActionTransition } from "@/lib/actions/transitions";
import { getDb } from "@/lib/db/client";
import { actions } from "@/lib/db/schema";
import type { RejectActionInput } from "@/lib/validations/actions";

export async function rejectAction(
  actionId: string,
  input: RejectActionInput,
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

    assertActionTransition(existingAction.status, "rejected");

    const updatedRows = await tx
      .update(actions)
      .set({
        status: "rejected",
        rejectedAt: new Date(),
        rejectedBy: input.rejectedBy,
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
        rejectedAt: actions.rejectedAt,
      });

    if (updatedRows.length === 0) {
      throw new StaleActionError(actionId);
    }

    const updatedAction = updatedRows[0];

    return {
      id: updatedAction.id,
      status: updatedAction.status,
      rejectedAt: updatedAction.rejectedAt?.toISOString() ?? null,
    };
  });
}
