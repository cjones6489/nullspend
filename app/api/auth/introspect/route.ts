import { NextResponse } from "next/server";

import {
  assertApiKeyWithIdentity,
  resolveDevFallbackApiKeyUserId,
} from "@/lib/auth/api-key";
import { checkHasBudgets } from "@/lib/auth/check-has-budgets";
import { getDevActor } from "@/lib/auth/session";
import { handleRouteError } from "@/lib/utils/http";

export async function GET(request: Request) {
  try {
    const identity = await assertApiKeyWithIdentity(request);

    if (identity) {
      // Managed key — return real identity
      const hasBudgets = await checkHasBudgets(identity.userId, identity.keyId);
      return NextResponse.json({
        userId: identity.userId,
        keyId: identity.keyId,
        hasBudgets,
      });
    }

    // Dev-mode fallback key — return dev identity
    const devUserId = resolveDevFallbackApiKeyUserId();
    const devActor = getDevActor();
    const resolvedUserId = devActor ?? devUserId;
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
