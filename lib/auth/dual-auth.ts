import { NextResponse } from "next/server";

import { API_KEY_HEADER } from "@/lib/auth/api-key";
import { authenticateApiKey } from "@/lib/auth/with-api-key-auth";
import { resolveSessionContext } from "@/lib/auth/session";
import { ForbiddenError } from "@/lib/auth/errors";
import { assertOrgMember, assertOrgRole } from "@/lib/auth/org-authorization";
import type { OrgRole } from "@/lib/validations/orgs";
import { getLogger } from "@/lib/observability";

export interface DualAuthResult {
  userId: string;
  orgId: string;
}

/**
 * Authenticate via API key or session.
 * When session-authenticated, enforces `minSessionRole` if provided.
 * API key auth verifies the key owner is still a member of the org
 * (defense-in-depth: keys should be revoked on member removal, but
 * this catch prevents cross-tenant access if revocation is missed).
 */
export async function assertApiKeyOrSession(
  request: Request,
  minSessionRole?: OrgRole,
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
    // AUTH-3: Verify key owner is still a member of the org.
    // Prevents cross-tenant access if key revocation is missed on member removal.
    try {
      await assertOrgMember(result.userId, result.orgId);
    } catch (err) {
      if (err instanceof ForbiddenError) {
        getLogger("auth").warn(
          { userId: result.userId, orgId: result.orgId, keyId: result.keyId },
          "API key used by non-member — possible missed revocation",
        );
        return NextResponse.json(
          { error: { code: "forbidden", message: "API key owner is no longer a member of the associated organization.", details: null } },
          { status: 403 },
        );
      }
      // DB errors, connection failures, etc. — let them propagate
      // so handleRouteError maps to 503, not a misleading 403.
      throw err;
    }
    return { userId: result.userId, orgId: result.orgId };
  }
  const ctx = await resolveSessionContext();
  if (minSessionRole) {
    await assertOrgRole(ctx.userId, ctx.orgId, minSessionRole);
  }
  return { userId: ctx.userId, orgId: ctx.orgId };
}
