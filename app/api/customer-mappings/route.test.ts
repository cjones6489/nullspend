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

import { GET, POST, DELETE } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveSessionContext.mockResolvedValue({ userId: "user-1", orgId: "org-1", role: "member" });
  mockAssertOrgRole.mockResolvedValue(undefined);
});

function jsonRequest(body: unknown, method = "POST"): Request {
  return new Request("http://localhost/api/customer-mappings", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/customer-mappings", () => {
  it("returns list of mappings", async () => {
    const rows = [
      { id: "m-1", orgId: "org-1", stripeCustomerId: "cus_1", tagKey: "customer", tagValue: "acme", matchType: "auto", confidence: 0.9, createdAt: new Date("2026-04-04") },
    ];
    mockGetDb.mockReturnValue({
      select: () => ({ from: () => ({ where: () => Promise.resolve(rows) }) }),
    });

    const req = new Request("http://localhost/api/customer-mappings");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].tagValue).toBe("acme");
  });
});

describe("POST /api/customer-mappings", () => {
  it("returns 400 if required fields are missing", async () => {
    const res = await POST(jsonRequest({ tagValue: "acme" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("validation_error");
  });

  it("creates a manual mapping", async () => {
    const mapping = {
      id: "m-1",
      orgId: "org-1",
      stripeCustomerId: "cus_1",
      tagKey: "customer",
      tagValue: "acme",
      matchType: "manual",
      confidence: 1.0,
      createdAt: new Date("2026-04-04"),
    };
    mockGetDb.mockReturnValue({
      insert: () => ({
        values: () => ({
          onConflictDoUpdate: () => ({
            returning: () => Promise.resolve([mapping]),
          }),
        }),
      }),
    });

    const res = await POST(jsonRequest({ stripeCustomerId: "cus_1", tagValue: "acme" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.matchType).toBe("manual");
  });
});

describe("DELETE /api/customer-mappings", () => {
  it("returns 400 if id is missing", async () => {
    const req = new Request("http://localhost/api/customer-mappings", { method: "DELETE" });
    const res = await DELETE(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid UUID", async () => {
    const req = new Request("http://localhost/api/customer-mappings?id=not-a-uuid", { method: "DELETE" });
    const res = await DELETE(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toContain("UUID");
  });

  it("returns 404 if mapping not found", async () => {
    mockGetDb.mockReturnValue({
      delete: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }),
    });

    const req = new Request("http://localhost/api/customer-mappings?id=00000000-0000-0000-0000-000000000000", { method: "DELETE" });
    const res = await DELETE(req);
    expect(res.status).toBe(404);
  });

  it("deletes mapping successfully", async () => {
    mockGetDb.mockReturnValue({
      delete: () => ({ where: () => ({ returning: () => Promise.resolve([{ id: "11111111-1111-1111-1111-111111111111" }]) }) }),
    });

    const req = new Request("http://localhost/api/customer-mappings?id=11111111-1111-1111-1111-111111111111", { method: "DELETE" });
    const res = await DELETE(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.deleted).toBe(true);
  });
});
