import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveSessionContext } from "@/lib/auth/session";
import {
  getAttributionDetailByKey,
  getAttributionDetailByTag,
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
  getAttributionDetailByKey: vi.fn(),
  getAttributionDetailByTag: vi.fn(),
}));

const mockedResolveSessionContext = vi.mocked(resolveSessionContext);
const mockedGetAttributionDetailByKey = vi.mocked(getAttributionDetailByKey);
const mockedGetAttributionDetailByTag = vi.mocked(getAttributionDetailByTag);

const MOCK_USER_ID = "user-abc-123";
const MOCK_ORG_ID = "org-mock-1";

const mockDetailResult = {
  daily: [
    { date: "2026-03-25", cost: 3_000_000, count: 15 },
    { date: "2026-03-26", cost: 5_000_000, count: 25 },
  ],
  models: [
    { model: "gpt-4o", cost: 6_000_000, count: 30 },
    { model: "gpt-4o-mini", cost: 2_000_000, count: 10 },
  ],
};

function setupMocks() {
  mockedResolveSessionContext.mockResolvedValue({ userId: MOCK_USER_ID, orgId: MOCK_ORG_ID, role: "owner" });
  mockedGetAttributionDetailByKey.mockResolvedValue(mockDetailResult);
  mockedGetAttributionDetailByTag.mockResolvedValue(mockDetailResult);
}

function makeParams(key: string): { params: Promise<{ key: string }> } {
  return { params: Promise.resolve({ key }) };
}

describe("GET /api/cost-events/attribution/[key]", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("returns 200 with API key detail including daily and models", async () => {
    setupMocks();

    const req = new Request("http://localhost/api/cost-events/attribution/key-abc?groupBy=api_key");
    const res = await GET(req, makeParams("key-abc"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.key).toBe("key-abc");
    expect(body.data.daily).toEqual(mockDetailResult.daily);
    expect(body.data.models).toEqual(mockDetailResult.models);
    expect(body.data.totalCostMicrodollars).toBe(8_000_000);
    expect(body.data.requestCount).toBe(40);
    expect(body.data.avgCostMicrodollars).toBe(200_000);
  });

  it("returns 200 with tag value detail", async () => {
    setupMocks();

    const req = new Request("http://localhost/api/cost-events/attribution/customer-alpha?groupBy=customer_id");
    const res = await GET(req, makeParams("customer-alpha"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.key).toBe("customer-alpha");
    expect(mockedGetAttributionDetailByTag).toHaveBeenCalledWith(
      MOCK_ORG_ID,
      "customer_id",
      "customer-alpha",
      30,
      undefined,
    );
  });

  it("uses default period 30d", async () => {
    setupMocks();

    const req = new Request("http://localhost/api/cost-events/attribution/key-abc?groupBy=api_key");
    await GET(req, makeParams("key-abc"));

    expect(mockedGetAttributionDetailByKey).toHaveBeenCalledWith(MOCK_ORG_ID, "key-abc", 30, undefined);
  });

  it("parses 7d period correctly", async () => {
    setupMocks();

    const req = new Request("http://localhost/api/cost-events/attribution/key-abc?groupBy=api_key&period=7d");
    await GET(req, makeParams("key-abc"));

    expect(mockedGetAttributionDetailByKey).toHaveBeenCalledWith(MOCK_ORG_ID, "key-abc", 7, undefined);
  });

  it("parses 90d period correctly", async () => {
    setupMocks();

    const req = new Request("http://localhost/api/cost-events/attribution/key-abc?groupBy=api_key&period=90d");
    await GET(req, makeParams("key-abc"));

    expect(mockedGetAttributionDetailByKey).toHaveBeenCalledWith(MOCK_ORG_ID, "key-abc", 90, undefined);
  });

  it("returns 401 when session is invalid", async () => {
    const { AuthenticationRequiredError } = await import("@/lib/auth/errors");
    mockedResolveSessionContext.mockRejectedValue(new AuthenticationRequiredError());

    const req = new Request("http://localhost/api/cost-events/attribution/key-abc?groupBy=api_key");
    const res = await GET(req, makeParams("key-abc"));

    expect(res.status).toBe(401);
  });

  it("returns 500 when query throws", async () => {
    mockedResolveSessionContext.mockResolvedValue({ userId: MOCK_USER_ID, orgId: MOCK_ORG_ID, role: "owner" });
    mockedGetAttributionDetailByKey.mockRejectedValue(new Error("DB timeout"));

    vi.spyOn(console, "error").mockImplementation(() => {});

    const req = new Request("http://localhost/api/cost-events/attribution/key-abc?groupBy=api_key");
    const res = await GET(req, makeParams("key-abc"));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("internal_error");
  });

  it("returns 400 when groupBy is missing", async () => {
    setupMocks();

    const req = new Request("http://localhost/api/cost-events/attribution/key-abc");
    const res = await GET(req, makeParams("key-abc"));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("validation_error");
  });

  it("returns 400 for path traversal in key", async () => {
    setupMocks();

    const req = new Request("http://localhost/api/cost-events/attribution/..%2F..%2Fetc?groupBy=api_key");
    const res = await GET(req, makeParams("../etc"));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid_key");
  });

  it('maps key "(no key)" to null apiKeyId for api_key groupBy', async () => {
    setupMocks();

    const req = new Request("http://localhost/api/cost-events/attribution/(no%20key)?groupBy=api_key");
    await GET(req, makeParams("(no key)"));

    expect(mockedGetAttributionDetailByKey).toHaveBeenCalledWith(MOCK_ORG_ID, null, 30, undefined);
  });

  it("returns valid response with empty daily and models", async () => {
    mockedResolveSessionContext.mockResolvedValue({ userId: MOCK_USER_ID, orgId: MOCK_ORG_ID, role: "owner" });
    mockedGetAttributionDetailByKey.mockResolvedValue({ daily: [], models: [] });

    const req = new Request("http://localhost/api/cost-events/attribution/key-abc?groupBy=api_key");
    const res = await GET(req, makeParams("key-abc"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.daily).toEqual([]);
    expect(body.data.models).toEqual([]);
    expect(body.data.totalCostMicrodollars).toBe(0);
    expect(body.data.requestCount).toBe(0);
    expect(body.data.avgCostMicrodollars).toBe(0);
  });
});
