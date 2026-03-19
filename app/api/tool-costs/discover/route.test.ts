import { afterEach, describe, expect, it, vi } from "vitest";

import { authenticateApiKey } from "@/lib/auth/with-api-key-auth";
import { getDb } from "@/lib/db/client";
import { POST } from "./route";

vi.mock("@/lib/auth/with-api-key-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/with-api-key-auth")>();
  return {
    ...actual,
    authenticateApiKey: vi.fn(),
  };
});

const mockTransaction = vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
  const mockTx = {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  };
  await fn(mockTx);
});
vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(() => ({
    transaction: mockTransaction,
  })),
}));

vi.mock("@nullspend/db", () => ({
  toolCosts: {
    userId: "user_id",
    serverName: "server_name",
    toolName: "tool_name",
    source: "source",
  },
}));

vi.mock("@/lib/validations/tool-costs", () => ({
  discoverToolCostsInputSchema: {
    parse: vi.fn((v: unknown) => v),
  },
}));

const mockedAuthenticateApiKey = vi.mocked(authenticateApiKey);

describe("POST /api/tool-costs/discover", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("discovers tools for the authenticated user", async () => {
    mockedAuthenticateApiKey.mockResolvedValue({ userId: "user-123", keyId: "key-456" });

    const response = await POST(
      new Request("http://localhost/api/tool-costs/discover", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-nullspend-key": "ns_live_sk_test0001",
        },
        body: JSON.stringify({
          serverName: "test-server",
          tools: [{ name: "test-tool", tierCost: 100 }],
        }),
      }),
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.registered).toBe(1);
    expect(mockedAuthenticateApiKey).toHaveBeenCalled();
  });

  it("returns 429 when per-key rate limit is exceeded", async () => {
    const rateLimitResponse = new Response(
      JSON.stringify({ error: { code: "rate_limit_exceeded", message: "Too many requests", details: null } }),
      { status: 429, headers: { "Content-Type": "application/json" } },
    );
    mockedAuthenticateApiKey.mockResolvedValue(rateLimitResponse);

    const response = await POST(
      new Request("http://localhost/api/tool-costs/discover", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-nullspend-key": "ns_live_sk_test0001",
        },
        body: JSON.stringify({
          serverName: "test-server",
          tools: [{ name: "test-tool", tierCost: 100 }],
        }),
      }),
    );

    expect(response.status).toBe(429);
    expect(getDb).not.toHaveBeenCalled();
  });
});
