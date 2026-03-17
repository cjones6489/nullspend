import { NextResponse } from "next/server";

import { getAction } from "@/lib/actions/get-action";
import { assertApiKeyOrSession } from "@/lib/auth/dual-auth";
import { withRequestContext } from "@/lib/observability";
import {
  actionIdParamsSchema,
  actionRecordSchema,
} from "@/lib/validations/actions";
import { readRouteParams } from "@/lib/utils/http";

export const GET = withRequestContext(async (
  request: Request,
  context: { params: Promise<{ id: string }> },
) => {
  const authResult = await assertApiKeyOrSession(request);
  if (authResult instanceof Response) return authResult;
  const ownerUserId = authResult;
  const params = await readRouteParams(context.params);
  const { id } = actionIdParamsSchema.parse(params);
  const action = await getAction(id, ownerUserId);

  return NextResponse.json(actionRecordSchema.parse(action));
});
