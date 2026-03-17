import { NextResponse } from "next/server";

import { markResult } from "@/lib/actions/mark-result";
import { authenticateApiKey, applyRateLimitHeaders } from "@/lib/auth/with-api-key-auth";
import {
  actionIdParamsSchema,
  markResultInputSchema,
  mutateActionResponseSchema,
} from "@/lib/validations/actions";
import {
  handleRouteError,
  readJsonBody,
  readRouteParams,
} from "@/lib/utils/http";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const authResult = await authenticateApiKey(request);
    if (authResult instanceof Response) return authResult;
    const ownerUserId = authResult.userId;
    const params = await readRouteParams(context.params);
    const { id } = actionIdParamsSchema.parse(params);
    const body = await readJsonBody(request);
    const input = markResultInputSchema.parse(body);
    const action = await markResult(id, input, ownerUserId);

    return applyRateLimitHeaders(
      NextResponse.json(mutateActionResponseSchema.parse(action)),
      authResult.rateLimit,
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
