import { describe, it, expect } from "vitest";
import {
  buildUpstreamHeaders,
  buildClientHeaders,
  buildFailoverHeaders,
} from "../lib/headers.js";

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request("https://proxy.example.com/v1/chat/completions", {
    method: "POST",
    headers,
    body: "{}",
  });
}

function makeResponse(
  status: number,
  headers: Record<string, string> = {},
): Response {
  return new Response(null, { status, headers });
}

describe("buildUpstreamHeaders edge cases", () => {
  it("always sets content-type: application/json even when client omits it", () => {
    const req = makeRequest({ authorization: "Bearer sk-test" });
    const headers = buildUpstreamHeaders(req);

    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("authorization")).toBe("Bearer sk-test");
  });

  it("overrides client content-type to application/json", () => {
    const req = makeRequest({
      authorization: "Bearer sk-test",
      "content-type": "text/plain",
    });
    const headers = buildUpstreamHeaders(req);

    expect(headers.get("content-type")).toBe("application/json");
  });

  it("returns minimal headers when no auth or org headers present", () => {
    const req = makeRequest({});
    const headers = buildUpstreamHeaders(req);

    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("openai-organization")).toBeNull();
    expect(headers.get("openai-project")).toBeNull();
  });

  it("forwards openai-organization and openai-project when present", () => {
    const req = makeRequest({
      authorization: "Bearer sk-test",
      "openai-organization": "org-123",
      "openai-project": "proj-456",
    });
    const headers = buildUpstreamHeaders(req);

    expect(headers.get("openai-organization")).toBe("org-123");
    expect(headers.get("openai-project")).toBe("proj-456");
  });

  it("does NOT forward x-agentseam-auth to upstream", () => {
    const req = makeRequest({
      authorization: "Bearer sk-test",
      "x-agentseam-auth": "platform-secret",
    });
    const headers = buildUpstreamHeaders(req);

    expect(headers.get("x-agentseam-auth")).toBeNull();
  });

  it("does NOT forward host or content-length", () => {
    const req = makeRequest({
      authorization: "Bearer sk-test",
      host: "proxy.example.com",
      "content-length": "42",
    });
    const headers = buildUpstreamHeaders(req);

    expect(headers.get("host")).toBeNull();
    expect(headers.get("content-length")).toBeNull();
  });
});

describe("buildClientHeaders edge cases", () => {
  it("forwards retry-after header when present (rate limiting)", () => {
    const res = makeResponse(429, {
      "content-type": "application/json",
      "retry-after": "30",
      "x-ratelimit-remaining-requests": "0",
      "x-ratelimit-reset-requests": "30s",
    });
    const headers = buildClientHeaders(res);

    expect(headers.get("retry-after")).toBe("30");
    expect(headers.get("x-ratelimit-remaining-requests")).toBe("0");
  });

  it("does NOT include retry-after when not present", () => {
    const res = makeResponse(200, {
      "content-type": "application/json",
      "x-request-id": "req-abc",
    });
    const headers = buildClientHeaders(res);

    expect(headers.get("retry-after")).toBeNull();
  });

  it("forwards all x-ratelimit-* headers", () => {
    const res = makeResponse(200, {
      "content-type": "text/event-stream",
      "x-ratelimit-limit-requests": "500",
      "x-ratelimit-limit-tokens": "30000",
      "x-ratelimit-remaining-requests": "499",
      "x-ratelimit-remaining-tokens": "29000",
      "x-ratelimit-reset-requests": "20ms",
      "x-ratelimit-reset-tokens": "100ms",
    });
    const headers = buildClientHeaders(res);

    expect(headers.get("x-ratelimit-limit-requests")).toBe("500");
    expect(headers.get("x-ratelimit-limit-tokens")).toBe("30000");
    expect(headers.get("x-ratelimit-remaining-requests")).toBe("499");
    expect(headers.get("x-ratelimit-remaining-tokens")).toBe("29000");
    expect(headers.get("x-ratelimit-reset-requests")).toBe("20ms");
    expect(headers.get("x-ratelimit-reset-tokens")).toBe("100ms");
  });

  it("does NOT forward server, date, or other non-allow-listed headers", () => {
    const res = makeResponse(200, {
      "content-type": "application/json",
      server: "cloudflare",
      date: "Sat, 07 Mar 2026 00:00:00 GMT",
      "cf-ray": "abc123",
      "set-cookie": "session=xyz",
    });
    const headers = buildClientHeaders(res);

    expect(headers.get("server")).toBeNull();
    expect(headers.get("date")).toBeNull();
    expect(headers.get("cf-ray")).toBeNull();
    expect(headers.get("set-cookie")).toBeNull();
  });

  it("forwards content-type and x-request-id", () => {
    const res = makeResponse(200, {
      "content-type": "text/event-stream",
      "x-request-id": "req-xyz-123",
    });
    const headers = buildClientHeaders(res);

    expect(headers.get("content-type")).toBe("text/event-stream");
    expect(headers.get("x-request-id")).toBe("req-xyz-123");
  });

  it("handles response with no headers gracefully", () => {
    const res = makeResponse(200, {});
    const headers = buildClientHeaders(res);

    expect(headers.get("content-type")).toBeNull();
    expect(headers.get("x-request-id")).toBeNull();
  });
});

describe("buildFailoverHeaders edge cases", () => {
  it("strips x-agentseam-auth from failover request", () => {
    const req = makeRequest({
      authorization: "Bearer sk-test",
      "x-agentseam-auth": "platform-secret",
      "content-type": "application/json",
    });
    const headers = buildFailoverHeaders(req);

    expect(headers.get("x-agentseam-auth")).toBeNull();
    expect(headers.get("authorization")).toBe("Bearer sk-test");
    expect(headers.get("content-type")).toBe("application/json");
  });

  it("strips host header from failover request", () => {
    const req = makeRequest({
      authorization: "Bearer sk-test",
      host: "proxy.local:8787",
    });
    const headers = buildFailoverHeaders(req);

    expect(headers.get("host")).toBeNull();
  });

  it("strips content-length from failover request", () => {
    const req = makeRequest({
      authorization: "Bearer sk-test",
      "content-length": "256",
    });
    const headers = buildFailoverHeaders(req);

    expect(headers.get("content-length")).toBeNull();
  });

  it("preserves all other headers in failover (user-agent, accept, etc.)", () => {
    const req = makeRequest({
      authorization: "Bearer sk-test",
      "user-agent": "my-app/1.0",
      accept: "application/json",
      "x-custom-header": "custom-value",
    });
    const headers = buildFailoverHeaders(req);

    expect(headers.get("user-agent")).toBe("my-app/1.0");
    expect(headers.get("accept")).toBe("application/json");
    expect(headers.get("x-custom-header")).toBe("custom-value");
  });

  it("handles case-insensitive stripping (X-AgentSeam-Auth vs x-agentseam-auth)", () => {
    const req = new Request("https://proxy.example.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer sk-test",
        "X-AgentSeam-Auth": "platform-secret",
        Host: "proxy.local",
      },
      body: "{}",
    });
    const headers = buildFailoverHeaders(req);

    expect(headers.get("x-agentseam-auth")).toBeNull();
    expect(headers.get("authorization")).toBe("Bearer sk-test");
  });
});
