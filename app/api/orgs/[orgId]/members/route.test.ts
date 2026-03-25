import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveSessionContext } from "@/lib/auth/session";
import { ForbiddenError } from "@/lib/auth/errors";
import { GET } from "./route";

const ORG_UUID = "00000000-0000-4000-a000-000000000001";
const ORG_ID = `ns_org_${ORG_UUID}`;

vi.mock("@/lib/auth/session", () => ({
  resolveSessionContext: vi.fn().mockResolvedValue({ userId: "user-1", orgId: "org-test-1", role: "owner" }),
}));

vi.mock("@/lib/observability/sentry", () => ({
  captureExceptionWithContext: vi.fn(),
}));

const mockAssertOrgMember = vi.fn().mockResolvedValue({ userId: "user-1", orgId: ORG_UUID, role: "owner" });

vi.mock("@/lib/auth/org-authorization", () => ({
  assertOrgMember: (...args: unknown[]) => mockAssertOrgMember(...args),
  assertOrgRole: vi.fn(),
}));

const mockSelectWhere = vi.fn();

vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(() => ({
    select: () => ({
      from: () => ({
        where: () => ({ orderBy: mockSelectWhere }),
      }),
    }),
  })),
}));

vi.mock("@/lib/utils/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils/http")>();
  return {
    ...actual,
    readJsonBody: vi.fn(),
    readRouteParams: vi.fn(async (p: unknown) => p),
  };
});

function makeContext(orgId: string) {
  return { params: Promise.resolve({ orgId }) };
}

const NOW = new Date("2026-01-15T00:00:00Z");

/* ------------------------------------------------------------------ */
/*  GET /api/orgs/[orgId]/members                                     */
/* ------------------------------------------------------------------ */
describe("GET /api/orgs/[orgId]/members", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns member list for any member", async () => {
    mockSelectWhere.mockResolvedValue([
      { userId: "user-1", role: "owner", createdAt: NOW },
      { userId: "user-2", role: "member", createdAt: NOW },
      { userId: "user-3", role: "viewer", createdAt: NOW },
    ]);

    const req = new Request("http://localhost/api/orgs/" + ORG_ID + "/members");
    const res = await GET(req, makeContext(ORG_ID));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(3);
    expect(body.data[0].userId).toBe("user-1");
    expect(body.data[0].role).toBe("owner");
    expect(body.data[1].role).toBe("member");
    expect(body.data[2].role).toBe("viewer");
    expect(mockAssertOrgMember).toHaveBeenCalledWith("user-1", ORG_UUID);
  });

  it("returns 403 for non-member", async () => {
    mockAssertOrgMember.mockRejectedValueOnce(new ForbiddenError("You are not a member of this organization."));

    const req = new Request("http://localhost/api/orgs/" + ORG_ID + "/members");
    const res = await GET(req, makeContext(ORG_ID));

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("forbidden");
  });

  it("returns 401 when session is invalid", async () => {
    const { AuthenticationRequiredError } = await import("@/lib/auth/errors");
    vi.mocked(resolveSessionContext).mockRejectedValueOnce(new AuthenticationRequiredError());

    const req = new Request("http://localhost/api/orgs/" + ORG_ID + "/members");
    const res = await GET(req, makeContext(ORG_ID));

    expect(res.status).toBe(401);
  });

  it("returns empty array when org has no members", async () => {
    mockSelectWhere.mockResolvedValue([]);

    const req = new Request("http://localhost/api/orgs/" + ORG_ID + "/members");
    const res = await GET(req, makeContext(ORG_ID));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([]);
  });
});
