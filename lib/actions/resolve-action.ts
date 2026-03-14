import { and, eq, sql } from "drizzle-orm";

import {
  ActionExpiredError,
  ActionNotFoundError,
  StaleActionError,
} from "@/lib/actions/errors";
import { isActionExpired } from "@/lib/actions/expiration";
import { assertActionTransition } from "@/lib/actions/transitions";
import { getDb } from "@/lib/db/client";
import { actions } from "@nullspend/db";
import type { ActionStatus } from "@/lib/utils/status";

export async function resolveAction(
  actionId: string,
  ownerUserId: string,
  targetStatus: ActionStatus,
  setFields: { approvedBy: string } | { rejectedBy: string },
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
        .set({ status: "expired", expiredAt: sql`NOW()` })
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

    const timestampField =
      targetStatus === "approved"
        ? { approvedAt: sql`NOW()` }
        : { rejectedAt: sql`NOW()` };

    const updatedRows = await tx
      .update(actions)
      .set({ ...setFields, ...timestampField, status: targetStatus })
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
