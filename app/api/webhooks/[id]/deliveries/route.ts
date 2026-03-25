import { NextResponse } from "next/server";
import { and, eq, desc } from "drizzle-orm";

import { resolveSessionContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { webhookEndpoints, webhookDeliveries } from "@nullspend/db";
import { handleRouteError, readRouteParams } from "@/lib/utils/http";
import {
  webhookIdParamsSchema,
  webhookDeliveryRecordSchema,
} from "@/lib/validations/webhooks";
import { assertOrgRole } from "@/lib/auth/org-authorization";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { userId, orgId } = await resolveSessionContext();
    await assertOrgRole(userId, orgId, "viewer");
    const params = await readRouteParams(context.params);
    const { id } = webhookIdParamsSchema.parse(params);

    const db = getDb();

    // Verify ownership
    const [endpoint] = await db
      .select({ id: webhookEndpoints.id })
      .from(webhookEndpoints)
      .where(
        and(
          eq(webhookEndpoints.id, id),
          eq(webhookEndpoints.orgId, orgId),
        ),
      );

    if (!endpoint) {
      return NextResponse.json(
        { error: { code: "not_found", message: "Webhook endpoint not found.", details: null } },
        { status: 404 },
      );
    }

    const rows = await db
      .select({
        id: webhookDeliveries.id,
        eventType: webhookDeliveries.eventType,
        eventId: webhookDeliveries.eventId,
        status: webhookDeliveries.status,
        attempts: webhookDeliveries.attempts,
        lastAttemptAt: webhookDeliveries.lastAttemptAt,
        responseStatus: webhookDeliveries.responseStatus,
        createdAt: webhookDeliveries.createdAt,
      })
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.endpointId, id))
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(50);

    const data = rows.map((row) =>
      webhookDeliveryRecordSchema.parse({
        ...row,
        lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      }),
    );

    return NextResponse.json({ data });
  } catch (error) {
    return handleRouteError(error);
  }
}
