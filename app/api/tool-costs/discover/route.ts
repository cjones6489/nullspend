import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";

import { authenticateApiKey, applyRateLimitHeaders } from "@/lib/auth/with-api-key-auth";
import { getDb } from "@/lib/db/client";
import { toolCosts } from "@nullspend/db";
import { withRequestContext } from "@/lib/observability";
import { withIdempotency } from "@/lib/resilience/idempotency";
import { readJsonBody } from "@/lib/utils/http";
import { discoverToolCostsInputSchema } from "@/lib/validations/tool-costs";

export const POST = withRequestContext(async (request: Request) => {
  return withIdempotency(request, async () => {
    const authResult = await authenticateApiKey(request);
    if (authResult instanceof Response) return authResult;
    const userId = authResult.userId;

    const body = await readJsonBody(request);
    const input = discoverToolCostsInputSchema.parse(body);

    const db = getDb();

    const orgId = authResult.orgId;
    const values = input.tools.map((t) => ({
      userId,
      orgId,
      serverName: input.serverName,
      toolName: t.name,
      costMicrodollars: t.tierCost,
      suggestedCost: t.suggestedCost ?? 0,
      source: "discovered" as const,
      description: t.description ?? null,
      annotations: (t.annotations ?? null) as Record<string, unknown> | null,
      lastSeenAt: sql`NOW()`,
    }));

    await db.transaction(async (tx) => {
      // Phase 1: Always upsert metadata (annotations, description, lastSeenAt)
      // This runs for ALL rows, including source='manual'
      await tx
        .insert(toolCosts)
        .values(values)
        .onConflictDoUpdate({
          target: [toolCosts.userId, toolCosts.serverName, toolCosts.toolName],
          set: {
            orgId: sql`excluded.org_id`,
            annotations: sql`excluded.annotations`,
            description: sql`excluded.description`,
            suggestedCost: sql`excluded.suggested_cost`,
            lastSeenAt: sql`NOW()`,
          },
        });

      // Phase 2: Conditionally update cost (only for discovered rows, not manual)
      await tx
        .insert(toolCosts)
        .values(values)
        .onConflictDoUpdate({
          target: [toolCosts.userId, toolCosts.serverName, toolCosts.toolName],
          set: {
            orgId: sql`excluded.org_id`,
            costMicrodollars: sql`excluded.cost_microdollars`,
          },
          setWhere: sql`${toolCosts.source} != 'manual'`,
        });
    });

    return applyRateLimitHeaders(
      NextResponse.json(
        { registered: input.tools.length },
        { status: 201 },
      ),
      authResult.rateLimit,
    );
  });
});
