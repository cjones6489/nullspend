import { and, eq, isNotNull, lte, sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { actions, type ActionRow } from "@nullspend/db";

export const DEFAULT_EXPIRATION_SECONDS = 3600;
export const MAX_EXPIRATION_SECONDS = 604800; // 7 days — prevent immortal actions

export function isActionExpired(
  row: Pick<ActionRow, "status" | "expiresAt">,
): boolean {
  return (
    row.status === "pending" &&
    row.expiresAt !== null &&
    row.expiresAt <= new Date()
  );
}

/**
 * Compute the expiration timestamp for a new action.
 *
 * - `undefined` → uses {@link DEFAULT_EXPIRATION_SECONDS} (1 hour)
 * - `null` or `0` → no expiration (returns `null`)
 * - positive number → expires in that many seconds from now
 */
export function computeExpiresAt(
  expiresInSeconds: number | null | undefined,
): Date | null {
  if (expiresInSeconds === 0 || expiresInSeconds === null) {
    // ACT-6: Even "no expiration" requests get capped at MAX_EXPIRATION_SECONDS
    // to prevent immortal pending actions that never self-expire.
    return new Date(Date.now() + MAX_EXPIRATION_SECONDS * 1000);
  }

  const ttl = Math.min(expiresInSeconds ?? DEFAULT_EXPIRATION_SECONDS, MAX_EXPIRATION_SECONDS);
  return new Date(Date.now() + ttl * 1000);
}

export async function expireAction(
  actionId: string,
  orgId: string,
): Promise<ActionRow | null> {
  const db = getDb();

  const [updated] = await db
    .update(actions)
    .set({
      status: "expired",
      expiredAt: sql`NOW()`,
    })
    .where(
      and(
        eq(actions.id, actionId),
        eq(actions.orgId, orgId),
        eq(actions.status, "pending"),
      ),
    )
    .returning();

  return updated ?? null;
}

export async function bulkExpireActions(orgId: string): Promise<void> {
  const db = getDb();

  await db
    .update(actions)
    .set({
      status: "expired",
      expiredAt: sql`NOW()`,
    })
    .where(
      and(
        eq(actions.orgId, orgId),
        eq(actions.status, "pending"),
        isNotNull(actions.expiresAt),
        lte(actions.expiresAt, sql`NOW()`),
      ),
    );
}
