import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { resolveSessionUserId } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { webhookEndpoints } from "@nullspend/db";
import { handleRouteError, readJsonBody, readRouteParams } from "@/lib/utils/http";
import {
  updateWebhookInputSchema,
  webhookIdParamsSchema,
  webhookRecordSchema,
} from "@/lib/validations/webhooks";
import { invalidateWebhookCacheForUser } from "@/lib/webhooks/invalidate-cache";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const userId = await resolveSessionUserId();
    const params = await readRouteParams(context.params);
    const { id } = webhookIdParamsSchema.parse(params);
    const body = await readJsonBody(request);
    const input = updateWebhookInputSchema.parse(body);

    const updates: Record<string, unknown> = {};
    if (input.url !== undefined) updates.url = input.url;
    if (input.description !== undefined) updates.description = input.description;
    if (input.eventTypes !== undefined) updates.eventTypes = input.eventTypes;
    if (input.enabled !== undefined) updates.enabled = input.enabled;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: { code: "validation_error", message: "No fields to update.", details: null } },
        { status: 400 },
      );
    }

    const db = getDb();

    const [updated] = await db
      .update(webhookEndpoints)
      .set(updates)
      .where(
        and(
          eq(webhookEndpoints.id, id),
          eq(webhookEndpoints.userId, userId),
        ),
      )
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

    if (!updated) {
      return NextResponse.json(
        { error: { code: "not_found", message: "Webhook endpoint not found.", details: null } },
        { status: 404 },
      );
    }

    console.info(
      `[NullSpend] Webhook endpoint updated: userId=${userId}, endpointId=${updated.id}`,
    );

    // Fire-and-forget: invalidate proxy's webhook cache so it picks up changes
    void invalidateWebhookCacheForUser(userId);

    return NextResponse.json({
      data: webhookRecordSchema.parse({
        ...updated,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      }),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const userId = await resolveSessionUserId();
    const params = await readRouteParams(context.params);
    const { id } = webhookIdParamsSchema.parse(params);

    const db = getDb();

    const [deleted] = await db
      .delete(webhookEndpoints)
      .where(
        and(
          eq(webhookEndpoints.id, id),
          eq(webhookEndpoints.userId, userId),
        ),
      )
      .returning({ id: webhookEndpoints.id });

    if (!deleted) {
      return NextResponse.json(
        { error: { code: "not_found", message: "Webhook endpoint not found.", details: null } },
        { status: 404 },
      );
    }

    console.info(
      `[NullSpend] Webhook endpoint deleted: userId=${userId}, endpointId=${deleted.id}`,
    );

    // Fire-and-forget: invalidate proxy's webhook cache
    void invalidateWebhookCacheForUser(userId);

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
