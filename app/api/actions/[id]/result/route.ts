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

    // Fire-and-forget: send Slack completion thread for budget_increase actions
    if (input.status === "executed") {
      sendBudgetCompletionThreadIfApplicable(id, authResult.orgId).catch(() => {});
    }

    return applyRateLimitHeaders(
      NextResponse.json({ data: mutateActionResponseSchema.parse(action) }),
      authResult.rateLimit,
    );
  });
});

async function sendBudgetCompletionThreadIfApplicable(
  actionId: string,
  orgId: string,
): Promise<void> {
  const { getDb } = await import("@/lib/db/client");
  const { actions, budgets } = await import("@nullspend/db");
  const { and, eq } = await import("drizzle-orm");

  const db = getDb();
  const [action] = await db
    .select({
      actionType: actions.actionType,
      payloadJson: actions.payloadJson,
      slackThreadTs: actions.slackThreadTs,
    })
    .from(actions)
    .where(and(eq(actions.id, actionId), eq(actions.orgId, orgId)))
    .limit(1);

  if (!action || action.actionType !== "budget_increase" || !action.slackThreadTs) return;

  const payload = action.payloadJson as { entityType?: string; entityId?: string } | null;
  if (!payload?.entityType || !payload?.entityId) return;

  const [budget] = await db
    .select({
      maxBudgetMicrodollars: budgets.maxBudgetMicrodollars,
      spendMicrodollars: budgets.spendMicrodollars,
    })
    .from(budgets)
    .where(
      and(
        eq(budgets.orgId, orgId),
        eq(budgets.entityType, payload.entityType as "user" | "api_key" | "tag"),
        eq(budgets.entityId, payload.entityId),
      ),
    )
    .limit(1);

  if (!budget) return;

  const remaining = budget.maxBudgetMicrodollars - budget.spendMicrodollars;
  const { sendBudgetIncreaseCompletionThread } = await import("@/lib/slack/notify");
  await sendBudgetIncreaseCompletionThread(actionId, orgId, remaining);
}
