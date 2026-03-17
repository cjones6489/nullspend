import { afterEach, describe, expect, it, vi } from "vitest";

import { checkHasBudgets } from "@/lib/auth/check-has-budgets";
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

vi.mock("@/lib/auth/check-has-budgets", () => ({
  checkHasBudgets: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getDevActor: vi.fn(),
}));

const mockedAuthenticateApiKey = vi.mocked(authenticateApiKey);
const mockedCheckHasBudgets = vi.mocked(checkHasBudgets);
const mockedGetDevActor = vi.mocked(getDevActor);

const MOCK_USER_ID = "user-abc-123";
const MOCK_KEY_ID = "550e8400-e29b-41d4-a716-446655440000";

function makeRequest() {
  return new Request("http://localhost/api/auth/introspect", {
    headers: { "x-nullspend-key": "ask_test123" },
  });
}

describe("GET /api/auth/introspect", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("managed key returns hasBudgets: true when budgets exist", async () => {
    mockedAuthenticateApiKey.mockResolvedValue({ userId: MOCK_USER_ID, keyId: MOCK_KEY_ID });
    mockedCheckHasBudgets.mockResolvedValue(true);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ userId: MOCK_USER_ID, keyId: MOCK_KEY_ID, hasBudgets: true });
    expect(mockedCheckHasBudgets).toHaveBeenCalledWith(MOCK_USER_ID, MOCK_KEY_ID);
  });

  it("managed key returns hasBudgets: false when no budgets", async () => {
    mockedAuthenticateApiKey.mockResolvedValue({ userId: MOCK_USER_ID, keyId: MOCK_KEY_ID });
    mockedCheckHasBudgets.mockResolvedValue(false);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ userId: MOCK_USER_ID, keyId: MOCK_KEY_ID, hasBudgets: false });
    expect(mockedCheckHasBudgets).toHaveBeenCalledWith(MOCK_USER_ID, MOCK_KEY_ID);
  });

  it("dev fallback returns hasBudgets field", async () => {
    mockedAuthenticateApiKey.mockResolvedValue({ userId: "dev-user-456", keyId: null });
    mockedGetDevActor.mockReturnValue("dev-actor-789");
    mockedCheckHasBudgets.mockResolvedValue(false);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      userId: "dev-actor-789",
      keyId: "dev",
      dev: true,
      hasBudgets: false,
    });
    expect(mockedCheckHasBudgets).toHaveBeenCalledWith("dev-actor-789");
  });

  it("missing API key returns 401", async () => {
    const { ApiKeyError } = await vi.importActual<typeof import("@/lib/auth/api-key")>("@/lib/auth/api-key");
    mockedAuthenticateApiKey.mockRejectedValue(new ApiKeyError());

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toBe("Invalid or missing API key.");
  });

  it("DB error during budget check returns 500", async () => {
    mockedAuthenticateApiKey.mockResolvedValue({ userId: MOCK_USER_ID, keyId: MOCK_KEY_ID });
    mockedCheckHasBudgets.mockRejectedValue(new Error("connection refused"));

    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe("Internal server error.");
  });

  it("dev fallback uses devUserId when getDevActor returns undefined", async () => {
    mockedAuthenticateApiKey.mockResolvedValue({ userId: "dev-user-456", keyId: null });
    mockedGetDevActor.mockReturnValue(undefined);
    mockedCheckHasBudgets.mockResolvedValue(true);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.userId).toBe("dev-user-456");
    expect(mockedCheckHasBudgets).toHaveBeenCalledWith("dev-user-456");
  });

  it("dev fallback throws 401 when dev mode is disabled", async () => {
    const { ApiKeyError } = await vi.importActual<typeof import("@/lib/auth/api-key")>("@/lib/auth/api-key");
    mockedAuthenticateApiKey.mockRejectedValue(
      new ApiKeyError("Managed API keys are required. The NULLSPEND_API_KEY fallback is development-only."),
    );

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toContain("Managed API keys are required");
    expect(mockedCheckHasBudgets).not.toHaveBeenCalled();
  });

  it("passes keyId to checkHasBudgets for managed key (checks both user and key budgets)", async () => {
    mockedAuthenticateApiKey.mockResolvedValue({ userId: MOCK_USER_ID, keyId: MOCK_KEY_ID });
    mockedCheckHasBudgets.mockResolvedValue(false);

    await GET(makeRequest());

    expect(mockedCheckHasBudgets).toHaveBeenCalledWith(MOCK_USER_ID, MOCK_KEY_ID);
    expect(mockedCheckHasBudgets).toHaveBeenCalledTimes(1);
  });

  it("returns 429 when per-key rate limit is exceeded", async () => {
    const rateLimitResponse = new Response(
      JSON.stringify({ error: "Too many requests" }),
      { status: 429, headers: { "Content-Type": "application/json" } },
    );
    mockedAuthenticateApiKey.mockResolvedValue(rateLimitResponse);

    const res = await GET(makeRequest());

    expect(res.status).toBe(429);
    expect(mockedCheckHasBudgets).not.toHaveBeenCalled();
  });
});
