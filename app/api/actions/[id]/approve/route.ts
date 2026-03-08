import { NextResponse } from "next/server";

import { approveAction } from "@/lib/actions/approve-action";
import {
  assertSession,
  resolveApprovalActor,
  resolveSessionUserId,
} from "@/lib/auth/session";
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
    await assertSession();
    const ownerUserId = await resolveSessionUserId();
    const params = await readRouteParams(context.params);
    const { id } = actionIdParamsSchema.parse(params);
    const approvedBy = await resolveApprovalActor();
    const action = await approveAction(id, { approvedBy }, ownerUserId);

    return NextResponse.json(mutateActionResponseSchema.parse(action));
  } catch (error) {
    return handleRouteError(error);
  }
}
