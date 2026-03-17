import { NextResponse } from "next/server";

import { markResult } from "@/lib/actions/mark-result";
import { authenticateApiKey, applyRateLimitHeaders } from "@/lib/auth/with-api-key-auth";
import { withRequestContext } from "@/lib/observability";
import { withIdempotency } from "@/lib/resilience/idempotency";
import {
  actionIdParamsSchema,
  markResultInputSchema,
  mutateActionResponseSchema,
} from "@/lib/validations/actions";
import {
  readJsonBody,
  readRouteParams,
} from "@/lib/utils/http";

export const POST = withRequestContext(async (
  request: Request,
  context: { params: Promise<{ id: string }> },
) => {
  return withIdempotency(request, async () => {
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
  });
});
