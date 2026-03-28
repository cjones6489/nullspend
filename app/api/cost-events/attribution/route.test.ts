import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveSessionContext } from "@/lib/auth/session";
import {
  getAttributionByKey,
  getAttributionByTag,
  getTotals,
} from "@/lib/cost-events/aggregate-cost-events";
import { GET } from "./route";

vi.mock("@/lib/auth/session", () => ({
  resolveSessionContext: vi.fn().mockResolvedValue({ userId: "user-1", orgId: "org-test-1", role: "owner" }),
}));

vi.mock("@/lib/auth/org-authorization", () => ({
  assertOrgRole: vi.fn().mockResolvedValue({ userId: "user-1", orgId: "org-test-1", role: "owner" }),
  assertOrgMember: vi.fn().mockResolvedValue({ userId: "user-1", orgId: "org-test-1", role: "owner" }),
}));

vi.mock("@/lib/cost-events/aggregate-cost-events", () => ({
  getAttributionByKey: vi.fn(),
  getAttributionByTag: vi.fn(),
  getTotals: vi.fn(),
}));

const mockedResolveSessionContext = vi.mocked(resolveSessionContext);
const mockedGetAttributionByKey = vi.mocked(getAttributionByKey);
const mockedGetAttributionByTag = vi.mocked(getAttributionByTag);
const mockedGetTotals = vi.mocked(getTotals);

const MOCK_USER_ID = "user-abc-123";
const MOCK_ORG_ID = "org-mock-1";

const mockKeyRows = [
  {
    apiKeyId: "550e8400-e29b-41d4-a716-446655440000",
    keyName: "Production Key",
    totalCostMicrodollars: 8_000_000,
    requestCount: 40,
  },
  {
    apiKeyId: "660e8400-e29b-41d4-a716-446655440001",
    keyName: "Dev Key",
    totalCostMicrodollars: 2_000_000,
    requestCount: 10,
  },
];

const mockTagRows = [
  {
    tagValue: "customer-alpha",
    totalCostMicrodollars: 6_000_000,
    requestCount: 30,
  },
  {
    tagValue: "customer-beta",
    totalCostMicrodollars: 4_000_000,
    requestCount: 20,
  },
];

const mockTotals = { totalCostMicrodollars: 10_000_000, totalRequests: 50 };

function setupMocks() {
  mockedResolveSessionContext.mockResolvedValue({ userId: MOCK_USER_ID, orgId: MOCK_ORG_ID, role: "owner" });
  mockedGetAttributionByKey.mockResolvedValue(mockKeyRows);
  mockedGetAttributionByTag.mockResolvedValue(mockTagRows);
  mockedGetTotals.mockResolvedValue(mockTotals);
}

describe("GET /api/cost-events/attribution", () => {
  beforeEach(() => {
    mockedGetTotals.mockResolvedValue({ totalCostMicrodollars: 0, totalRequests: 0 });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("returns 200 with groups sorted by cost DESC for groupBy=api_key", async () => {
    setupMocks();

    const req = new Request("http://localhost/api/cost-events/attribution?groupBy=api_key");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.groups).toHaveLength(2);
    expect(body.data.groups[0].key).toBe("Production Key");
    expect(body.data.groups[0].keyId).toBe("ns_key_550e8400-e29b-41d4-a716-446655440000");
    expect(body.data.groups[0].totalCostMicrodollars).toBe(8_000_000);
    expect(body.data.groups[0].requestCount).toBe(40);
    expect(body.data.groups[0].avgCostMicrodollars).toBe(200_000);
    expect(body.data.groups[1].key).toBe("Dev Key");
    expect(body.data.groupBy).toBe("api_key");
    expect(body.data.period).toBe("30d");
    expect(body.data.totals.totalCostMicrodollars).toBe(10_000_000);
    expect(body.data.totals.totalRequests).toBe(50);
  });

  it("returns 200 with groups for groupBy=customer_id (tag)", async () => {
    setupMocks();

    const req = new Request("http://localhost/api/cost-events/attribution?groupBy=customer_id");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.groups).toHaveLength(2);
    expect(body.data.groups[0].key).toBe("customer-alpha");
    expect(body.data.groups[0].keyId).toBeNull();
    expect(body.data.groups[0].totalCostMicrodollars).toBe(6_000_000);
    expect(body.data.groups[0].requestCount).toBe(30);
    expect(body.data.groups[0].avgCostMicrodollars).toBe(200_000);
    expect(body.data.groupBy).toBe("customer_id");
  });

  it("uses default period 30d when not specified", async () => {
    setupMocks();

    const req = new Request("http://localhost/api/cost-events/attribution?groupBy=api_key");
    await GET(req);

    // limit + 1 = 101 because default limit is 100
    expect(mockedGetAttributionByKey).toHaveBeenCalledWith(MOCK_ORG_ID, 30, 101, undefined);
  });

  it("parses 7d period correctly", async () => {
    setupMocks();

    const req = new Request("http://localhost/api/cost-events/attribution?groupBy=api_key&period=7d");
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(mockedGetAttributionByKey).toHaveBeenCalledWith(MOCK_ORG_ID, 7, 101, undefined);
    const body = await res.json();
    expect(body.data.period).toBe("7d");
  });

  it("parses 90d period correctly", async () => {
    setupMocks();

    const req = new Request("http://localhost/api/cost-events/attribution?groupBy=api_key&period=90d");
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(mockedGetAttributionByKey).toHaveBeenCalledWith(MOCK_ORG_ID, 90, 101, undefined);
    const body = await res.json();
    expect(body.data.period).toBe("90d");
  });

  it("returns 400 for invalid period value", async () => {
    setupMocks();

    const req = new Request("http://localhost/api/cost-events/attribution?groupBy=api_key&period=14d");
    const res = await GET(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("validation_error");
  });

  it("returns 400 when groupBy is missing", async () => {
    setupMocks();

    const req = new Request("http://localhost/api/cost-events/attribution");
    const res = await GET(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("validation_error");
  });

  it("passes custom limit to aggregation (limit+1 for hasMore)", async () => {
    setupMocks();

    const req = new Request("http://localhost/api/cost-events/attribution?groupBy=api_key&limit=50");
    await GET(req);

    expect(mockedGetAttributionByKey).toHaveBeenCalledWith(MOCK_ORG_ID, 30, 51, undefined);
  });

  it("returns 400 when limit > 500", async () => {
    setupMocks();

    const req = new Request("http://localhost/api/cost-events/attribution?groupBy=api_key&limit=501");
    const res = await GET(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("validation_error");
  });

  it("passes excludeEstimated option when query param is true", async () => {
    setupMocks();

    const req = new Request("http://localhost/api/cost-events/attribution?groupBy=api_key&excludeEstimated=true");
    await GET(req);

    expect(mockedGetAttributionByKey).toHaveBeenCalledWith(MOCK_ORG_ID, 30, 101, { excludeEstimated: true });
  });

  it("returns text/csv with Content-Disposition when format=csv", async () => {
    setupMocks();

    const req = new Request("http://localhost/api/cost-events/attribution?groupBy=api_key&format=csv");
    const res = await GET(req);

    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    const disposition = res.headers.get("Content-Disposition")!;
    expect(disposition).toContain("attachment");
    expect(disposition).toContain("nullspend-attribution-api_key-");
    expect(disposition).toContain(".csv");

    const text = await res.text();
    const lines = text.split("\n");
    expect(lines[0]).toBe("key,key_id,total_cost_microdollars,total_cost_usd,request_count,avg_cost_microdollars,avg_cost_usd");
    expect(lines).toHaveLength(3); // header + 2 data rows
  });

  it("CSV escapes values with commas", async () => {
    mockedResolveSessionContext.mockResolvedValue({ userId: MOCK_USER_ID, orgId: MOCK_ORG_ID, role: "owner" });
    mockedGetAttributionByKey.mockResolvedValue([
      {
        apiKeyId: "key-1",
        keyName: "Key, with comma",
        totalCostMicrodollars: 1_000_000,
        requestCount: 5,
      },
    ]);

    const req = new Request("http://localhost/api/cost-events/attribution?groupBy=api_key&format=csv");
    const res = await GET(req);

    const text = await res.text();
    const lines = text.split("\n");
    // The key name should be quoted because it contains a comma
    expect(lines[1]).toContain('"Key, with comma"');
  });

  it("returns empty groups array with hasMore=false when no data", async () => {
    mockedResolveSessionContext.mockResolvedValue({ userId: MOCK_USER_ID, orgId: MOCK_ORG_ID, role: "owner" });
    mockedGetAttributionByKey.mockResolvedValue([]);

    const req = new Request("http://localhost/api/cost-events/attribution?groupBy=api_key");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.groups).toEqual([]);
    expect(body.data.hasMore).toBe(false);
    expect(body.data.totalGroups).toBe(0);
  });

  it("returns 401 when session is invalid", async () => {
    const { AuthenticationRequiredError } = await import("@/lib/auth/errors");
    mockedResolveSessionContext.mockRejectedValue(new AuthenticationRequiredError());

    const req = new Request("http://localhost/api/cost-events/attribution?groupBy=api_key");
    const res = await GET(req);

    expect(res.status).toBe(401);
  });

  it("returns 500 when aggregation throws", async () => {
    mockedResolveSessionContext.mockResolvedValue({ userId: MOCK_USER_ID, orgId: MOCK_ORG_ID, role: "owner" });
    mockedGetAttributionByKey.mockRejectedValue(new Error("DB connection lost"));

    vi.spyOn(console, "error").mockImplementation(() => {});

    const req = new Request("http://localhost/api/cost-events/attribution?groupBy=api_key");
    const res = await GET(req);

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("internal_error");
  });

  it("passes orgId correctly to getAttributionByKey", async () => {
    const customOrgId = "org-custom-xyz";
    mockedResolveSessionContext.mockResolvedValue({ userId: "u-1", orgId: customOrgId, role: "owner" });
    mockedGetAttributionByKey.mockResolvedValue([]);

    const req = new Request("http://localhost/api/cost-events/attribution?groupBy=api_key");
    await GET(req);

    expect(mockedGetAttributionByKey).toHaveBeenCalledWith(customOrgId, 30, 101, undefined);
  });

  it("passes orgId correctly to getAttributionByTag", async () => {
    const customOrgId = "org-custom-xyz";
    mockedResolveSessionContext.mockResolvedValue({ userId: "u-1", orgId: customOrgId, role: "owner" });
    mockedGetAttributionByTag.mockResolvedValue([]);

    const req = new Request("http://localhost/api/cost-events/attribution?groupBy=customer_id");
    await GET(req);

    expect(mockedGetAttributionByTag).toHaveBeenCalledWith(customOrgId, "customer_id", 30, 101, undefined);
  });

  it("hasMore=true when returned rows exceed limit", async () => {
    mockedResolveSessionContext.mockResolvedValue({ userId: MOCK_USER_ID, orgId: MOCK_ORG_ID, role: "owner" });
    // Return 3 rows with limit=2 → hasMore=true (route fetches limit+1=3, gets 3, slices to 2)
    const threeRows = [
      { apiKeyId: "550e8400-e29b-41d4-a716-446655440001", keyName: "Key 1", totalCostMicrodollars: 3_000_000, requestCount: 10 },
      { apiKeyId: "550e8400-e29b-41d4-a716-446655440002", keyName: "Key 2", totalCostMicrodollars: 2_000_000, requestCount: 5 },
      { apiKeyId: "550e8400-e29b-41d4-a716-446655440003", keyName: "Key 3", totalCostMicrodollars: 1_000_000, requestCount: 2 },
    ];
    mockedGetAttributionByKey.mockResolvedValue(threeRows);

    const req = new Request("http://localhost/api/cost-events/attribution?groupBy=api_key&limit=2");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.hasMore).toBe(true);
    expect(body.data.groups).toHaveLength(2);
  });

  it("hasMore=false when returned rows are fewer than limit", async () => {
    mockedResolveSessionContext.mockResolvedValue({ userId: MOCK_USER_ID, orgId: MOCK_ORG_ID, role: "owner" });
    // Return 1 row with limit=2 → hasMore=false (route fetches limit+1=3, gets 1)
    mockedGetAttributionByKey.mockResolvedValue([
      { apiKeyId: "550e8400-e29b-41d4-a716-446655440001", keyName: "Key 1", totalCostMicrodollars: 3_000_000, requestCount: 10 },
    ]);

    const req = new Request("http://localhost/api/cost-events/attribution?groupBy=api_key&limit=2");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.hasMore).toBe(false);
    expect(body.data.groups).toHaveLength(1);
  });

  it("avgCostMicrodollars is 0 when requestCount is 0", async () => {
    mockedResolveSessionContext.mockResolvedValue({ userId: MOCK_USER_ID, orgId: MOCK_ORG_ID, role: "owner" });
    mockedGetAttributionByKey.mockResolvedValue([
      { apiKeyId: "550e8400-e29b-41d4-a716-446655440001", keyName: "Idle Key", totalCostMicrodollars: 0, requestCount: 0 },
    ]);

    const req = new Request("http://localhost/api/cost-events/attribution?groupBy=api_key");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.groups[0].avgCostMicrodollars).toBe(0);
  });

  it("null apiKeyId is mapped to keyId in response for api_key groupBy", async () => {
    mockedResolveSessionContext.mockResolvedValue({ userId: MOCK_USER_ID, orgId: MOCK_ORG_ID, role: "owner" });
    mockedGetAttributionByKey.mockResolvedValue([
      { apiKeyId: null, keyName: "(no key)", totalCostMicrodollars: 1_000_000, requestCount: 5 },
    ]);

    const req = new Request("http://localhost/api/cost-events/attribution?groupBy=api_key");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.groups[0].keyId).toBeNull();
    expect(body.data.groups[0].key).toBe("(no key)");
  });

  it('maps null and "null" tag values to "(none)" for tag groupBy', async () => {
    mockedResolveSessionContext.mockResolvedValue({ userId: MOCK_USER_ID, orgId: MOCK_ORG_ID, role: "owner" });
    mockedGetAttributionByTag.mockResolvedValue([
      { tagValue: "null", totalCostMicrodollars: 2_000_000, requestCount: 10 },
      { tagValue: null, totalCostMicrodollars: 1_000_000, requestCount: 5 },
    ]);

    const req = new Request("http://localhost/api/cost-events/attribution?groupBy=customer_id");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    // Both null and "null" (from .mapWith(String)) should normalize to "(none)"
    expect(body.data.groups[0].key).toBe("(none)");
    expect(body.data.groups[1].key).toBe("(none)");
  });

  it("returns 500 when getTotals throws but group query would succeed", async () => {
    mockedResolveSessionContext.mockResolvedValue({ userId: MOCK_USER_ID, orgId: MOCK_ORG_ID, role: "owner" });
    mockedGetAttributionByKey.mockResolvedValue(mockKeyRows);
    mockedGetTotals.mockRejectedValue(new Error("totals query failed"));

    vi.spyOn(console, "error").mockImplementation(() => {});

    const req = new Request("http://localhost/api/cost-events/attribution?groupBy=api_key");
    const res = await GET(req);

    // Currently fails the whole request — documenting existing behavior
    expect(res.status).toBe(500);
  });

  it("passes excludeEstimated option to getTotals", async () => {
    setupMocks();

    const req = new Request("http://localhost/api/cost-events/attribution?groupBy=api_key&excludeEstimated=true");
    await GET(req);

    expect(mockedGetTotals).toHaveBeenCalledWith(MOCK_ORG_ID, 30, { excludeEstimated: true });
  });

  it("passes matching period to getTotals", async () => {
    setupMocks();

    const req = new Request("http://localhost/api/cost-events/attribution?groupBy=api_key&period=7d");
    await GET(req);

    expect(mockedGetTotals).toHaveBeenCalledWith(MOCK_ORG_ID, 7, undefined);
  });
});
