import type postgres from "postgres";

export const BASE = process.env.PROXY_URL ?? `http://127.0.0.1:${process.env.PROXY_PORT ?? "8787"}`;
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
export const PLATFORM_AUTH_KEY = process.env.PLATFORM_AUTH_KEY ?? "test-platform-key";
export const DATABASE_URL = process.env.DATABASE_URL;

/**
 * Build auth headers for proxy requests. Supports two patterns:
 *   authHeaders()                          — basic auth
 *   authHeaders({ "X-Custom": "val" })     — basic auth + extra headers
 *   authHeaders("user-id")                 — auth with userId
 *   authHeaders("user-id", "key-id")       — auth with userId + keyId
 */
export function authHeaders(
  userIdOrExtra?: string | Record<string, string>,
  keyId?: string,
): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${OPENAI_API_KEY}`,
    "X-NullSpend-Auth": PLATFORM_AUTH_KEY,
  };

  if (typeof userIdOrExtra === "string") {
    h["X-NullSpend-User-Id"] = userIdOrExtra;
    if (keyId) h["X-NullSpend-Key-Id"] = keyId;
  } else if (userIdOrExtra) {
    Object.assign(h, userIdOrExtra);
  }

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

export function anthropicAuthHeaders(
  extra?: Record<string, string>,
): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key": ANTHROPIC_API_KEY!,
    "X-NullSpend-Auth": PLATFORM_AUTH_KEY,
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
