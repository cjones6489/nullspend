import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";

import { resolveSessionContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { apiKeys } from "@nullspend/db";
import { handleRouteError, readJsonBody, readRouteParams } from "@/lib/utils/http";
import { deleteApiKeyResponseSchema, keyIdParamsSchema, updateApiKeyInputSchema, apiKeyRecordSchema } from "@/lib/validations/api-keys";
import { invalidateProxyCache } from "@/lib/proxy-invalidate";
import { assertOrgRole } from "@/lib/auth/org-authorization";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { userId, orgId } = await resolveSessionContext();
    await assertOrgRole(userId, orgId, "admin");
    const params = await readRouteParams(context.params);
    const { id } = keyIdParamsSchema.parse(params);

    const db = getDb();
    const now = new Date();

    const [revoked] = await db
      .update(apiKeys)
      .set({ revokedAt: now })
      .where(
        and(
          eq(apiKeys.id, id),
          eq(apiKeys.orgId, orgId),
          isNull(apiKeys.revokedAt),
        ),
      )
      .returning({ id: apiKeys.id, revokedAt: apiKeys.revokedAt });

    if (!revoked) {
      return NextResponse.json(
        { error: { code: "not_found", message: "API key not found or already revoked.", details: null } },
        { status: 404 },
      );
    }

    console.info(
      `[NullSpend] API key revoked: userId=${userId}, keyId=${revoked.id}`,
    );

    return NextResponse.json(
      deleteApiKeyResponseSchema.parse({
        id: revoked.id,
        revokedAt: (revoked.revokedAt as Date).toISOString(),
      }),
    );
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { userId, orgId } = await resolveSessionContext();
    await assertOrgRole(userId, orgId, "admin");
    const params = await readRouteParams(context.params);
    const { id } = keyIdParamsSchema.parse(params);
    const body = await readJsonBody(request);
    const input = updateApiKeyInputSchema.parse(body);

    const db = getDb();

    const updates: Partial<{ name: string; defaultTags: Record<string, string> }> = {};
    if (input.name !== undefined) updates.name = input.name;
    if (input.defaultTags !== undefined) updates.defaultTags = input.defaultTags;

    const [updated] = await db
      .update(apiKeys)
      .set(updates)
      .where(
        and(
          eq(apiKeys.id, id),
          eq(apiKeys.orgId, orgId),
          isNull(apiKeys.revokedAt),
        ),
      )
      .returning({
        id: apiKeys.id,
        name: apiKeys.name,
        keyPrefix: apiKeys.keyPrefix,
        defaultTags: apiKeys.defaultTags,
        lastUsedAt: apiKeys.lastUsedAt,
        createdAt: apiKeys.createdAt,
      });

    if (!updated) {
      return NextResponse.json(
        { error: { code: "not_found", message: "API key not found or already revoked.", details: null } },
        { status: 404 },
      );
    }

    // Flush the proxy's auth cache so the new defaultTags take effect immediately
    invalidateProxyCache({
      action: "sync",
      ownerId: orgId,
      entityType: "api_key",
      entityId: id,
    }).catch((err) => console.error("[keys] Proxy cache sync failed:", err));

    console.info(
      `[NullSpend] API key updated: userId=${userId}, keyId=${updated.id}`,
    );

    return NextResponse.json(
      apiKeyRecordSchema.parse({
        ...updated,
        lastUsedAt: updated.lastUsedAt?.toISOString() ?? null,
        createdAt: updated.createdAt.toISOString(),
      }),
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
