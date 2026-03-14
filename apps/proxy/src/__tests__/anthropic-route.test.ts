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
  waitUntil: vi.fn((promise: Promise<unknown>) => {
    promise.catch(() => {});
  }),
}));

const { mockIsKnownModel } = vi.hoisted(() => {
  const mockIsKnownModel = vi.fn().mockReturnValue(true);
  return { mockIsKnownModel };
});
vi.mock("@nullspend/cost-engine", () => ({
  isKnownModel: mockIsKnownModel,
  getModelPricing: vi.fn().mockReturnValue(null),
  costComponent: vi.fn().mockReturnValue(0),
}));

import { handleAnthropicMessages } from "../routes/anthropic.js";

function makeRequest(
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Request {
  return new Request("http://localhost/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer sk-ant-api03-test",
      "X-NullSpend-Auth": "test-platform-key",
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

function makeAnthropicSSEStream(chunks: string[]): ReadableStream<Uint8Array> {
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

const ANTHROPIC_NON_STREAMING_RESPONSE = {
  id: "msg_01XFDUDYJgAACzvnptvVoYEL",
  type: "message",
  role: "assistant",
  model: "claude-sonnet-4-20250514",
  content: [{ type: "text", text: "Hello!" }],
  stop_reason: "end_turn",
  usage: {
    input_tokens: 25,
    output_tokens: 10,
  },
};

describe("handleAnthropicMessages", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns 401 when X-NullSpend-Auth is missing", async () => {
    const request = new Request("http://localhost/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const res = await handleAnthropicMessages(request, makeEnv(), {
      model: "claude-sonnet-4-20250514",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 when X-NullSpend-Auth is invalid", async () => {
    const request = makeRequest(
      { model: "claude-sonnet-4-20250514", max_tokens: 100, messages: [{ role: "user", content: "hi" }] },
      { "X-NullSpend-Auth": "wrong-key" },
    );
    const res = await handleAnthropicMessages(request, makeEnv(), {
      model: "claude-sonnet-4-20250514",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
    });
    expect(res.status).toBe(401);
  });

  it("returns 400 for unknown model", async () => {
    mockIsKnownModel.mockReturnValueOnce(false);
    const body = { model: "claude-unknown", max_tokens: 100, messages: [] };
    const res = await handleAnthropicMessages(makeRequest(body), makeEnv(), body);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("invalid_model");
  });

  it("handles valid non-streaming request", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(ANTHROPIC_NON_STREAMING_RESPONSE), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "request-id": "req_018EeWyXxfu5pfWkrYcMdjWG",
        },
      }),
    );

    const body = {
      model: "claude-sonnet-4-20250514",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
    };
    const res = await handleAnthropicMessages(makeRequest(body), makeEnv(), body);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.model).toBe("claude-sonnet-4-20250514");
    expect(json.usage.input_tokens).toBe(25);
    expect(json.usage.output_tokens).toBe(10);
  });

  it("handles valid streaming request with anti-buffering headers", async () => {
    const sseChunks = [
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_01","type":"message","role":"assistant","model":"claude-sonnet-4-20250514","usage":{"input_tokens":25,"output_tokens":0}}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":10}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ];

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(makeAnthropicSSEStream(sseChunks), {
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "request-id": "req_stream_test",
        },
      }),
    );

    const body = {
      model: "claude-sonnet-4-20250514",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
      stream: true,
    };
    const res = await handleAnthropicMessages(makeRequest(body), makeEnv(), body);

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-cache, no-transform");
    expect(res.headers.get("x-accel-buffering")).toBe("no");
    expect(res.headers.get("connection")).toBe("keep-alive");

    const text = await res.text();
    expect(text).toContain("message_start");
    expect(text).toContain("Hello");
  });

  it("forwards upstream 4xx errors to client", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          type: "error",
          error: { type: "invalid_request_error", message: "max_tokens is required" },
        }),
        {
          status: 400,
          headers: {
            "content-type": "application/json",
            "request-id": "req_err_400",
          },
        },
      ),
    );

    const body = {
      model: "claude-sonnet-4-20250514",
      messages: [{ role: "user", content: "hi" }],
    };
    const res = await handleAnthropicMessages(makeRequest(body), makeEnv(), body);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.type).toBe("invalid_request_error");
  });

  it("forwards upstream 5xx errors to client", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          type: "error",
          error: { type: "api_error", message: "Internal server error" },
        }),
        {
          status: 500,
          headers: {
            "content-type": "application/json",
            "request-id": "req_err_500",
          },
        },
      ),
    );

    const body = {
      model: "claude-sonnet-4-20250514",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
    };
    const res = await handleAnthropicMessages(makeRequest(body), makeEnv(), body);

    expect(res.status).toBe(500);
  });

  it("returns 502 when streaming response has no body", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "request-id": "req_no_body",
        },
      }),
    );

    const body = {
      model: "claude-sonnet-4-20250514",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
      stream: true,
    };
    const res = await handleAnthropicMessages(makeRequest(body), makeEnv(), body);

    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).toContain("No response body");
  });

  it("handles non-streaming response with no usage gracefully", async () => {
    const responseWithoutUsage = {
      id: "msg_no_usage",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-4-20250514",
      content: [{ type: "text", text: "Hello!" }],
      stop_reason: "end_turn",
    };

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(responseWithoutUsage), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "request-id": "req_no_usage",
        },
      }),
    );

    const body = {
      model: "claude-sonnet-4-20250514",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
    };
    const res = await handleAnthropicMessages(makeRequest(body), makeEnv(), body);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).not.toHaveProperty("usage");
  });

  it("handles non-streaming response with unparseable body gracefully", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("this is not json at all!", {
        status: 200,
        headers: {
          "content-type": "application/json",
          "request-id": "req_bad_json",
        },
      }),
    );

    const body = {
      model: "claude-sonnet-4-20250514",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
    };
    const res = await handleAnthropicMessages(makeRequest(body), makeEnv(), body);

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe("this is not json at all!");
  });

  it("extracts request-id and forwards as x-request-id", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(ANTHROPIC_NON_STREAMING_RESPONSE), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "request-id": "req_018EeWyXxfu5pfWkrYcMdjWG",
        },
      }),
    );

    const body = {
      model: "claude-sonnet-4-20250514",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
    };
    const res = await handleAnthropicMessages(makeRequest(body), makeEnv(), body);

    expect(res.headers.get("x-request-id")).toBe("req_018EeWyXxfu5pfWkrYcMdjWG");
    await res.text();
  });
});
