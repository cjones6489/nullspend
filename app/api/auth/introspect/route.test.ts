import { afterEach, describe, expect, it, vi } from "vitest";

import { getDevActor } from "@/lib/auth/session";
import { authenticateApiKey } from "@/lib/auth/with-api-key-auth";
import { GET } from "./route";

vi.mock("@/lib/auth/with-api-key-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/with-api-key-auth")>();
  return {
    ...actual,
    authenticateApiKey: vi.fn(),
  };
});

vi.mock("@/lib/auth/session", () => ({
  getDevActor: vi.fn(),
}));

const mockedAuthenticateApiKey = vi.mocked(authenticateApiKey);
const mockedGetDevActor = vi.mocked(getDevActor);

const MOCK_USER_ID = "user-abc-123";
const MOCK_KEY_ID = "550e8400-e29b-41d4-a716-446655440000";

function makeRequest() {
  return new Request("http://localhost/api/auth/introspect", {
    headers: { "x-nullspend-key": "ns_live_sk_test0001" },
  });
}

describe("GET /api/auth/introspect", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("managed key returns userId and keyId", async () => {
    mockedAuthenticateApiKey.mockResolvedValue({ userId: MOCK_USER_ID, orgId: "org-test-1", keyId: MOCK_KEY_ID, apiVersion: "2026-04-01" });

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ userId: `ns_usr_${MOCK_USER_ID}`, keyId: `ns_key_${MOCK_KEY_ID}` });
  });

  it("dev fallback returns dev identity", async () => {
    mockedAuthenticateApiKey.mockResolvedValue({ userId: "dev-user-456", orgId: "org-test-1", keyId: null, apiVersion: "2026-04-01" });
    mockedGetDevActor.mockReturnValue("dev-actor-789");

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      userId: "ns_usr_dev-actor-789",
      keyId: "dev",
      dev: true,
    });
  });

  it("missing API key returns 401", async () => {
    const { ApiKeyError } = await vi.importActual<typeof import("@/lib/auth/api-key")>("@/lib/auth/api-key");
    mockedAuthenticateApiKey.mockRejectedValue(new ApiKeyError());

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error.code).toBe("authentication_required");
    expect(body.error.message).toBe("Invalid or missing API key.");
  });

  it("dev fallback uses devUserId when getDevActor returns undefined", async () => {
    mockedAuthenticateApiKey.mockResolvedValue({ userId: "dev-user-456", orgId: "org-test-1", keyId: null, apiVersion: "2026-04-01" });
    mockedGetDevActor.mockReturnValue(undefined);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.userId).toBe("ns_usr_dev-user-456");
  });

  it("dev fallback throws 401 when dev mode is disabled", async () => {
    const { ApiKeyError } = await vi.importActual<typeof import("@/lib/auth/api-key")>("@/lib/auth/api-key");
    mockedAuthenticateApiKey.mockRejectedValue(
      new ApiKeyError("Managed API keys are required. The NULLSPEND_API_KEY fallback is development-only."),
    );

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error.code).toBe("authentication_required");
    expect(body.error.message).toContain("Managed API keys are required");
  });

  it("returns 429 when per-key rate limit is exceeded", async () => {
    const rateLimitResponse = new Response(
      JSON.stringify({ error: { code: "rate_limit_exceeded", message: "Too many requests", details: null } }),
      { status: 429, headers: { "Content-Type": "application/json" } },
    );
    mockedAuthenticateApiKey.mockResolvedValue(rateLimitResponse);

    const res = await GET(makeRequest());

    expect(res.status).toBe(429);
  });
});
