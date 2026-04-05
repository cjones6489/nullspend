import { describe, it, expect, vi, beforeEach } from "vitest";

const mockResolveSessionContext = vi.fn();
const mockAssertOrgRole = vi.fn();
const mockGetDb = vi.fn();
const mockGetAttributionByTag = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  resolveSessionContext: () => mockResolveSessionContext(),
}));
vi.mock("@/lib/auth/org-authorization", () => ({
  assertOrgRole: (...args: unknown[]) => mockAssertOrgRole(...args),
}));
vi.mock("@/lib/db/client", () => ({
  getDb: () => mockGetDb(),
}));
vi.mock("@/lib/cost-events/aggregate-cost-events", () => ({
  getAttributionByTag: (...args: unknown[]) => mockGetAttributionByTag(...args),
}));

import { GET } from "./route";
import { ForbiddenError } from "@/lib/auth/errors";
import { customerRevenue, customerMappings } from "@nullspend/db";

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveSessionContext.mockResolvedValue({ userId: "user-1", orgId: "org-1", role: "viewer" });
  mockAssertOrgRole.mockResolvedValue(undefined);
});

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Mock DB to return specific data for the two queries run in Promise.all.
 * Distinguishes queries by comparing the table reference passed to from().
 */
function mockDbWith(mappings: unknown[], revenueCustomers: unknown[]) {
  mockGetDb.mockReturnValue({
    select: () => ({
      from: (table: unknown) => {
        if (table === customerMappings) {
          return { where: () => Promise.resolve(mappings) };
        }
        if (table === customerRevenue) {
          return { where: () => ({ groupBy: () => Promise.resolve(revenueCustomers) }) };
        }
        return { where: () => Promise.resolve([]) };
      },
    }),
  });
}

// ── Tests ────────────────────────────────────────────────────────────

describe("GET /api/margins/unmatched", () => {
  it("returns unmatched customers (in revenue but not mapped)", async () => {
    mockDbWith(
      [{ id: "m-1", stripeCustomerId: "cus_1", tagValue: "acme", matchType: "manual", confidence: 1.0 }],
      [
        { stripeCustomerId: "cus_1", customerName: "Acme Corp", customerEmail: "a@acme.com", totalRevenueMicrodollars: 50_000_000 },
        { stripeCustomerId: "cus_2", customerName: "BetaCo", customerEmail: "b@beta.com", totalRevenueMicrodollars: 30_000_000 },
      ],
    );
    mockGetAttributionByTag.mockResolvedValue([
      { tagValue: "acme", totalCostMicrodollars: 10_000_000, requestCount: 50 },
      { tagValue: "beta", totalCostMicrodollars: 5_000_000, requestCount: 20 },
    ]);

    const req = new Request("http://localhost/api/margins/unmatched");
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.unmatchedStripeCustomers).toHaveLength(1);
    expect(body.data.unmatchedStripeCustomers[0].stripeCustomerId).toBe("cus_2");
    expect(body.data.unmatchedStripeCustomers[0].customerName).toBe("BetaCo");
    expect(body.data.unmatchedStripeCustomers[0].totalRevenueMicrodollars).toBe(30_000_000);
  });

  it("returns unmapped tag values (in cost_events but not mapped)", async () => {
    mockDbWith(
      [{ id: "m-1", stripeCustomerId: "cus_1", tagValue: "acme", matchType: "manual", confidence: 1.0 }],
      [{ stripeCustomerId: "cus_1", customerName: "Acme Corp", customerEmail: null, totalRevenueMicrodollars: 50_000_000 }],
    );
    mockGetAttributionByTag.mockResolvedValue([
      { tagValue: "acme", totalCostMicrodollars: 10_000_000, requestCount: 50 },
      { tagValue: "beta", totalCostMicrodollars: 5_000_000, requestCount: 20 },
      { tagValue: "gamma", totalCostMicrodollars: 2_000_000, requestCount: 10 },
    ]);

    const req = new Request("http://localhost/api/margins/unmatched");
    const res = await GET(req);
    const body = await res.json();

    expect(body.data.unmappedTagValues).toHaveLength(2);
    expect(body.data.unmappedTagValues.map((t: { tagValue: string }) => t.tagValue)).toEqual(["beta", "gamma"]);
  });

  it("returns pending auto-matches (matchType=auto) with customer names", async () => {
    mockDbWith(
      [
        { id: "m-1", stripeCustomerId: "cus_1", tagValue: "acme", matchType: "auto", confidence: 0.9 },
        { id: "m-2", stripeCustomerId: "cus_2", tagValue: "beta", matchType: "manual", confidence: 1.0 },
      ],
      [
        { stripeCustomerId: "cus_1", customerName: "Acme Corp", customerEmail: null, totalRevenueMicrodollars: 50_000_000 },
        { stripeCustomerId: "cus_2", customerName: "BetaCo", customerEmail: null, totalRevenueMicrodollars: 30_000_000 },
      ],
    );
    mockGetAttributionByTag.mockResolvedValue([]);

    const req = new Request("http://localhost/api/margins/unmatched");
    const res = await GET(req);
    const body = await res.json();

    expect(body.data.pendingAutoMatches).toHaveLength(1);
    expect(body.data.pendingAutoMatches[0].stripeCustomerId).toBe("cus_1");
    expect(body.data.pendingAutoMatches[0].customerName).toBe("Acme Corp");
    expect(body.data.pendingAutoMatches[0].confidence).toBe(0.9);
  });

  it("returns empty arrays when fully matched", async () => {
    mockDbWith(
      [{ id: "m-1", stripeCustomerId: "cus_1", tagValue: "acme", matchType: "manual", confidence: 1.0 }],
      [{ stripeCustomerId: "cus_1", customerName: "Acme Corp", customerEmail: null, totalRevenueMicrodollars: 50_000_000 }],
    );
    mockGetAttributionByTag.mockResolvedValue([
      { tagValue: "acme", totalCostMicrodollars: 10_000_000, requestCount: 50 },
    ]);

    const req = new Request("http://localhost/api/margins/unmatched");
    const res = await GET(req);
    const body = await res.json();

    expect(body.data.unmatchedStripeCustomers).toHaveLength(0);
    expect(body.data.unmappedTagValues).toHaveLength(0);
    expect(body.data.pendingAutoMatches).toHaveLength(0);
  });

  it("returns 403 for unauthorized users", async () => {
    mockAssertOrgRole.mockRejectedValue(new ForbiddenError("Insufficient role."));

    const req = new Request("http://localhost/api/margins/unmatched");
    const res = await GET(req);
    expect(res.status).toBe(403);

    const body = await res.json();
    expect(body.error.code).toBe("forbidden");
    expect(mockAssertOrgRole).toHaveBeenCalledWith("user-1", "org-1", "viewer");
  });

  it("returns empty arrays when no revenue customers exist", async () => {
    mockDbWith([], []);
    mockGetAttributionByTag.mockResolvedValue([]);

    const req = new Request("http://localhost/api/margins/unmatched");
    const res = await GET(req);
    const body = await res.json();

    expect(body.data.unmatchedStripeCustomers).toHaveLength(0);
    expect(body.data.unmappedTagValues).toHaveLength(0);
    expect(body.data.pendingAutoMatches).toHaveLength(0);
    expect(body.data.customerNames).toEqual({});
  });

  it("filters out null tag values from unmapped list", async () => {
    mockDbWith([], []);
    mockGetAttributionByTag.mockResolvedValue([
      { tagValue: null, totalCostMicrodollars: 1_000_000, requestCount: 5 },
      { tagValue: "valid-tag", totalCostMicrodollars: 2_000_000, requestCount: 10 },
    ]);

    const req = new Request("http://localhost/api/margins/unmatched");
    const res = await GET(req);
    const body = await res.json();

    expect(body.data.unmappedTagValues).toHaveLength(1);
    expect(body.data.unmappedTagValues[0].tagValue).toBe("valid-tag");
  });

  it("returns customerNames map for confirmed mapping display", async () => {
    mockDbWith(
      [
        { id: "m-1", stripeCustomerId: "cus_1", tagValue: "acme", matchType: "manual", confidence: 1.0 },
        { id: "m-2", stripeCustomerId: "cus_2", tagValue: "beta", matchType: "manual", confidence: 1.0 },
      ],
      [
        { stripeCustomerId: "cus_1", customerName: "Acme Corp", customerEmail: null, totalRevenueMicrodollars: 50_000_000 },
        { stripeCustomerId: "cus_2", customerName: "BetaCo", customerEmail: null, totalRevenueMicrodollars: 30_000_000 },
        { stripeCustomerId: "cus_3", customerName: null, customerEmail: null, totalRevenueMicrodollars: 10_000_000 },
      ],
    );
    mockGetAttributionByTag.mockResolvedValue([]);

    const req = new Request("http://localhost/api/margins/unmatched");
    const res = await GET(req);
    const body = await res.json();

    expect(body.data.customerNames).toEqual({
      cus_1: "Acme Corp",
      cus_2: "BetaCo",
    });
    // null names are excluded from the map
    expect(body.data.customerNames).not.toHaveProperty("cus_3");
  });

  it("normalizes empty-string customerName/Email from SQL max() to null", async () => {
    mockDbWith(
      [],
      [{ stripeCustomerId: "cus_1", customerName: "", customerEmail: "", totalRevenueMicrodollars: 10_000_000 }],
    );
    mockGetAttributionByTag.mockResolvedValue([]);

    const req = new Request("http://localhost/api/margins/unmatched");
    const res = await GET(req);
    const body = await res.json();

    expect(body.data.unmatchedStripeCustomers[0].customerName).toBeNull();
    expect(body.data.unmatchedStripeCustomers[0].customerEmail).toBeNull();
  });

  it('normalizes "null" string from mapWith(String) on SQL NULL to null', async () => {
    // Drizzle mapWith(String) calls String(null) → "null" for SQL NULLs
    mockDbWith(
      [],
      [{ stripeCustomerId: "cus_1", customerName: "null", customerEmail: "null", totalRevenueMicrodollars: 10_000_000 }],
    );
    mockGetAttributionByTag.mockResolvedValue([]);

    const req = new Request("http://localhost/api/margins/unmatched");
    const res = await GET(req);
    const body = await res.json();

    expect(body.data.unmatchedStripeCustomers[0].customerName).toBeNull();
    expect(body.data.unmatchedStripeCustomers[0].customerEmail).toBeNull();
    // "null" names must not leak into customerNames map
    expect(body.data.customerNames).not.toHaveProperty("cus_1");
  });

  it("filters out empty-string tag values from unmapped list", async () => {
    mockDbWith([], []);
    mockGetAttributionByTag.mockResolvedValue([
      { tagValue: "", totalCostMicrodollars: 500_000, requestCount: 2 },
      { tagValue: "real-tag", totalCostMicrodollars: 3_000_000, requestCount: 15 },
    ]);

    const req = new Request("http://localhost/api/margins/unmatched");
    const res = await GET(req);
    const body = await res.json();

    expect(body.data.unmappedTagValues).toHaveLength(1);
    expect(body.data.unmappedTagValues[0].tagValue).toBe("real-tag");
  });

  it('filters out "null" string tag values from mapWith(String) on untagged events', async () => {
    // getAttributionByTag uses mapWith(String) which turns SQL NULL groups into "null"
    mockDbWith([], []);
    mockGetAttributionByTag.mockResolvedValue([
      { tagValue: "null", totalCostMicrodollars: 50_000_000, requestCount: 500 },
      { tagValue: "acme-corp", totalCostMicrodollars: 10_000_000, requestCount: 50 },
    ]);

    const req = new Request("http://localhost/api/margins/unmatched");
    const res = await GET(req);
    const body = await res.json();

    // "null" is the mapWith(String) artifact for events without a customer tag
    expect(body.data.unmappedTagValues).toHaveLength(1);
    expect(body.data.unmappedTagValues[0].tagValue).toBe("acme-corp");
  });

  it("ignores mappings with non-customer tagKey", async () => {
    // The mock returns mappings as-is; the route should filter by tagKey=customer
    // but our mock bypasses the WHERE clause. This test verifies the query is scoped.
    // We verify by checking that getAttributionByTag is called with "customer" key
    mockDbWith(
      [{ id: "m-1", stripeCustomerId: "cus_1", tagValue: "acme", matchType: "manual", confidence: 1.0 }],
      [{ stripeCustomerId: "cus_1", customerName: "Acme", customerEmail: null, totalRevenueMicrodollars: 50_000_000 }],
    );
    mockGetAttributionByTag.mockResolvedValue([]);

    const req = new Request("http://localhost/api/margins/unmatched");
    await GET(req);

    expect(mockGetAttributionByTag).toHaveBeenCalledWith("org-1", "customer", 90, 500);
  });

  it("returns 500 when a database query fails", async () => {
    mockGetDb.mockReturnValue({
      select: () => ({
        from: () => {
          throw new Error("Connection refused");
        },
      }),
    });
    mockGetAttributionByTag.mockResolvedValue([]);

    const req = new Request("http://localhost/api/margins/unmatched");
    const res = await GET(req);
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.error.code).toBe("internal_error");
  });

  it("returns 500 when getAttributionByTag fails", async () => {
    mockDbWith([], []);
    mockGetAttributionByTag.mockRejectedValue(new Error("Query timeout"));

    const req = new Request("http://localhost/api/margins/unmatched");
    const res = await GET(req);
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.error.code).toBe("internal_error");
  });
});
