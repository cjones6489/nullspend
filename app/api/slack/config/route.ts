import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { resolveSessionUserId } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { slackConfigs } from "@/lib/db/schema";
import { handleRouteError, readJsonBody } from "@/lib/utils/http";
import {
  slackConfigInputSchema,
  slackConfigRecordSchema,
} from "@/lib/validations/slack";

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
        webhookUrl: config.webhookUrl,
        channelName: config.channelName,
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
      })
      .onConflictDoUpdate({
        target: slackConfigs.userId,
        set: {
          webhookUrl: input.webhookUrl,
          channelName: input.channelName ?? null,
          isActive: input.isActive ?? true,
          updatedAt: new Date(),
        },
      })
      .returning();

    return NextResponse.json({
      data: slackConfigRecordSchema.parse({
        id: upserted.id,
        webhookUrl: upserted.webhookUrl,
        channelName: upserted.channelName,
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
        { error: "No Slack configuration found." },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
