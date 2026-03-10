import { NextResponse } from "next/server";
import { and, eq, isNull, desc } from "drizzle-orm";

import {
  generateRawKey,
  hashKey,
  extractPrefix,
} from "@/lib/auth/api-key";
import { resolveSessionUserId } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { apiKeys } from "@agentseam/db";
import { handleRouteError, readJsonBody } from "@/lib/utils/http";
import {
  createApiKeyInputSchema,
  createApiKeyResponseSchema,
  listApiKeysResponseSchema,
} from "@/lib/validations/api-keys";

export async function GET() {
  try {
    const userId = await resolveSessionUserId();
    const db = getDb();

    const rows = await db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        keyPrefix: apiKeys.keyPrefix,
        lastUsedAt: apiKeys.lastUsedAt,
        createdAt: apiKeys.createdAt,
      })
      .from(apiKeys)
      .where(and(eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)))
      .orderBy(desc(apiKeys.createdAt));

    const data = rows.map((row) => ({
      ...row,
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    }));

    return NextResponse.json(listApiKeysResponseSchema.parse({ data }));
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    const userId = await resolveSessionUserId();
    const body = await readJsonBody(request);
    const input = createApiKeyInputSchema.parse(body);

    const rawKey = generateRawKey();
    const db = getDb();

    const [created] = await db
      .insert(apiKeys)
      .values({
        userId,
        name: input.name,
        keyHash: hashKey(rawKey),
        keyPrefix: extractPrefix(rawKey),
      })
      .returning({
        id: apiKeys.id,
        name: apiKeys.name,
        keyPrefix: apiKeys.keyPrefix,
        createdAt: apiKeys.createdAt,
      });

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

