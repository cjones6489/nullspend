import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { GET } from "./route";

vi.mock("@/lib/auth/session", () => ({
  resolveSessionContext: vi.fn().mockResolvedValue({ userId: "user-1", orgId: "org-test-1", role: "owner" as const }),
}));

vi.mock("@/lib/auth/org-authorization", () => ({
  assertOrgRole: vi.fn().mockResolvedValue({ userId: "user-1", orgId: "org-test-1", role: "owner" }),
  assertOrgMember: vi.fn().mockResolvedValue({ userId: "user-1", orgId: "org-test-1", role: "owner" }),
}));

vi.mock("@/lib/observability/sentry", () => ({
  captureExceptionWithContext: vi.fn(),
  addSentryBreadcrumb: vi.fn(),
}));

const originalEnv = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.PROXY_INTERNAL_URL = "https://proxy.internal";
  process.env.PROXY_INTERNAL_SECRET = "test-secret";
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

function makeRequest(): Request {
  return new Request("http://localhost/api/budgets/velocity-status");
}

describe("GET /api/budgets/velocity-status", () => {
  it("returns velocity state from proxy", async () => {
    const velocityData = [
      {
        entity_key: "user:user-1",
        window_size_ms: 60_000,
        window_start_ms: Date.now(),
        current_count: 5,
        current_spend: 2_500_000,
        prev_count: 3,
        prev_spend: 1_500_000,
        tripped_at: null,
      },
    ];

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ velocityState: velocityData }), { status: 200 }),
    );

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.velocityState).toHaveLength(1);
    expect(body.velocityState[0].entity_key).toBe("user:user-1");
  });

  it("returns empty array when proxy is unavailable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Connection refused"));

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.velocityState).toEqual([]);
  });

  it("returns empty array when proxy returns non-2xx", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Internal Server Error", { status: 500 }),
    );

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.velocityState).toEqual([]);
  });

  it("returns empty array in local dev (no PROXY_INTERNAL_URL)", async () => {
    delete process.env.PROXY_INTERNAL_URL;
    delete process.env.PROXY_INTERNAL_SECRET;

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.velocityState).toEqual([]);
  });

  it("passes correct auth header to proxy", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ velocityState: [] }), { status: 200 }),
    );

    await GET(makeRequest());

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/internal/budget/velocity-state?ownerId="),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test-secret",
        }),
      }),
    );
  });
});
