import { NextResponse } from "next/server";

import { getAction } from "@/lib/actions/get-action";
import { assertApiKeyOrSession } from "@/lib/auth/dual-auth";
import { getCostEventsByActionId } from "@/lib/cost-events/get-cost-events-by-action";
import { actionIdParamsSchema } from "@/lib/validations/actions";
import { handleRouteError, readRouteParams } from "@/lib/utils/http";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const authResult = await assertApiKeyOrSession(request);
    if (authResult instanceof Response) return authResult;
    const ownerUserId = authResult;
    const params = await readRouteParams(context.params);
    const { id } = actionIdParamsSchema.parse(params);

    await getAction(id, ownerUserId);

    const costEvents = await getCostEventsByActionId(id, ownerUserId);
    return NextResponse.json({ data: costEvents });
  } catch (error) {
    return handleRouteError(error);
  }
}
