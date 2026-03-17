import { describe, it, expect, vi, beforeEach } from "vitest";

const { MockClient } = vi.hoisted(() => {
  const MockClient = vi.fn();
  return { MockClient };
});

vi.mock("pg", () => ({
  Client: MockClient,
}));

vi.mock("../lib/db-semaphore.js", () => ({
  withDbConnection: <T>(fn: () => Promise<T>) => fn(),
}));

import {
  getWebhookEndpoints,
  getWebhookEndpointsWithSecrets,
  invalidateWebhookCache,
} from "../lib/webhook-cache.js";

function makeRedis(overrides: Record<string, unknown> = {}) {
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue("OK"),
    del: vi.fn().mockResolvedValue(1),
    ...overrides,
  } as any;
}

// Mock DB rows (snake_case as returned by pg)
const mockDbRows = [
  {
    id: "ep-1",
    url: "https://hooks.example.com/1",
    signing_secret: "whsec_secret1",
    event_types: ["cost_event.created"],
  },
  {
    id: "ep-2",
    url: "https://hooks.example.com/2",
    signing_secret: "whsec_secret2",
    event_types: [],
  },
];

function mockDbClient(rows = mockDbRows) {
  MockClient.mockImplementation(function (this: any) {
    this.connect = vi.fn().mockResolvedValue(undefined);
    this.query = vi.fn().mockResolvedValue({ rows });
    this.end = vi.fn().mockResolvedValue(undefined);
    this.on = vi.fn();
  });
}

describe("getWebhookEndpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("returns cached endpoints on cache hit", async () => {
    const cached = [
      { id: "ep-1", url: "https://hooks.example.com/1", eventTypes: [] },
    ];
    const redis = makeRedis({ get: vi.fn().mockResolvedValue(cached) });

    const result = await getWebhookEndpoints(redis, "postgresql://test", "user-1");
    expect(result).toEqual(cached);
    expect(MockClient).not.toHaveBeenCalled();
  });

  it("queries database on cache miss and caches metadata without secrets", async () => {
    mockDbClient();

    const redis = makeRedis();
    const result = await getWebhookEndpoints(redis, "postgresql://test", "user-1");

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      id: "ep-1",
      url: "https://hooks.example.com/1",
      eventTypes: ["cost_event.created"],
    });
    expect(result[1]).toEqual({
      id: "ep-2",
      url: "https://hooks.example.com/2",
      eventTypes: [],
    });

    // Secrets must NOT be in the cached value
    expect(result[0]).not.toHaveProperty("signingSecret");
    expect(result[1]).not.toHaveProperty("signingSecret");

    // Verify cache was written
    expect(redis.set).toHaveBeenCalledWith(
      "webhooks:user:user-1",
      expect.any(String),
      { ex: 300 },
    );

    // Verify cached JSON does not contain secrets
    const cachedJson = redis.set.mock.calls[0][1] as string;
    expect(cachedJson).not.toContain("whsec_secret1");
    expect(cachedJson).not.toContain("whsec_secret2");
  });

  it("returns empty array on database error (fail-open)", async () => {
    MockClient.mockImplementation(function (this: any) {
      this.connect = vi.fn().mockRejectedValue(new Error("connection failed"));
      this.end = vi.fn();
      this.on = vi.fn();
    });

    const redis = makeRedis();
    const result = await getWebhookEndpoints(redis, "postgresql://test", "user-1");
    expect(result).toEqual([]);
  });

  it("returns empty array on Redis read error (fail-open, falls to DB)", async () => {
    const redis = makeRedis({
      get: vi.fn().mockRejectedValue(new Error("redis down")),
    });

    MockClient.mockImplementation(function (this: any) {
      this.connect = vi.fn().mockRejectedValue(new Error("db also down"));
      this.end = vi.fn();
      this.on = vi.fn();
    });

    const result = await getWebhookEndpoints(redis, "postgresql://test", "user-1");
    expect(result).toEqual([]);
  });

  it("returns endpoints even if Redis write fails", async () => {
    mockDbClient();

    const redis = makeRedis({
      set: vi.fn().mockRejectedValue(new Error("redis write failed")),
    });

    const result = await getWebhookEndpoints(redis, "postgresql://test", "user-1");
    expect(result).toHaveLength(2);
  });

  it("returns empty array when user has no endpoints", async () => {
    mockDbClient([]);

    const redis = makeRedis();
    const result = await getWebhookEndpoints(redis, "postgresql://test", "user-1");
    expect(result).toEqual([]);
  });
});

describe("getWebhookEndpointsWithSecrets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("returns endpoints with signing secrets from DB", async () => {
    mockDbClient();

    const result = await getWebhookEndpointsWithSecrets("postgresql://test", "user-1");

    expect(result).toHaveLength(2);
    expect(result[0].signingSecret).toBe("whsec_secret1");
    expect(result[1].signingSecret).toBe("whsec_secret2");
  });

  it("returns empty array on database error (fail-open)", async () => {
    MockClient.mockImplementation(function (this: any) {
      this.connect = vi.fn().mockRejectedValue(new Error("connection failed"));
      this.end = vi.fn();
      this.on = vi.fn();
    });

    const result = await getWebhookEndpointsWithSecrets("postgresql://test", "user-1");
    expect(result).toEqual([]);
  });
});

describe("invalidateWebhookCache", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("deletes the cache key", async () => {
    const redis = makeRedis();
    await invalidateWebhookCache(redis, "user-1");
    expect(redis.del).toHaveBeenCalledWith("webhooks:user:user-1");
  });

  it("does not throw on Redis error", async () => {
    const redis = makeRedis({
      del: vi.fn().mockRejectedValue(new Error("redis error")),
    });
    await expect(invalidateWebhookCache(redis, "user-1")).resolves.not.toThrow();
  });
});
