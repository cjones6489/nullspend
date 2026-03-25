import { NextResponse } from "next/server";

import { resolveSessionContext } from "@/lib/auth/session";
import { assertOrgRole } from "@/lib/auth/org-authorization";
import {
  sendSlackTestNotification,
  SlackConfigNotFoundError,
  SlackWebhookError,
} from "@/lib/slack/notify";
import { handleRouteError } from "@/lib/utils/http";

export async function POST() {
  try {
    const { userId, orgId } = await resolveSessionContext();
    await assertOrgRole(userId, orgId, "admin");

    try {
      await sendSlackTestNotification(orgId);
    } catch (slackErr) {
      console.error("[NullSpend] Slack test notification failed:", slackErr);

      if (slackErr instanceof SlackConfigNotFoundError) {
        return NextResponse.json(
          { error: { code: "not_found", message: slackErr.message, details: null } },
          { status: 404 },
        );
      }

      if (slackErr instanceof SlackWebhookError) {
        return NextResponse.json(
          { error: { code: "slack_webhook_error", message: "Failed to send test notification.", details: null } },
          { status: slackErr.statusCode >= 500 ? 502 : 400 },
        );
      }

      return NextResponse.json(
        { error: { code: "slack_webhook_error", message: "Failed to send test notification.", details: null } },
        { status: 502 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
