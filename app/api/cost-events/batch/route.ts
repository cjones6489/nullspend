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
import { updateBudgetSpendFromCostEvent } from "@/lib/budgets/update-spend";
import { detectThresholdCrossings } from "@/lib/budgets/threshold-detection";
import { invalidateProxyCache } from "@/lib/proxy-invalidate";
import {
  dispatchCostEventToEndpoints,
  dispatchToEndpoints,
  fetchWebhookEndpoints,
} from "@/lib/webhooks/dispatch";

const log = getLogger("cost-events-batch");

export const POST = withRequestContext(async (request: Request) => {
  return withIdempotency(request, async () => {
    const authResult = await authenticateApiKey(request);
    if (authResult instanceof Response) return authResult;
    if (!authResult.orgId) {
      return NextResponse.json(
        { error: { code: "configuration_error", message: "API key is not associated with an organization.", details: null } },
        { status: 403 },
      );
    }

    const body = await readJsonBody(request);
    const { events } = costEventBatchInputSchema.parse(body);

    const result = await insertCostEventsBatch(events, {
      userId: authResult.userId,
      orgId: authResult.orgId,
      apiKeyId: authResult.keyId,
    });

    // Fire-and-forget: webhook dispatch + budget spend update + threshold detection
    //
    // Budget spend update runs PER-EVENT (not aggregated) to ensure tag-specific
    // budgets are only charged the cost of events that actually carry that tag.
    // api_key and user budgets naturally get charged for every event since the
    // same key/user made all requests.
    if (result.inserted > 0) {
      const orgId = authResult.orgId;
      const afterInsert = async () => {
        const endpoints = await fetchWebhookEndpoints(orgId);

        for (const row of result.rows) {
          // 1. Webhook dispatch per event — try/catch so one failure doesn't block budget updates
          if (endpoints.length > 0) {
            try {
              await dispatchCostEventToEndpoints(endpoints, {
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
            } catch (dispatchErr) {
              log.error(
                { err: dispatchErr, requestId: row.requestId },
                "Webhook dispatch failed for cost event in batch",
              );
            }
          }

          // 2. Budget spend update per event — ensures correct per-tag accounting
          if (row.costMicrodollars > 0) {
            try {
              const tags = row.tags && Object.keys(row.tags).length > 0 ? row.tags : undefined;
              const { updatedEntities } = await updateBudgetSpendFromCostEvent(
                orgId,
                authResult.keyId,
                row.costMicrodollars,
                tags,
                authResult.userId,
              );

              if (updatedEntities.length > 0) {
                log.info(
                  { requestId: row.requestId, costMicrodollars: row.costMicrodollars, entitiesUpdated: updatedEntities.length },
                  "batch_budget_spend_updated",
                );

                // 3. Sync proxy DO with updated spend — matches single-event route pattern
                for (const entity of updatedEntities) {
                  invalidateProxyCache({
                    action: "sync",
                    ownerId: orgId,
                    entityType: entity.entityType,
                    entityId: entity.entityId,
                  }).catch((syncErr) => {
                    log.error(
                      { err: syncErr, entityType: entity.entityType, entityId: entity.entityId },
                      "Proxy cache sync failed after batch spend update",
                    );
                  });
                }

                // 4. Threshold detection per event — catches crossings at each increment
                if (endpoints.length > 0) {
                  const thresholdEvents = detectThresholdCrossings(
                    updatedEntities,
                    row.requestId,
                  );
                  for (const te of thresholdEvents) {
                    await dispatchToEndpoints(endpoints, te);
                  }
                }
              }
            } catch (budgetErr) {
              log.error(
                { err: budgetErr, requestId: row.requestId, costMicrodollars: row.costMicrodollars },
                "Budget spend update failed for cost event in batch",
              );
            }
          }
        }
      };
      afterInsert().catch((err) => {
        log.error({ err }, "Post-insert processing failed for cost event batch");
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
