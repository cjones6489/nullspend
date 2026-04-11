import { NextResponse } from "next/server";
import { z } from "zod";

import { approveAction } from "@/lib/actions/approve-action";
import { resolveSessionContext } from "@/lib/auth/session";
import { assertOrgRole } from "@/lib/auth/org-authorization";
import {
  actionIdParamsSchema,
  mutateActionResponseSchema,
} from "@/lib/validations/actions";
import { handleRouteError, readJsonBody, readRouteParams } from "@/lib/utils/http";

const approveBodySchema = z.object({
  approvedAmountMicrodollars: z.number().int().positive().max(1_000_000_000_000).optional(),
}).optional();

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { userId, orgId } = await resolveSessionContext();
    await assertOrgRole(userId, orgId, "admin");
    const params = await readRouteParams(context.params);
    const { id } = actionIdParamsSchema.parse(params);
    // ACT-3: Only treat empty/no-body as undefined. Malformed JSON should 400.
    // Use Content-Type (not Content-Length) — handles chunked transfers correctly.
    const hasJsonBody = request.headers.get("content-type")?.includes("application/json") ?? false;
    const body = hasJsonBody ? await readJsonBody(request) : undefined;
    const parsed = approveBodySchema.parse(body);
    const action = await approveAction(
      id,
      { approvedBy: userId, approvedAmountMicrodollars: parsed?.approvedAmountMicrodollars },
      orgId,
    );

    return NextResponse.json({ data: mutateActionResponseSchema.parse(action) });
  } catch (error) {
    return handleRouteError(error);
  }
}
