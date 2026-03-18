import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";

import { resolveSessionUserId } from "@/lib/auth/session";
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
    const userId = await resolveSessionUserId();
    const raw = await readRouteParams(params);
    const { id } = deleteRouteParamsSchema.parse(raw);

    const db = getDb();

    const deleted = await db
      .delete(toolCosts)
      .where(and(eq(toolCosts.id, id), eq(toolCosts.userId, userId)))
      .returning({ id: toolCosts.id, serverName: toolCosts.serverName, toolName: toolCosts.toolName });

    if (deleted.length === 0) {
      throw new NotFoundError("Tool cost not found.");
    }

    console.info(`[NullSpend] Tool cost reset to default: ${deleted[0].serverName}/${deleted[0].toolName} (user: ${userId})`);

    return NextResponse.json({ deleted: true });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: { code: "not_found", message: error.message, details: null } }, { status: 404 });
    }
    return handleRouteError(error);
  }
}
