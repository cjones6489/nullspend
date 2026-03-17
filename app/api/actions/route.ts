import { NextResponse } from "next/server";

import { createAction } from "@/lib/actions/create-action";
import { listActions } from "@/lib/actions/list-actions";
import { resolveSessionUserId } from "@/lib/auth/session";
import { authenticateApiKey, applyRateLimitHeaders } from "@/lib/auth/with-api-key-auth";
import { withRequestContext } from "@/lib/observability";
import { withIdempotency } from "@/lib/resilience/idempotency";
import { sendSlackNotification } from "@/lib/slack/notify";
import {
  createActionInputSchema,
  createActionResponseSchema,
  listActionsQuerySchema,
  listActionsResponseSchema,
} from "@/lib/validations/actions";
import { readJsonBody } from "@/lib/utils/http";

export const GET = withRequestContext(async (request: Request) => {
  const ownerUserId = await resolveSessionUserId();
  const url = new URL(request.url);
  const query = listActionsQuerySchema.parse({
    status: url.searchParams.get("status") ?? undefined,
    statuses: url.searchParams.get("statuses") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
    cursor: url.searchParams.get("cursor") ?? undefined,
  });
  const result = await listActions({ ...query, ownerUserId });

  return NextResponse.json(listActionsResponseSchema.parse(result));
});

export const POST = withRequestContext(async (request: Request) => {
  return withIdempotency(request, async () => {
    const authResult = await authenticateApiKey(request);
    if (authResult instanceof Response) return authResult;
    const ownerUserId = authResult.userId;
    const body = await readJsonBody(request);
    const input = createActionInputSchema.parse(body);
    const action = await createAction(input, ownerUserId);

    sendSlackNotification(action, ownerUserId).catch((err) => {
      console.error("[NullSpend] Slack notification failed:", err);
    });

    return applyRateLimitHeaders(
      NextResponse.json(
        createActionResponseSchema.parse({
          id: action.id,
          status: action.status,
          expiresAt: action.expiresAt,
        }),
        { status: 201 },
      ),
      authResult.rateLimit,
    );
  });
});
