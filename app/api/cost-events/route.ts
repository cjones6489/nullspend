import { NextResponse } from "next/server";

import { CURRENT_VERSION } from "@/lib/api-version";
import { assertApiKeyOrSession } from "@/lib/auth/dual-auth";
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
import { updateBudgetSpendFromCostEvent } from "@/lib/budgets/update-spend";
import { detectThresholdCrossings } from "@/lib/budgets/threshold-detection";
import { invalidateProxyCache } from "@/lib/proxy-invalidate";
import {
  dispatchCostEventToEndpoints,
  dispatchToEndpoints,
  fetchWebhookEndpoints,
} from "@/lib/webhooks/dispatch";
import {
  buildBudgetThresholdMessage,
  dispatchBudgetThresholdSlackAlert,
} from "@/lib/slack/budget-threshold-message";

const log = getLogger("cost-events");

export const GET = withRequestContext(async (request: Request) => {
  // Dual auth: API key (for SDK listCostEvents) or session (for dashboard UI).
  const auth = await assertApiKeyOrSession(request, "viewer");
  if (auth instanceof Response) return auth;
  const { orgId } = auth;
  const url = new URL(request.url);

  // Parse tag.* query params for JSONB containment filtering
  const tags: Record<string, string> = {};
  for (const [key, value] of url.searchParams.entries()) {
    if (key.startsWith("tag.")) {
      tags[key.slice(4)] = value;
    }
  }

  const query = listCostEventsQuerySchema.parse({
    limit: url.searchParams.get("limit") ?? undefined,
    cursor: url.searchParams.get("cursor") ?? undefined,
    // Unique index is (requestId, provider) — include both for unambiguous results
    requestId: url.searchParams.get("requestId") || undefined,
    apiKeyId: url.searchParams.get("apiKeyId") || undefined,
    model: url.searchParams.get("model") ?? undefined,
    provider: url.searchParams.get("provider") ?? undefined,
    source: url.searchParams.get("source") ?? undefined,
    budgetStatus: url.searchParams.get("budgetStatus") ?? undefined,
    traceId: url.searchParams.get("traceId") || undefined,
    sessionId: url.searchParams.get("sessionId") || undefined,
    tags: Object.keys(tags).length > 0 ? tags : undefined,
  });
  const result = await listCostEvents({ ...query, orgId });
  const response = NextResponse.json(listCostEventsResponseSchema.parse(result));
  response.headers.set("NullSpend-Version", CURRENT_VERSION);
  return response;
});

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
    const input = costEventInputSchema.parse(body);

    const idempotencyHeader = request.headers.get("Idempotency-Key");

    const result = await insertCostEvent(input, {
      userId: authResult.userId,
      orgId: authResult.orgId,
      apiKeyId: authResult.keyId,
    }, idempotencyHeader);

    // Fire-and-forget: webhook dispatch + budget spend update + threshold detection
    if (!result.deduplicated) {
      const costEventData = {
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
        traceId: input.traceId,
        apiKeyId: authResult.keyId,
        tags: input.tags,
        source: "api",
      };
      const orgId = authResult.orgId;
      (async () => {
        // 1. Budget spend update — critical path, updates Postgres budgets table
        let updatedEntities: Awaited<ReturnType<typeof updateBudgetSpendFromCostEvent>>["updatedEntities"] = [];
        try {
          const result = await updateBudgetSpendFromCostEvent(
            orgId,
            authResult.keyId,
            input.costMicrodollars,
            input.tags,
            authResult.userId,
            input.customer ?? (input.tags?.["customer"] ?? null),
          );
          updatedEntities = result.updatedEntities;
        } catch (spendErr) {
          log.error({ err: spendErr }, "Budget spend update failed for SDK cost event — budget may under-count");
        }

        // 2. Sync proxy Durable Object with updated spend so enforcement stays accurate
        //    Runs independently — even if spend update failed, a sync attempt may help
        if (updatedEntities.length > 0) {
          for (const entity of updatedEntities) {
            invalidateProxyCache({
              action: "sync",
              ownerId: orgId,
              entityType: entity.entityType,
              entityId: entity.entityId,
            }).catch((syncErr) => {
              log.error({ err: syncErr, entityType: entity.entityType, entityId: entity.entityId },
                "Proxy cache sync failed after SDK spend update");
            });
          }
        }

        // 3. Webhook dispatch — fetch endpoints once, used for both cost event and threshold
        let endpoints: Awaited<ReturnType<typeof fetchWebhookEndpoints>> = [];
        try {
          endpoints = await fetchWebhookEndpoints(orgId);
          await dispatchCostEventToEndpoints(endpoints, costEventData);
        } catch (webhookErr) {
          log.error({ err: webhookErr }, "Webhook dispatch failed for cost event — threshold detection will proceed");
        }

        // 4. Threshold detection — runs independently from webhook endpoint fetch
        if (updatedEntities.length > 0) {
          try {
            const thresholdEvents = detectThresholdCrossings(
              updatedEntities,
              costEventData.requestId,
            );
            // 4a. Webhook dispatch for threshold events
            if (endpoints.length > 0) {
              for (const te of thresholdEvents) {
                await dispatchToEndpoints(endpoints, te);
              }
            }
            // 4b. Slack notification for threshold events
            for (const te of thresholdEvents) {
              const obj = te.data.object as Record<string, unknown>;
              const msg = buildBudgetThresholdMessage({
                eventType: te.type,
                entityType: String(obj.budget_entity_type ?? ""),
                entityId: String(obj.budget_entity_id ?? ""),
                thresholdPercent: Number(obj.threshold_percent ?? 0),
                spendMicrodollars: Number(obj.budget_spend_microdollars ?? 0),
                limitMicrodollars: Number(obj.budget_limit_microdollars ?? 0),
              });
              dispatchBudgetThresholdSlackAlert(orgId, msg).catch((slackErr) => {
                log.error({ err: slackErr }, "Budget threshold Slack alert failed");
              });
            }
          } catch (thresholdErr) {
            log.error({ err: thresholdErr }, "Threshold detection/dispatch failed");
          }
        }
      })().catch((err) => {
        log.error({ err }, "Post-insert processing failed for cost event");
      });
    }

    const status = result.deduplicated ? 200 : 201;
    return applyRateLimitHeaders(
      NextResponse.json(
        { data: { id: toExternalId("evt", result.id), createdAt: result.createdAt } },
        { status },
      ),
      authResult.rateLimit,
    );
  });
});
