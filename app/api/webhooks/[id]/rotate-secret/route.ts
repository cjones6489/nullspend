import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";

import { resolveSessionContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { webhookEndpoints } from "@nullspend/db";
import { handleRouteError, readRouteParams } from "@/lib/utils/http";
import { webhookIdParamsSchema } from "@/lib/validations/webhooks";
import { assertOrgRole } from "@/lib/auth/org-authorization";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { userId, orgId } = await resolveSessionContext();
    await assertOrgRole(userId, orgId, "admin");
    const params = await readRouteParams(context.params);
    const { id } = webhookIdParamsSchema.parse(params);

    const newSecret = `whsec_${randomBytes(32).toString("hex")}`;

    const db = getDb();

    const secretRotatedAt = new Date();

    const [updated] = await db
      .update(webhookEndpoints)
      .set({
        previousSigningSecret: sql`${webhookEndpoints.signingSecret}`,
        signingSecret: newSecret,
        secretRotatedAt,
      })
      .where(
        and(
          eq(webhookEndpoints.id, id),
          eq(webhookEndpoints.orgId, orgId),
        ),
      )
      .returning({ id: webhookEndpoints.id });

    if (!updated) {
      return NextResponse.json(
        { error: { code: "not_found", message: "Webhook endpoint not found.", details: null } },
        { status: 404 },
      );
    }

    console.info(
      `[NullSpend] Webhook secret rotated: userId=${userId}, endpointId=${updated.id}`,
    );

    return NextResponse.json({
      data: { signingSecret: newSecret, secretRotatedAt: secretRotatedAt.toISOString() },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
