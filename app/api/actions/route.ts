import { NextResponse } from "next/server";

import { createAction } from "@/lib/actions/create-action";
import { getAction } from "@/lib/actions/get-action";
import { listActions } from "@/lib/actions/list-actions";
import {
  assertApiKeyWithIdentity,
  resolveDevFallbackApiKeyUserId,
} from "@/lib/auth/api-key";
import { resolveSessionUserId } from "@/lib/auth/session";
import { sendSlackNotification } from "@/lib/slack/notify";
import {
  createActionInputSchema,
  createActionResponseSchema,
  listActionsQuerySchema,
  listActionsResponseSchema,
} from "@/lib/validations/actions";
import { handleRouteError, readJsonBody } from "@/lib/utils/http";

export async function GET(request: Request) {
  try {
    const ownerUserId = await resolveSessionUserId();
    const url = new URL(request.url);
    const query = listActionsQuerySchema.parse({
      status: url.searchParams.get("status") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
      cursor: url.searchParams.get("cursor") ?? undefined,
    });
    const result = await listActions({ ...query, ownerUserId });

    return NextResponse.json(listActionsResponseSchema.parse(result));
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    const identity = await assertApiKeyWithIdentity(request);
    const ownerUserId = identity?.userId ?? resolveDevFallbackApiKeyUserId();
    const body = await readJsonBody(request);
    const input = createActionInputSchema.parse(body);
    const created = await createAction(input, ownerUserId);

    try {
      const fullAction = await getAction(created.id, ownerUserId);
      sendSlackNotification(fullAction, ownerUserId).catch((err) => {
        console.error("[AgentSeam] Slack notification failed:", err);
      });
    } catch (notifyErr) {
      console.error("[AgentSeam] Slack notification lookup failed:", notifyErr);
    }

    return NextResponse.json(createActionResponseSchema.parse(created), {
      status: 201,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
