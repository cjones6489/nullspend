import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockError = vi.fn();
const mockInfo = vi.fn();

vi.mock("@/lib/observability", () => ({
  getLogger: () => ({ error: mockError, info: mockInfo }),
}));

const mockAddSentryBreadcrumb = vi.fn();
vi.mock("@/lib/observability/sentry", () => ({
  addSentryBreadcrumb: mockAddSentryBreadcrumb,
}));

// Import after mocks are set up
const { invalidateProxyCache } = await import("./proxy-invalidate");

const originalEnv = process.env;

describe("invalidateProxyCache", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockError.mockClear();
    mockInfo.mockClear();
    mockAddSentryBreadcrumb.mockClear();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("calls fetch with correct URL/headers/body", async () => {
    process.env.PROXY_INTERNAL_URL = "https://proxy.test";
    process.env.PROXY_INTERNAL_SECRET = "secret-123";

    const mockFetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    await invalidateProxyCache({
      action: "remove",
      userId: "user-1",
      entityType: "api_key",
      entityId: "key-1",
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://proxy.test/internal/budget/invalidate");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>)["Authorization"]).toBe("Bearer secret-123");
    expect((init?.headers as Record<string, string>)["Content-Type"]).toBe("application/json");

    const body = JSON.parse(init?.body as string);
    expect(body).toEqual({
      action: "remove",
      userId: "user-1",
      entityType: "api_key",
      entityId: "key-1",
    });
  });

  it("no-ops when PROXY_INTERNAL_URL is missing", async () => {
    delete process.env.PROXY_INTERNAL_URL;
    process.env.PROXY_INTERNAL_SECRET = "secret-123";

    const mockFetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 200 }),
    );

    await invalidateProxyCache({
      action: "remove",
      userId: "user-1",
      entityType: "api_key",
      entityId: "key-1",
    });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("no-ops when PROXY_INTERNAL_SECRET is missing", async () => {
    process.env.PROXY_INTERNAL_URL = "https://proxy.test";
    delete process.env.PROXY_INTERNAL_SECRET;

    const mockFetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 200 }),
    );

    await invalidateProxyCache({
      action: "remove",
      userId: "user-1",
      entityType: "api_key",
      entityId: "key-1",
    });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("never throws on network error", async () => {
    process.env.PROXY_INTERNAL_URL = "https://proxy.test";
    process.env.PROXY_INTERNAL_SECRET = "secret-123";

    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network error"));

    await expect(
      invalidateProxyCache({
        action: "remove",
        userId: "user-1",
        entityType: "api_key",
        entityId: "key-1",
      }),
    ).resolves.toBeUndefined();

    expect(mockError).toHaveBeenCalledWith(
      expect.objectContaining({ action: "remove", userId: "user-1" }),
      "Proxy cache invalidation error",
    );
  });

  it("never throws on non-200 response", async () => {
    process.env.PROXY_INTERNAL_URL = "https://proxy.test";
    process.env.PROXY_INTERNAL_SECRET = "secret-123";

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }),
    );

    await expect(
      invalidateProxyCache({
        action: "reset_spend",
        userId: "user-1",
        entityType: "user",
        entityId: "user-1",
      }),
    ).resolves.toBeUndefined();

    expect(mockError).toHaveBeenCalledWith(
      expect.objectContaining({ status: 401, action: "reset_spend", userId: "user-1" }),
      "Proxy cache invalidation failed",
    );
  });

  it("logs success on 200 response", async () => {
    process.env.PROXY_INTERNAL_URL = "https://proxy.test";
    process.env.PROXY_INTERNAL_SECRET = "secret-123";

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    await invalidateProxyCache({
      action: "remove",
      userId: "user-1",
      entityType: "api_key",
      entityId: "key-1",
    });

    expect(mockInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "remove", userId: "user-1",
        entityType: "api_key", entityId: "key-1",
      }),
      "Proxy cache invalidated",
    );
  });

  it("adds Sentry breadcrumb on non-200 failure", async () => {
    process.env.PROXY_INTERNAL_URL = "https://proxy.test";
    process.env.PROXY_INTERNAL_SECRET = "secret-123";

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 500 }),
    );

    await invalidateProxyCache({
      action: "remove",
      userId: "user-1",
      entityType: "api_key",
      entityId: "key-1",
    });

    expect(mockAddSentryBreadcrumb).toHaveBeenCalledWith(
      "proxy-invalidate",
      "Invalidation failed",
      expect.objectContaining({ status: 500, action: "remove", userId: "user-1" }),
    );
  });

  it("adds Sentry breadcrumb on network error", async () => {
    process.env.PROXY_INTERNAL_URL = "https://proxy.test";
    process.env.PROXY_INTERNAL_SECRET = "secret-123";

    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Connection refused"));

    await invalidateProxyCache({
      action: "reset_spend",
      userId: "user-2",
      entityType: "user",
      entityId: "user-2",
    });

    expect(mockAddSentryBreadcrumb).toHaveBeenCalledWith(
      "proxy-invalidate",
      "Invalidation error",
      expect.objectContaining({
        error: "Connection refused",
        action: "reset_spend",
        userId: "user-2",
      }),
    );
  });

  it("uses 5s timeout via AbortSignal", async () => {
    process.env.PROXY_INTERNAL_URL = "https://proxy.test";
    process.env.PROXY_INTERNAL_SECRET = "secret-123";

    const mockFetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    await invalidateProxyCache({
      action: "remove",
      userId: "user-1",
      entityType: "api_key",
      entityId: "key-1",
    });

    const [, init] = mockFetch.mock.calls[0];
    expect(init?.signal).toBeDefined();
  });
});
