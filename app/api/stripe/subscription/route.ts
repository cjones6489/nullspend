import { NextResponse } from "next/server";

import { resolveSessionContext } from "@/lib/auth/session";
import { getSubscriptionByUserId } from "@/lib/stripe/subscription";
import { handleRouteError } from "@/lib/utils/http";

export async function GET() {
  try {
    const { userId } = await resolveSessionContext();
    const row = await getSubscriptionByUserId(userId);

    if (!row) {
      return NextResponse.json(null);
    }

    return NextResponse.json({
      id: row.id,
      tier: row.tier,
      status: row.status,
      currentPeriodStart: row.currentPeriodStart?.toISOString() ?? null,
      currentPeriodEnd: row.currentPeriodEnd?.toISOString() ?? null,
      cancelAtPeriodEnd: row.cancelAtPeriodEnd,
      createdAt: row.createdAt.toISOString(),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
