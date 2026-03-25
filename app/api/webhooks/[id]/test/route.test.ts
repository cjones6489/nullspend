import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveSessionContext } from "@/lib/auth/session";
import { POST } from "./route";

vi.mock("@/lib/auth/session", () => ({
  resolveSessionContext: vi.fn(),
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

const mockedResolveSessionContext = vi.mocked(resolveSessionContext);

const VALID_UUID = "00000000-0000-4000-a000-000000000001";
const VALID_ID = `ns_wh_${VALID_UUID}`;

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
    mockedResolveSessionContext.mockResolvedValue({ userId: "user-1", orgId: "org-test-1", role: "owner" as const });
    mockSelectEndpoint.mockResolvedValue([
      {
        id: VALID_UUID,
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
          "X-NullSpend-Webhook-Id": expect.stringContaining("evt_"),
          "User-Agent": "NullSpend-Webhooks/1.0",
        }),
      }),
    );

    // Verify event body uses builder shape (test.ping with new envelope)
    const sentBody = JSON.parse(mockFetch.mock.calls[0][1]!.body as string);
    expect(sentBody.type).toBe("test.ping");
    expect(sentBody.api_version).toBe("2026-04-01");
    expect(typeof sentBody.created_at).toBe("number");
    expect(sentBody.data.object.message).toBe("Test webhook event");
  });

  it("returns 404 for non-owned endpoint", async () => {
    mockedResolveSessionContext.mockResolvedValue({ userId: "user-1", orgId: "org-test-1", role: "owner" as const });
    mockSelectEndpoint.mockResolvedValue([]);

    const req = new Request("http://localhost/api/webhooks/" + VALID_ID + "/test", {
      method: "POST",
    });

    const res = await POST(req, makeContext(VALID_ID));

    expect(res.status).toBe(404);
  });

  it("returns success=false when target URL is unreachable", async () => {
    mockedResolveSessionContext.mockResolvedValue({ userId: "user-1", orgId: "org-test-1", role: "owner" as const });
    mockSelectEndpoint.mockResolvedValue([
      {
        id: VALID_UUID,
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
    mockedResolveSessionContext.mockResolvedValue({ userId: "user-1", orgId: "org-test-1", role: "owner" as const });
    mockSelectEndpoint.mockResolvedValue([
      {
        id: VALID_UUID,
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
