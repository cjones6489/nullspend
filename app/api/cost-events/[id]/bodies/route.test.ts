import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthenticationRequiredError } from "@/lib/auth/errors";
import { resolveSessionContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { GET } from "./route";

vi.mock("@/lib/auth/session", () => ({
  resolveSessionContext: vi.fn().mockResolvedValue({ userId: "user-1", orgId: "org-test-1", role: "owner" }),
}));

vi.mock("@/lib/auth/org-authorization", () => ({
  assertOrgRole: vi.fn().mockResolvedValue({ userId: "user-1", orgId: "org-test-1", role: "owner" }),
  assertOrgMember: vi.fn().mockResolvedValue({ userId: "user-1", orgId: "org-test-1", role: "owner" }),
}));

vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(),
}));

vi.mock("@/lib/observability/sentry", () => ({
  captureExceptionWithContext: vi.fn(),
  addSentryBreadcrumb: vi.fn(),
}));

vi.mock("@/lib/observability", () => ({
  getLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
}));

const mockedResolveSessionContext = vi.mocked(resolveSessionContext);
const mockedGetDb = vi.mocked(getDb);

const VALID_UUID = "a0000000-0000-4000-a000-000000000001";
const PREFIXED_ID = `ns_evt_${VALID_UUID}`;
const REQUEST_ID = "chatcmpl-abc123";

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makeRequest() {
  return new Request("http://localhost:3000/api/cost-events/" + VALID_UUID + "/bodies");
}

describe("GET /api/cost-events/[id]/bodies", () => {
  let mockSelect: ReturnType<typeof vi.fn>;
  let mockFrom: ReturnType<typeof vi.fn>;
  let mockWhere: ReturnType<typeof vi.fn>;
  let mockLimit: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockLimit = vi.fn();
    mockWhere = vi.fn(() => ({ limit: mockLimit }));
    mockFrom = vi.fn(() => ({ where: mockWhere }));
    mockSelect = vi.fn(() => ({ from: mockFrom }));
    mockedGetDb.mockReturnValue({ select: mockSelect } as unknown as ReturnType<typeof getDb>);

    // Default: no PROXY_INTERNAL_URL configured (local dev)
    delete process.env.PROXY_INTERNAL_URL;
    delete process.env.PROXY_INTERNAL_SECRET;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.PROXY_INTERNAL_URL;
    delete process.env.PROXY_INTERNAL_SECRET;
  });

  it("returns 401 when unauthenticated", async () => {
    mockedResolveSessionContext.mockRejectedValue(new AuthenticationRequiredError());

    const res = await GET(makeRequest(), makeContext(VALID_UUID));
    expect(res.status).toBe(401);

    const json = await res.json();
    expect(json.error.code).toBe("authentication_required");
  });

  it("returns 400 for invalid ID format", async () => {
    mockedResolveSessionContext.mockResolvedValue({ userId: "user-1", orgId: "org-test-1", role: "owner" });

    const res = await GET(makeRequest(), makeContext("not-a-uuid"));
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error.code).toBe("validation_error");
  });

  it("returns 404 when cost event not found", async () => {
    mockedResolveSessionContext.mockResolvedValue({ userId: "user-1", orgId: "org-test-1", role: "owner" });
    mockLimit.mockResolvedValue([]);

    const res = await GET(makeRequest(), makeContext(VALID_UUID));
    expect(res.status).toBe(404);

    const json = await res.json();
    expect(json.error.code).toBe("not_found");
  });

  it("returns 404 when cost event has null requestId", async () => {
    mockedResolveSessionContext.mockResolvedValue({ userId: "user-1", orgId: "org-test-1", role: "owner" });
    mockLimit.mockResolvedValue([{ requestId: null }]);

    const res = await GET(makeRequest(), makeContext(VALID_UUID));
    expect(res.status).toBe(404);
  });

  it("returns empty bodies when PROXY_INTERNAL_URL is not configured", async () => {
    mockedResolveSessionContext.mockResolvedValue({ userId: "user-1", orgId: "org-test-1", role: "owner" });
    mockLimit.mockResolvedValue([{ requestId: REQUEST_ID }]);

    const res = await GET(makeRequest(), makeContext(VALID_UUID));
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.data).toEqual({ requestBody: null, responseBody: null });
  });

  it("accepts ns_evt_ prefixed ID", async () => {
    mockedResolveSessionContext.mockResolvedValue({ userId: "user-1", orgId: "org-test-1", role: "owner" });
    mockLimit.mockResolvedValue([{ requestId: REQUEST_ID }]);

    const res = await GET(makeRequest(), makeContext(PREFIXED_ID));
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.data).toEqual({ requestBody: null, responseBody: null });
  });

  it("fetches bodies from proxy when PROXY_INTERNAL_URL is configured", async () => {
    mockedResolveSessionContext.mockResolvedValue({ userId: "user-1", orgId: "org-test-1", role: "owner" });
    mockLimit.mockResolvedValue([{ requestId: REQUEST_ID }]);

    process.env.PROXY_INTERNAL_URL = "https://proxy.test";
    process.env.PROXY_INTERNAL_SECRET = "secret-123";

    const mockFetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({
        requestBody: { model: "gpt-4o" },
        responseBody: { choices: [] },
      }), { status: 200 }),
    );

    const res = await GET(makeRequest(), makeContext(VALID_UUID));
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.data.requestBody).toEqual({ model: "gpt-4o" });
    expect(json.data.responseBody).toEqual({ choices: [] });

    // Verify fetch was called with correct URL and auth
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining(`/internal/request-bodies/${REQUEST_ID}?ownerId=org-test-1`),
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ Authorization: "Bearer secret-123" }),
      }),
    );

    mockFetch.mockRestore();
  });

  it("returns empty bodies when proxy returns non-2xx", async () => {
    mockedResolveSessionContext.mockResolvedValue({ userId: "user-1", orgId: "org-test-1", role: "owner" });
    mockLimit.mockResolvedValue([{ requestId: REQUEST_ID }]);

    process.env.PROXY_INTERNAL_URL = "https://proxy.test";
    process.env.PROXY_INTERNAL_SECRET = "secret-123";

    const mockFetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Internal Server Error", { status: 500 }),
    );

    const res = await GET(makeRequest(), makeContext(VALID_UUID));
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.data).toEqual({ requestBody: null, responseBody: null });

    mockFetch.mockRestore();
  });

  it("returns empty bodies when proxy fetch times out", async () => {
    mockedResolveSessionContext.mockResolvedValue({ userId: "user-1", orgId: "org-test-1", role: "owner" });
    mockLimit.mockResolvedValue([{ requestId: REQUEST_ID }]);

    process.env.PROXY_INTERNAL_URL = "https://proxy.test";
    process.env.PROXY_INTERNAL_SECRET = "secret-123";

    const mockFetch = vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      new Error("AbortError: signal timed out"),
    );

    const res = await GET(makeRequest(), makeContext(VALID_UUID));
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.data).toEqual({ requestBody: null, responseBody: null });

    mockFetch.mockRestore();
  });
});
