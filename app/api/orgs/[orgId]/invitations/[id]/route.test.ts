import { afterEach, describe, expect, it, vi } from "vitest";

import { ForbiddenError } from "@/lib/auth/errors";
import { DELETE } from "./route";

const ORG_UUID = "00000000-0000-4000-a000-000000000001";
const ORG_ID = `ns_org_${ORG_UUID}`;
const INV_ID = "aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee";

vi.mock("@/lib/auth/session", () => ({
  resolveSessionContext: vi.fn().mockResolvedValue({ userId: "user-1", orgId: "org-test-1", role: "owner" }),
}));

vi.mock("@/lib/observability/sentry", () => ({
  captureExceptionWithContext: vi.fn(),
}));

const mockAssertOrgRole = vi.fn().mockResolvedValue({ userId: "user-1", orgId: ORG_UUID, role: "admin" });

vi.mock("@/lib/auth/org-authorization", () => ({
  assertOrgRole: (...args: unknown[]) => mockAssertOrgRole(...args),
}));

const mockSelectLimit = vi.fn();
const mockUpdateWhere = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(() => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: mockSelectLimit,
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: mockUpdateWhere,
      }),
    }),
  })),
}));

vi.mock("@/lib/utils/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils/http")>();
  return {
    ...actual,
    readRouteParams: vi.fn(async (p: unknown) => p),
  };
});

function makeContext(orgId: string, id: string) {
  return { params: Promise.resolve({ orgId, id }) };
}

describe("DELETE /api/orgs/[orgId]/invitations/[id]", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("revokes a pending invitation — 200", async () => {
    mockSelectLimit.mockResolvedValue([{ status: "pending" }]);

    const req = new Request("http://localhost/api/orgs/" + ORG_ID + "/invitations/" + INV_ID, { method: "DELETE" });
    const res = await DELETE(req, makeContext(ORG_ID, INV_ID));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(mockUpdateWhere).toHaveBeenCalled();
    expect(mockAssertOrgRole).toHaveBeenCalledWith("user-1", ORG_UUID, "admin");
  });

  it("returns 404 when invitation not found", async () => {
    mockSelectLimit.mockResolvedValue([]);

    const req = new Request("http://localhost/api/orgs/" + ORG_ID + "/invitations/" + INV_ID, { method: "DELETE" });
    const res = await DELETE(req, makeContext(ORG_ID, INV_ID));

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("not_found");
  });

  it("returns 409 when invitation is already accepted", async () => {
    mockSelectLimit.mockResolvedValue([{ status: "accepted" }]);

    const req = new Request("http://localhost/api/orgs/" + ORG_ID + "/invitations/" + INV_ID, { method: "DELETE" });
    const res = await DELETE(req, makeContext(ORG_ID, INV_ID));

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("conflict");
    expect(body.error.message).toContain("accepted");
  });

  it("returns 409 when invitation is already revoked", async () => {
    mockSelectLimit.mockResolvedValue([{ status: "revoked" }]);

    const req = new Request("http://localhost/api/orgs/" + ORG_ID + "/invitations/" + INV_ID, { method: "DELETE" });
    const res = await DELETE(req, makeContext(ORG_ID, INV_ID));

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("conflict");
    expect(body.error.message).toContain("revoked");
  });

  it("returns 403 for non-admin", async () => {
    mockAssertOrgRole.mockRejectedValueOnce(new ForbiddenError("This action requires the admin role or higher."));

    const req = new Request("http://localhost/api/orgs/" + ORG_ID + "/invitations/" + INV_ID, { method: "DELETE" });
    const res = await DELETE(req, makeContext(ORG_ID, INV_ID));

    expect(res.status).toBe(403);
  });
});
