import { and, desc, eq, inArray, lt, or } from "drizzle-orm";

import { bulkExpireActions } from "@/lib/actions/expiration";
import { serializeAction } from "@/lib/actions/serialize-action";
import { getDb } from "@/lib/db/client";
import { actions } from "@nullspend/db";
import type { ActionStatus } from "@/lib/utils/status";

interface ListActionsOptions {
  ownerUserId: string;
  status?: ActionStatus;
  statuses?: ActionStatus[];
  limit: number;
  cursor?: { createdAt: string; id: string };
}

export async function listActions(options: ListActionsOptions) {
  await bulkExpireActions(options.ownerUserId);

  const db = getDb();
  const conditions = [eq(actions.ownerUserId, options.ownerUserId)];

  if (options.statuses && options.statuses.length > 0) {
    conditions.push(inArray(actions.status, options.statuses));
  } else if (options.status) {
    conditions.push(eq(actions.status, options.status));
  }

  if (options.cursor) {
    const cursorDate = new Date(options.cursor.createdAt);
    conditions.push(
      or(
        lt(actions.createdAt, cursorDate),
        and(eq(actions.createdAt, cursorDate), lt(actions.id, options.cursor.id)),
      )!,
    );
  }

  const rows = await db
    .select()
    .from(actions)
    .where(and(...conditions))
    .orderBy(desc(actions.createdAt), desc(actions.id))
    .limit(options.limit + 1);

  const hasMore = rows.length > options.limit;
  const pageRows = hasMore ? rows.slice(0, options.limit) : rows;
  const lastRow = pageRows[pageRows.length - 1];

  return {
    data: pageRows.map(serializeAction),
    cursor: hasMore && lastRow
      ? { createdAt: lastRow.createdAt.toISOString(), id: lastRow.id }
      : null,
  };
}
