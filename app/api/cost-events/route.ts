import { NextResponse } from "next/server";

import { resolveSessionUserId } from "@/lib/auth/session";
import { listCostEvents } from "@/lib/cost-events/list-cost-events";
import { withRequestContext } from "@/lib/observability";
import {
  listCostEventsQuerySchema,
  listCostEventsResponseSchema,
} from "@/lib/validations/cost-events";

export const GET = withRequestContext(async (request: Request) => {
  const userId = await resolveSessionUserId();
  const url = new URL(request.url);
  const query = listCostEventsQuerySchema.parse({
    limit: url.searchParams.get("limit") ?? undefined,
    cursor: url.searchParams.get("cursor") ?? undefined,
    apiKeyId: url.searchParams.get("apiKeyId") ?? undefined,
    model: url.searchParams.get("model") ?? undefined,
    provider: url.searchParams.get("provider") ?? undefined,
  });
  const result = await listCostEvents({ ...query, userId });
  return NextResponse.json(listCostEventsResponseSchema.parse(result));
});
