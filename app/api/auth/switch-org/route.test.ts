import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveSessionContext, setActiveOrgCookie } from "@/lib/auth/session";
import { assertOrgMember } from "@/lib/auth/org-authorization";
import { readJsonBody } from "@/lib/utils/http";
import { ForbiddenError } from "@/lib/auth/errors";
import { POST } from "./route";

vi.mock("@/lib/auth/session", () => ({
  resolveSessionContext: vi.fn(),
  setActiveOrgCookie: vi.fn(),
}));

vi.mock("@/lib/auth/org-authorization", () => ({
  assertOrgMember: vi.fn(),
}));

vi.mock("@/lib/observability/sentry", () => ({
  captureExceptionWithContext: vi.fn(),
  addSentryBreadcrumb: vi.fn(),
}));

vi.mock("@/lib/utils/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils/http")>();
  return {
    ...actual,
    readJsonBody: vi.fn(),
  };
});

const mockedResolveSessionContext = vi.mocked(resolveSessionContext);
const mockedAssertOrgMember = vi.mocked(assertOrgMember);
const mockedReadJsonBody = vi.mocked(readJsonBody);
const mockedSetActiveOrgCookie = vi.mocked(setActiveOrgCookie);

const VALID_ORG_ID = "a0000000-0000-4000-a000-000000000001";

describe("POST /api/auth/switch-org", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 with userId, orgId, role when switching to a valid org", async () => {
    mockedResolveSessionContext.mockResolvedValue({
      userId: "user-1",
      orgId: "old-org-id",
      role: "member",
    });
    mockedReadJsonBody.mockResolvedValue({ orgId: VALID_ORG_ID });
    mockedAssertOrgMember.mockResolvedValue({
      userId: "user-1",
      orgId: VALID_ORG_ID,
      role: "admin",
    });
    mockedSetActiveOrgCookie.mockResolvedValue(undefined);

    const req = new Request("http://localhost/api/auth/switch-org", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      userId: "user-1",
      orgId: VALID_ORG_ID,
      role: "admin",
    });

    expect(mockedAssertOrgMember).toHaveBeenCalledWith("user-1", VALID_ORG_ID);
    expect(mockedSetActiveOrgCookie).toHaveBeenCalledWith(VALID_ORG_ID, "admin");
  });

  it("returns 403 when user is not a member of target org", async () => {
    mockedResolveSessionContext.mockResolvedValue({
      userId: "user-1",
      orgId: "old-org-id",
      role: "member",
    });
    mockedReadJsonBody.mockResolvedValue({ orgId: VALID_ORG_ID });
    mockedAssertOrgMember.mockRejectedValue(
      new ForbiddenError("You are not a member of this organization."),
    );

    const req = new Request("http://localhost/api/auth/switch-org", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("forbidden");
  });

  it("returns 400 for invalid orgId (not a UUID)", async () => {
    mockedResolveSessionContext.mockResolvedValue({
      userId: "user-1",
      orgId: "old-org-id",
      role: "member",
    });
    mockedReadJsonBody.mockResolvedValue({ orgId: "not-a-uuid" });

    const req = new Request("http://localhost/api/auth/switch-org", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("validation_error");
  });

  it("returns 400 for missing orgId in body", async () => {
    mockedResolveSessionContext.mockResolvedValue({
      userId: "user-1",
      orgId: "old-org-id",
      role: "member",
    });
    mockedReadJsonBody.mockResolvedValue({});

    const req = new Request("http://localhost/api/auth/switch-org", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("validation_error");
  });
});
