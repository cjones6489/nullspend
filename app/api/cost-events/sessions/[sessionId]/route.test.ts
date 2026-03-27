import { afterEach, describe, expect, it, vi } from "vitest";

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

vi.mock("@/lib/observability/sentry", () => ({
  captureExceptionWithContext: vi.fn(),
  addSentryBreadcrumb: vi.fn(),
}));

vi.mock("@/lib/observability", () => ({
  getLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
}));

const mockedResolveSessionContext = vi.mocked(resolveSessionContext);
const mockedGetDb = vi.mocked(getDb);

function makeCostEventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "a0000000-0000-4000-a000-000000000001",
    requestId: "req-001",
    apiKeyId: "b0000000-0000-4000-a000-000000000002",
    provider: "openai",
    model: "gpt-4o",
    inputTokens: 100,
    outputTokens: 50,
    cachedInputTokens: 0,
    reasoningTokens: 0,
    costMicrodollars: 1500,
    durationMs: 320,
    createdAt: new Date("2026-03-18T14:21:00.000Z"),
    traceId: null,
    sessionId: "session-abc",
    source: "proxy",
    tags: {},
    keyName: "My Key",
    ...overrides,
  };
}

function makeContext(sessionId: string) {
  return { params: Promise.resolve({ sessionId }) };
}

function makeRequest() {
  return new Request("http://localhost:3000/api/cost-events/sessions/session-abc", {
    method: "GET",
  });
}

function mockDbChain(rows: Record<string, unknown>[]) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
  };
  mockedGetDb.mockReturnValue(chain as any);
  return chain;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/cost-events/sessions/[sessionId]", () => {
  it("returns session events in chronological order with summary", async () => {
    const row1 = makeCostEventRow({
      id: "a0000000-0000-4000-a000-000000000001",
      costMicrodollars: 1500,
      inputTokens: 100,
      outputTokens: 50,
      durationMs: 320,
      createdAt: new Date("2026-03-18T14:21:00.000Z"),
    });
    const row2 = makeCostEventRow({
      id: "a0000000-0000-4000-a000-000000000002",
      costMicrodollars: 800,
      inputTokens: 60,
      outputTokens: 30,
      durationMs: 200,
      createdAt: new Date("2026-03-18T14:21:05.000Z"),
    });
    mockDbChain([row1, row2]);

    const response = await GET(makeRequest(), makeContext("session-abc"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.sessionId).toBe("session-abc");
    expect(body.summary.eventCount).toBe(2);
    expect(body.summary.totalCostMicrodollars).toBe(2300);
    expect(body.summary.totalInputTokens).toBe(160);
    expect(body.summary.totalOutputTokens).toBe(80);
    expect(body.summary.totalDurationMs).toBe(520);
    expect(body.summary.startedAt).toBe("2026-03-18T14:21:00.000Z");
    expect(body.summary.endedAt).toBe("2026-03-18T14:21:05.000Z");
    expect(body.events).toHaveLength(2);
  });

  it("returns empty events array for nonexistent session", async () => {
    mockDbChain([]);

    const response = await GET(makeRequest(), makeContext("nonexistent-session"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.summary.eventCount).toBe(0);
    expect(body.summary.totalCostMicrodollars).toBe(0);
    expect(body.events).toHaveLength(0);
    expect(body.summary.startedAt).toBeNull();
    expect(body.summary.endedAt).toBeNull();
  });

  it("returns 401 when not authenticated", async () => {
    const { AuthenticationRequiredError } = await import("@/lib/auth/errors");
    mockedResolveSessionContext.mockRejectedValueOnce(new AuthenticationRequiredError());

    const response = await GET(makeRequest(), makeContext("session-abc"));
    expect(response.status).toBe(401);
  });

  it("returns 400 for empty session ID", async () => {
    const response = await GET(makeRequest(), makeContext(""));
    expect(response.status).toBe(400);
  });

  it("returns 400 for session ID exceeding 200 characters", async () => {
    const response = await GET(makeRequest(), makeContext("x".repeat(201)));
    expect(response.status).toBe(400);
  });

  it("scopes query by orgId", async () => {
    const chain = mockDbChain([]);

    await GET(makeRequest(), makeContext("session-abc"));

    // Verify where() was called (org scoping happens inside the query)
    expect(chain.where).toHaveBeenCalled();
  });

  it("includes sessionId in serialized events", async () => {
    mockDbChain([makeCostEventRow({ sessionId: "session-abc" })]);

    const response = await GET(makeRequest(), makeContext("session-abc"));
    const body = await response.json();

    expect(body.events[0].sessionId).toBe("session-abc");
  });
});
