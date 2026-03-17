import { NextResponse } from "next/server";

import { checkHasBudgets } from "@/lib/auth/check-has-budgets";
import { getDevActor } from "@/lib/auth/session";
import { authenticateApiKey, applyRateLimitHeaders } from "@/lib/auth/with-api-key-auth";
import { handleRouteError } from "@/lib/utils/http";

export async function GET(request: Request) {
  try {
    const authResult = await authenticateApiKey(request);
    if (authResult instanceof Response) return authResult;

    if (authResult.keyId) {
      // Managed key — return real identity
      const hasBudgets = await checkHasBudgets(authResult.userId, authResult.keyId);
      return applyRateLimitHeaders(
        NextResponse.json({
          userId: authResult.userId,
          keyId: authResult.keyId,
          hasBudgets,
        }),
        authResult.rateLimit,
      );
    }

    // Dev-mode fallback key — return dev identity
    const devActor = getDevActor();
    const resolvedUserId = devActor ?? authResult.userId;
    const hasBudgets = await checkHasBudgets(resolvedUserId);
    return NextResponse.json({
      userId: resolvedUserId,
      keyId: "dev",
      dev: true,
      hasBudgets,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
