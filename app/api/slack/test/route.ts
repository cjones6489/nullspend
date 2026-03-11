import { NextResponse } from "next/server";

import { resolveSessionUserId } from "@/lib/auth/session";
import {
  sendSlackTestNotification,
  SlackConfigNotFoundError,
  SlackWebhookError,
} from "@/lib/slack/notify";
import { handleRouteError } from "@/lib/utils/http";

export async function POST() {
  try {
    const userId = await resolveSessionUserId();

    try {
      await sendSlackTestNotification(userId);
    } catch (slackErr) {
      console.error("[AgentSeam] Slack test notification failed:", slackErr);

      if (slackErr instanceof SlackConfigNotFoundError) {
        return NextResponse.json(
          { error: slackErr.message },
          { status: 404 },
        );
      }

      if (slackErr instanceof SlackWebhookError) {
        return NextResponse.json(
          { error: "Failed to send test notification." },
          { status: slackErr.statusCode >= 500 ? 502 : 400 },
        );
      }

      return NextResponse.json(
        { error: "Failed to send test notification." },
        { status: 502 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
