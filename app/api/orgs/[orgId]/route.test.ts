import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveSessionContext } from "@/lib/auth/session";
import { ForbiddenError } from "@/lib/auth/errors";
import { GET, PATCH, DELETE } from "./route";

const ORG_UUID = "00000000-0000-4000-a000-000000000001";
const ORG_ID = `ns_org_${ORG_UUID}`;

vi.mock("@/lib/auth/session", () => ({
  resolveSessionContext: vi.fn().mockResolvedValue({ userId: "user-1", orgId: "org-test-1", role: "owner" }),
}));

vi.mock("@/lib/observability/sentry", () => ({
  captureExceptionWithContext: vi.fn(),
}));

const mockAssertOrgMember = vi.fn().mockResolvedValue({ userId: "user-1", orgId: ORG_UUID, role: "owner" });
const mockAssertOrgRole = vi.fn().mockResolvedValue({ userId: "user-1", orgId: ORG_UUID, role: "owner" });

vi.mock("@/lib/auth/org-authorization", () => ({
  assertOrgMember: (...args: unknown[]) => mockAssertOrgMember(...args),
  assertOrgRole: (...args: unknown[]) => mockAssertOrgRole(...args),
}));

const mockSelectResult = vi.fn();
const mockDeleteWhere = vi.fn().mockResolvedValue(undefined);
const mockUpdateReturning = vi.fn();

vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(() => {
    const dbMethods = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: mockSelectResult,
          }),
        }),
      }),
      update: () => ({
        set: () => ({
          where: () => ({
            returning: mockUpdateReturning,
          }),
        }),
      }),
      delete: () => ({
        where: mockDeleteWhere,
      }),
      transaction: vi.fn((cb: (tx: unknown) => Promise<unknown>) => cb(dbMethods)),
    };
    return dbMethods;
  }),
}));

vi.mock("@/lib/utils/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils/http")>();
  return {
    ...actual,
    readJsonBody: vi.fn(),
    readRouteParams: vi.fn(async (p: unknown) => p),
  };
});

import { readJsonBody } from "@/lib/utils/http";

function makeContext(orgId: string) {
  return { params: Promise.resolve({ orgId }) };
}

const NOW = new Date("2026-01-15T00:00:00Z");

const SAMPLE_ORG = {
  id: ORG_UUID,
  name: "Acme Corp",
  slug: "acme-corp",
  isPersonal: false,
  createdAt: NOW,
  updatedAt: NOW,
};

/* ------------------------------------------------------------------ */
/*  GET /api/orgs/[orgId]                                             */
/* ------------------------------------------------------------------ */
describe("GET /api/orgs/[orgId]", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns org details for a member", async () => {
    mockSelectResult.mockResolvedValue([SAMPLE_ORG]);

    const req = new Request("http://localhost/api/orgs/" + ORG_ID);
    const res = await GET(req, makeContext(ORG_ID));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe(ORG_ID);
    expect(body.data.name).toBe("Acme Corp");
    expect(body.data.slug).toBe("acme-corp");
    expect(body.data.isPersonal).toBe(false);
    expect(mockAssertOrgMember).toHaveBeenCalledWith("user-1", ORG_UUID);
  });

  it("returns 403 for non-member", async () => {
    mockAssertOrgMember.mockRejectedValueOnce(new ForbiddenError("You are not a member of this organization."));

    const req = new Request("http://localhost/api/orgs/" + ORG_ID);
    const res = await GET(req, makeContext(ORG_ID));

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("forbidden");
  });

  it("returns 404 when org does not exist", async () => {
    mockSelectResult.mockResolvedValue([]);

    const req = new Request("http://localhost/api/orgs/" + ORG_ID);
    const res = await GET(req, makeContext(ORG_ID));

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("not_found");
  });

  it("returns 401 when session is invalid", async () => {
    const { AuthenticationRequiredError } = await import("@/lib/auth/errors");
    vi.mocked(resolveSessionContext).mockRejectedValueOnce(new AuthenticationRequiredError());

    const req = new Request("http://localhost/api/orgs/" + ORG_ID);
    const res = await GET(req, makeContext(ORG_ID));

    expect(res.status).toBe(401);
  });
});

/* ------------------------------------------------------------------ */
/*  PATCH /api/orgs/[orgId]                                           */
/* ------------------------------------------------------------------ */
describe("PATCH /api/orgs/[orgId]", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("updates name and slug for admin", async () => {
    vi.mocked(readJsonBody).mockResolvedValue({ name: "New Name", slug: "new-slug" });
    mockSelectResult.mockResolvedValue([{ isPersonal: false }]);
    mockUpdateReturning.mockResolvedValue([
      { ...SAMPLE_ORG, name: "New Name", slug: "new-slug", updatedAt: new Date("2026-01-16T00:00:00Z") },
    ]);

    const req = new Request("http://localhost/api/orgs/" + ORG_ID, { method: "PATCH" });
    const res = await PATCH(req, makeContext(ORG_ID));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.name).toBe("New Name");
    expect(body.data.slug).toBe("new-slug");
    expect(mockAssertOrgRole).toHaveBeenCalledWith("user-1", ORG_UUID, "admin");
  });

  it("returns 403 for viewer (insufficient role)", async () => {
    mockAssertOrgRole.mockRejectedValueOnce(new ForbiddenError("This action requires the admin role or higher."));

    vi.mocked(readJsonBody).mockResolvedValue({ name: "New Name" });

    const req = new Request("http://localhost/api/orgs/" + ORG_ID, { method: "PATCH" });
    const res = await PATCH(req, makeContext(ORG_ID));

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("forbidden");
  });

  it("returns 403 for member (insufficient role)", async () => {
    mockAssertOrgRole.mockRejectedValueOnce(new ForbiddenError("This action requires the admin role or higher."));

    vi.mocked(readJsonBody).mockResolvedValue({ name: "New Name" });

    const req = new Request("http://localhost/api/orgs/" + ORG_ID, { method: "PATCH" });
    const res = await PATCH(req, makeContext(ORG_ID));

    expect(res.status).toBe(403);
  });

  it("prevents renaming personal org", async () => {
    vi.mocked(readJsonBody).mockResolvedValue({ name: "My Personal" });
    mockSelectResult.mockResolvedValue([{ isPersonal: true }]);

    const req = new Request("http://localhost/api/orgs/" + ORG_ID, { method: "PATCH" });
    const res = await PATCH(req, makeContext(ORG_ID));

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("forbidden");
    expect(body.error.message).toContain("Personal organizations cannot be renamed");
  });

  it("returns 400 when no fields to update", async () => {
    vi.mocked(readJsonBody).mockResolvedValue({});

    const req = new Request("http://localhost/api/orgs/" + ORG_ID, { method: "PATCH" });
    const res = await PATCH(req, makeContext(ORG_ID));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("validation_error");
    expect(body.error.message).toContain("No fields to update");
  });
});

/* ------------------------------------------------------------------ */
/*  DELETE /api/orgs/[orgId]                                          */
/* ------------------------------------------------------------------ */
describe("DELETE /api/orgs/[orgId]", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("deletes for owner", async () => {
    mockSelectResult.mockResolvedValue([{ isPersonal: false }]);

    const req = new Request("http://localhost/api/orgs/" + ORG_ID, { method: "DELETE" });
    const res = await DELETE(req, makeContext(ORG_ID));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(mockAssertOrgRole).toHaveBeenCalledWith("user-1", ORG_UUID, "owner");
    expect(mockDeleteWhere).toHaveBeenCalled();
  });

  it("returns 403 for admin (not owner)", async () => {
    mockAssertOrgRole.mockRejectedValueOnce(new ForbiddenError("This action requires the owner role or higher."));

    const req = new Request("http://localhost/api/orgs/" + ORG_ID, { method: "DELETE" });
    const res = await DELETE(req, makeContext(ORG_ID));

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("forbidden");
  });

  it("returns 403 for member (not owner)", async () => {
    mockAssertOrgRole.mockRejectedValueOnce(new ForbiddenError("This action requires the owner role or higher."));

    const req = new Request("http://localhost/api/orgs/" + ORG_ID, { method: "DELETE" });
    const res = await DELETE(req, makeContext(ORG_ID));

    expect(res.status).toBe(403);
  });

  it("prevents deleting personal org", async () => {
    mockSelectResult.mockResolvedValue([{ isPersonal: true }]);

    const req = new Request("http://localhost/api/orgs/" + ORG_ID, { method: "DELETE" });
    const res = await DELETE(req, makeContext(ORG_ID));

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("forbidden");
    expect(body.error.message).toContain("Personal organizations cannot be deleted");
  });

  it("returns 401 when session is invalid", async () => {
    const { AuthenticationRequiredError } = await import("@/lib/auth/errors");
    vi.mocked(resolveSessionContext).mockRejectedValueOnce(new AuthenticationRequiredError());

    const req = new Request("http://localhost/api/orgs/" + ORG_ID, { method: "DELETE" });
    const res = await DELETE(req, makeContext(ORG_ID));

    expect(res.status).toBe(401);
  });
});
