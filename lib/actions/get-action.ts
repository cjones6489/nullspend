import { and, eq } from "drizzle-orm";

import { ActionNotFoundError } from "@/lib/actions/errors";
import { expireAction, isActionExpired } from "@/lib/actions/expiration";
import { serializeAction } from "@/lib/actions/serialize-action";
import { getDb } from "@/lib/db/client";
import { actions } from "@/lib/db/schema";

export async function getAction(actionId: string, ownerUserId: string) {
  const db = getDb();
  const [action] = await db
    .select()
    .from(actions)
    .where(and(eq(actions.id, actionId), eq(actions.ownerUserId, ownerUserId)))
    .limit(1);

  if (!action) {
    throw new ActionNotFoundError(actionId);
  }

  if (isActionExpired(action)) {
    const updated = await expireAction(actionId, ownerUserId);
    if (updated) {
      return serializeAction(updated);
    }

    const [refreshed] = await db
      .select()
      .from(actions)
      .where(
        and(eq(actions.id, actionId), eq(actions.ownerUserId, ownerUserId)),
      )
      .limit(1);

    if (refreshed) {
      return serializeAction(refreshed);
    }
  }

  return serializeAction(action);
}
