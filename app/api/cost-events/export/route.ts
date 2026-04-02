import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { assertOrgRole } from "@/lib/auth/org-authorization";
import { resolveSessionContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { escapeCSV } from "@/lib/utils/csv";
import { handleRouteError } from "@/lib/utils/http";
import { apiKeys, costEvents } from "@nullspend/db";

const MAX_EXPORT_ROWS = 10_000;

const CSV_HEADERS = [
  "id",
  "request_id",
  "provider",
  "model",
  "input_tokens",
  "output_tokens",
  "cached_input_tokens",
  "reasoning_tokens",
  "cost_microdollars",
  "cost_usd",
  "duration_ms",
  "source",
  "session_id",
  "trace_id",
  "key_name",
  "created_at",
  "cost_breakdown_input",
  "cost_breakdown_output",
  "cost_breakdown_cached",
  "cost_breakdown_reasoning",
  "cost_breakdown_tool_definition",
] as const;

function rowToCSV(row: {
  id: string;
  requestId: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
  costMicrodollars: number;
  durationMs: number | null;
  source: string;
  sessionId: string | null;
  traceId: string | null;
  keyName: string | null;
  createdAt: Date;
  costBreakdown: { input?: number; output?: number; cached?: number; reasoning?: number; toolDefinition?: number } | null;
}): string {
  const cb = row.costBreakdown;
  return [
    escapeCSV(row.id),
    escapeCSV(row.requestId),
    escapeCSV(row.provider),
    escapeCSV(row.model),
    String(row.inputTokens),
    String(row.outputTokens),
    String(row.cachedInputTokens),
    String(row.reasoningTokens),
    String(row.costMicrodollars),
    (row.costMicrodollars / 1_000_000).toFixed(6),
    row.durationMs != null ? String(row.durationMs) : "",
    escapeCSV(row.source),
    escapeCSV(row.sessionId ?? ""),
    escapeCSV(row.traceId ?? ""),
    escapeCSV(row.keyName ?? ""),
    row.createdAt.toISOString(),
    cb?.input != null ? String(cb.input) : "",
    cb?.output != null ? String(cb.output) : "",
    cb?.cached != null ? String(cb.cached) : "",
    cb?.reasoning != null ? String(cb.reasoning) : "",
    cb?.toolDefinition != null ? String(cb.toolDefinition) : "",
  ].join(",");
}

export async function GET(request: Request) {
  try {
    const { userId, orgId } = await resolveSessionContext();
    await assertOrgRole(userId, orgId, "viewer");
    const url = new URL(request.url);

    const db = getDb();
    const conditions = [eq(costEvents.orgId, orgId)];

    const provider = url.searchParams.get("provider");
    if (provider) conditions.push(eq(costEvents.provider, provider));

    const model = url.searchParams.get("model");
    if (model) conditions.push(eq(costEvents.model, model));

    const apiKeyId = url.searchParams.get("apiKeyId");
    if (apiKeyId) conditions.push(eq(costEvents.apiKeyId, apiKeyId));

    const sourceParam = z.enum(["proxy", "api", "mcp"]).optional().safeParse(
      url.searchParams.get("source") ?? undefined,
    );
    if (sourceParam.success && sourceParam.data) {
      conditions.push(eq(costEvents.source, sourceParam.data));
    }

    const sessionId = url.searchParams.get("sessionId");
    if (sessionId) conditions.push(eq(costEvents.sessionId, sessionId));

    const traceId = url.searchParams.get("traceId");
    if (traceId) conditions.push(eq(costEvents.traceId, traceId));

    // Tag filters
    for (const [key, value] of url.searchParams.entries()) {
      if (key.startsWith("tag.")) {
        const tagObj = { [key.slice(4)]: value };
        conditions.push(sql`${costEvents.tags} @> ${JSON.stringify(tagObj)}::jsonb`);
      }
    }

    const rows = await db
      .select({
        id: costEvents.id,
        requestId: costEvents.requestId,
        provider: costEvents.provider,
        model: costEvents.model,
        inputTokens: costEvents.inputTokens,
        outputTokens: costEvents.outputTokens,
        cachedInputTokens: costEvents.cachedInputTokens,
        reasoningTokens: costEvents.reasoningTokens,
        costMicrodollars: costEvents.costMicrodollars,
        durationMs: costEvents.durationMs,
        source: costEvents.source,
        sessionId: costEvents.sessionId,
        traceId: costEvents.traceId,
        keyName: apiKeys.name,
        createdAt: costEvents.createdAt,
        costBreakdown: costEvents.costBreakdown,
      })
      .from(costEvents)
      .leftJoin(apiKeys, eq(costEvents.apiKeyId, apiKeys.id))
      .where(and(...conditions))
      .orderBy(desc(costEvents.createdAt))
      .limit(MAX_EXPORT_ROWS);

    const csvLines = [CSV_HEADERS.join(",")];
    for (const row of rows) {
      csvLines.push(rowToCSV(row));
    }

    const date = new Date().toISOString().slice(0, 10);
    return new Response(csvLines.join("\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="nullspend-cost-events-${date}.csv"`,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
