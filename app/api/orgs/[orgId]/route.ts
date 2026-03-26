import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";

import { resolveSessionContext } from "@/lib/auth/session";
import { assertOrgMember, assertOrgRole } from "@/lib/auth/org-authorization";
import { getDb } from "@/lib/db/client";
import {
  actions,
  apiKeys,
  budgets,
  costEvents,
  organizations,
  slackConfigs,
  subscriptions,
  toolCosts,
  webhookDeliveries,
  webhookEndpoints,
} from "@nullspend/db";
import { handleRouteError, readJsonBody, readRouteParams } from "@/lib/utils/http";
import { orgIdParamsSchema, updateOrgSchema, orgRecordSchema } from "@/lib/validations/orgs";
import { ForbiddenError } from "@/lib/auth/errors";
import { getSubscriptionByOrgId } from "@/lib/stripe/subscription";
import { getStripe } from "@/lib/stripe/client";
import { invalidateProxyCache } from "@/lib/proxy-invalidate";

type RouteContext = { params: Promise<{ orgId: string }> };

/**
 * GET /api/orgs/[orgId] — get org details. Requires membership.
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const { userId } = await resolveSessionContext();
    const params = await readRouteParams(context.params);
    const { orgId } = orgIdParamsSchema.parse(params);

    await assertOrgMember(userId, orgId);

    const db = getDb();
    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);

    if (!org) {
      return NextResponse.json(
        { error: { code: "not_found", message: "Organization not found.", details: null } },
        { status: 404 },
      );
    }

    return NextResponse.json({
      data: orgRecordSchema.parse({
        id: org.id,
        name: org.name,
        slug: org.slug,
        isPersonal: org.isPersonal,
        createdAt: org.createdAt.toISOString(),
        updatedAt: org.updatedAt.toISOString(),
      }),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * PATCH /api/orgs/[orgId] — update org name/slug. Requires admin+.
 * Personal orgs cannot be renamed.
 */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { userId } = await resolveSessionContext();
    const params = await readRouteParams(context.params);
    const { orgId } = orgIdParamsSchema.parse(params);

    await assertOrgRole(userId, orgId, "admin");

    const body = await readJsonBody(request);
    const input = updateOrgSchema.parse(body);

    if (Object.keys(input).length === 0) {
      return NextResponse.json(
        { error: { code: "validation_error", message: "No fields to update.", details: null } },
        { status: 400 },
      );
    }

    const db = getDb();

    // Prevent renaming personal orgs
    const [existing] = await db
      .select({ isPersonal: organizations.isPersonal })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);

    if (existing?.isPersonal) {
      throw new ForbiddenError("Personal organizations cannot be renamed.");
    }

    let updated;
    try {
      [updated] = await db
        .update(organizations)
        .set({ ...input, updatedAt: sql`NOW()` })
        .where(eq(organizations.id, orgId))
        .returning();
    } catch (err) {
      if (err instanceof Error && "code" in err && (err as { code: string }).code === "23505") {
        return NextResponse.json(
          { error: { code: "conflict", message: "An organization with this slug already exists.", details: null } },
          { status: 409 },
        );
      }
      throw err;
    }

    return NextResponse.json({
      data: orgRecordSchema.parse({
        id: updated.id,
        name: updated.name,
        slug: updated.slug,
        isPersonal: updated.isPersonal,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      }),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * DELETE /api/orgs/[orgId] — delete org. Owner only.
 * Personal orgs cannot be deleted. Cascades via FK (memberships, invitations).
 */
export async function DELETE(request: Request, context: RouteContext) {
  try {
    const { userId } = await resolveSessionContext();
    const params = await readRouteParams(context.params);
    const { orgId } = orgIdParamsSchema.parse(params);

    await assertOrgRole(userId, orgId, "owner");

    const db = getDb();

    const [existing] = await db
      .select({ isPersonal: organizations.isPersonal })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);

    if (existing?.isPersonal) {
      throw new ForbiddenError("Personal organizations cannot be deleted.");
    }

    // Cancel Stripe subscription if one exists (before deleting the DB row)
    const sub = await getSubscriptionByOrgId(orgId);
    if (sub?.stripeSubscriptionId) {
      try {
        const stripe = getStripe();
        await stripe.subscriptions.cancel(sub.stripeSubscriptionId);
      } catch (err) {
        // Log but don't block deletion — the subscription may already be canceled
        console.error("[org-delete] Failed to cancel Stripe subscription:", err);
      }
    }

    // Invalidate proxy DO budget state for all the org's budgets
    const orgBudgets = await db.select({ entityType: budgets.entityType, entityId: budgets.entityId }).from(budgets).where(eq(budgets.orgId, orgId));
    for (const b of orgBudgets) {
      invalidateProxyCache({ action: "remove", ownerId: orgId, entityType: b.entityType, entityId: b.entityId }).catch((err) =>
        console.error("[org-delete] Proxy cache invalidation failed:", err),
      );
    }

    // Delete all org resources, then the org itself (which FK-cascades memberships + invitations)
    await db.transaction(async (tx) => {
      // Delete dependent tables first (webhook_deliveries references webhook_endpoints)
      await tx.delete(webhookDeliveries).where(
        sql`${webhookDeliveries.endpointId} IN (SELECT id FROM webhook_endpoints WHERE org_id = ${orgId})`,
      );
      await tx.delete(webhookEndpoints).where(eq(webhookEndpoints.orgId, orgId));
      await tx.delete(costEvents).where(eq(costEvents.orgId, orgId));
      await tx.delete(budgets).where(eq(budgets.orgId, orgId));
      await tx.delete(apiKeys).where(eq(apiKeys.orgId, orgId));
      await tx.delete(actions).where(eq(actions.orgId, orgId));
      await tx.delete(slackConfigs).where(eq(slackConfigs.orgId, orgId));
      await tx.delete(toolCosts).where(eq(toolCosts.orgId, orgId));
      await tx.delete(subscriptions).where(eq(subscriptions.orgId, orgId));
      // Finally delete the org — cascades memberships + invitations via FK
      await tx.delete(organizations).where(eq(organizations.id, orgId));
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
