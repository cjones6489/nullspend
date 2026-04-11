import { describe, it, expect, vi, beforeEach } from "vitest";

const mockResolveSessionContext = vi.fn();
const mockAssertOrgRole = vi.fn();
const mockGetDb = vi.fn();
const mockDeleteRevenue = vi.fn();
const mockDeleteMappings = vi.fn();
const mockDeleteConnections = vi.fn();

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
  mockDeleteRevenue.mockResolvedValue(undefined);
  mockDeleteMappings.mockResolvedValue(undefined);
});

function setupDbMock(connectionRows: { id: string }[]) {
  mockDeleteConnections.mockResolvedValue(connectionRows);
  mockGetDb.mockReturnValue({
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        delete: () => ({
          where: (_condition: unknown) => {
            // Distinguish between the three delete calls by returning different promises
            return {
              returning: () => mockDeleteConnections(),
              then: (resolve: (v: unknown) => unknown) => resolve(undefined),
            };
          },
        }),
      };
      return fn(tx);
    }),
  });
}

describe("DELETE /api/stripe/disconnect", () => {
  it("returns 200 on successful disconnect", async () => {
    setupDbMock([{ id: "conn-1" }]);

    const req = new Request("http://localhost/api/stripe/disconnect", { method: "DELETE" });
    const res = await DELETE(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.deleted).toBe(true);
  });

  it("returns 404 if no connection exists", async () => {
    setupDbMock([]);

    const req = new Request("http://localhost/api/stripe/disconnect", { method: "DELETE" });
    const res = await DELETE(req);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("not_found");
  });

  it("cascades delete to revenue and mappings in a transaction", async () => {
    const txSpy = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const deleteCalls: string[] = [];
      const tx = {
        delete: (table: unknown) => {
          deleteCalls.push(String(table));
          return {
            where: () => ({
              returning: () => Promise.resolve([{ id: "conn-1" }]),
              then: (resolve: (v: unknown) => unknown) => resolve(undefined),
            }),
          };
        },
      };
      const result = await fn(tx);
      // STRIPE-15: Verify 4 delete calls (revenue, mappings, margin_alerts_sent, connections)
      expect(deleteCalls.length).toBe(4);
      return result;
    });

    mockGetDb.mockReturnValue({ transaction: txSpy });

    const req = new Request("http://localhost/api/stripe/disconnect", { method: "DELETE" });
    await DELETE(req);
    expect(txSpy).toHaveBeenCalled();
  });

  it("requires admin role", async () => {
    const { ForbiddenError } = await import("@/lib/auth/errors");
    mockAssertOrgRole.mockRejectedValue(new ForbiddenError());

    const req = new Request("http://localhost/api/stripe/disconnect", { method: "DELETE" });
    const res = await DELETE(req);
    expect(res.status).toBe(403);
  });
});
