import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

import { withIdempotency } from "./idempotency";

// Mock Redis
const mockRedisGet = vi.fn();
const mockRedisSet = vi.fn();
const mockRedisDel = vi.fn();

vi.mock("./redis", () => ({
  getResilienceRedis: () => ({
    get: mockRedisGet,
    set: mockRedisSet,
    del: mockRedisDel,
  }),
}));

vi.mock("@/lib/observability", () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/actions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify({ test: true }),
  });
}

function makeHandler(responseFn?: () => NextResponse) {
  const factory = responseFn ?? (() => NextResponse.json({ id: "action-123" }, { status: 201 }));
  return vi.fn().mockImplementation(() => Promise.resolve(factory()));
}

describe("withIdempotency", () => {
  beforeEach(() => {
    vi.stubEnv("NULLSPEND_IDEMPOTENCY_ENABLED", "true");
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue("OK");
    mockRedisDel.mockResolvedValue(1);
  });

  afterEach(() => {
    vi.resetAllMocks();
    vi.unstubAllEnvs();
  });

  it("executes handler normally when no Idempotency-Key header", async () => {
    const handler = makeHandler();
    const request = makeRequest();

    const response = await withIdempotency(request, handler);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(201);
    expect(mockRedisGet).not.toHaveBeenCalled();
  });

  it("executes handler and caches response on first request with key", async () => {
    const handler = makeHandler();
    const request = makeRequest({ "Idempotency-Key": "key-1" });

    const response = await withIdempotency(request, handler);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.id).toBe("action-123");

    // Should cache the response (sentinel SET + cache SET)
    expect(mockRedisSet).toHaveBeenCalledTimes(2);
    const cacheCall = mockRedisSet.mock.calls[1];
    expect(cacheCall[0]).toBe("nullspend:idempotency:key-1");
    expect(cacheCall[1]).toMatchObject({
      status: 201,
      body: expect.stringContaining("action-123"),
      headers: expect.objectContaining({
        "content-type": "application/json",
      }),
    });
  });

  it("returns cached response for duplicate key without calling handler", async () => {
    const cachedEntry = {
      status: 201,
      body: JSON.stringify({ id: "action-123" }),
      headers: { "content-type": "application/json", "x-ratelimit-limit": "60" },
      completedAt: "2026-03-16T00:00:00.000Z",
    };
    mockRedisGet.mockResolvedValue(cachedEntry);

    const handler = makeHandler();
    const request = makeRequest({ "Idempotency-Key": "key-1" });

    const response = await withIdempotency(request, handler);

    expect(handler).not.toHaveBeenCalled();
    expect(response.status).toBe(201);
    expect(response.headers.get("X-Idempotent-Replayed")).toBe("true");
    const body = await response.json();
    expect(body.id).toBe("action-123");
  });

  it("preserves original response headers on first request", async () => {
    const handler = makeHandler(() => {
      const res = NextResponse.json({ id: "action-123" }, { status: 201 });
      res.headers.set("X-RateLimit-Limit", "60");
      res.headers.set("X-RateLimit-Remaining", "59");
      return res;
    });
    const request = makeRequest({ "Idempotency-Key": "key-headers" });

    const response = await withIdempotency(request, handler);

    expect(response.status).toBe(201);
    expect(response.headers.get("X-RateLimit-Limit")).toBe("60");
    expect(response.headers.get("X-RateLimit-Remaining")).toBe("59");
  });

  it("restores cached headers on replayed responses", async () => {
    mockRedisGet.mockResolvedValue({
      status: 201,
      body: JSON.stringify({ id: "action-123" }),
      headers: {
        "content-type": "application/json",
        "x-ratelimit-limit": "60",
        "x-ratelimit-remaining": "59",
      },
      completedAt: "2026-03-16T00:00:00.000Z",
    });

    const request = makeRequest({ "Idempotency-Key": "key-1" });
    const response = await withIdempotency(request, makeHandler());

    expect(response.headers.get("X-Idempotent-Replayed")).toBe("true");
    expect(response.headers.get("x-ratelimit-limit")).toBe("60");
    expect(response.headers.get("x-ratelimit-remaining")).toBe("59");
  });

  it("concurrent duplicates: second request gets 503 when first is still processing", async () => {
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue(null); // NX failed

    // Polling: still "processing"
    mockRedisGet
      .mockResolvedValueOnce(null) // initial check
      .mockResolvedValue("processing"); // all poll attempts

    const handler = makeHandler();
    const request = makeRequest({ "Idempotency-Key": "key-concurrent" });

    const response = await withIdempotency(request, handler);

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("1");
    expect(handler).not.toHaveBeenCalled();
  });

  it("different keys execute independently", async () => {
    const handler = makeHandler();

    const req1 = makeRequest({ "Idempotency-Key": "key-a" });
    const req2 = makeRequest({ "Idempotency-Key": "key-b" });

    const res1 = await withIdempotency(req1, handler);
    const res2 = await withIdempotency(req2, handler);

    expect(handler).toHaveBeenCalledTimes(2);
    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);
  });

  it("kill switch NULLSPEND_IDEMPOTENCY_ENABLED=false bypasses idempotency", async () => {
    vi.stubEnv("NULLSPEND_IDEMPOTENCY_ENABLED", "false");
    const handler = makeHandler();
    const request = makeRequest({ "Idempotency-Key": "key-1" });

    const response = await withIdempotency(request, handler);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(201);
    expect(mockRedisGet).not.toHaveBeenCalled();
  });

  it("handler throws: sentinel cleaned up, error propagates", async () => {
    const handler = vi.fn().mockRejectedValue(new Error("DB error"));
    const request = makeRequest({ "Idempotency-Key": "key-err" });

    await expect(withIdempotency(request, handler)).rejects.toThrow("DB error");

    expect(mockRedisDel).toHaveBeenCalledWith("nullspend:idempotency:key-err");
  });

  it("5xx response: sentinel cleaned up so retries can proceed", async () => {
    const handler = makeHandler(() =>
      NextResponse.json({ error: "Internal" }, { status: 500 }),
    );
    const request = makeRequest({ "Idempotency-Key": "key-5xx" });

    const response = await withIdempotency(request, handler);

    expect(response.status).toBe(500);
    expect(mockRedisDel).toHaveBeenCalledWith("nullspend:idempotency:key-5xx");
  });

  it("429 rate limit response: NOT cached, sentinel cleaned up", async () => {
    const handler = makeHandler(() =>
      NextResponse.json({ error: "Too many requests" }, { status: 429 }),
    );
    const request = makeRequest({ "Idempotency-Key": "key-429" });

    const response = await withIdempotency(request, handler);

    expect(response.status).toBe(429);
    // Sentinel should be deleted (not cached)
    expect(mockRedisDel).toHaveBeenCalledWith("nullspend:idempotency:key-429");
    // No cache SET should have happened (only sentinel SET)
    const cacheSets = mockRedisSet.mock.calls.filter(
      (call) => typeof call[1] === "object",
    );
    expect(cacheSets).toHaveLength(0);
  });

  it("4xx response: cached in Redis (same as Stripe behavior)", async () => {
    const handler = makeHandler(() =>
      NextResponse.json({ error: "Validation failed" }, { status: 400 }),
    );
    const request = makeRequest({ "Idempotency-Key": "key-4xx" });

    const response = await withIdempotency(request, handler);

    expect(response.status).toBe(400);
    const setCalls = mockRedisSet.mock.calls;
    const cacheCall = setCalls.find(
      (call) => call[0] === "nullspend:idempotency:key-4xx" && typeof call[1] === "object",
    );
    expect(cacheCall).toBeDefined();
    expect(cacheCall![1]).toMatchObject({ status: 400 });
  });

  it("Redis GET error: fails open, handler executes", async () => {
    mockRedisGet.mockRejectedValue(new Error("ECONNREFUSED"));
    const handler = makeHandler();
    const request = makeRequest({ "Idempotency-Key": "key-redis-err" });

    const response = await withIdempotency(request, handler);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(201);
  });

  it("Redis SET NX error: fails open, handler executes", async () => {
    mockRedisGet.mockResolvedValue(null); // no cache
    mockRedisSet.mockRejectedValue(new Error("ECONNREFUSED"));
    const handler = makeHandler();
    const request = makeRequest({ "Idempotency-Key": "key-setnx-err" });

    const response = await withIdempotency(request, handler);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(201);
  });

  it("Redis cache write error after handler success: returns response without double-executing", async () => {
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet
      .mockResolvedValueOnce("OK") // sentinel SET succeeds
      .mockRejectedValueOnce(new Error("Redis write failed")); // cache SET fails

    const handler = makeHandler();
    const request = makeRequest({ "Idempotency-Key": "key-write-err" });

    const response = await withIdempotency(request, handler);

    // Handler should execute exactly once
    expect(handler).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.id).toBe("action-123");
    // Sentinel should be cleaned up
    expect(mockRedisDel).toHaveBeenCalledWith("nullspend:idempotency:key-write-err");
  });
});

describe("withIdempotency — Redis unavailable", () => {
  it("fails open when Redis returns null", async () => {
    vi.resetModules();

    vi.doMock("./redis", () => ({
      getResilienceRedis: () => null,
    }));
    vi.doMock("@/lib/observability", () => ({
      getLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      }),
    }));

    const { withIdempotency: freshWithIdempotency } = await import("./idempotency");

    const handler = vi.fn().mockImplementation(() =>
      Promise.resolve(NextResponse.json({ id: "action-456" }, { status: 201 })),
    );
    const request = new Request("http://localhost/api/actions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "key-no-redis",
      },
      body: JSON.stringify({ test: true }),
    });

    const response = await freshWithIdempotency(request, handler);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(201);
  });
});
