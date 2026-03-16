import { and, eq, or } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { budgets } from "@nullspend/db";

export async function checkHasBudgets(userId: string, keyId?: string): Promise<boolean> {
  const db = getDb();
  const conditions = [
    and(eq(budgets.entityType, "user"), eq(budgets.entityId, userId)),
  ];
  if (keyId) {
    conditions.push(
      and(eq(budgets.entityType, "api_key"), eq(budgets.entityId, keyId)),
    );
  }
  const [row] = await db
    .select({ id: budgets.id })
    .from(budgets)
    .where(or(...conditions))
    .limit(1);
  return !!row;
}
