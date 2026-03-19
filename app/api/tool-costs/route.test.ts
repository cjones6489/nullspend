import { afterEach, describe, expect, it, vi } from "vitest";

import { assertApiKeyOrSession } from "@/lib/auth/dual-auth";
import { resolveSessionUserId } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { GET, POST } from "./route";

vi.mock("@/lib/auth/dual-auth", () => ({
  assertApiKeyOrSession: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  resolveSessionUserId: vi.fn(),
}));

const mockSelect = vi.fn().mockReturnValue({
  from: vi.fn().mockReturnValue({
    where: vi.fn().mockResolvedValue([]),
  }),
});
const mockUpdate = vi.fn().mockReturnValue({
  set: vi.fn().mockReturnValue({
    where: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([]),
    }),
  }),
});
vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(() => ({
    select: mockSelect,
    update: mockUpdate,
  })),
}));

vi.mock("@nullspend/db", () => ({
  toolCosts: {
    userId: "user_id",
    serverName: "server_name",
    toolName: "tool_name",
  },
}));

vi.mock("@/lib/validations/tool-costs", () => ({
  listToolCostsResponseSchema: { parse: vi.fn((v: unknown) => v) },
  upsertToolCostInputSchema: { parse: vi.fn((v: unknown) => v) },
}));

const mockedAssertApiKeyOrSession = vi.mocked(assertApiKeyOrSession);
const mockedResolveSessionUserId = vi.mocked(resolveSessionUserId);

describe("GET /api/tool-costs", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("returns tool costs for the authenticated user", async () => {
    mockedAssertApiKeyOrSession.mockResolvedValue("user-123");

    const response = await GET(
      new Request("http://localhost/api/tool-costs", {
        headers: { "x-nullspend-key": "ns_live_sk_test0001" },
      }),
    );

    expect(response.status).toBe(200);
    expect(mockedAssertApiKeyOrSession).toHaveBeenCalled();
  });

  it("returns 429 when per-key rate limit is exceeded", async () => {
    const rateLimitResponse = new Response(
      JSON.stringify({ error: { code: "rate_limit_exceeded", message: "Too many requests", details: null } }),
      { status: 429, headers: { "Content-Type": "application/json" } },
    );
    mockedAssertApiKeyOrSession.mockResolvedValue(rateLimitResponse as any);

    const response = await GET(
      new Request("http://localhost/api/tool-costs", {
        headers: { "x-nullspend-key": "ns_live_sk_test0001" },
      }),
    );

    expect(response.status).toBe(429);
    expect(getDb).not.toHaveBeenCalled();
  });
});

describe("POST /api/tool-costs", () => {
  it("uses session auth (not API key auth)", async () => {
    mockedResolveSessionUserId.mockResolvedValue("user-123");
    mockUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([]),
        }),
      }),
    });

    const response = await POST(
      new Request("http://localhost/api/tool-costs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serverName: "test-server",
          toolName: "test-tool",
          costMicrodollars: 5000,
        }),
      }),
    );

    // 404 because mock returns empty array (no matching tool)
    expect(response.status).toBe(404);
    expect(mockedResolveSessionUserId).toHaveBeenCalled();
    expect(mockedAssertApiKeyOrSession).not.toHaveBeenCalled();
  });
});
