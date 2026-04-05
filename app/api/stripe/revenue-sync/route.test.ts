import { describe, it, expect, vi, beforeEach } from "vitest";

const mockResolveSessionContext = vi.fn();
const mockAssertOrgRole = vi.fn();
const mockSyncOrgRevenue = vi.fn();
const mockSyncAllOrgs = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  resolveSessionContext: () => mockResolveSessionContext(),
}));
vi.mock("@/lib/auth/org-authorization", () => ({
  assertOrgRole: (...args: unknown[]) => mockAssertOrgRole(...args),
}));
vi.mock("@/lib/margins/sync", () => ({
  syncOrgRevenue: (...args: unknown[]) => mockSyncOrgRevenue(...args),
  syncAllOrgs: () => mockSyncAllOrgs(),
}));

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", "test-cron-secret-value");
  mockResolveSessionContext.mockResolvedValue({ userId: "user-1", orgId: "org-1", role: "member" });
  mockAssertOrgRole.mockResolvedValue(undefined);
});

describe("GET /api/stripe/revenue-sync", () => {
  describe("cron auth path", () => {
    it("returns 401 for invalid cron secret", async () => {
      const req = new Request("http://localhost/api/stripe/revenue-sync", {
        headers: { Authorization: "Bearer wrong-secret" },
      });
      const res = await GET(req);
      expect(res.status).toBe(401);
    });

    it("returns 401 when CRON_SECRET is not set", async () => {
      vi.stubEnv("CRON_SECRET", "");
      const req = new Request("http://localhost/api/stripe/revenue-sync", {
        headers: { Authorization: "Bearer anything" },
      });
      const res = await GET(req);
      expect(res.status).toBe(401);
    });

    it("syncs all orgs with valid cron secret", async () => {
      mockSyncAllOrgs.mockResolvedValue([]);
      const req = new Request("http://localhost/api/stripe/revenue-sync", {
        headers: { Authorization: "Bearer test-cron-secret-value" },
      });
      const res = await GET(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.synced).toBe(0);
      expect(mockSyncAllOrgs).toHaveBeenCalled();
    });

    it("returns aggregate counts, not org IDs", async () => {
      mockSyncAllOrgs.mockResolvedValue([
        { orgId: "org-1", error: null },
        { orgId: "org-2", error: "failed" },
      ]);
      const req = new Request("http://localhost/api/stripe/revenue-sync", {
        headers: { Authorization: "Bearer test-cron-secret-value" },
      });
      const res = await GET(req);
      const body = await res.json();
      expect(body.data.synced).toBe(2);
      expect(body.data.errors).toBe(1);
      expect(body.data.results).toBeUndefined(); // org IDs stripped
    });
  });

  describe("session auth path", () => {
    it("syncs single org with session auth", async () => {
      mockSyncOrgRevenue.mockResolvedValue({ orgId: "org-1", customersProcessed: 5 });
      const req = new Request("http://localhost/api/stripe/revenue-sync");
      const res = await GET(req);
      expect(res.status).toBe(200);
      expect(mockSyncOrgRevenue).toHaveBeenCalledWith("org-1");
    });
  });
});
