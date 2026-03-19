import { NextResponse } from "next/server";

import { getDevActor } from "@/lib/auth/session";
import { authenticateApiKey, applyRateLimitHeaders } from "@/lib/auth/with-api-key-auth";
import { handleRouteError } from "@/lib/utils/http";

export async function GET(request: Request) {
  try {
    const authResult = await authenticateApiKey(request);
    if (authResult instanceof Response) return authResult;

    if (authResult.keyId) {
      return applyRateLimitHeaders(
        NextResponse.json({
          userId: authResult.userId,
          keyId: authResult.keyId,
        }),
        authResult.rateLimit,
      );
    }

    // Dev-mode fallback key — return dev identity
    const devActor = getDevActor();
    const resolvedUserId = devActor ?? authResult.userId;
    return NextResponse.json({
      userId: resolvedUserId,
      keyId: "dev",
      dev: true,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
