import { and, eq } from "drizzle-orm";

import { ActionNotFoundError } from "@/lib/actions/errors";
import { expireAction, isActionExpired } from "@/lib/actions/expiration";
import { serializeAction } from "@/lib/actions/serialize-action";
import { getDb } from "@/lib/db/client";
import { actions } from "@nullspend/db";

export async function getAction(actionId: string, orgId: string) {
  const db = getDb();
  const [action] = await db
    .select()
    .from(actions)
    .where(and(eq(actions.id, actionId), eq(actions.orgId, orgId)))
    .limit(1);

  if (!action) {
    throw new ActionNotFoundError(actionId);
  }

  if (isActionExpired(action)) {
    const updated = await expireAction(actionId, orgId);
    if (updated) {
      return serializeAction(updated);
    }

    const [refreshed] = await db
      .select()
      .from(actions)
      .where(
        and(eq(actions.id, actionId), eq(actions.orgId, orgId)),
      )
      .limit(1);

    if (refreshed) {
      return serializeAction(refreshed);
    }
  }

  return serializeAction(action);
}
