import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";

import { resolveSessionUserId } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { webhookEndpoints } from "@nullspend/db";
import { handleRouteError, readRouteParams } from "@/lib/utils/http";
import { webhookIdParamsSchema } from "@/lib/validations/webhooks";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const userId = await resolveSessionUserId();
    const params = await readRouteParams(context.params);
    const { id } = webhookIdParamsSchema.parse(params);

    const newSecret = `whsec_${randomBytes(32).toString("hex")}`;

    const db = getDb();

    const [updated] = await db
      .update(webhookEndpoints)
      .set({ signingSecret: newSecret })
      .where(
        and(
          eq(webhookEndpoints.id, id),
          eq(webhookEndpoints.userId, userId),
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
      data: { signingSecret: newSecret },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
