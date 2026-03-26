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
    const params = await readRouteParams(context.params);
    const { id } = actionIdParamsSchema.parse(params);
    const body = await readJsonBody(request);
    const input = markResultInputSchema.parse(body);
    if (!authResult.orgId) {
      return NextResponse.json(
        { error: { code: "configuration_error", message: "API key is not associated with an organization.", details: null } },
        { status: 403 },
      );
    }
    const action = await markResult(id, input, authResult.orgId);

    return applyRateLimitHeaders(
      NextResponse.json({ data: mutateActionResponseSchema.parse(action) }),
      authResult.rateLimit,
    );
  });
});
