import { describe, expect, it } from "vitest";

import {
  ASSIGNABLE_ROLES,
  ORG_ROLES,
  SEAT_COUNTED_ROLES,
  changeRoleSchema,
  createOrgSchema,
  inviteMemberSchema,
  updateOrgSchema,
} from "./orgs";

describe("ORG_ROLES", () => {
  it("includes owner, admin, member, viewer", () => {
    expect(ORG_ROLES).toEqual(["owner", "admin", "member", "viewer"]);
  });
});

describe("ASSIGNABLE_ROLES", () => {
  it("includes admin, member, viewer but not owner", () => {
    expect(ASSIGNABLE_ROLES).toEqual(["admin", "member", "viewer"]);
    expect(ASSIGNABLE_ROLES).not.toContain("owner");
  });
});

describe("SEAT_COUNTED_ROLES", () => {
  it("counts owner, admin, member but not viewer", () => {
    expect(SEAT_COUNTED_ROLES).toContain("owner");
    expect(SEAT_COUNTED_ROLES).toContain("admin");
    expect(SEAT_COUNTED_ROLES).toContain("member");
    expect(SEAT_COUNTED_ROLES).not.toContain("viewer");
  });
});

describe("inviteMemberSchema", () => {
  it("accepts valid admin invitation", () => {
    const result = inviteMemberSchema.safeParse({ email: "alice@example.com", role: "admin" });
    expect(result.success).toBe(true);
  });

  it("accepts valid member invitation", () => {
    const result = inviteMemberSchema.safeParse({ email: "bob@example.com", role: "member" });
    expect(result.success).toBe(true);
  });

  it("accepts valid viewer invitation", () => {
    const result = inviteMemberSchema.safeParse({ email: "carol@example.com", role: "viewer" });
    expect(result.success).toBe(true);
  });

  it("rejects owner role (must be transferred, not invited)", () => {
    const result = inviteMemberSchema.safeParse({ email: "dave@example.com", role: "owner" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid role", () => {
    const result = inviteMemberSchema.safeParse({ email: "eve@example.com", role: "superadmin" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid email", () => {
    const result = inviteMemberSchema.safeParse({ email: "not-an-email", role: "member" });
    expect(result.success).toBe(false);
  });

  it("rejects missing email", () => {
    const result = inviteMemberSchema.safeParse({ role: "member" });
    expect(result.success).toBe(false);
  });

  it("rejects missing role", () => {
    const result = inviteMemberSchema.safeParse({ email: "frank@example.com" });
    expect(result.success).toBe(false);
  });
});

describe("changeRoleSchema", () => {
  it("accepts viewer role change", () => {
    const result = changeRoleSchema.safeParse({ role: "viewer" });
    expect(result.success).toBe(true);
  });

  it("accepts admin role change", () => {
    const result = changeRoleSchema.safeParse({ role: "admin" });
    expect(result.success).toBe(true);
  });

  it("rejects owner role change", () => {
    const result = changeRoleSchema.safeParse({ role: "owner" });
    expect(result.success).toBe(false);
  });
});

describe("createOrgSchema", () => {
  it("accepts valid org", () => {
    const result = createOrgSchema.safeParse({ name: "My Team", slug: "my-team" });
    expect(result.success).toBe(true);
  });

  it("rejects empty name", () => {
    const result = createOrgSchema.safeParse({ name: "", slug: "my-team" });
    expect(result.success).toBe(false);
  });

  it("rejects slug with uppercase", () => {
    const result = createOrgSchema.safeParse({ name: "Team", slug: "My-Team" });
    expect(result.success).toBe(false);
  });

  it("rejects slug shorter than 3 characters", () => {
    const result = createOrgSchema.safeParse({ name: "Team", slug: "ab" });
    expect(result.success).toBe(false);
  });

  it("rejects slug with consecutive hyphens", () => {
    const result = createOrgSchema.safeParse({ name: "Team", slug: "my--team" });
    expect(result.success).toBe(false);
  });

  it("rejects slug starting with hyphen", () => {
    const result = createOrgSchema.safeParse({ name: "Team", slug: "-my-team" });
    expect(result.success).toBe(false);
  });
});

describe("updateOrgSchema", () => {
  it("accepts partial update with name only", () => {
    const result = updateOrgSchema.safeParse({ name: "New Name" });
    expect(result.success).toBe(true);
  });

  it("accepts partial update with slug only", () => {
    const result = updateOrgSchema.safeParse({ slug: "new-slug" });
    expect(result.success).toBe(true);
  });

  it("accepts empty object (no fields to update)", () => {
    const result = updateOrgSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});
