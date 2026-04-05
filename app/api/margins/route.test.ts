import { describe, it, expect, vi, beforeEach } from "vitest";

const mockResolveSessionContext = vi.fn();
const mockAssertOrgRole = vi.fn();
const mockGetMarginTable = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  resolveSessionContext: () => mockResolveSessionContext(),
}));
vi.mock("@/lib/auth/org-authorization", () => ({
  assertOrgRole: (...args: unknown[]) => mockAssertOrgRole(...args),
}));
vi.mock("@/lib/margins/margin-query", () => ({
  getMarginTable: (...args: unknown[]) => mockGetMarginTable(...args),
}));
vi.mock("@/lib/margins/periods", () => ({
  formatPeriod: () => "2026-04",
  currentMonthStart: () => new Date(Date.UTC(2026, 3, 1)),
}));

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveSessionContext.mockResolvedValue({ userId: "user-1", orgId: "org-1", role: "viewer" });
  mockAssertOrgRole.mockResolvedValue(undefined);
});

describe("GET /api/margins", () => {
  it("returns margin table data with default period", async () => {
    const mockResult = {
      summary: {
        blendedMarginPercent: 42,
        totalRevenueMicrodollars: 100_000_000,
        totalCostMicrodollars: 58_000_000,
        criticalCount: 1,
        atRiskCount: 2,
        lastSyncAt: "2026-04-04T10:00:00Z",
        syncStatus: "active",
      },
      customers: [],
    };
    mockGetMarginTable.mockResolvedValue(mockResult);

    const req = new Request("http://localhost/api/margins");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.summary.blendedMarginPercent).toBe(42);
    expect(mockGetMarginTable).toHaveBeenCalledWith("org-1", "2026-04");
  });

  it("accepts period query parameter", async () => {
    mockGetMarginTable.mockResolvedValue({ summary: {}, customers: [] });

    const req = new Request("http://localhost/api/margins?period=2026-03");
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(mockGetMarginTable).toHaveBeenCalledWith("org-1", "2026-03");
  });

  it("returns 400 for invalid period format", async () => {
    const req = new Request("http://localhost/api/margins?period=invalid");
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("validation_error");
  });

  it("passes through lastSyncAt and syncStatus", async () => {
    mockGetMarginTable.mockResolvedValue({
      summary: {
        lastSyncAt: "2026-04-04T10:00:00Z",
        syncStatus: "active",
      },
      customers: [],
    });

    const req = new Request("http://localhost/api/margins");
    const res = await GET(req);
    const body = await res.json();
    expect(body.data.summary.lastSyncAt).toBe("2026-04-04T10:00:00Z");
    expect(body.data.summary.syncStatus).toBe("active");
  });
});
