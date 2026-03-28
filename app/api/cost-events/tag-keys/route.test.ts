import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveSessionContext } from "@/lib/auth/session";
import { getDistinctTagKeys } from "@/lib/cost-events/aggregate-cost-events";
import { GET } from "./route";

vi.mock("@/lib/auth/session", () => ({
  resolveSessionContext: vi.fn().mockResolvedValue({ userId: "user-1", orgId: "org-test-1", role: "owner" }),
}));

vi.mock("@/lib/auth/org-authorization", () => ({
  assertOrgRole: vi.fn().mockResolvedValue({ userId: "user-1", orgId: "org-test-1", role: "owner" }),
  assertOrgMember: vi.fn().mockResolvedValue({ userId: "user-1", orgId: "org-test-1", role: "owner" }),
}));

vi.mock("@/lib/cost-events/aggregate-cost-events", () => ({
  getDistinctTagKeys: vi.fn(),
}));

const mockedResolveSessionContext = vi.mocked(resolveSessionContext);
const mockedGetDistinctTagKeys = vi.mocked(getDistinctTagKeys);

const MOCK_USER_ID = "user-abc-123";
const MOCK_ORG_ID = "org-mock-1";

describe("GET /api/cost-events/tag-keys", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("returns 200 with array of tag key strings", async () => {
    mockedResolveSessionContext.mockResolvedValue({ userId: MOCK_USER_ID, orgId: MOCK_ORG_ID, role: "owner" });
    mockedGetDistinctTagKeys.mockResolvedValue(["customer_id", "project", "environment"]);

    const res = await GET();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual(["customer_id", "project", "environment"]);
  });

  it("returns empty array when no tag keys exist", async () => {
    mockedResolveSessionContext.mockResolvedValue({ userId: MOCK_USER_ID, orgId: MOCK_ORG_ID, role: "owner" });
    mockedGetDistinctTagKeys.mockResolvedValue([]);

    const res = await GET();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([]);
  });

  it("returns 401 when session is invalid", async () => {
    const { AuthenticationRequiredError } = await import("@/lib/auth/errors");
    mockedResolveSessionContext.mockRejectedValue(new AuthenticationRequiredError());

    const res = await GET();

    expect(res.status).toBe(401);
  });

  it("returns 500 when query throws", async () => {
    mockedResolveSessionContext.mockResolvedValue({ userId: MOCK_USER_ID, orgId: MOCK_ORG_ID, role: "owner" });
    mockedGetDistinctTagKeys.mockRejectedValue(new Error("DB connection error"));

    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await GET();

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("internal_error");
  });

  it("wraps response in { data: [...] }", async () => {
    mockedResolveSessionContext.mockResolvedValue({ userId: MOCK_USER_ID, orgId: MOCK_ORG_ID, role: "owner" });
    mockedGetDistinctTagKeys.mockResolvedValue(["team"]);

    const res = await GET();

    const body = await res.json();
    expect(body).toHaveProperty("data");
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("passes correct orgId to getDistinctTagKeys", async () => {
    const customOrgId = "org-custom-xyz";
    mockedResolveSessionContext.mockResolvedValue({ userId: "u-1", orgId: customOrgId, role: "owner" });
    mockedGetDistinctTagKeys.mockResolvedValue([]);

    await GET();

    expect(mockedGetDistinctTagKeys).toHaveBeenCalledWith(customOrgId);
  });
});
