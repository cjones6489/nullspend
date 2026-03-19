import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockError = vi.fn();
const mockInfo = vi.fn();
const mockWarn = vi.fn();

vi.mock("@/lib/observability", () => ({
  getLogger: () => ({ error: mockError, info: mockInfo, warn: mockWarn }),
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
    mockWarn.mockClear();
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

  it("never throws on network error (retries exhausted)", async () => {
    vi.useFakeTimers();
    process.env.PROXY_INTERNAL_URL = "https://proxy.test";
    process.env.PROXY_INTERNAL_SECRET = "secret-123";

    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network error"));

    const promise = invalidateProxyCache({
      action: "remove",
      userId: "user-1",
      entityType: "api_key",
      entityId: "key-1",
    });
    // Advance past both retry delays (1s + 3s)
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(promise).resolves.toBeUndefined();

    expect(mockError).toHaveBeenCalledWith(
      expect.objectContaining({ action: "remove", userId: "user-1", attempt: 0 }),
      "Proxy cache invalidation error",
    );
    expect(mockWarn).toHaveBeenCalledWith(
      expect.objectContaining({ action: "remove", userId: "user-1", retries: 2 }),
      expect.stringContaining("Budget sync gap"),
    );

    vi.useRealTimers();
  });

  it("never throws on non-200 response (retries exhausted)", async () => {
    vi.useFakeTimers();
    process.env.PROXY_INTERNAL_URL = "https://proxy.test";
    process.env.PROXY_INTERNAL_SECRET = "secret-123";

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "unauthorized" } }), { status: 401 }),
    );

    const promise = invalidateProxyCache({
      action: "reset_spend",
      userId: "user-1",
      entityType: "user",
      entityId: "user-1",
    });
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(promise).resolves.toBeUndefined();

    expect(mockError).toHaveBeenCalledWith(
      expect.objectContaining({ status: 401, action: "reset_spend", userId: "user-1" }),
      "Proxy cache invalidation failed",
    );
    expect(mockWarn).toHaveBeenCalledWith(
      expect.objectContaining({ action: "reset_spend", userId: "user-1", retries: 2 }),
      expect.stringContaining("Budget sync gap"),
    );

    vi.useRealTimers();
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

  it("adds Sentry breadcrumb after all retries fail (non-200)", async () => {
    vi.useFakeTimers();
    process.env.PROXY_INTERNAL_URL = "https://proxy.test";
    process.env.PROXY_INTERNAL_SECRET = "secret-123";

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 500 }),
    );

    const promise = invalidateProxyCache({
      action: "remove",
      userId: "user-1",
      entityType: "api_key",
      entityId: "key-1",
    });
    await vi.advanceTimersByTimeAsync(5_000);
    await promise;

    expect(mockWarn).toHaveBeenCalledTimes(1);
    expect(mockAddSentryBreadcrumb).toHaveBeenCalledWith(
      "proxy-invalidate",
      "Invalidation failed after retries",
      expect.objectContaining({ status: 500, action: "remove", userId: "user-1", retries: 2 }),
    );

    vi.useRealTimers();
  });

  it("adds Sentry breadcrumb after all retries fail (network error)", async () => {
    vi.useFakeTimers();
    process.env.PROXY_INTERNAL_URL = "https://proxy.test";
    process.env.PROXY_INTERNAL_SECRET = "secret-123";

    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Connection refused"));

    const promise = invalidateProxyCache({
      action: "reset_spend",
      userId: "user-2",
      entityType: "user",
      entityId: "user-2",
    });
    await vi.advanceTimersByTimeAsync(5_000);
    await promise;

    expect(mockWarn).toHaveBeenCalledTimes(1);
    expect(mockAddSentryBreadcrumb).toHaveBeenCalledWith(
      "proxy-invalidate",
      "Invalidation error after retries",
      expect.objectContaining({
        error: "Connection refused",
        action: "reset_spend",
        userId: "user-2",
        retries: 2,
      }),
    );

    vi.useRealTimers();
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

  // ── Retry behavior ──────────────────────────────────────────────────

  it("retries on network error and succeeds on second attempt", async () => {
    vi.useFakeTimers();
    process.env.PROXY_INTERNAL_URL = "https://proxy.test";
    process.env.PROXY_INTERNAL_SECRET = "secret-123";

    const mockFetch = vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("Connection refused"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const promise = invalidateProxyCache({
      action: "sync",
      userId: "user-1",
      entityType: "user",
      entityId: "user-1",
    });
    await vi.advanceTimersByTimeAsync(2_000);
    await promise;

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockInfo).toHaveBeenCalledWith(
      expect.objectContaining({ action: "sync", retries: 1 }),
      "Proxy cache invalidated",
    );
    // No Sentry breadcrumb on eventual success
    expect(mockAddSentryBreadcrumb).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("retries on 500 and succeeds on third attempt", async () => {
    vi.useFakeTimers();
    process.env.PROXY_INTERNAL_URL = "https://proxy.test";
    process.env.PROXY_INTERNAL_SECRET = "secret-123";

    const mockFetch = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 502 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const promise = invalidateProxyCache({
      action: "sync",
      userId: "user-1",
      entityType: "api_key",
      entityId: "key-1",
    });
    await vi.advanceTimersByTimeAsync(5_000);
    await promise;

    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(mockInfo).toHaveBeenCalledWith(
      expect.objectContaining({ action: "sync", retries: 2 }),
      "Proxy cache invalidated",
    );

    vi.useRealTimers();
  });

  it("makes exactly 3 attempts (1 + 2 retries) before giving up", async () => {
    vi.useFakeTimers();
    process.env.PROXY_INTERNAL_URL = "https://proxy.test";
    process.env.PROXY_INTERNAL_SECRET = "secret-123";

    const mockFetch = vi.spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Persistent failure"));

    const promise = invalidateProxyCache({
      action: "sync",
      userId: "user-1",
      entityType: "user",
      entityId: "user-1",
    });
    await vi.advanceTimersByTimeAsync(10_000);
    await promise;

    expect(mockFetch).toHaveBeenCalledTimes(3);
    // Error logged for each attempt, plus one warn for sync gap
    expect(mockError).toHaveBeenCalledTimes(3);
    expect(mockWarn).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it("does not retry on first success", async () => {
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
    expect(mockError).not.toHaveBeenCalled();
  });
});
