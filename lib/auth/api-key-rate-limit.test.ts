import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/observability", () => ({
  getLogger: vi.fn(() => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

const { mockLimit, MockRatelimit } = vi.hoisted(() => {
  const mockLimit = vi.fn();
  const MockRatelimit = vi.fn().mockImplementation(function () { return { limit: mockLimit }; });
  (MockRatelimit as any).slidingWindow = vi.fn();
  return { mockLimit, MockRatelimit };
});

vi.mock("@upstash/ratelimit", () => ({
  Ratelimit: MockRatelimit,
}));
vi.mock("@upstash/redis", () => ({
  Redis: { fromEnv: vi.fn() },
}));

import { checkKeyRateLimit, _resetKeyRatelimitForTesting } from "./api-key-rate-limit";

describe("checkKeyRateLimit", () => {
  afterEach(() => {
    _resetKeyRatelimitForTesting();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("returns allowed: true when Upstash not configured", async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;

    const result = await checkKeyRateLimit("key-123");
    expect(result).toEqual({ allowed: true });
  });

  it("returns allowed: true when under limit", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://fake.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "fake-token");
    mockLimit.mockResolvedValueOnce({ success: true, limit: 60, remaining: 55, reset: Date.now() + 60000 });

    const result = await checkKeyRateLimit("key-123");
    expect(result).toEqual({ allowed: true, limit: 60, remaining: 55, reset: expect.any(Number) });
  });

  it("returns allowed: false when over limit", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://fake.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "fake-token");
    const resetTime = Date.now() + 60000;
    mockLimit.mockResolvedValueOnce({ success: false, limit: 60, remaining: 0, reset: resetTime });

    const result = await checkKeyRateLimit("key-123");
    expect(result).toEqual({ allowed: false, limit: 60, remaining: 0, reset: resetTime });
  });

  it("returns allowed: true when Redis throws (fail-open)", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://fake.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "fake-token");
    mockLimit.mockRejectedValueOnce(new Error("Redis connection failed"));

    const result = await checkKeyRateLimit("key-123");
    expect(result).toEqual({ allowed: true });
  });

  it("uses NULLSPEND_API_KEY_RATE_LIMIT env var", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://fake.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "fake-token");
    vi.stubEnv("NULLSPEND_API_KEY_RATE_LIMIT", "120");
    mockLimit.mockResolvedValueOnce({ success: true, limit: 120, remaining: 119, reset: Date.now() + 60000 });

    await checkKeyRateLimit("key-123");

    expect((MockRatelimit as any).slidingWindow).toHaveBeenCalledWith(120, "1 m");
  });

  it("uses default 60 when env var absent", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://fake.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "fake-token");
    delete process.env.NULLSPEND_API_KEY_RATE_LIMIT;
    mockLimit.mockResolvedValueOnce({ success: true, limit: 60, remaining: 59, reset: Date.now() + 60000 });

    await checkKeyRateLimit("key-123");

    expect((MockRatelimit as any).slidingWindow).toHaveBeenCalledWith(60, "1 m");
  });
});
