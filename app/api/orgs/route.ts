import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";

import { resolveSessionContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { organizations, orgMemberships } from "@nullspend/db";
import { readJsonBody } from "@/lib/utils/http";
import { createOrgSchema, orgRecordSchema } from "@/lib/validations/orgs";
import { withRequestContext } from "@/lib/observability";

/**
 * GET /api/orgs — list all orgs the user is a member of.
 */
export const GET = withRequestContext(async (_request: Request) => {
  const { userId } = await resolveSessionContext();
  const db = getDb();

  const rows = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      isPersonal: organizations.isPersonal,
      role: orgMemberships.role,
      createdAt: organizations.createdAt,
      updatedAt: organizations.updatedAt,
    })
    .from(orgMemberships)
    .innerJoin(organizations, eq(orgMemberships.orgId, organizations.id))
    .where(eq(orgMemberships.userId, userId))
    .orderBy(asc(organizations.createdAt));

  const data = rows.map((row) => ({
    ...orgRecordSchema.parse({
      id: row.id,
      name: row.name,
      slug: row.slug,
      isPersonal: row.isPersonal,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }),
    role: row.role,
  }));

  return NextResponse.json({ data });
});

/**
 * POST /api/orgs — create a new team org.
 * The requesting user becomes the owner.
 */
export const POST = withRequestContext(async (request: Request) => {
  const { userId } = await resolveSessionContext();
  const body = await readJsonBody(request);
  const input = createOrgSchema.parse(body);

  const db = getDb();

  let org;
  try {
    [org] = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(organizations)
        .values({
          name: input.name,
          slug: input.slug,
          isPersonal: false,
          createdBy: userId,
        })
        .returning();

      await tx.insert(orgMemberships).values({
        orgId: created.id,
        userId,
        role: "owner",
      });

      return [created];
    });
  } catch (err) {
    if (err instanceof Error && "code" in err && (err as { code: string }).code === "23505") {
      return NextResponse.json(
        { error: { code: "conflict", message: "An organization with this slug already exists.", details: null } },
        { status: 409 },
      );
    }
    throw err;
  }

  return NextResponse.json(
    orgRecordSchema.parse({
      id: org.id,
      name: org.name,
      slug: org.slug,
      isPersonal: org.isPersonal,
      createdAt: org.createdAt.toISOString(),
      updatedAt: org.updatedAt.toISOString(),
    }),
    { status: 201 },
  );
});
