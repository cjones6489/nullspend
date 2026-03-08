import { and, desc, eq, lt } from "drizzle-orm";

import { serializeAction } from "@/lib/actions/serialize-action";
import { getDb } from "@/lib/db/client";
import { actions } from "@/lib/db/schema";
import type { ActionStatus } from "@/lib/utils/status";

interface ListActionsOptions {
  ownerUserId: string;
  status?: ActionStatus;
  limit: number;
  cursor?: string;
}

export async function listActions(options: ListActionsOptions) {
  const db = getDb();
  const conditions = [eq(actions.ownerUserId, options.ownerUserId)];

  if (options.status) {
    conditions.push(eq(actions.status, options.status));
  }

  if (options.cursor) {
    conditions.push(lt(actions.createdAt, new Date(options.cursor)));
  }

  const rows = await db
    .select()
    .from(actions)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(actions.createdAt))
    .limit(options.limit + 1);

  const hasMore = rows.length > options.limit;
  const pageRows = hasMore ? rows.slice(0, options.limit) : rows;

  return {
    data: pageRows.map(serializeAction),
    cursor: hasMore
      ? pageRows[pageRows.length - 1].createdAt.toISOString()
      : null,
  };
}
