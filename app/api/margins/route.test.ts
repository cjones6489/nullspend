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

  it("returns CSV when format=csv", async () => {
    mockGetMarginTable.mockResolvedValue({
      summary: {},
      customers: [
        {
          stripeCustomerId: "cus_1",
          customerName: "Acme Corp",
          tagValue: "acme",
          revenueMicrodollars: 100_000_000,
          costMicrodollars: 30_000_000,
          marginMicrodollars: 70_000_000,
          marginPercent: 70,
          healthTier: "healthy",
          sparkline: [],
          projectedTierWorsening: false,
          budgetSuggestionMicrodollars: null,
          avatarUrl: null,
        },
      ],
    });

    const req = new Request("http://localhost/api/margins?format=csv");
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv");
    expect(res.headers.get("Content-Disposition")).toContain("margins-2026-04.csv");

    const csv = await res.text();
    const lines = csv.split("\n");
    expect(lines[0]).toBe("Customer,Stripe ID,Tag Value,Revenue ($),Cost ($),Margin (%),Margin ($),Health Tier");
    expect(lines[1]).toContain("Acme Corp");
    expect(lines[1]).toContain("100.00");
    expect(lines[1]).toContain("healthy");
  });

  it("escapes CSV special characters in customer names", async () => {
    mockGetMarginTable.mockResolvedValue({
      summary: {},
      customers: [
        {
          stripeCustomerId: "cus_1",
          customerName: 'Acme, Inc. "Best"',
          tagValue: "acme",
          revenueMicrodollars: 50_000_000,
          costMicrodollars: 10_000_000,
          marginMicrodollars: 40_000_000,
          marginPercent: 80,
          healthTier: "healthy",
          sparkline: [],
          projectedTierWorsening: false,
          budgetSuggestionMicrodollars: null,
          avatarUrl: null,
        },
      ],
    });

    const req = new Request("http://localhost/api/margins?format=csv");
    const res = await GET(req);
    const csv = await res.text();
    // RFC 4180: commas and quotes wrapped in quotes, inner quotes doubled
    expect(csv).toContain('"Acme, Inc. ""Best"""');
  });

  it("returns JSON when format is not csv", async () => {
    mockGetMarginTable.mockResolvedValue({ summary: {}, customers: [] });

    const req = new Request("http://localhost/api/margins?format=json");
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/json");
  });

  it("returns CSV with headers only when no customers", async () => {
    mockGetMarginTable.mockResolvedValue({ summary: {}, customers: [] });

    const req = new Request("http://localhost/api/margins?format=csv");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const csv = await res.text();
    const lines = csv.split("\n");
    expect(lines).toHaveLength(1); // header only, no data rows
    expect(lines[0]).toContain("Customer");
  });

  it("defends against CSV formula injection in customer names", async () => {
    mockGetMarginTable.mockResolvedValue({
      summary: {},
      customers: [
        {
          stripeCustomerId: "cus_1",
          customerName: "=CMD|'/C calc'!A0",
          tagValue: "+dangerous",
          revenueMicrodollars: 10_000_000,
          costMicrodollars: 5_000_000,
          marginMicrodollars: 5_000_000,
          marginPercent: 50,
          healthTier: "healthy",
          sparkline: [],
          projectedTierWorsening: false,
          budgetSuggestionMicrodollars: null,
          avatarUrl: null,
        },
      ],
    });

    const req = new Request("http://localhost/api/margins?format=csv");
    const res = await GET(req);
    const csv = await res.text();
    const lines = csv.split("\n");
    // Customer name: formula trigger "=" must be prefixed with single-quote
    // The cell value should start with '= not bare =
    const dataLine = lines[1];
    expect(dataLine).toMatch(/^'=/); // first cell starts with '=
    // Tag value starting with + also gets prefixed
    expect(dataLine).toContain("'+dangerous");
  });
});
