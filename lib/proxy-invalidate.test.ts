import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { invalidateProxyCache } from "./proxy-invalidate";

const originalEnv = process.env;

describe("invalidateProxyCache", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      invalidateProxyCache({
        action: "remove",
        userId: "user-1",
        entityType: "api_key",
        entityId: "key-1",
      }),
    ).resolves.toBeUndefined();
  });

  it("never throws on non-200 response", async () => {
    process.env.PROXY_INTERNAL_URL = "https://proxy.test";
    process.env.PROXY_INTERNAL_SECRET = "secret-123";

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      invalidateProxyCache({
        action: "reset_spend",
        userId: "user-1",
        entityType: "user",
        entityId: "user-1",
      }),
    ).resolves.toBeUndefined();
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
