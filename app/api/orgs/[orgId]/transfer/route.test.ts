import { afterEach, describe, expect, it, vi } from "vitest";

import { ForbiddenError } from "@/lib/auth/errors";
import { POST } from "./route";

const ORG_UUID = "00000000-0000-4000-a000-000000000001";
const ORG_ID = `ns_org_${ORG_UUID}`;
const OWNER_ID = "user-owner";
const TARGET_ID = "user-target";

/* ------------------------------------------------------------------ */
/*  Hoisted mocks                                                      */
/* ------------------------------------------------------------------ */

const {
  mockAssertOrgRole,
  mockSelectLimit,
  mockTransaction,
  mockReadJsonBody,
} = vi.hoisted(() => ({
  mockAssertOrgRole: vi.fn(),
  mockSelectLimit: vi.fn(),
  mockTransaction: vi.fn(),
  mockReadJsonBody: vi.fn(),
}));

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

vi.mock("@/lib/auth/session", () => ({
  resolveSessionContext: vi.fn().mockResolvedValue({
    userId: "user-owner",
    orgId: "00000000-0000-4000-a000-000000000001",
    role: "owner",
  }),
  invalidateMembershipCache: vi.fn(),
}));

vi.mock("@/lib/observability/sentry", () => ({
  captureExceptionWithContext: vi.fn(),
}));

vi.mock("@/lib/audit/log", () => ({
  logAuditEvent: vi.fn(),
}));

vi.mock("@/lib/auth/org-authorization", () => ({
  assertOrgRole: (...args: unknown[]) => mockAssertOrgRole(...args),
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
          where: vi.fn().mockResolvedValue(undefined),
        }),
      }),
      transaction: (...args: unknown[]) => mockTransaction(...args),
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

function makeContext(orgId: string) {
  return { params: Promise.resolve({ orgId }) };
}

function makeRequest(body: object) {
  return new Request(`http://localhost/api/orgs/${ORG_ID}/transfer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/* ================================================================== */
/*  POST /api/orgs/[orgId]/transfer — transfer ownership              */
/* ================================================================== */
describe("POST /api/orgs/[orgId]/transfer", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("owner transfers ownership to existing member — returns 200", async () => {
    mockAssertOrgRole.mockResolvedValue(undefined);
    mockReadJsonBody.mockResolvedValue({ newOwnerUserId: TARGET_ID });
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        execute: vi.fn().mockResolvedValue([{ role: "member" }]),
        update: () => ({
          set: () => ({
            where: vi.fn().mockResolvedValue(undefined),
          }),
        }),
      };
      return cb(tx);
    });

    const res = await POST(
      makeRequest({ newOwnerUserId: TARGET_ID }),
      makeContext(ORG_ID),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.newOwnerUserId).toBe(TARGET_ID);
  });

  it("returns 403 for non-owner (assertOrgRole throws ForbiddenError)", async () => {
    mockAssertOrgRole.mockRejectedValue(new ForbiddenError("Requires owner role."));
    mockReadJsonBody.mockResolvedValue({ newOwnerUserId: TARGET_ID });

    const res = await POST(
      makeRequest({ newOwnerUserId: TARGET_ID }),
      makeContext(ORG_ID),
    );

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("forbidden");
  });

  it("returns 400 when trying to transfer to self", async () => {
    mockAssertOrgRole.mockResolvedValue(undefined);
    mockReadJsonBody.mockResolvedValue({ newOwnerUserId: OWNER_ID });

    const res = await POST(
      makeRequest({ newOwnerUserId: OWNER_ID }),
      makeContext(ORG_ID),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("validation_error");
    expect(body.error.message).toContain("already the owner");
  });

  it("returns 404 when target user is not a member", async () => {
    mockAssertOrgRole.mockResolvedValue(undefined);
    mockReadJsonBody.mockResolvedValue({ newOwnerUserId: "user-nonexistent" });
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        execute: vi.fn().mockResolvedValue([]),
      };
      return cb(tx);
    });

    const res = await POST(
      makeRequest({ newOwnerUserId: "user-nonexistent" }),
      makeContext(ORG_ID),
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("not_found");
    expect(body.error.message).toContain("not a member");
  });

  it("returns 400 when target is a viewer", async () => {
    mockAssertOrgRole.mockResolvedValue(undefined);
    mockReadJsonBody.mockResolvedValue({ newOwnerUserId: TARGET_ID });
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        execute: vi.fn().mockResolvedValue([{ role: "viewer" }]),
      };
      return cb(tx);
    });

    const res = await POST(
      makeRequest({ newOwnerUserId: TARGET_ID }),
      makeContext(ORG_ID),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("validation_error");
    expect(body.error.message).toContain("Viewers");
  });
});
