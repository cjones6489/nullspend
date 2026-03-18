import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";

import { resolveSessionUserId } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { apiKeys } from "@nullspend/db";
import { handleRouteError, readRouteParams } from "@/lib/utils/http";
import { deleteApiKeyResponseSchema, keyIdParamsSchema } from "@/lib/validations/api-keys";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const userId = await resolveSessionUserId();
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
          eq(apiKeys.userId, userId),
          isNull(apiKeys.revokedAt),
        ),
      )
      .returning({ id: apiKeys.id, revokedAt: apiKeys.revokedAt });

    if (!revoked) {
      return NextResponse.json(
        { error: "not_found", message: "API key not found or already revoked." },
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

