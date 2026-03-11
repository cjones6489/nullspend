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

export async function resolveAction(
  actionId: string,
  ownerUserId: string,
  targetStatus: string,
  setFields: Record<string, unknown>,
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
      .limit(1)
      .for("update");

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
            eq(actions.ownerUserId, ownerUserId),
            eq(actions.status, "pending"),
          ),
        );
      throw new ActionExpiredError(actionId);
    }

    assertActionTransition(existingAction.status, targetStatus);

    const updatedRows = await tx
      .update(actions)
      .set({ status: targetStatus, ...setFields })
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
        rejectedAt: actions.rejectedAt,
      });

    if (updatedRows.length === 0) {
      throw new StaleActionError(actionId);
    }

    return updatedRows[0];
  });
}
