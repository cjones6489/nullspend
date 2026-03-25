import { NextResponse } from "next/server";
import { z } from "zod";

import { getAction } from "@/lib/actions/get-action";
import { assertApiKeyOrSession } from "@/lib/auth/dual-auth";
import { getCostEventsByActionId } from "@/lib/cost-events/get-cost-events-by-action";
import { actionIdParamsSchema } from "@/lib/validations/actions";
import { costEventRecordSchema } from "@/lib/validations/cost-events";
import { handleRouteError, readRouteParams } from "@/lib/utils/http";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const authResult = await assertApiKeyOrSession(request);
    if (authResult instanceof Response) return authResult;
    const params = await readRouteParams(context.params);
    const { id } = actionIdParamsSchema.parse(params);

    await getAction(id, authResult.orgId);

    const costEvents = await getCostEventsByActionId(id, authResult.orgId);
    return NextResponse.json({ data: z.array(costEventRecordSchema).parse(costEvents) });
  } catch (error) {
    return handleRouteError(error);
  }
}
