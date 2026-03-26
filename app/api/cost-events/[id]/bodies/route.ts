import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { assertOrgRole } from "@/lib/auth/org-authorization";
import { resolveSessionContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { fromExternalIdOfType } from "@/lib/ids/prefixed-id";
import { handleRouteError, readRouteParams } from "@/lib/utils/http";
import { costEvents } from "@nullspend/db";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/cost-events/{id}/bodies
 *
 * Fetches stored request/response bodies for a cost event.
 * Bodies are stored in R2 on the proxy side, keyed by requestId.
 * This endpoint verifies ownership via orgId, then bridges to the
 * proxy's internal endpoint to retrieve the bodies.
 *
 * Returns { data: { requestBody, responseBody } } or 404 if not found.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { userId, orgId } = await resolveSessionContext();
    await assertOrgRole(userId, orgId, "viewer");
    const params = await readRouteParams(context.params);

    // Accept raw UUID or ns_evt_ prefixed ID
    let id: string;
    if (params.id.startsWith("ns_evt_")) {
      id = fromExternalIdOfType("evt", params.id);
    } else if (UUID_RE.test(params.id)) {
      id = params.id;
    } else {
      return NextResponse.json(
        { error: { code: "validation_error", message: "Invalid cost event ID.", details: null } },
        { status: 400 },
      );
    }

    // Look up the cost event to get its requestId and verify ownership
    const db = getDb();
    const [row] = await db
      .select({ requestId: costEvents.requestId })
      .from(costEvents)
      .where(
        and(
          eq(costEvents.id, id),
          eq(costEvents.orgId, orgId),
        ),
      )
      .limit(1);

    if (!row || !row.requestId) {
      return NextResponse.json(
        { error: { code: "not_found", message: "Cost event not found.", details: null } },
        { status: 404 },
      );
    }

    const url = process.env.PROXY_INTERNAL_URL;
    const secret = process.env.PROXY_INTERNAL_SECRET;

    if (!url || !secret) {
      // Local dev or unconfigured — return empty bodies
      return NextResponse.json({ data: { requestBody: null, responseBody: null } });
    }

    let res: Response;
    try {
      res = await fetch(
        `${url}/internal/request-bodies/${encodeURIComponent(row.requestId)}?ownerId=${encodeURIComponent(orgId)}`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${secret}` },
          signal: AbortSignal.timeout(5_000),
        },
      );
    } catch (fetchErr) {
      // Timeout, network error — gracefully return empty bodies
      console.error("[cost-events/bodies] Proxy fetch failed:", fetchErr);
      return NextResponse.json({ data: { requestBody: null, responseBody: null } });
    }

    if (!res.ok) {
      console.error("[cost-events/bodies] Proxy returned non-2xx:", res.status);
      return NextResponse.json({ data: { requestBody: null, responseBody: null } });
    }

    let data: Record<string, unknown>;
    try {
      data = await res.json();
    } catch {
      // Malformed JSON from proxy — gracefully return empty bodies
      console.error("[cost-events/bodies] Proxy returned invalid JSON");
      return NextResponse.json({ data: { requestBody: null, responseBody: null } });
    }

    return NextResponse.json({
      data: {
        requestBody: data.requestBody ?? null,
        responseBody: data.responseBody ?? null,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
