import { describe, it, expect, vi, beforeEach } from "vitest";

const mockResolveSessionContext = vi.fn();
const mockAssertOrgRole = vi.fn();
const mockGetCustomerDetail = vi.fn();
const mockReadRouteParams = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  resolveSessionContext: () => mockResolveSessionContext(),
}));
vi.mock("@/lib/auth/org-authorization", () => ({
  assertOrgRole: (...args: unknown[]) => mockAssertOrgRole(...args),
}));
vi.mock("@/lib/margins/margin-query", () => ({
  getCustomerDetail: (...args: unknown[]) => mockGetCustomerDetail(...args),
}));
vi.mock("@/lib/margins/periods", () => ({
  formatPeriod: () => "2026-04",
  currentMonthStart: () => new Date(Date.UTC(2026, 3, 1)),
}));
vi.mock("@/lib/utils/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils/http")>();
  return {
    ...actual,
    readRouteParams: (...args: unknown[]) => mockReadRouteParams(...args),
  };
});

import { GET } from "./route";
import { ForbiddenError } from "@/lib/auth/errors";

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveSessionContext.mockResolvedValue({ userId: "user-1", orgId: "org-1", role: "viewer" });
  mockAssertOrgRole.mockResolvedValue(undefined);
  mockReadRouteParams.mockResolvedValue({ customer: "acme" });
});

function callGET(url = "http://localhost/api/margins/acme") {
  return GET(new Request(url), { params: Promise.resolve({ customer: "acme" }) });
}

describe("GET /api/margins/[customer]", () => {
  it("returns customer detail with default period", async () => {
    const mockDetail = {
      stripeCustomerId: "cus_1",
      customerName: "Acme Corp",
      avatarUrl: null,
      tagValue: "acme",
      healthTier: "healthy",
      marginPercent: 70,
      revenueMicrodollars: 100_000_000,
      costMicrodollars: 30_000_000,
      revenueOverTime: [],
      modelBreakdown: [],
    };
    mockGetCustomerDetail.mockResolvedValue(mockDetail);

    const res = await callGET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.tagValue).toBe("acme");
    expect(body.data.marginPercent).toBe(70);
    expect(mockGetCustomerDetail).toHaveBeenCalledWith("org-1", "acme", "2026-04");
  });

  it("accepts period query parameter", async () => {
    mockGetCustomerDetail.mockResolvedValue({ tagValue: "acme" });

    const res = await callGET("http://localhost/api/margins/acme?period=2026-02");
    expect(res.status).toBe(200);
    expect(mockGetCustomerDetail).toHaveBeenCalledWith("org-1", "acme", "2026-02");
  });

  it("returns 400 for invalid period format", async () => {
    const res = await callGET("http://localhost/api/margins/acme?period=bad");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("validation_error");
  });

  it("rejects period month 00", async () => {
    const res = await callGET("http://localhost/api/margins/acme?period=2026-00");
    expect(res.status).toBe(400);
  });

  it("rejects period month 13", async () => {
    const res = await callGET("http://localhost/api/margins/acme?period=2026-13");
    expect(res.status).toBe(400);
  });

  it("returns 404 when customer mapping not found", async () => {
    mockGetCustomerDetail.mockResolvedValue(null);

    const res = await callGET();
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("not_found");
  });

  it("returns 403 for unauthorized users", async () => {
    mockAssertOrgRole.mockRejectedValue(new ForbiddenError("Insufficient role."));

    const res = await callGET();
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("forbidden");
  });

  it("decodes URL-encoded customer tag values", async () => {
    mockReadRouteParams.mockResolvedValue({ customer: "acme%20corp" });
    mockGetCustomerDetail.mockResolvedValue({ tagValue: "acme corp" });

    const res = await GET(
      new Request("http://localhost/api/margins/acme%20corp"),
      { params: Promise.resolve({ customer: "acme%20corp" }) },
    );
    expect(res.status).toBe(200);
    // decodeURIComponent("acme%20corp") = "acme corp"
    expect(mockGetCustomerDetail).toHaveBeenCalledWith("org-1", "acme corp", "2026-04");
  });

  it("rejects SQL injection in period parameter", async () => {
    const res = await callGET("http://localhost/api/margins/acme?period=2026-01'%3BDROP--");
    expect(res.status).toBe(400);
  });

  it("API-14: returns 400 for malformed percent-encoded customer (not 500)", async () => {
    // %ZZ is not valid percent-encoding — decodeURIComponent throws URIError
    mockReadRouteParams.mockResolvedValue({ customer: "%ZZ" });

    const res = await GET(
      new Request("http://localhost/api/margins/%ZZ"),
      { params: Promise.resolve({ customer: "%ZZ" }) },
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe("validation_error");
  });
});
