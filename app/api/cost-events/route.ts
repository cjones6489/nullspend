import { NextResponse } from "next/server";

import { resolveSessionUserId } from "@/lib/auth/session";
import { authenticateApiKey, applyRateLimitHeaders } from "@/lib/auth/with-api-key-auth";
import { costEventInputSchema, insertCostEvent } from "@/lib/cost-events/ingest";
import { toExternalId } from "@/lib/ids/prefixed-id";
import { listCostEvents } from "@/lib/cost-events/list-cost-events";
import { getLogger, withRequestContext } from "@/lib/observability";
import { withIdempotency } from "@/lib/resilience/idempotency";
import { readJsonBody } from "@/lib/utils/http";
import {
  listCostEventsQuerySchema,
  listCostEventsResponseSchema,
} from "@/lib/validations/cost-events";
import {
  buildCostEventWebhookPayload,
  dispatchWebhookEvent,
} from "@/lib/webhooks/dispatch";

const log = getLogger("cost-events");

export const GET = withRequestContext(async (request: Request) => {
  const userId = await resolveSessionUserId();
  const url = new URL(request.url);
  const query = listCostEventsQuerySchema.parse({
    limit: url.searchParams.get("limit") ?? undefined,
    cursor: url.searchParams.get("cursor") ?? undefined,
    apiKeyId: url.searchParams.get("apiKeyId") || undefined,
    model: url.searchParams.get("model") ?? undefined,
    provider: url.searchParams.get("provider") ?? undefined,
  });
  const result = await listCostEvents({ ...query, userId });
  return NextResponse.json(listCostEventsResponseSchema.parse(result));
});

export const POST = withRequestContext(async (request: Request) => {
  return withIdempotency(request, async () => {
    const authResult = await authenticateApiKey(request);
    if (authResult instanceof Response) return authResult;

    const body = await readJsonBody(request);
    const input = costEventInputSchema.parse(body);

    const idempotencyHeader = request.headers.get("Idempotency-Key");

    const result = await insertCostEvent(input, {
      userId: authResult.userId,
      apiKeyId: authResult.keyId,
    }, idempotencyHeader);

    // Fire-and-forget webhook dispatch
    if (!result.deduplicated) {
      const whEvent = buildCostEventWebhookPayload({
        requestId: idempotencyHeader ?? `sdk_${result.id}`,
        provider: input.provider,
        model: input.model,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        cachedInputTokens: input.cachedInputTokens ?? 0,
        costMicrodollars: input.costMicrodollars,
        durationMs: input.durationMs ?? null,
        eventType: input.eventType ?? "custom",
        toolName: input.toolName,
        toolServer: input.toolServer,
        sessionId: input.sessionId,
        apiKeyId: authResult.keyId,
      });
      dispatchWebhookEvent(authResult.userId, whEvent).catch((err) => {
        log.error({ err }, "Webhook dispatch failed for cost event");
      });
    }

    const status = result.deduplicated ? 200 : 201;
    return applyRateLimitHeaders(
      NextResponse.json(
        { id: toExternalId("evt", result.id), createdAt: result.createdAt },
        { status },
      ),
      authResult.rateLimit,
    );
  });
});
