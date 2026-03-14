import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

beforeAll(() => {
  if (!crypto.subtle.timingSafeEqual) {
    (crypto.subtle as any).timingSafeEqual = (a: ArrayBuffer, b: ArrayBuffer) => {
      const viewA = new Uint8Array(a);
      const viewB = new Uint8Array(b);
      if (viewA.byteLength !== viewB.byteLength) return false;
      let result = 0;
      for (let i = 0; i < viewA.byteLength; i++) {
        result |= viewA[i] ^ viewB[i];
      }
      return result === 0;
    };
  }
});

const { mockIpLimit, mockKeyLimit } = vi.hoisted(() => ({
  mockIpLimit: vi.fn(),
  mockKeyLimit: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({
  waitUntil: vi.fn((p: Promise<unknown>) => {
    p.catch(() => {});
  }),
}));

vi.mock("@upstash/redis/cloudflare", () => ({
  Redis: { fromEnv: vi.fn(() => ({})) },
}));

// Mock Ratelimit to control IP and key limiting separately
vi.mock("@upstash/ratelimit", () => {
  return {
    Ratelimit: class MockRatelimit {
      private prefix: string;
      constructor(opts: { prefix: string }) {
        this.prefix = opts.prefix;
      }
      static slidingWindow() {
        return "slidingWindow";
      }
      async limit(key: string) {
        if (this.prefix.includes(":key")) {
          return mockKeyLimit(key);
        }
        return mockIpLimit(key);
      }
    },
  };
});

// Mock route handlers to avoid needing full auth/budget mocks
vi.mock("../routes/openai.js", () => ({
  handleChatCompletions: vi.fn().mockResolvedValue(
    Response.json({ id: "test", choices: [] }, { status: 200 }),
  ),
}));

vi.mock("../routes/anthropic.js", () => ({
  handleAnthropicMessages: vi.fn().mockResolvedValue(
    Response.json({ id: "test", content: [] }, { status: 200 }),
  ),
}));

import handler from "../index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(
  path: string,
  headers: Record<string, string> = {},
): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "cf-connecting-ip": "1.2.3.4",
      ...headers,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
    }),
  });
}

function makeEnv(): Env {
  return {
    PLATFORM_AUTH_KEY: "test-key",
    OPENAI_API_KEY: "sk-test",
    HYPERDRIVE: { connectionString: "postgresql://localhost:5432/test" },
    UPSTASH_REDIS_REST_URL: "https://fake.upstash.io",
    UPSTASH_REDIS_REST_TOKEN: "fake-token",
  } as Env;
}

function makeCtx(): ExecutionContext {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  } as unknown as ExecutionContext;
}

const ipAllowed = {
  success: true,
  limit: 120,
  remaining: 119,
  reset: Date.now() + 60000,
};
const keyAllowed = {
  success: true,
  limit: 600,
  remaining: 599,
  reset: Date.now() + 60000,
};
const ipDenied = {
  success: false,
  limit: 120,
  remaining: 0,
  reset: Date.now() + 30000,
};
const keyDenied = {
  success: false,
  limit: 600,
  remaining: 0,
  reset: Date.now() + 30000,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("per-key rate limiting edge cases", () => {
  beforeEach(() => {
    mockIpLimit.mockReset().mockResolvedValue(ipAllowed);
    mockKeyLimit.mockReset().mockResolvedValue(keyAllowed);
  });

  it("key-id header absent — only IP rate limit applied", async () => {
    const req = makeRequest("/v1/chat/completions");
    const res = await handler.fetch(req, makeEnv(), makeCtx());

    expect(mockIpLimit).toHaveBeenCalledOnce();
    expect(mockKeyLimit).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  it("key-id header present — both IP and key rate limits applied", async () => {
    const req = makeRequest("/v1/chat/completions", {
      "x-nullspend-key-id": "key-123",
    });
    const res = await handler.fetch(req, makeEnv(), makeCtx());

    expect(mockIpLimit).toHaveBeenCalledOnce();
    expect(mockKeyLimit).toHaveBeenCalledOnce();
    expect(mockKeyLimit).toHaveBeenCalledWith("key-123");
    expect(res.status).toBe(200);
  });

  it("IP rate limit hit — returns 429 before key check", async () => {
    mockIpLimit.mockResolvedValue(ipDenied);

    const req = makeRequest("/v1/chat/completions", {
      "x-nullspend-key-id": "key-123",
    });
    const res = await handler.fetch(req, makeEnv(), makeCtx());

    expect(res.status).toBe(429);
    expect(mockKeyLimit).not.toHaveBeenCalled();

    const body = await res.json();
    expect(body.error).toBe("rate_limited");

    expect(res.headers.has("X-RateLimit-Limit")).toBe(true);
    expect(res.headers.has("X-RateLimit-Remaining")).toBe(true);
    expect(res.headers.has("X-RateLimit-Reset")).toBe(true);
    expect(res.headers.has("Retry-After")).toBe(true);
  });

  it("IP passes but key rate limit hit — returns 429", async () => {
    mockIpLimit.mockResolvedValue(ipAllowed);
    mockKeyLimit.mockResolvedValue(keyDenied);

    const req = makeRequest("/v1/chat/completions", {
      "x-nullspend-key-id": "key-456",
    });
    const res = await handler.fetch(req, makeEnv(), makeCtx());

    expect(res.status).toBe(429);

    expect(res.headers.has("X-RateLimit-Limit")).toBe(true);
    expect(res.headers.has("X-RateLimit-Remaining")).toBe(true);
    expect(res.headers.has("X-RateLimit-Reset")).toBe(true);
    expect(res.headers.has("Retry-After")).toBe(true);
  });

  it("key-id header exceeds 128 chars — key rate limit skipped", async () => {
    const longKeyId = "a".repeat(129);
    const req = makeRequest("/v1/chat/completions", {
      "x-nullspend-key-id": longKeyId,
    });
    const res = await handler.fetch(req, makeEnv(), makeCtx());

    expect(mockKeyLimit).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  it("key-id header exactly 128 chars — key rate limit applied", async () => {
    const exactKeyId = "a".repeat(128);
    const req = makeRequest("/v1/chat/completions", {
      "x-nullspend-key-id": exactKeyId,
    });
    const res = await handler.fetch(req, makeEnv(), makeCtx());

    expect(mockKeyLimit).toHaveBeenCalledOnce();
    expect(mockKeyLimit).toHaveBeenCalledWith(exactKeyId);
    expect(res.status).toBe(200);
  });

  it("empty key-id header — key rate limit skipped", async () => {
    const req = makeRequest("/v1/chat/completions", {
      "x-nullspend-key-id": "",
    });
    const res = await handler.fetch(req, makeEnv(), makeCtx());

    expect(mockKeyLimit).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  it("custom key rate limit from env — flow still works", async () => {
    const env = makeEnv();
    (env as Record<string, unknown>).PROXY_KEY_RATE_LIMIT = "1000";

    const req = makeRequest("/v1/chat/completions", {
      "x-nullspend-key-id": "key-custom",
    });
    const res = await handler.fetch(req, env, makeCtx());

    expect(mockKeyLimit).toHaveBeenCalledOnce();
    expect(mockKeyLimit).toHaveBeenCalledWith("key-custom");
    expect(res.status).toBe(200);
  });

  it("rate limiter error — request proceeds (fail-open)", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockIpLimit.mockRejectedValue(new Error("Redis connection failed"));

    const req = makeRequest("/v1/chat/completions");
    const res = await handler.fetch(req, makeEnv(), makeCtx());

    expect(res.status).toBe(200);
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});
