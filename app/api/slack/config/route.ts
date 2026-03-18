import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { resolveSessionUserId } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { slackConfigs } from "@nullspend/db";
import { handleRouteError, readJsonBody } from "@/lib/utils/http";
import {
  slackConfigInputSchema,
  slackConfigRecordSchema,
} from "@/lib/validations/slack";

function maskWebhookUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length >= 4) {
      parts[1] = "****";
      parts[2] = "****";
      parts[3] = parts[3].slice(0, 4) + "****";
    }
    return `${parsed.origin}/${parts.join("/")}`;
  } catch {
    return "https://hooks.slack.com/services/****";
  }
}

export async function GET() {
  try {
    const userId = await resolveSessionUserId();
    const db = getDb();

    const [config] = await db
      .select()
      .from(slackConfigs)
      .where(eq(slackConfigs.userId, userId))
      .limit(1);

    if (!config) {
      return NextResponse.json({ data: null });
    }

    return NextResponse.json({
      data: slackConfigRecordSchema.parse({
        id: config.id,
        webhookUrl: maskWebhookUrl(config.webhookUrl),
        channelName: config.channelName,
        slackUserId: config.slackUserId,
        isActive: config.isActive,
        createdAt: config.createdAt.toISOString(),
        updatedAt: config.updatedAt.toISOString(),
      }),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    const userId = await resolveSessionUserId();
    const body = await readJsonBody(request);
    const input = slackConfigInputSchema.parse(body);

    const db = getDb();

    const [upserted] = await db
      .insert(slackConfigs)
      .values({
        userId,
        webhookUrl: input.webhookUrl,
        channelName: input.channelName ?? null,
        slackUserId: input.slackUserId ?? null,
      })
      .onConflictDoUpdate({
        target: slackConfigs.userId,
        set: {
          webhookUrl: input.webhookUrl,
          channelName: input.channelName ?? null,
          slackUserId: input.slackUserId ?? null,
          isActive: input.isActive ?? true,
          updatedAt: new Date(),
        },
      })
      .returning();

    return NextResponse.json({
      data: slackConfigRecordSchema.parse({
        id: upserted.id,
        webhookUrl: maskWebhookUrl(upserted.webhookUrl),
        channelName: upserted.channelName,
        slackUserId: upserted.slackUserId,
        isActive: upserted.isActive,
        createdAt: upserted.createdAt.toISOString(),
        updatedAt: upserted.updatedAt.toISOString(),
      }),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE() {
  try {
    const userId = await resolveSessionUserId();
    const db = getDb();

    const [deleted] = await db
      .delete(slackConfigs)
      .where(eq(slackConfigs.userId, userId))
      .returning({ id: slackConfigs.id });

    if (!deleted) {
      return NextResponse.json(
        { error: { code: "not_found", message: "No Slack configuration found.", details: null } },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
