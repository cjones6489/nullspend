import { and, eq, isNotNull, lte, sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { actions, type ActionRow } from "@/lib/db/schema";

export const DEFAULT_EXPIRATION_SECONDS = 3600;

export function isActionExpired(
  row: Pick<ActionRow, "status" | "expiresAt">,
): boolean {
  return (
    row.status === "pending" &&
    row.expiresAt !== null &&
    row.expiresAt <= new Date()
  );
}

export function computeExpiresAt(
  expiresInSeconds: number | null | undefined,
): Date | null {
  if (expiresInSeconds === 0 || expiresInSeconds === null) {
    return null;
  }

  const ttl = expiresInSeconds ?? DEFAULT_EXPIRATION_SECONDS;
  return new Date(Date.now() + ttl * 1000);
}

export async function expireAction(
  actionId: string,
  ownerUserId: string,
): Promise<ActionRow | null> {
  const db = getDb();

  const [updated] = await db
    .update(actions)
    .set({
      status: "expired",
      expiredAt: new Date(),
    })
    .where(
      and(
        eq(actions.id, actionId),
        eq(actions.ownerUserId, ownerUserId),
        eq(actions.status, "pending"),
      ),
    )
    .returning();

  return updated ?? null;
}

export async function bulkExpireActions(ownerUserId: string): Promise<void> {
  const db = getDb();

  await db
    .update(actions)
    .set({
      status: "expired",
      expiredAt: sql`NOW()`,
    })
    .where(
      and(
        eq(actions.ownerUserId, ownerUserId),
        eq(actions.status, "pending"),
        isNotNull(actions.expiresAt),
        lte(actions.expiresAt, sql`NOW()`),
      ),
    );
}
