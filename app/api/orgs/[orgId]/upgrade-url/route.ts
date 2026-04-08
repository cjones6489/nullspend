import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";

import { resolveSessionContext } from "@/lib/auth/session";
import { assertOrgMember, assertOrgRole } from "@/lib/auth/org-authorization";
import { getDb } from "@/lib/db/client";
import { organizations } from "@nullspend/db";
import { handleRouteError, readJsonBody, readRouteParams } from "@/lib/utils/http";
import { orgIdParamsSchema, setUpgradeUrlSchema } from "@/lib/validations/orgs";
import { invalidateProxyCache } from "@/lib/proxy-invalidate";
import { logAuditEvent } from "@/lib/audit/log";

type RouteContext = { params: Promise<{ orgId: string }> };

/**
 * GET /api/orgs/[orgId]/upgrade-url
 *
 * Returns the current org-level upgrade URL from
 * `organizations.metadata.upgradeUrl`. Returns `{ data: { upgradeUrl: null } }`
 * when unset. Requires org membership (any role can read).
 */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const { userId } = await resolveSessionContext();
    const params = await readRouteParams(context.params);
    const { orgId } = orgIdParamsSchema.parse(params);

    await assertOrgMember(userId, orgId);

    const db = getDb();
    const [row] = await db
      .select({ metadata: organizations.metadata })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);

    if (!row) {
      return NextResponse.json(
        { error: { code: "not_found", message: "Organization not found.", details: null } },
        { status: 404 },
      );
    }

    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    const url = typeof meta.upgradeUrl === "string" ? meta.upgradeUrl : null;
    return NextResponse.json({ data: { upgradeUrl: url } });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * PATCH /api/orgs/[orgId]/upgrade-url
 *
 * Sets or clears the org-level upgrade URL stored at
 * `organizations.metadata.upgradeUrl`. Surfaced in `budget_exceeded` and
 * `customer_budget_exceeded` denial response bodies as `error.upgrade_url`.
 *
 * Pass `{ upgradeUrl: "https://acme.com/billing?customer={customer_id}" }`
 * to set, `{ upgradeUrl: null }` to clear. The `{customer_id}` placeholder
 * is substituted at denial time by the proxy.
 *
 * Owner role required. Fires a fire-and-forget `auth_only` invalidation
 * to the proxy so the cached auth identity picks up the new value within
 * a single round trip rather than the 120s positive cache TTL.
 */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { userId } = await resolveSessionContext();
    const params = await readRouteParams(context.params);
    const { orgId } = orgIdParamsSchema.parse(params);

    await assertOrgRole(userId, orgId, "owner");

    const body = await readJsonBody(request);
    const { upgradeUrl } = setUpgradeUrlSchema.parse(body);

    const db = getDb();

    // jsonb_set requires a non-null parent — coalesce metadata to '{}' first.
    // To clear, use the `-` operator (jsonb minus key) instead of jsonb_set.
    if (upgradeUrl === null) {
      await db
        .update(organizations)
        .set({
          metadata: sql`COALESCE(metadata, '{}'::jsonb) - 'upgradeUrl'`,
          updatedAt: sql`NOW()`,
        })
        .where(eq(organizations.id, orgId));
    } else {
      await db
        .update(organizations)
        .set({
          metadata: sql`jsonb_set(COALESCE(metadata, '{}'::jsonb), '{upgradeUrl}', to_jsonb(${upgradeUrl}::text))`,
          updatedAt: sql`NOW()`,
        })
        .where(eq(organizations.id, orgId));
    }

    // Fire-and-forget cache invalidation so subsequent requests pick up
    // the new value without waiting for the 120s positive auth TTL.
    invalidateProxyCache({ action: "auth_only", ownerId: orgId }).catch((err) =>
      console.error("[orgs/upgrade-url] Proxy cache invalidation failed:", err),
    );

    // Audit log: URL changes are security-sensitive (agents may auto-follow
    // the URL on denial). Track every write with actor + new value. Mirrors
    // the per-customer upgrade-url endpoint. (Audit T1.)
    logAuditEvent({
      orgId,
      actorId: userId,
      action: "org_upgrade_url.updated",
      resourceType: "organization",
      resourceId: orgId,
      metadata: { upgradeUrl },
    });

    return NextResponse.json({ data: { upgradeUrl } });
  } catch (error) {
    return handleRouteError(error);
  }
}
