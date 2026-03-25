import { NextResponse } from "next/server";
import { and, count, eq, isNull, desc, lt, or } from "drizzle-orm";

import {
  generateRawKey,
  hashKey,
  extractPrefix,
} from "@/lib/auth/api-key";
import { CURRENT_VERSION } from "@/lib/api-version";
import { resolveSessionContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { apiKeys } from "@nullspend/db";
import { handleRouteError, readJsonBody } from "@/lib/utils/http";
import {
  createApiKeyInputSchema,
  createApiKeyResponseSchema,
  listApiKeysQuerySchema,
  listApiKeysResponseSchema,
} from "@/lib/validations/api-keys";
import { TIERS, getTierForUser } from "@/lib/stripe/tiers";
import { getSubscriptionByUserId } from "@/lib/stripe/subscription";

export async function GET(request: Request) {
  try {
    const { orgId } = await resolveSessionContext();
    const url = new URL(request.url);
    const query = listApiKeysQuerySchema.parse({
      limit: url.searchParams.get("limit") ?? undefined,
      cursor: url.searchParams.get("cursor") ?? undefined,
    });

    const db = getDb();
    const conditions = [eq(apiKeys.orgId, orgId), isNull(apiKeys.revokedAt)];

    if (query.cursor) {
      const cursorDate = new Date(query.cursor.createdAt);
      conditions.push(
        or(
          lt(apiKeys.createdAt, cursorDate),
          and(eq(apiKeys.createdAt, cursorDate), lt(apiKeys.id, query.cursor.id)),
        )!,
      );
    }

    const rows = await db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        keyPrefix: apiKeys.keyPrefix,
        defaultTags: apiKeys.defaultTags,
        lastUsedAt: apiKeys.lastUsedAt,
        createdAt: apiKeys.createdAt,
      })
      .from(apiKeys)
      .where(and(...conditions))
      .orderBy(desc(apiKeys.createdAt), desc(apiKeys.id))
      .limit(query.limit + 1);

    const hasMore = rows.length > query.limit;
    const pageRows = hasMore ? rows.slice(0, query.limit) : rows;
    const lastRow = pageRows[pageRows.length - 1];

    const data = pageRows.map((row) => ({
      ...row,
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    }));

    const response = NextResponse.json(
      listApiKeysResponseSchema.parse({
        data,
        cursor: hasMore && lastRow
          ? { createdAt: lastRow.createdAt.toISOString(), id: lastRow.id }
          : null,
      }),
    );
    response.headers.set("NullSpend-Version", CURRENT_VERSION);
    return response;
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { userId, orgId } = await resolveSessionContext();
    const body = await readJsonBody(request);
    const input = createApiKeyInputSchema.parse(body);

    const db = getDb();

    const [{ value: activeKeyCount }] = await db
      .select({ value: count() })
      .from(apiKeys)
      .where(and(eq(apiKeys.orgId, orgId), isNull(apiKeys.revokedAt)));

    const subscription = await getSubscriptionByUserId(userId);
    const tier = getTierForUser(subscription);
    const maxKeys = TIERS[tier].maxApiKeys;

    if (activeKeyCount >= maxKeys) {
      return NextResponse.json(
        { error: { code: "limit_exceeded", message: `Maximum of ${maxKeys} active API keys allowed on the ${TIERS[tier].label} plan.`, details: null } },
        { status: 409 },
      );
    }

    const rawKey = generateRawKey();

    const [created] = await db
      .insert(apiKeys)
      .values({
        userId,
        orgId,
        name: input.name,
        keyHash: hashKey(rawKey),
        keyPrefix: extractPrefix(rawKey),
        apiVersion: CURRENT_VERSION,
        defaultTags: input.defaultTags,
      })
      .returning({
        id: apiKeys.id,
        name: apiKeys.name,
        keyPrefix: apiKeys.keyPrefix,
        defaultTags: apiKeys.defaultTags,
        createdAt: apiKeys.createdAt,
      });

    console.info(
      `[NullSpend] API key created: userId=${userId}, keyId=${created.id}, name="${created.name}"`,
    );

    return NextResponse.json(
      createApiKeyResponseSchema.parse({
        ...created,
        rawKey,
        createdAt: created.createdAt.toISOString(),
      }),
      { status: 201 },
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
