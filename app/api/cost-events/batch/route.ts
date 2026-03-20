import { NextResponse } from "next/server";

import { authenticateApiKey, applyRateLimitHeaders } from "@/lib/auth/with-api-key-auth";
import {
  costEventBatchInputSchema,
  insertCostEventsBatch,
} from "@/lib/cost-events/ingest";
import { toExternalId } from "@/lib/ids/prefixed-id";
import { getLogger, withRequestContext } from "@/lib/observability";
import { withIdempotency } from "@/lib/resilience/idempotency";
import { readJsonBody } from "@/lib/utils/http";
import {
  buildCostEventWebhookPayload,
  dispatchToEndpoints,
  fetchWebhookEndpoints,
} from "@/lib/webhooks/dispatch";

const log = getLogger("cost-events-batch");

export const POST = withRequestContext(async (request: Request) => {
  return withIdempotency(request, async () => {
    const authResult = await authenticateApiKey(request);
    if (authResult instanceof Response) return authResult;

    const body = await readJsonBody(request);
    const { events } = costEventBatchInputSchema.parse(body);

    const result = await insertCostEventsBatch(events, {
      userId: authResult.userId,
      apiKeyId: authResult.keyId,
    });

    // Fire-and-forget webhook dispatch for actually-inserted rows
    if (result.inserted > 0) {
      const dispatchAll = async () => {
        const endpoints = await fetchWebhookEndpoints(authResult.userId);
        if (endpoints.length === 0) return;

        for (const row of result.rows) {
          const whEvent = buildCostEventWebhookPayload({
            requestId: row.requestId,
            provider: row.provider,
            model: row.model,
            inputTokens: row.inputTokens,
            outputTokens: row.outputTokens,
            cachedInputTokens: row.cachedInputTokens,
            costMicrodollars: row.costMicrodollars,
            durationMs: row.durationMs,
            eventType: row.eventType,
            toolName: row.toolName,
            toolServer: row.toolServer,
            sessionId: row.sessionId,
            traceId: row.traceId,
            apiKeyId: authResult.keyId,
            tags: row.tags,
            source: row.source,
          });
          await dispatchToEndpoints(endpoints, whEvent);
        }
      };
      dispatchAll().catch((err) => {
        log.error({ err }, "Webhook dispatch failed for cost event batch");
      });
    }

    return applyRateLimitHeaders(
      NextResponse.json(
        { inserted: result.inserted, ids: result.ids.map((id) => toExternalId("evt", id)) },
        { status: 201 },
      ),
      authResult.rateLimit,
    );
  });
});
