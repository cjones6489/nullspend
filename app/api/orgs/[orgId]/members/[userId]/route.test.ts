import { afterEach, describe, expect, it, vi } from "vitest";

import { ForbiddenError } from "@/lib/auth/errors";
import { PATCH, DELETE } from "./route";

const ORG_UUID = "00000000-0000-4000-a000-000000000001";
const ORG_ID = `ns_org_${ORG_UUID}`;
const REQUESTER_ID = "user-requester";
const TARGET_ID = "user-target";
const NOW = new Date("2026-01-15T00:00:00Z");

/* ------------------------------------------------------------------ */
/*  Hoisted mocks (available inside vi.mock factories)                 */
/* ------------------------------------------------------------------ */

const {
  mockAssertOrgRole,
  mockSelectLimit,
  mockReturning,
  mockDeleteWhere,
  mockReadJsonBody,
} = vi.hoisted(() => ({
  mockAssertOrgRole: vi.fn(),
  mockSelectLimit: vi.fn(),
  mockReturning: vi.fn(),
  mockDeleteWhere: vi.fn().mockResolvedValue(undefined),
  mockReadJsonBody: vi.fn(),
}));

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

vi.mock("@/lib/auth/session", () => ({
  resolveSessionContext: vi.fn().mockResolvedValue({ userId: "user-requester", orgId: "00000000-0000-4000-a000-000000000001", role: "owner" }),
}));

vi.mock("@/lib/observability/sentry", () => ({
  captureExceptionWithContext: vi.fn(),
}));

vi.mock("@/lib/auth/org-authorization", () => ({
  assertOrgRole: (...args: unknown[]) => mockAssertOrgRole(...args),
  assertOrgMember: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(() => {
    const dbMethods = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: mockSelectLimit,
          }),
        }),
      }),
      update: () => ({
        set: () => ({
          where: () => ({
            returning: mockReturning,
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
    readJsonBody: (...args: unknown[]) => mockReadJsonBody(...args),
    readRouteParams: vi.fn(async (p: unknown) => p),
  };
});

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function makeContext(orgId: string, userId: string) {
  return { params: Promise.resolve({ orgId, userId }) };
}

function makePatchRequest(body: object) {
  return new Request(`http://localhost/api/orgs/${ORG_ID}/members/${TARGET_ID}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeDeleteRequest() {
  return new Request(`http://localhost/api/orgs/${ORG_ID}/members/${TARGET_ID}`, {
    method: "DELETE",
  });
}

/* ================================================================== */
/*  PATCH /api/orgs/[orgId]/members/[userId] — change role            */
/* ================================================================== */
describe("PATCH /api/orgs/[orgId]/members/[userId]", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("admin changes member to viewer — returns updated member with 200", async () => {
    mockAssertOrgRole.mockResolvedValue({ userId: REQUESTER_ID, orgId: ORG_UUID, role: "admin" });
    mockSelectLimit.mockResolvedValue([{ role: "member" }]);
    mockReadJsonBody.mockResolvedValue({ role: "viewer" });
    mockReturning.mockResolvedValue([{ userId: TARGET_ID, role: "viewer", createdAt: NOW }]);

    const res = await PATCH(makePatchRequest({ role: "viewer" }), makeContext(ORG_ID, TARGET_ID));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.userId).toBe(TARGET_ID);
    expect(body.data.role).toBe("viewer");
    expect(body.data.createdAt).toBe(NOW.toISOString());
  });

  it("owner changes member to admin — returns updated member", async () => {
    mockAssertOrgRole.mockResolvedValue({ userId: REQUESTER_ID, orgId: ORG_UUID, role: "owner" });
    mockSelectLimit.mockResolvedValue([{ role: "member" }]);
    mockReadJsonBody.mockResolvedValue({ role: "admin" });
    mockReturning.mockResolvedValue([{ userId: TARGET_ID, role: "admin", createdAt: NOW }]);

    const res = await PATCH(makePatchRequest({ role: "admin" }), makeContext(ORG_ID, TARGET_ID));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.userId).toBe(TARGET_ID);
    expect(body.data.role).toBe("admin");
  });

  it("returns 403 when changing own role (self-modification prevention)", async () => {
    mockAssertOrgRole.mockResolvedValue({ userId: REQUESTER_ID, orgId: ORG_UUID, role: "owner" });
    mockReadJsonBody.mockResolvedValue({ role: "member" });

    const res = await PATCH(
      makePatchRequest({ role: "member" }),
      makeContext(ORG_ID, REQUESTER_ID), // target === requester
    );

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("forbidden");
    expect(body.error.message).toContain("your own role");
  });

  it("returns 403 when trying to change the owner's role", async () => {
    mockAssertOrgRole.mockResolvedValue({ userId: REQUESTER_ID, orgId: ORG_UUID, role: "admin" });
    mockSelectLimit.mockResolvedValue([{ role: "owner" }]);
    mockReadJsonBody.mockResolvedValue({ role: "member" });

    const res = await PATCH(makePatchRequest({ role: "member" }), makeContext(ORG_ID, TARGET_ID));

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("forbidden");
    expect(body.error.message).toContain("owner");
  });

  it("returns 403 when admin tries to change another admin's role", async () => {
    mockAssertOrgRole.mockResolvedValue({ userId: REQUESTER_ID, orgId: ORG_UUID, role: "admin" });
    mockSelectLimit.mockResolvedValue([{ role: "admin" }]);
    mockReadJsonBody.mockResolvedValue({ role: "member" });

    const res = await PATCH(makePatchRequest({ role: "member" }), makeContext(ORG_ID, TARGET_ID));

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("forbidden");
    expect(body.error.message).toContain("other admins");
  });

  it("returns 403 when member/viewer tries to change a role (insufficient permissions)", async () => {
    mockAssertOrgRole.mockRejectedValue(new ForbiddenError("Requires admin role or higher."));
    mockReadJsonBody.mockResolvedValue({ role: "viewer" });

    const res = await PATCH(makePatchRequest({ role: "viewer" }), makeContext(ORG_ID, TARGET_ID));

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("forbidden");
  });

  it("returns 404 when target user is not a member", async () => {
    mockAssertOrgRole.mockResolvedValue({ userId: REQUESTER_ID, orgId: ORG_UUID, role: "admin" });
    mockSelectLimit.mockResolvedValue([]);
    mockReadJsonBody.mockResolvedValue({ role: "viewer" });

    const res = await PATCH(makePatchRequest({ role: "viewer" }), makeContext(ORG_ID, TARGET_ID));

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("not_found");
    expect(body.error.message).toContain("Member not found");
  });

  it("returns 400 for invalid role", async () => {
    mockAssertOrgRole.mockResolvedValue({ userId: REQUESTER_ID, orgId: ORG_UUID, role: "owner" });
    mockReadJsonBody.mockResolvedValue({ role: "superadmin" });

    const res = await PATCH(makePatchRequest({ role: "superadmin" }), makeContext(ORG_ID, TARGET_ID));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("validation_error");
  });
});

/* ================================================================== */
/*  DELETE /api/orgs/[orgId]/members/[userId] — remove member         */
/* ================================================================== */
describe("DELETE /api/orgs/[orgId]/members/[userId]", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("admin removes member — returns success", async () => {
    mockAssertOrgRole.mockResolvedValue({ userId: REQUESTER_ID, orgId: ORG_UUID, role: "admin" });
    mockSelectLimit.mockResolvedValue([{ role: "member" }]);

    const res = await DELETE(makeDeleteRequest(), makeContext(ORG_ID, TARGET_ID));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it("owner removes admin — returns success", async () => {
    mockAssertOrgRole.mockResolvedValue({ userId: REQUESTER_ID, orgId: ORG_UUID, role: "owner" });
    mockSelectLimit.mockResolvedValue([{ role: "admin" }]);

    const res = await DELETE(makeDeleteRequest(), makeContext(ORG_ID, TARGET_ID));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it("returns 403 when removing self", async () => {
    mockAssertOrgRole.mockResolvedValue({ userId: REQUESTER_ID, orgId: ORG_UUID, role: "owner" });

    const res = await DELETE(
      makeDeleteRequest(),
      makeContext(ORG_ID, REQUESTER_ID), // target === requester
    );

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("forbidden");
    expect(body.error.message).toContain("remove yourself");
  });

  it("returns 403 when trying to remove the owner", async () => {
    mockAssertOrgRole.mockResolvedValue({ userId: REQUESTER_ID, orgId: ORG_UUID, role: "admin" });
    mockSelectLimit.mockResolvedValue([{ role: "owner" }]);

    const res = await DELETE(makeDeleteRequest(), makeContext(ORG_ID, TARGET_ID));

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("forbidden");
    expect(body.error.message).toContain("owner");
  });

  it("returns 403 when admin tries to remove another admin", async () => {
    mockAssertOrgRole.mockResolvedValue({ userId: REQUESTER_ID, orgId: ORG_UUID, role: "admin" });
    mockSelectLimit.mockResolvedValue([{ role: "admin" }]);

    const res = await DELETE(makeDeleteRequest(), makeContext(ORG_ID, TARGET_ID));

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("forbidden");
    expect(body.error.message).toContain("other admins");
  });

  it("returns 403 when member/viewer tries to remove (insufficient permissions)", async () => {
    mockAssertOrgRole.mockRejectedValue(new ForbiddenError("Requires admin role or higher."));

    const res = await DELETE(makeDeleteRequest(), makeContext(ORG_ID, TARGET_ID));

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("forbidden");
  });

  it("returns 404 when target user is not a member", async () => {
    mockAssertOrgRole.mockResolvedValue({ userId: REQUESTER_ID, orgId: ORG_UUID, role: "admin" });
    mockSelectLimit.mockResolvedValue([]);

    const res = await DELETE(makeDeleteRequest(), makeContext(ORG_ID, TARGET_ID));

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("not_found");
    expect(body.error.message).toContain("Member not found");
  });
});
