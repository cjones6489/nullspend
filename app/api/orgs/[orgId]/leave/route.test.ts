import { afterEach, describe, expect, it, vi } from "vitest";

import { ForbiddenError } from "@/lib/auth/errors";
import { POST } from "./route";

const ORG_UUID = "00000000-0000-4000-a000-000000000001";
const ORG_ID = `ns_org_${ORG_UUID}`;
const USER_ID = "user-member";

/* ------------------------------------------------------------------ */
/*  Hoisted mocks                                                      */
/* ------------------------------------------------------------------ */

const {
  mockAssertOrgMember,
  mockTransaction,
} = vi.hoisted(() => ({
  mockAssertOrgMember: vi.fn(),
  mockTransaction: vi.fn(),
}));

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

vi.mock("@/lib/auth/session", () => ({
  resolveSessionContext: vi.fn().mockResolvedValue({
    userId: "user-member",
    orgId: "00000000-0000-4000-a000-000000000001",
    role: "member",
  }),
  setActiveOrgCookie: vi.fn().mockResolvedValue(undefined),
  invalidateMembershipCache: vi.fn(),
}));

vi.mock("@/lib/observability/sentry", () => ({
  captureExceptionWithContext: vi.fn(),
}));

vi.mock("@/lib/audit/log", () => ({
  logAuditEvent: vi.fn(),
}));

vi.mock("@/lib/auth/org-authorization", () => ({
  assertOrgMember: (...args: unknown[]) => mockAssertOrgMember(...args),
}));

vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(() => {
    const dbMethods = {
      update: () => ({
        set: () => ({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      }),
      delete: () => ({
        where: vi.fn().mockResolvedValue(undefined),
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
    readRouteParams: vi.fn(async (p: unknown) => p),
  };
});

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function makeContext(orgId: string) {
  return { params: Promise.resolve({ orgId }) };
}

function makeRequest() {
  return new Request(`http://localhost/api/orgs/${ORG_ID}/leave`, {
    method: "POST",
  });
}

/* ================================================================== */
/*  POST /api/orgs/[orgId]/leave — leave organization                 */
/* ================================================================== */
describe("POST /api/orgs/[orgId]/leave", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("member leaves org — returns 200", async () => {
    mockAssertOrgMember.mockResolvedValue({ userId: USER_ID, orgId: ORG_UUID, role: "member" });
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        update: () => ({
          set: () => ({
            where: vi.fn().mockResolvedValue(undefined),
          }),
        }),
        delete: () => ({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      };
      return cb(tx);
    });

    const res = await POST(makeRequest(), makeContext(ORG_ID));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it("returns 403 when owner tries to leave (must transfer first)", async () => {
    mockAssertOrgMember.mockResolvedValue({ userId: USER_ID, orgId: ORG_UUID, role: "owner" });

    const res = await POST(makeRequest(), makeContext(ORG_ID));

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("forbidden");
    expect(body.error.message).toContain("Transfer ownership first");
  });

  it("returns 403 for non-member (assertOrgMember throws)", async () => {
    mockAssertOrgMember.mockRejectedValue(new ForbiddenError("Not a member of this organization."));

    const res = await POST(makeRequest(), makeContext(ORG_ID));

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("forbidden");
  });
});
