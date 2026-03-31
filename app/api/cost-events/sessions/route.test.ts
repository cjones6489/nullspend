import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveSessionContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { GET } from "./route";

vi.mock("@/lib/auth/session", () => ({
  resolveSessionContext: vi.fn().mockResolvedValue({ userId: "user-1", orgId: "org-test-1", role: "owner" }),
}));

vi.mock("@/lib/auth/org-authorization", () => ({
  assertOrgRole: vi.fn().mockResolvedValue({ userId: "user-1", orgId: "org-test-1", role: "owner" }),
}));

vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(),
}));

vi.mock("@/lib/api-version", () => ({
  CURRENT_VERSION: "2026-04-01",
}));

const mockedResolveSessionContext = vi.mocked(resolveSessionContext);
const mockedGetDb = vi.mocked(getDb);

function makeSessionRow(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: "ses_test_001",
    eventCount: 12,
    totalCostMicrodollars: 45000,
    firstEventAt: new Date("2026-03-28T10:00:00Z"),
    lastEventAt: new Date("2026-03-28T12:00:00Z"),
    ...overrides,
  };
}

function makeRequest(url = "http://localhost:3000/api/cost-events/sessions"): Request {
  return new Request(url, { method: "GET" });
}

function mockDbChain(rows: Record<string, unknown>[]) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
  };
  mockedGetDb.mockReturnValue(chain as unknown as ReturnType<typeof getDb>);
  return chain;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/cost-events/sessions", () => {
  it("returns 200 with session list", async () => {
    const rows = [
      makeSessionRow({ sessionId: "ses_1" }),
      makeSessionRow({ sessionId: "ses_2", eventCount: 5, totalCostMicrodollars: 12000 }),
    ];
    mockDbChain(rows);

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.data).toHaveLength(2);
    expect(json.data[0].sessionId).toBe("ses_1");
    expect(json.data[1].sessionId).toBe("ses_2");
    expect(json.cursor).toBeNull();
  });

  it("returns empty data array when no sessions exist", async () => {
    mockDbChain([]);

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.data).toEqual([]);
    expect(json.cursor).toBeNull();
  });

  it("returns cursor when more pages available", async () => {
    // 26 rows = 25 per page + 1 extra means hasMore=true
    const rows = Array.from({ length: 26 }, (_, i) =>
      makeSessionRow({
        sessionId: `ses_${i}`,
        lastEventAt: new Date(`2026-03-${String(28 - i).padStart(2, "0")}T12:00:00Z`),
      }),
    );
    mockDbChain(rows);

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.data).toHaveLength(25);
    expect(json.cursor).toBeTruthy();
    expect(typeof json.cursor).toBe("string");
  });

  it("passes cursor parameter to query", async () => {
    const chain = mockDbChain([]);
    const cursorDate = "2026-03-25T12:00:00.000Z";

    await GET(makeRequest(`http://localhost:3000/api/cost-events/sessions?cursor=${cursorDate}`));

    // where should be called with cursor condition
    expect(chain.where).toHaveBeenCalled();
  });

  it("serializes dates as ISO strings", async () => {
    mockDbChain([makeSessionRow()]);

    const res = await GET(makeRequest());
    const json = await res.json();

    expect(json.data[0].firstEventAt).toBe("2026-03-28T10:00:00.000Z");
    expect(json.data[0].lastEventAt).toBe("2026-03-28T12:00:00.000Z");
  });

  it("includes NullSpend-Version header", async () => {
    mockDbChain([]);

    const res = await GET(makeRequest());
    expect(res.headers.get("NullSpend-Version")).toBe("2026-04-01");
  });

  it("returns error when auth fails", async () => {
    mockedResolveSessionContext.mockRejectedValue(new Error("auth_required"));

    const res = await GET(makeRequest());
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
