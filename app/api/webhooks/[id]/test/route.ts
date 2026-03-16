import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { resolveSessionUserId } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { webhookEndpoints } from "@nullspend/db";
import { handleRouteError, readRouteParams } from "@/lib/utils/http";
import { webhookIdParamsSchema } from "@/lib/validations/webhooks";
import { signPayload } from "@/lib/webhooks/signer";

const TEST_TIMEOUT_MS = 5_000;

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const userId = await resolveSessionUserId();
    const params = await readRouteParams(context.params);
    const { id } = webhookIdParamsSchema.parse(params);

    const db = getDb();

    const [endpoint] = await db
      .select({
        id: webhookEndpoints.id,
        url: webhookEndpoints.url,
        signingSecret: webhookEndpoints.signingSecret,
      })
      .from(webhookEndpoints)
      .where(
        and(
          eq(webhookEndpoints.id, id),
          eq(webhookEndpoints.userId, userId),
        ),
      );

    if (!endpoint) {
      return NextResponse.json(
        { error: "Webhook endpoint not found." },
        { status: 404 },
      );
    }

    const testEvent = {
      id: `evt_test_${crypto.randomUUID()}`,
      type: "cost_event.created",
      created_at: new Date().toISOString(),
      data: {
        request_id: "req_test_000",
        event_type: "llm",
        provider: "openai",
        model: "gpt-4o-mini",
        input_tokens: 100,
        output_tokens: 50,
        cached_input_tokens: 0,
        cost_microdollars: 1500,
        duration_ms: 500,
        api_key_id: null,
        session_id: null,
        _test: true,
      },
    };

    const payload = JSON.stringify(testEvent);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = signPayload(payload, endpoint.signingSecret, timestamp);

    let statusCode: number | null = null;
    let responsePreview: string | null = null;
    let success = false;

    try {
      const response = await fetch(endpoint.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-NullSpend-Signature": signature,
          "X-NullSpend-Webhook-Id": testEvent.id,
          "X-NullSpend-Webhook-Timestamp": String(timestamp),
          "User-Agent": "NullSpend-Webhooks/1.0",
        },
        body: payload,
        signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
      });

      statusCode = response.status;
      try {
        const text = await response.text();
        responsePreview = text.slice(0, 200);
      } catch {
        responsePreview = null;
      }
      success = response.ok;
    } catch (err) {
      responsePreview = err instanceof Error ? err.message : "Request failed";
    }

    return NextResponse.json({
      success,
      statusCode,
      responsePreview,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
