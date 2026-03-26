import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";

import { assertApiKeyOrSession } from "@/lib/auth/dual-auth";
import { assertOrgRole } from "@/lib/auth/org-authorization";
import { resolveSessionContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { toolCosts } from "@nullspend/db";
import { handleRouteError, readJsonBody } from "@/lib/utils/http";
import {
  listToolCostsResponseSchema,
  upsertToolCostInputSchema,
} from "@/lib/validations/tool-costs";

function toResponse(row: typeof toolCosts.$inferSelect) {
  return {
    ...row,
    annotations: row.annotations ?? null,
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function GET(request: Request) {
  try {
    const authResult = await assertApiKeyOrSession(request, "viewer");
    if (authResult instanceof Response) return authResult;
    const db = getDb();

    const rows = await db
      .select()
      .from(toolCosts)
      .where(eq(toolCosts.orgId, authResult.orgId));

    const data = rows.map(toResponse);

    return NextResponse.json(listToolCostsResponseSchema.parse({ data }));
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { userId, orgId } = await resolveSessionContext();
    await assertOrgRole(userId, orgId, "admin");
    const body = await readJsonBody(request);
    const input = upsertToolCostInputSchema.parse(body);

    const db = getDb();

    // UPDATE-only: tools must be created via proxy discovery, not manual API calls.
    // This prevents phantom entries for non-existent tools.
    const [row] = await db
      .update(toolCosts)
      .set({
        costMicrodollars: input.costMicrodollars,
        source: "manual",
        updatedAt: sql`NOW()`,
      })
      .where(
        and(
          eq(toolCosts.orgId, orgId),
          eq(toolCosts.serverName, input.serverName),
          eq(toolCosts.toolName, input.toolName),
        ),
      )
      .returning();

    if (!row) {
      return NextResponse.json(
        { error: { code: "not_found", message: "Tool cost not found. Tools must be discovered by the proxy before costs can be set.", details: null } },
        { status: 404 },
      );
    }

    console.info(`[NullSpend] Tool cost updated: ${input.serverName}/${input.toolName} → ${input.costMicrodollars} microdollars (user: ${userId})`);

    return NextResponse.json({ data: toResponse(row) }, { status: 200 });
  } catch (error) {
    return handleRouteError(error);
  }
}
