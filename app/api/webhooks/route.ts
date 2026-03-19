import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { count, eq, desc } from "drizzle-orm";

import { resolveSessionUserId } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { webhookEndpoints } from "@nullspend/db";
import { handleRouteError, readJsonBody } from "@/lib/utils/http";
import {
  createWebhookInputSchema,
  webhookRecordSchema,
  MAX_WEBHOOK_ENDPOINTS_PER_USER,
} from "@/lib/validations/webhooks";
import { invalidateWebhookCacheForUser } from "@/lib/webhooks/invalidate-cache";

export async function GET() {
  try {
    const userId = await resolveSessionUserId();
    const db = getDb();

    const rows = await db
      .select({
        id: webhookEndpoints.id,
        url: webhookEndpoints.url,
        description: webhookEndpoints.description,
        eventTypes: webhookEndpoints.eventTypes,
        enabled: webhookEndpoints.enabled,
        apiVersion: webhookEndpoints.apiVersion,
        createdAt: webhookEndpoints.createdAt,
        updatedAt: webhookEndpoints.updatedAt,
      })
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.userId, userId))
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
    const userId = await resolveSessionUserId();
    const body = await readJsonBody(request);
    const input = createWebhookInputSchema.parse(body);

    const db = getDb();

    const [{ value: endpointCount }] = await db
      .select({ value: count() })
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.userId, userId));

    if (endpointCount >= MAX_WEBHOOK_ENDPOINTS_PER_USER) {
      return NextResponse.json(
        { error: { code: "limit_exceeded", message: `Maximum of ${MAX_WEBHOOK_ENDPOINTS_PER_USER} webhook endpoints allowed.`, details: null } },
        { status: 409 },
      );
    }

    const signingSecret = `whsec_${randomBytes(32).toString("hex")}`;

    const [created] = await db
      .insert(webhookEndpoints)
      .values({
        userId,
        url: input.url,
        description: input.description ?? null,
        signingSecret,
        eventTypes: input.eventTypes,
      })
      .returning({
        id: webhookEndpoints.id,
        url: webhookEndpoints.url,
        description: webhookEndpoints.description,
        eventTypes: webhookEndpoints.eventTypes,
        enabled: webhookEndpoints.enabled,
        apiVersion: webhookEndpoints.apiVersion,
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
