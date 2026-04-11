import { beforeEach, describe, expect, it, vi } from "vitest";

import { assertOrgMember, assertOrgRole } from "@/lib/auth/org-authorization";
import { ForbiddenError } from "@/lib/auth/errors";
import { getDb } from "@/lib/db/client";

vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(),
}));

vi.mock("@nullspend/db", () => ({
  orgMemberships: {
    userId: "userId",
    orgId: "orgId",
    role: "role",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  and: vi.fn(),
}));

const mockedGetDb = vi.mocked(getDb);

function mockDbReturning(rows: unknown[]) {
  const mockLimit = vi.fn().mockResolvedValue(rows);
  const mockWhere = vi.fn(() => ({ limit: mockLimit }));
  const mockFrom = vi.fn(() => ({ where: mockWhere }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));
  mockedGetDb.mockReturnValue({ select: mockSelect } as unknown as ReturnType<typeof getDb>);
  return { mockSelect, mockFrom, mockWhere, mockLimit };
}

describe("assertOrgMember", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns membership when user is a member", async () => {
    const row = { userId: "user-1", orgId: "org-1", role: "member" };
    mockDbReturning([row]);

    const result = await assertOrgMember("user-1", "org-1");

    expect(result).toEqual({ userId: "user-1", orgId: "org-1", role: "member" });
  });

  it("returns membership with owner role", async () => {
    const row = { userId: "user-1", orgId: "org-1", role: "owner" };
    mockDbReturning([row]);

    const result = await assertOrgMember("user-1", "org-1");

    expect(result).toEqual({ userId: "user-1", orgId: "org-1", role: "owner" });
  });

  it("throws ForbiddenError when user is not a member", async () => {
    mockDbReturning([]);

    await expect(assertOrgMember("user-1", "org-1")).rejects.toThrow(ForbiddenError);
    await expect(assertOrgMember("user-1", "org-1")).rejects.toThrow(
      "You are not a member of this organization.",
    );
  });

  it("throws ForbiddenError when query returns undefined (empty result set)", async () => {
    mockDbReturning([undefined]);

    await expect(assertOrgMember("user-1", "org-1")).rejects.toThrow(ForbiddenError);
  });

  it("calls getDb and queries with correct chaining", async () => {
    const row = { userId: "user-1", orgId: "org-1", role: "viewer" };
    const { mockSelect, mockFrom, mockWhere, mockLimit } = mockDbReturning([row]);

    await assertOrgMember("user-1", "org-1");

    expect(mockedGetDb).toHaveBeenCalledOnce();
    expect(mockSelect).toHaveBeenCalledOnce();
    expect(mockFrom).toHaveBeenCalledOnce();
    expect(mockWhere).toHaveBeenCalledOnce();
    expect(mockLimit).toHaveBeenCalledWith(1);
  });
});

describe("assertOrgRole", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns membership when user has the exact required role", async () => {
    const row = { userId: "user-1", orgId: "org-1", role: "admin" };
    mockDbReturning([row]);

    const result = await assertOrgRole("user-1", "org-1", "admin");

    expect(result).toEqual({ userId: "user-1", orgId: "org-1", role: "admin" });
  });

  it("returns membership when user has a higher role than required", async () => {
    const row = { userId: "user-1", orgId: "org-1", role: "owner" };
    mockDbReturning([row]);

    const result = await assertOrgRole("user-1", "org-1", "member");

    expect(result).toEqual({ userId: "user-1", orgId: "org-1", role: "owner" });
  });

  it("throws ForbiddenError when user has a lower role than required", async () => {
    const row = { userId: "user-1", orgId: "org-1", role: "viewer" };
    mockDbReturning([row]);

    await expect(assertOrgRole("user-1", "org-1", "admin")).rejects.toThrow(ForbiddenError);
    mockDbReturning([row]);
    await expect(assertOrgRole("user-1", "org-1", "admin")).rejects.toThrow(
      "This action requires the admin role or higher.",
    );
  });

  it("throws ForbiddenError when user is not a member at all", async () => {
    mockDbReturning([]);

    await expect(assertOrgRole("user-1", "org-1", "viewer")).rejects.toThrow(ForbiddenError);
    await expect(assertOrgRole("user-1", "org-1", "viewer")).rejects.toThrow(
      "You are not a member of this organization.",
    );
  });

  it("includes the required role name in the error message", async () => {
    const row = { userId: "user-1", orgId: "org-1", role: "member" };
    mockDbReturning([row]);

    await expect(assertOrgRole("user-1", "org-1", "owner")).rejects.toThrow(
      "This action requires the owner role or higher.",
    );
  });
});

describe("role hierarchy: viewer < member < admin < owner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const allRoles = ["viewer", "member", "admin", "owner"] as const;
  const roleLevel: Record<string, number> = {
    viewer: 0,
    member: 1,
    admin: 2,
    owner: 3,
  };

  for (const userRole of allRoles) {
    for (const requiredRole of allRoles) {
      const shouldPass = roleLevel[userRole] >= roleLevel[requiredRole];

      it(`${userRole} ${shouldPass ? "passes" : "fails"} ${requiredRole} check`, async () => {
        const row = { userId: "user-1", orgId: "org-1", role: userRole };
        mockDbReturning([row]);

        if (shouldPass) {
          const result = await assertOrgRole("user-1", "org-1", requiredRole);
          expect(result.role).toBe(userRole);
        } else {
          await expect(assertOrgRole("user-1", "org-1", requiredRole)).rejects.toThrow(
            ForbiddenError,
          );
        }
      });
    }
  }
});

describe("AUTH-2: unknown role values fail closed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects when DB role is an unknown string", async () => {
    mockDbReturning([{ userId: "user-1", orgId: "org-1", role: "superadmin" }]);

    await expect(assertOrgRole("user-1", "org-1", "viewer")).rejects.toThrow(ForbiddenError);
  });

  it("rejects when DB role is empty string", async () => {
    mockDbReturning([{ userId: "user-1", orgId: "org-1", role: "" }]);

    await expect(assertOrgRole("user-1", "org-1", "viewer")).rejects.toThrow(ForbiddenError);
  });

  it("rejects when DB role is 'Owner' (wrong case)", async () => {
    mockDbReturning([{ userId: "user-1", orgId: "org-1", role: "Owner" }]);

    await expect(assertOrgRole("user-1", "org-1", "viewer")).rejects.toThrow(ForbiddenError);
  });

  it("rejects when DB role is '__proto__' (prototype pollution attempt)", async () => {
    mockDbReturning([{ userId: "user-1", orgId: "org-1", role: "__proto__" }]);

    await expect(assertOrgRole("user-1", "org-1", "viewer")).rejects.toThrow(ForbiddenError);
  });

  it("rejects when DB role is 'constructor'", async () => {
    mockDbReturning([{ userId: "user-1", orgId: "org-1", role: "constructor" }]);

    await expect(assertOrgRole("user-1", "org-1", "viewer")).rejects.toThrow(ForbiddenError);
  });
});

describe("exact minimum role matches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("viewer passes viewer check", async () => {
    mockDbReturning([{ userId: "u", orgId: "o", role: "viewer" }]);
    await expect(assertOrgRole("u", "o", "viewer")).resolves.toEqual({
      userId: "u",
      orgId: "o",
      role: "viewer",
    });
  });

  it("member passes member check", async () => {
    mockDbReturning([{ userId: "u", orgId: "o", role: "member" }]);
    await expect(assertOrgRole("u", "o", "member")).resolves.toEqual({
      userId: "u",
      orgId: "o",
      role: "member",
    });
  });

  it("admin passes admin check", async () => {
    mockDbReturning([{ userId: "u", orgId: "o", role: "admin" }]);
    await expect(assertOrgRole("u", "o", "admin")).resolves.toEqual({
      userId: "u",
      orgId: "o",
      role: "admin",
    });
  });

  it("owner passes owner check", async () => {
    mockDbReturning([{ userId: "u", orgId: "o", role: "owner" }]);
    await expect(assertOrgRole("u", "o", "owner")).resolves.toEqual({
      userId: "u",
      orgId: "o",
      role: "owner",
    });
  });
});
