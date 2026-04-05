import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { resolveSessionContext } from "@/lib/auth/session";
import { assertOrgRole } from "@/lib/auth/org-authorization";
import { getDb } from "@/lib/db/client";
import { customerMappings } from "@nullspend/db";
import { withRequestContext } from "@/lib/observability";
import { readJsonBody } from "@/lib/utils/http";

export const GET = withRequestContext(async (_request: Request) => {
  const { userId, orgId } = await resolveSessionContext();
  await assertOrgRole(userId, orgId, "viewer");

  const db = getDb();
  const rows = await db
    .select()
    .from(customerMappings)
    .where(eq(customerMappings.orgId, orgId));

  return NextResponse.json({
    data: rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
    })),
  });
});

export const POST = withRequestContext(async (request: Request) => {
  const { userId, orgId } = await resolveSessionContext();
  await assertOrgRole(userId, orgId, "member");

  const body = (await readJsonBody(request)) as {
    stripeCustomerId?: string;
    tagValue?: string;
    tagKey?: string;
    matchType?: string;
  };

  if (!body.stripeCustomerId || !body.tagValue) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "stripeCustomerId and tagValue are required.", details: null } },
      { status: 400 },
    );
  }

  // Length and character validation
  const MAX_LEN = 255;
  const CONTROL_CHARS = /[\x00-\x1f\x7f]/;
  if (
    body.stripeCustomerId.length > MAX_LEN ||
    body.tagValue.length > MAX_LEN ||
    (body.tagKey && body.tagKey.length > MAX_LEN) ||
    CONTROL_CHARS.test(body.stripeCustomerId) ||
    CONTROL_CHARS.test(body.tagValue) ||
    (body.tagKey && CONTROL_CHARS.test(body.tagKey))
  ) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "Fields must be under 255 characters with no control characters.", details: null } },
      { status: 400 },
    );
  }

  const matchType = body.matchType === "auto" ? "auto" as const : "manual" as const;
  const tagKey = body.tagKey ?? "customer";

  const db = getDb();

  const [mapping] = await db
    .insert(customerMappings)
    .values({
      orgId,
      stripeCustomerId: body.stripeCustomerId,
      tagKey,
      tagValue: body.tagValue,
      matchType,
      confidence: matchType === "manual" ? 1.0 : null,
    })
    .onConflictDoUpdate({
      target: [customerMappings.orgId, customerMappings.stripeCustomerId, customerMappings.tagKey],
      set: {
        tagValue: body.tagValue,
        matchType,
        confidence: matchType === "manual" ? 1.0 : null,
      },
    })
    .returning();

  return NextResponse.json(
    { data: { ...mapping, createdAt: mapping.createdAt.toISOString() } },
    { status: 201 },
  );
});

export const DELETE = withRequestContext(async (request: Request) => {
  const { userId, orgId } = await resolveSessionContext();
  await assertOrgRole(userId, orgId, "member");

  const url = new URL(request.url);
  const mappingId = url.searchParams.get("id");

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!mappingId || !UUID_RE.test(mappingId)) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "id must be a valid UUID.", details: null } },
      { status: 400 },
    );
  }

  const db = getDb();
  const deleted = await db
    .delete(customerMappings)
    .where(
      and(
        eq(customerMappings.id, mappingId),
        eq(customerMappings.orgId, orgId),
      ),
    )
    .returning({ id: customerMappings.id });

  if (deleted.length === 0) {
    return NextResponse.json(
      { error: { code: "not_found", message: "Mapping not found.", details: null } },
      { status: 404 },
    );
  }

  return NextResponse.json({ data: { deleted: true } });
});
