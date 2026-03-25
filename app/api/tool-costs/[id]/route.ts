import { NextResponse } from "next/server";
import { eq, and, sql } from "drizzle-orm";

import { resolveSessionContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { toolCosts } from "@nullspend/db";
import { handleRouteError, readRouteParams } from "@/lib/utils/http";
import { deleteRouteParamsSchema } from "@/lib/validations/tool-costs";

type RouteParams = { params: Promise<{ id: string }> };

class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const { userId, orgId } = await resolveSessionContext();
    const raw = await readRouteParams(params);
    const { id } = deleteRouteParamsSchema.parse(raw);

    const db = getDb();

    const [reset] = await db
      .update(toolCosts)
      .set({
        costMicrodollars: 0,
        source: "discovered",
        updatedAt: sql`NOW()`,
      })
      .where(and(eq(toolCosts.id, id), eq(toolCosts.orgId, orgId)))
      .returning({ id: toolCosts.id, serverName: toolCosts.serverName, toolName: toolCosts.toolName });

    if (!reset) {
      throw new NotFoundError("Tool cost not found.");
    }

    console.info(`[NullSpend] Tool cost reset to unpriced: ${reset.serverName}/${reset.toolName} (user: ${userId})`);

    return NextResponse.json({ deleted: true });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: { code: "not_found", message: error.message, details: null } }, { status: 404 });
    }
    return handleRouteError(error);
  }
}
