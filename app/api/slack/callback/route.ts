import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { approveAction } from "@/lib/actions/approve-action";
import {
  ActionExpiredError,
  ActionNotFoundError,
  InvalidActionTransitionError,
  StaleActionError,
} from "@/lib/actions/errors";
import { rejectAction } from "@/lib/actions/reject-action";
import { getDb } from "@/lib/db/client";
import { actions } from "@/lib/db/schema";
import { buildDecisionMessage } from "@/lib/slack/message";
import {
  SlackSignatureError,
  verifySlackSignature,
} from "@/lib/slack/verify";

function getDashboardUrl(): string {
  return process.env.AGENTSEAM_URL || process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
}

function errorMessage(text: string) {
  return NextResponse.json({
    replace_original: true,
    text,
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text },
      },
    ],
  });
}

export async function POST(request: Request) {
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return errorMessage("Failed to read request body.");
  }

  try {
    verifySlackSignature(rawBody, request.headers);
  } catch (err) {
    if (err instanceof SlackSignatureError) {
      return errorMessage("Could not verify this request.");
    }
    return errorMessage("Could not verify this request.");
  }

  let payload: {
    type: string;
    user: { id: string; username?: string; name?: string };
    actions: { action_id: string; value: string }[];
  };

  try {
    const params = new URLSearchParams(rawBody);
    payload = JSON.parse(params.get("payload") ?? "{}");
  } catch {
    return errorMessage("Could not parse the request payload.");
  }

  if (payload.type !== "block_actions" || !payload.actions?.length) {
    return errorMessage("Unsupported interaction type.");
  }

  const interaction = payload.actions[0];
  const actionId = interaction.value;
  const isApprove = interaction.action_id === "approve_action";
  const isReject = interaction.action_id === "reject_action";

  if (!isApprove && !isReject) {
    return NextResponse.json({ ok: true });
  }

  if (!payload.user?.id) {
    return errorMessage("Could not identify the acting user.");
  }

  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!actionId || !uuidPattern.test(actionId)) {
    return errorMessage("This action was not found.");
  }

  const decidedBy =
    payload.user.username ?? payload.user.name ?? payload.user.id;

  let action: { id: string; ownerUserId: string | null; actionType: string; agentId: string } | undefined;

  try {
    const db = getDb();
    [action] = await db
      .select({
        id: actions.id,
        ownerUserId: actions.ownerUserId,
        actionType: actions.actionType,
        agentId: actions.agentId,
      })
      .from(actions)
      .where(eq(actions.id, actionId))
      .limit(1);
  } catch (err) {
    console.error("[AgentSeam] Slack callback DB lookup error:", err);
    return errorMessage("Something went wrong processing this action.");
  }

  if (!action || !action.ownerUserId) {
    return errorMessage("This action was not found.");
  }

  const dashboardUrl = getDashboardUrl();

  try {
    if (isApprove) {
      await approveAction(actionId, { approvedBy: decidedBy }, action.ownerUserId);
    } else {
      await rejectAction(actionId, { rejectedBy: decidedBy }, action.ownerUserId);
    }

    const decision = isApprove ? "approved" : "rejected";
    const message = buildDecisionMessage(
      action.actionType,
      action.agentId,
      decision,
      decidedBy,
      dashboardUrl,
      action.id,
    );

    return NextResponse.json({
      replace_original: true,
      ...message,
    });
  } catch (err) {
    if (err instanceof ActionExpiredError) {
      const message = buildDecisionMessage(
        action.actionType,
        action.agentId,
        "expired",
        "system",
        dashboardUrl,
        action.id,
      );
      return NextResponse.json({ replace_original: true, ...message });
    }

    if (err instanceof ActionNotFoundError) {
      return errorMessage("This action was not found.");
    }

    if (
      err instanceof InvalidActionTransitionError ||
      err instanceof StaleActionError
    ) {
      return errorMessage("This action has already been decided.");
    }

    console.error("[AgentSeam] Slack callback error:", err);
    return errorMessage("Something went wrong processing this action.");
  }
}
