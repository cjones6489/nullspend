/**
 * Unit tests for the OpenAI route handler logic.
 * Tests the handleChatCompletions function behavior with mocked
 * dependencies to cover internal error paths, cost calculation
 * failures, and response handling edge cases.
 *
 * These tests verify the route handler's resilience without
 * requiring a live OpenAI API key or running proxy server.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";

// crypto.subtle.timingSafeEqual is a CF Workers API; polyfill for Node.js tests
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
  waitUntil: vi.fn((promise: Promise<unknown>) => {
    promise.catch(() => {});
  }),
}));

import { handleChatCompletions } from "../routes/openai.js";

function makeRequest(
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Request {
  return new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer sk-test-key",
      "X-AgentSeam-Auth": "test-platform-key",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    PLATFORM_AUTH_KEY: "test-platform-key",
    OPENAI_API_KEY: "sk-test-key",
    HYPERDRIVE: {
      connectionString: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    },
    UPSTASH_REDIS_REST_URL: "https://fake.upstash.io",
    UPSTASH_REDIS_REST_TOKEN: "fake-token",
    ...overrides,
  } as Env;
}

function makeSSEStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

describe("handleChatCompletions", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns 401 when platform key is missing", async () => {
    const request = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const res = await handleChatCompletions(request, makeEnv(), {
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 when platform key is wrong", async () => {
    const request = makeRequest(
      { model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }] },
      { "X-AgentSeam-Auth": "wrong-key" },
    );
    const res = await handleChatCompletions(request, makeEnv(), {
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(res.status).toBe(401);
  });

  it("forwards upstream error responses with correct status", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "Invalid model", type: "invalid_request_error" } }), {
        status: 404,
        headers: { "content-type": "application/json", "x-request-id": "req-test-404" },
      }),
    );

    const res = await handleChatCompletions(
      makeRequest({ model: "fake-model", messages: [{ role: "user", content: "hi" }] }),
      makeEnv(),
      { model: "fake-model", messages: [{ role: "user", content: "hi" }] },
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.message).toBe("Invalid model");
  });

  it("returns 502 when upstream streaming response has no body", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "x-request-id": "req-no-body",
        },
      }),
    );

    const res = await handleChatCompletions(
      makeRequest({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "hi" }],
        stream: true,
      }),
      makeEnv(),
      {
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "hi" }],
        stream: true,
      },
    );

    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).toContain("No response body");
  });

  it("handles non-streaming response with valid usage", async () => {
    const mockResponse = {
      id: "chatcmpl-test",
      model: "gpt-4o-mini-2024-07-18",
      choices: [{ index: 0, message: { role: "assistant", content: "hello" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    };

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockResponse), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-request-id": "req-non-stream",
        },
      }),
    );

    const res = await handleChatCompletions(
      makeRequest({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "hi" }],
        stream: false,
      }),
      makeEnv(),
      {
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "hi" }],
        stream: false,
      },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.usage.prompt_tokens).toBe(10);
    expect(body.usage.completion_tokens).toBe(5);
    expect(body.model).toBe("gpt-4o-mini-2024-07-18");
  });

  it("handles non-streaming response with unparseable body gracefully", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("this is not json at all!", {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-request-id": "req-bad-json",
        },
      }),
    );

    const res = await handleChatCompletions(
      makeRequest({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "hi" }],
        stream: false,
      }),
      makeEnv(),
      {
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "hi" }],
        stream: false,
      },
    );

    // Should still return the raw text to the client
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe("this is not json at all!");
  });

  it("handles non-streaming response with no usage object", async () => {
    const mockResponse = {
      id: "chatcmpl-test",
      model: "gpt-4o-mini-2024-07-18",
      choices: [{ index: 0, message: { role: "assistant", content: "hello" }, finish_reason: "stop" }],
    };

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockResponse), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-request-id": "req-no-usage",
        },
      }),
    );

    const res = await handleChatCompletions(
      makeRequest({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "hi" }],
      }),
      makeEnv(),
      {
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "hi" }],
      },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).not.toHaveProperty("usage");
  });

  it("handles streaming response with proper SSE passthrough", async () => {
    const sseChunks = [
      'data: {"id":"chatcmpl-1","model":"gpt-4o-mini","choices":[{"delta":{"content":"hi"}}]}\n\n',
      'data: {"id":"chatcmpl-1","model":"gpt-4o-mini","choices":[],"usage":{"prompt_tokens":5,"completion_tokens":1}}\n\n',
      "data: [DONE]\n\n",
    ];

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(makeSSEStream(sseChunks), {
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "x-request-id": "req-stream",
        },
      }),
    );

    const res = await handleChatCompletions(
      makeRequest({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "hi" }],
        stream: true,
      }),
      makeEnv(),
      {
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "hi" }],
        stream: true,
      },
    );

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("data:");
    expect(text).toContain("[DONE]");
    expect(text).toContain('"content":"hi"');
  });

  it("force-merges stream_options.include_usage for streaming requests", async () => {
    let capturedBody: string | null = null;

    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      capturedBody = init.body as string;
      const sseChunks = [
        'data: {"id":"chatcmpl-1","model":"gpt-4o-mini","choices":[],"usage":{"prompt_tokens":5,"completion_tokens":1}}\n\n',
        "data: [DONE]\n\n",
      ];
      return new Response(makeSSEStream(sseChunks), {
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "x-request-id": "req-merge",
        },
      });
    });

    const body = {
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "hi" }],
      stream: true,
      stream_options: { include_usage: false },
    };

    const res = await handleChatCompletions(makeRequest(body), makeEnv(), body);
    expect(res.status).toBe(200);
    await res.text();

    expect(capturedBody).toBeTruthy();
    const sentBody = JSON.parse(capturedBody!);
    expect(sentBody.stream_options.include_usage).toBe(true);
  });

  it("extracts model from body as 'unknown' when model is missing", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "model required" } }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    );

    const res = await handleChatCompletions(
      makeRequest({ messages: [{ role: "user", content: "hi" }] }),
      makeEnv(),
      { messages: [{ role: "user", content: "hi" }] },
    );

    // OpenAI will reject this, proxy forwards the error
    expect(res.status).toBe(400);
  });

  it("forwards x-request-id header from upstream to client", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ model: "gpt-4o-mini", choices: [], usage: { prompt_tokens: 1, completion_tokens: 1 } }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-request-id": "req-unique-id-abc",
        },
      }),
    );

    const res = await handleChatCompletions(
      makeRequest({ model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }] }),
      makeEnv(),
      { model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }] },
    );

    expect(res.headers.get("x-request-id")).toBe("req-unique-id-abc");
    await res.text();
  });

  it("forwards x-ratelimit headers from upstream to client", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ model: "gpt-4o-mini", choices: [], usage: { prompt_tokens: 1, completion_tokens: 1 } }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-request-id": "req-rl",
          "x-ratelimit-limit-requests": "500",
          "x-ratelimit-remaining-requests": "499",
        },
      }),
    );

    const res = await handleChatCompletions(
      makeRequest({ model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }] }),
      makeEnv(),
      { model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }] },
    );

    expect(res.headers.get("x-ratelimit-limit-requests")).toBe("500");
    expect(res.headers.get("x-ratelimit-remaining-requests")).toBe("499");
    await res.text();
  });

  it("strips x-agentseam-auth header before sending to OpenAI", async () => {
    let capturedHeaders: Headers | null = null;

    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      capturedHeaders = init.headers as Headers;
      return new Response(JSON.stringify({ model: "gpt-4o-mini", choices: [] }), {
        status: 200,
        headers: { "content-type": "application/json", "x-request-id": "req-strip" },
      });
    });

    await handleChatCompletions(
      makeRequest({ model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }] }),
      makeEnv(),
      { model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }] },
    );

    expect(capturedHeaders).toBeTruthy();
    expect(capturedHeaders!.get("x-agentseam-auth")).toBeNull();
  });

  it("streaming response includes anti-buffering headers", async () => {
    const sseChunks = [
      'data: {"id":"chatcmpl-1","model":"gpt-4o-mini","choices":[{"delta":{"content":"hi"}}]}\n\n',
      'data: {"id":"chatcmpl-1","model":"gpt-4o-mini","choices":[],"usage":{"prompt_tokens":5,"completion_tokens":1}}\n\n',
      "data: [DONE]\n\n",
    ];

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(makeSSEStream(sseChunks), {
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "x-request-id": "req-stream-headers",
        },
      }),
    );

    const res = await handleChatCompletions(
      makeRequest({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "hi" }],
        stream: true,
      }),
      makeEnv(),
      {
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "hi" }],
        stream: true,
      },
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-cache, no-transform");
    expect(res.headers.get("x-accel-buffering")).toBe("no");
    expect(res.headers.get("connection")).toBe("keep-alive");
    await res.text();
  });

  it("non-streaming response does NOT include anti-buffering headers", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ model: "gpt-4o-mini", choices: [], usage: { prompt_tokens: 1, completion_tokens: 1 } }), {
        status: 200,
        headers: { "content-type": "application/json", "x-request-id": "req-non-stream-headers" },
      }),
    );

    const res = await handleChatCompletions(
      makeRequest({ model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }] }),
      makeEnv(),
      { model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }] },
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBeNull();
    expect(res.headers.get("x-accel-buffering")).toBeNull();
    await res.text();
  });

  it("passes AbortSignal.timeout to upstream fetch", async () => {
    let capturedSignal: AbortSignal | null = null;

    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      capturedSignal = init.signal as AbortSignal;
      return new Response(JSON.stringify({ model: "gpt-4o-mini", choices: [] }), {
        status: 200,
        headers: { "content-type": "application/json", "x-request-id": "req-timeout" },
      });
    });

    await handleChatCompletions(
      makeRequest({ model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }] }),
      makeEnv(),
      { model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }] },
    );

    expect(capturedSignal).toBeTruthy();
    expect(capturedSignal!.aborted).toBe(false);
  });

  it("cost calculation failure in streaming waitUntil does not affect response", async () => {
    const sseChunks = [
      'data: {"id":"chatcmpl-1","model":"gpt-4o-mini","choices":[{"delta":{"content":"hi"}}]}\n\n',
      'data: {"id":"chatcmpl-1","model":"gpt-4o-mini","choices":[],"usage":{"prompt_tokens":"NaN","completion_tokens":-1}}\n\n',
      "data: [DONE]\n\n",
    ];

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(makeSSEStream(sseChunks), {
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "x-request-id": "req-bad-usage",
        },
      }),
    );

    const res = await handleChatCompletions(
      makeRequest({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "hi" }],
        stream: true,
      }),
      makeEnv(),
      {
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "hi" }],
        stream: true,
      },
    );

    // Response should still be delivered regardless of cost calc issues
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("[DONE]");
  });
});
