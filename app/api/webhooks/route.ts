import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { count, eq, desc } from "drizzle-orm";

import { resolveSessionContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { webhookEndpoints } from "@nullspend/db";
import { handleRouteError, readJsonBody } from "@/lib/utils/http";
import {
  createWebhookInputSchema,
  webhookRecordSchema,
} from "@/lib/validations/webhooks";
import { invalidateWebhookCacheForUser } from "@/lib/webhooks/invalidate-cache";
import { resolveUserTier, assertCountBelowLimit } from "@/lib/stripe/feature-gate";

export async function GET() {
  try {
    const { orgId } = await resolveSessionContext();
    const db = getDb();

    const rows = await db
      .select({
        id: webhookEndpoints.id,
        url: webhookEndpoints.url,
        description: webhookEndpoints.description,
        eventTypes: webhookEndpoints.eventTypes,
        enabled: webhookEndpoints.enabled,
        apiVersion: webhookEndpoints.apiVersion,
        payloadMode: webhookEndpoints.payloadMode,
        createdAt: webhookEndpoints.createdAt,
        updatedAt: webhookEndpoints.updatedAt,
      })
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.orgId, orgId))
      .orderBy(desc(webhookEndpoints.createdAt));

    const data = rows.map((row) =>
      webhookRecordSchema.parse({
        ...row,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      }),
    );

    return NextResponse.json({ data });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { userId, orgId } = await resolveSessionContext();
    const body = await readJsonBody(request);
    const input = createWebhookInputSchema.parse(body);

    const db = getDb();

    const [{ value: endpointCount }] = await db
      .select({ value: count() })
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.orgId, orgId));

    const tierInfo = await resolveUserTier(userId);
    assertCountBelowLimit(tierInfo, "maxWebhookEndpoints", endpointCount, "webhook endpoints");

    const signingSecret = `whsec_${randomBytes(32).toString("hex")}`;

    const [created] = await db
      .insert(webhookEndpoints)
      .values({
        userId,
        orgId,
        url: input.url,
        description: input.description ?? null,
        signingSecret,
        eventTypes: input.eventTypes,
        payloadMode: input.payloadMode,
      })
      .returning({
        id: webhookEndpoints.id,
        url: webhookEndpoints.url,
        description: webhookEndpoints.description,
        eventTypes: webhookEndpoints.eventTypes,
        enabled: webhookEndpoints.enabled,
        apiVersion: webhookEndpoints.apiVersion,
        payloadMode: webhookEndpoints.payloadMode,
        createdAt: webhookEndpoints.createdAt,
        updatedAt: webhookEndpoints.updatedAt,
      });

    console.info(
      `[NullSpend] Webhook endpoint created: userId=${userId}, endpointId=${created.id}`,
    );

    // Fire-and-forget: invalidate proxy's webhook cache
    void invalidateWebhookCacheForUser(userId);

    return NextResponse.json(
      {
        data: {
          ...webhookRecordSchema.parse({
            ...created,
            createdAt: created.createdAt.toISOString(),
            updatedAt: created.updatedAt.toISOString(),
          }),
          signingSecret,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
