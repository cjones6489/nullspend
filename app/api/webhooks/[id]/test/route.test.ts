import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveSessionUserId } from "@/lib/auth/session";
import { POST } from "./route";

vi.mock("@/lib/auth/session", () => ({
  resolveSessionUserId: vi.fn(),
}));

const mockSelectEndpoint = vi.fn();

vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(() => ({
    select: () => ({
      from: () => ({
        where: mockSelectEndpoint,
      }),
    }),
  })),
}));

vi.mock("@/lib/webhooks/signer", () => ({
  signPayload: vi.fn().mockReturnValue("t=1000,v1=abc123"),
}));

const mockedResolveSessionUserId = vi.mocked(resolveSessionUserId);

const VALID_ID = "00000000-0000-4000-a000-000000000001";

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

const originalFetch = globalThis.fetch;

describe("POST /api/webhooks/:id/test", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.resetAllMocks();
  });

  it("sends a test webhook and returns success", async () => {
    mockedResolveSessionUserId.mockResolvedValue("user-1");
    mockSelectEndpoint.mockResolvedValue([
      {
        id: VALID_ID,
        url: "https://hooks.example.com/test",
        signingSecret: "whsec_testsecret",
      },
    ]);

    const mockFetch = vi.fn().mockResolvedValue(
      new Response("OK", { status: 200 }),
    );
    globalThis.fetch = mockFetch;

    const req = new Request("http://localhost/api/webhooks/" + VALID_ID + "/test", {
      method: "POST",
    });

    const res = await POST(req, makeContext(VALID_ID));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.statusCode).toBe(200);

    expect(mockFetch).toHaveBeenCalledWith(
      "https://hooks.example.com/test",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "X-NullSpend-Signature": expect.any(String),
          "X-NullSpend-Webhook-Id": expect.stringContaining("evt_test_"),
          "User-Agent": "NullSpend-Webhooks/1.0",
        }),
      }),
    );
  });

  it("returns 404 for non-owned endpoint", async () => {
    mockedResolveSessionUserId.mockResolvedValue("user-1");
    mockSelectEndpoint.mockResolvedValue([]);

    const req = new Request("http://localhost/api/webhooks/" + VALID_ID + "/test", {
      method: "POST",
    });

    const res = await POST(req, makeContext(VALID_ID));

    expect(res.status).toBe(404);
  });

  it("returns success=false when target URL is unreachable", async () => {
    mockedResolveSessionUserId.mockResolvedValue("user-1");
    mockSelectEndpoint.mockResolvedValue([
      {
        id: VALID_ID,
        url: "https://unreachable.example.com/hook",
        signingSecret: "whsec_testsecret",
      },
    ]);

    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    const req = new Request("http://localhost/api/webhooks/" + VALID_ID + "/test", {
      method: "POST",
    });

    const res = await POST(req, makeContext(VALID_ID));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.statusCode).toBeNull();
    expect(body.responsePreview).toContain("ECONNREFUSED");
  });

  it("returns success=false for non-2xx response", async () => {
    mockedResolveSessionUserId.mockResolvedValue("user-1");
    mockSelectEndpoint.mockResolvedValue([
      {
        id: VALID_ID,
        url: "https://hooks.example.com/broken",
        signingSecret: "whsec_testsecret",
      },
    ]);

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("Bad Request", { status: 400 }),
    );

    const req = new Request("http://localhost/api/webhooks/" + VALID_ID + "/test", {
      method: "POST",
    });

    const res = await POST(req, makeContext(VALID_ID));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.statusCode).toBe(400);
  });
});
