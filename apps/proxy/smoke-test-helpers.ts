import type postgres from "postgres";

export const BASE = process.env.PROXY_URL ?? `http://127.0.0.1:${process.env.PROXY_PORT ?? "8787"}`;
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
export const NULLSPEND_API_KEY = process.env.NULLSPEND_API_KEY;
export const NULLSPEND_SMOKE_USER_ID = process.env.NULLSPEND_SMOKE_USER_ID;
export const NULLSPEND_SMOKE_KEY_ID = process.env.NULLSPEND_SMOKE_KEY_ID;
export const DATABASE_URL = process.env.DATABASE_URL;
export const INTERNAL_SECRET = process.env.INTERNAL_SECRET;

/**
 * Build auth headers for OpenAI proxy requests.
 * Uses x-nullspend-key (API key auth). Proxy derives userId/keyId from the key.
 */
export function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${OPENAI_API_KEY}`,
    "x-nullspend-key": NULLSPEND_API_KEY!,
  };
  if (extra) Object.assign(h, extra);
  return h;
}

export function smallRequest(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: "Say ok" }],
    max_tokens: 3,
    ...overrides,
  });
}

/**
 * Build auth headers for Anthropic proxy requests.
 * Uses x-nullspend-key (API key auth). Proxy derives userId/keyId from the key.
 */
export function anthropicAuthHeaders(extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key": ANTHROPIC_API_KEY!,
    "x-nullspend-key": NULLSPEND_API_KEY!,
  };
  if (extra) Object.assign(h, extra);
  return h;
}

export function smallAnthropicRequest(
  overrides: Record<string, unknown> = {},
) {
  return JSON.stringify({
    model: "claude-3-haiku-20240307",
    max_tokens: 10,
    messages: [{ role: "user", content: "Say ok" }],
    ...overrides,
  });
}

export async function isServerUp(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function waitForCostEvent(
  sql: postgres.Sql,
  requestId: string,
  timeoutMs = 15_000,
  provider = "openai",
): Promise<Record<string, unknown> | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const rows = await sql`
      SELECT * FROM cost_events
      WHERE request_id = ${requestId} AND provider = ${provider}
      LIMIT 1
    `;
    if (rows.length > 0) return rows[0] as Record<string, unknown>;
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

/**
 * Call the proxy's internal budget invalidation endpoint to properly clean up
 * all three layers of budget state: DO SQLite, DO lookup cache, and auth cache.
 *
 * Requires INTERNAL_SECRET in .env.smoke.
 */
export async function invalidateBudget(
  userId: string,
  entityType: string,
  entityId: string,
  action: "remove" | "reset_spend" = "remove",
): Promise<void> {
  if (!INTERNAL_SECRET) {
    throw new Error("INTERNAL_SECRET required in .env.smoke for budget invalidation");
  }
  const res = await fetch(`${BASE}/internal/budget/invalidate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${INTERNAL_SECRET}`,
    },
    body: JSON.stringify({ action, userId, entityType, entityId }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Budget invalidation failed (${res.status}): ${body}`);
  }
}

export async function countCostEventsSince(
  sql: postgres.Sql,
  since: Date,
): Promise<number> {
  const rows = await sql`
    SELECT COUNT(*)::int as count FROM cost_events
    WHERE created_at >= ${since.toISOString()}
  `;
  return rows[0].count as number;
}
