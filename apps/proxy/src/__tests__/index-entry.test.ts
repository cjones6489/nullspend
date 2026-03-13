/**
 * Integration tests for the main Worker entry point (index.ts).
 * Tests the full request→route→response flow without hitting OpenAI,
 * covering body parsing, JSON validation, fail-closed behavior, body size limits, and routing logic.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";

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

vi.mock("cloudflare:workers", () => ({
  waitUntil: vi.fn((p: Promise<unknown>) => { p.catch(() => {}); }),
}));

vi.mock("@upstash/redis/cloudflare", () => ({
  Redis: {
    fromEnv: () => ({
      ping: vi.fn().mockResolvedValue("PONG"),
    }),
  },
}));

const { mockProxyLimit, MockProxyRatelimit } = vi.hoisted(() => {
  const mockProxyLimit = vi.fn().mockResolvedValue({ success: true, limit: 120, remaining: 119, reset: Date.now() + 60000 });
  const MockProxyRatelimit = vi.fn().mockImplementation(function () { return { limit: mockProxyLimit }; });
  (MockProxyRatelimit as any).slidingWindow = vi.fn();
  return { mockProxyLimit, MockProxyRatelimit };
});
vi.mock("@upstash/ratelimit", () => ({
  Ratelimit: MockProxyRatelimit,
}));

vi.mock("@agentseam/cost-engine", () => ({
  isKnownModel: vi.fn().mockReturnValue(true),
  getModelPricing: vi.fn().mockReturnValue(null),
  costComponent: vi.fn().mockReturnValue(0),
}));

import entrypoint from "../index.js";

function makeEnv(): Env {
  return {
    PLATFORM_AUTH_KEY: "test-platform-key",
    OPENAI_API_KEY: "sk-test",
    HYPERDRIVE: { connectionString: "postgresql://postgres:postgres@127.0.0.1:54322/postgres" },
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

describe("Worker entry point routing", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("health endpoints", () => {
    it("GET /health returns 200 with service info", async () => {
      const req = new Request("http://localhost/health");
      const res = await entrypoint.fetch(req, makeEnv(), makeCtx());
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("ok");
      expect(body.service).toBe("agentseam-proxy");
    });

    it("GET /health/ready returns 200 when Redis is up", async () => {
      const req = new Request("http://localhost/health/ready");
      const res = await entrypoint.fetch(req, makeEnv(), makeCtx());
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("ok");
      expect(body.redis).toBe("PONG");
    });
  });

  describe("body parsing", () => {
    it("empty body returns 400 with bad_request", async () => {
      const req = new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: { "X-AgentSeam-Auth": "test-platform-key" },
        body: "",
      });
      const res = await entrypoint.fetch(req, makeEnv(), makeCtx());
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("bad_request");
    });

    it("non-JSON body returns 400", async () => {
      const req = new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: { "X-AgentSeam-Auth": "test-platform-key" },
        body: "not json {{{",
      });
      const res = await entrypoint.fetch(req, makeEnv(), makeCtx());
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("bad_request");
      expect(body.message).toContain("Invalid JSON");
    });

    it("JSON array returns 400 (must be object)", async () => {
      const req = new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: { "X-AgentSeam-Auth": "test-platform-key" },
        body: "[1, 2, 3]",
      });
      const res = await entrypoint.fetch(req, makeEnv(), makeCtx());
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.message).toContain("JSON object");
    });

    it("JSON null returns 400", async () => {
      const req = new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: { "X-AgentSeam-Auth": "test-platform-key" },
        body: "null",
      });
      const res = await entrypoint.fetch(req, makeEnv(), makeCtx());
      expect(res.status).toBe(400);
    });

    it("JSON string returns 400", async () => {
      const req = new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: { "X-AgentSeam-Auth": "test-platform-key" },
        body: '"hello"',
      });
      const res = await entrypoint.fetch(req, makeEnv(), makeCtx());
      expect(res.status).toBe(400);
    });

    it("JSON number returns 400", async () => {
      const req = new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: { "X-AgentSeam-Auth": "test-platform-key" },
        body: "42",
      });
      const res = await entrypoint.fetch(req, makeEnv(), makeCtx());
      expect(res.status).toBe(400);
    });

    it("deeply nested valid JSON object passes body validation", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ choices: [], model: "gpt-4o-mini" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

      const req = new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: {
          "X-AgentSeam-Auth": "test-platform-key",
          Authorization: "Bearer sk-test",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: "hi" }],
          nested: { deep: { value: true } },
        }),
      });
      const res = await entrypoint.fetch(req, makeEnv(), makeCtx());
      expect(res.status).toBe(200);
    });
  });

  describe("routing", () => {
    it("GET /v1/chat/completions returns 404 (POST only)", async () => {
      const req = new Request("http://localhost/v1/chat/completions", { method: "GET" });
      const res = await entrypoint.fetch(req, makeEnv(), makeCtx());
      expect(res.status).toBe(404);
    });

    it("POST /v1/embeddings returns 404 (not supported)", async () => {
      const req = new Request("http://localhost/v1/embeddings", {
        method: "POST",
        body: "{}",
      });
      const res = await entrypoint.fetch(req, makeEnv(), makeCtx());
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe("not_found");
      expect(body.message).toContain("not yet supported");
    });

    it("POST /v1/audio/transcriptions returns 404", async () => {
      const req = new Request("http://localhost/v1/audio/transcriptions", {
        method: "POST",
        body: "{}",
      });
      const res = await entrypoint.fetch(req, makeEnv(), makeCtx());
      expect(res.status).toBe(404);
    });

    it("unknown root path returns 404", async () => {
      const req = new Request("http://localhost/unknown");
      const res = await entrypoint.fetch(req, makeEnv(), makeCtx());
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe("not_found");
    });

    it("root path returns 404", async () => {
      const req = new Request("http://localhost/");
      const res = await entrypoint.fetch(req, makeEnv(), makeCtx());
      expect(res.status).toBe(404);
    });

    it("POST /v1/messages reaches Anthropic handler", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            id: "msg_test",
            type: "message",
            role: "assistant",
            model: "claude-sonnet-4-20250514",
            content: [{ type: "text", text: "Hello" }],
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
          { status: 200, headers: { "content-type": "application/json", "request-id": "req_test123" } },
        ),
      );

      const req = new Request("http://localhost/v1/messages", {
        method: "POST",
        headers: {
          "X-AgentSeam-Auth": "test-platform-key",
          Authorization: "Bearer sk-ant-test",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 100,
          messages: [{ role: "user", content: "hi" }],
        }),
      });

      const res = await entrypoint.fetch(req, makeEnv(), makeCtx());
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.model).toBe("claude-sonnet-4-20250514");
    });

    it("GET /v1/messages returns 404 (POST only)", async () => {
      const req = new Request("http://localhost/v1/messages", { method: "GET" });
      const res = await entrypoint.fetch(req, makeEnv(), makeCtx());
      expect(res.status).toBe(404);
    });
  });

  describe("fail-closed behavior", () => {
    it("returns 502 when route handler throws (never forwards to origin)", async () => {
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        throw new Error("Simulated internal error");
      });

      const req = new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: {
          "X-AgentSeam-Auth": "test-platform-key",
          Authorization: "Bearer sk-test",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: "hi" }],
        }),
      });

      const res = await entrypoint.fetch(req, makeEnv(), makeCtx());
      expect(res.status).toBe(502);
      const body = await res.json();
      expect(body.error).toBe("internal_error");
    });

    it("does not call passThroughOnException", async () => {
      const ctx = makeCtx();
      const req = new Request("http://localhost/health");
      await entrypoint.fetch(req, makeEnv(), ctx);
      expect(ctx.passThroughOnException).not.toHaveBeenCalled();
    });
  });

  describe("body size limits", () => {
    it("rejects requests with Content-Length exceeding 1MB", async () => {
      const req = new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: {
          "X-AgentSeam-Auth": "test-platform-key",
          "Content-Type": "application/json",
          "Content-Length": "2000000",
        },
        body: JSON.stringify({ model: "gpt-4o-mini", messages: [] }),
      });

      const res = await entrypoint.fetch(req, makeEnv(), makeCtx());
      expect(res.status).toBe(413);
      const body = await res.json();
      expect(body.error).toBe("payload_too_large");
    });

    it("allows requests with Content-Length under 1MB", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ choices: [], model: "gpt-4o-mini" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

      const req = new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: {
          "X-AgentSeam-Auth": "test-platform-key",
          Authorization: "Bearer sk-test",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }] }),
      });

      const res = await entrypoint.fetch(req, makeEnv(), makeCtx());
      expect(res.status).not.toBe(413);
    });
  });

  describe("rate limiting", () => {
    it("returns 429 when rate limit is exceeded", async () => {
      mockProxyLimit.mockResolvedValueOnce({ success: false, limit: 120, remaining: 0, reset: Date.now() + 60000 });

      const req = new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: {
          "X-AgentSeam-Auth": "test-platform-key",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: "gpt-4o-mini", messages: [] }),
      });

      const res = await entrypoint.fetch(req, makeEnv(), makeCtx());
      expect(res.status).toBe(429);
      const body = await res.json();
      expect(body.error).toBe("rate_limited");
      expect(res.headers.get("X-RateLimit-Limit")).toBe("120");
      expect(res.headers.get("Retry-After")).toBeTruthy();
    });

    it("continues processing when rate limit is not exceeded", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ choices: [], model: "gpt-4o-mini" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

      const req = new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: {
          "X-AgentSeam-Auth": "test-platform-key",
          Authorization: "Bearer sk-test",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }] }),
      });

      const res = await entrypoint.fetch(req, makeEnv(), makeCtx());
      expect(res.status).toBe(200);
    });

    it("continues processing when rate limiter throws (fail-open for availability)", async () => {
      mockProxyLimit.mockRejectedValueOnce(new Error("Redis connection failed"));

      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ choices: [], model: "gpt-4o-mini" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

      const req = new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: {
          "X-AgentSeam-Auth": "test-platform-key",
          Authorization: "Bearer sk-test",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }] }),
      });

      const res = await entrypoint.fetch(req, makeEnv(), makeCtx());
      expect(res.status).toBe(200);
    });
  });
});
