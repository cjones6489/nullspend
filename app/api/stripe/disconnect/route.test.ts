import { describe, it, expect, vi, beforeEach } from "vitest";

const mockResolveSessionContext = vi.fn();
const mockAssertOrgRole = vi.fn();
const mockGetDb = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  resolveSessionContext: () => mockResolveSessionContext(),
}));
vi.mock("@/lib/auth/org-authorization", () => ({
  assertOrgRole: (...args: unknown[]) => mockAssertOrgRole(...args),
}));
vi.mock("@/lib/db/client", () => ({
  getDb: () => mockGetDb(),
}));

import { DELETE } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveSessionContext.mockResolvedValue({ userId: "user-1", orgId: "org-1", role: "admin" });
  mockAssertOrgRole.mockResolvedValue(undefined);
});

describe("DELETE /api/stripe/disconnect", () => {
  it("returns 200 on successful disconnect", async () => {
    mockGetDb.mockReturnValue({
      delete: () => ({ where: () => ({ returning: () => Promise.resolve([{ id: "conn-1" }]) }) }),
    });

    const req = new Request("http://localhost/api/stripe/disconnect", { method: "DELETE" });
    const res = await DELETE(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.deleted).toBe(true);
  });

  it("returns 404 if no connection exists", async () => {
    mockGetDb.mockReturnValue({
      delete: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }),
    });

    const req = new Request("http://localhost/api/stripe/disconnect", { method: "DELETE" });
    const res = await DELETE(req);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("not_found");
  });

  it("requires admin role", async () => {
    mockAssertOrgRole.mockRejectedValue(new Error("Forbidden"));

    const req = new Request("http://localhost/api/stripe/disconnect", { method: "DELETE" });
    const res = await DELETE(req);
    expect(res.status).toBe(500); // handleRouteError catches generic errors as 500
  });
});
