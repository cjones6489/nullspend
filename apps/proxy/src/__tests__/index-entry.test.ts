/**
 * Integration tests for the main Worker entry point (index.ts).
 * Tests the full request→route→response flow without hitting OpenAI,
 * covering body parsing, JSON validation, failover, and routing logic.
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
  });

  describe("failover path", () => {
    it("falls back to OpenAI when route handler throws", async () => {
      let failoverCalled = false;
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes("api.openai.com")) {
          failoverCalled = true;
          return new Response(JSON.stringify({ choices: [], model: "gpt-4o-mini" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
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
      expect(failoverCalled).toBe(true);
      expect(res.status).toBe(200);
    });

    it("failover preserves the original body text", async () => {
      let capturedBody: string | null = null;
      const originalBody = JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "preserve me" }],
        custom_field: "keep this",
      });

      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
        if (url.includes("api.openai.com")) {
          capturedBody = init.body as string;
          return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
        }
        throw new Error("Simulated error");
      });

      const req = new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: {
          "X-AgentSeam-Auth": "test-platform-key",
          Authorization: "Bearer sk-test",
          "Content-Type": "application/json",
        },
        body: originalBody,
      });

      await entrypoint.fetch(req, makeEnv(), makeCtx());
      expect(capturedBody).toBe(originalBody);
    });

    it("passThroughOnException is called on every request", async () => {
      const ctx = makeCtx();
      const req = new Request("http://localhost/health");
      await entrypoint.fetch(req, makeEnv(), ctx);
      expect(ctx.passThroughOnException).toHaveBeenCalled();
    });
  });
});
