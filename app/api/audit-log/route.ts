import { NextResponse } from "next/server";
import { and, desc, eq, lt, or } from "drizzle-orm";
import { z } from "zod";

import { resolveSessionContext } from "@/lib/auth/session";
import { assertOrgRole } from "@/lib/auth/org-authorization";
import { getDb } from "@/lib/db/client";
import { auditEvents } from "@nullspend/db";
import { handleRouteError } from "@/lib/utils/http";

const cursorSchema = z.object({
  createdAt: z.string().datetime(),
  id: z.string().uuid(),
});

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z
    .string()
    .transform((s, ctx) => {
      try { return JSON.parse(s); }
      catch { ctx.addIssue({ code: "custom", message: "Invalid cursor JSON" }); return z.NEVER; }
    })
    .pipe(cursorSchema)
    .optional(),
  action: z.string().min(1).optional(),
});

/**
 * GET /api/audit-log — list audit events for the current org.
 * Requires admin or owner role. Cursor-paginated by (createdAt, id) DESC.
 */
export async function GET(request: Request) {
  try {
    const { userId, orgId } = await resolveSessionContext();
    await assertOrgRole(userId, orgId, "admin");

    const url = new URL(request.url);
    const query = querySchema.parse({
      limit: url.searchParams.get("limit") || undefined,
      cursor: url.searchParams.get("cursor") || undefined,
      action: url.searchParams.get("action") || undefined,
    });

    const db = getDb();
    const conditions = [eq(auditEvents.orgId, orgId)];

    if (query.cursor) {
      const cursorDate = new Date(query.cursor.createdAt);
      conditions.push(
        or(
          lt(auditEvents.createdAt, cursorDate),
          and(eq(auditEvents.createdAt, cursorDate), lt(auditEvents.id, query.cursor.id)),
        )!,
      );
    }
    if (query.action) {
      conditions.push(eq(auditEvents.action, query.action));
    }

    const rows = await db
      .select({
        id: auditEvents.id,
        actorId: auditEvents.actorId,
        action: auditEvents.action,
        resourceType: auditEvents.resourceType,
        resourceId: auditEvents.resourceId,
        metadata: auditEvents.metadata,
        createdAt: auditEvents.createdAt,
      })
      .from(auditEvents)
      .where(and(...conditions))
      .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
      .limit(query.limit + 1);

    const hasMore = rows.length > query.limit;
    const data = rows.slice(0, query.limit).map((row) => ({
      id: row.id,
      actorId: row.actorId,
      action: row.action,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      metadata: row.metadata,
      createdAt: row.createdAt.toISOString(),
    }));

    const last = data[data.length - 1];
    const cursor = hasMore && last
      ? { createdAt: last.createdAt, id: last.id }
      : null;

    return NextResponse.json({ data, cursor });
  } catch (error) {
    return handleRouteError(error);
  }
}
