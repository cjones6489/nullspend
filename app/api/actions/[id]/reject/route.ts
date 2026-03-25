import { NextResponse } from "next/server";

import { rejectAction } from "@/lib/actions/reject-action";
import { resolveSessionContext } from "@/lib/auth/session";
import {
  actionIdParamsSchema,
  mutateActionResponseSchema,
} from "@/lib/validations/actions";
import { handleRouteError, readRouteParams } from "@/lib/utils/http";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { userId, orgId } = await resolveSessionContext();
    const params = await readRouteParams(context.params);
    const { id } = actionIdParamsSchema.parse(params);
    const action = await rejectAction(id, { rejectedBy: userId }, orgId);

    return NextResponse.json(mutateActionResponseSchema.parse(action));
  } catch (error) {
    return handleRouteError(error);
  }
}
