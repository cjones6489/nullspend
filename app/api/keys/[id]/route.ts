import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";

import { resolveSessionUserId } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { apiKeys } from "@agentseam/db";
import { handleRouteError, readRouteParams } from "@/lib/utils/http";
import { actionIdParamsSchema } from "@/lib/validations/actions";
import { deleteApiKeyResponseSchema } from "@/lib/validations/api-keys";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const userId = await resolveSessionUserId();
    const params = await readRouteParams(context.params);
    const { id } = actionIdParamsSchema.parse(params);

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
        { error: "API key not found or already revoked." },
        { status: 404 },
      );
    }

    return NextResponse.json(
      deleteApiKeyResponseSchema.parse({
        id: revoked.id,
        revokedAt: revoked.revokedAt!.toISOString(),
      }),
    );
  } catch (error) {
    return handleRouteError(error);
  }
}

