import { and, eq } from "drizzle-orm";

import { ActionNotFoundError } from "@/lib/actions/errors";
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

  return serializeAction(action);
}
