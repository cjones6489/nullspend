import { resolveSessionContext } from "@/lib/auth/session";
import { withRequestContext } from "@/lib/observability";
import { NextResponse } from "next/server";

/**
 * GET /api/auth/session — returns current session context for client components.
 */
export const GET = withRequestContext(async (_request: Request) => {
  const { userId, orgId, role } = await resolveSessionContext();
  return NextResponse.json({ userId, orgId, role });
});
