import { NextResponse } from "next/server";

import { API_KEY_HEADER } from "@/lib/auth/api-key";
import { authenticateApiKey } from "@/lib/auth/with-api-key-auth";
import { resolveSessionContext } from "@/lib/auth/session";

export interface DualAuthResult {
  userId: string;
  orgId: string;
}

export async function assertApiKeyOrSession(
  request: Request,
): Promise<DualAuthResult | Response> {
  if (request.headers.has(API_KEY_HEADER)) {
    const result = await authenticateApiKey(request);
    if (result instanceof Response) return result; // 429
    if (!result.orgId) {
      return NextResponse.json(
        { error: { code: "configuration_error", message: "API key is not associated with an organization. Re-create the key or contact support.", details: null } },
        { status: 403 },
      );
    }
    return { userId: result.userId, orgId: result.orgId };
  }
  const ctx = await resolveSessionContext();
  return { userId: ctx.userId, orgId: ctx.orgId };
}
