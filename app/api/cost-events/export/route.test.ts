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

describe("GET /api/cost-events/export", () => {
  it("returns CSV with correct headers and content type", async () => {
    mockDbChain([
      {
        id: "evt-1",
        requestId: "req-001",
        provider: "openai",
        model: "gpt-4o",
        inputTokens: 100,
        outputTokens: 50,
        cachedInputTokens: 0,
        reasoningTokens: 0,
        costMicrodollars: 1500,
        durationMs: 320,
        source: "proxy",
        sessionId: null,
        traceId: null,
        keyName: "My Key",
        createdAt: new Date("2026-03-27T14:00:00.000Z"),
        costBreakdown: { input: 800, output: 600, cached: 100 },
      },
    ]);

    const res = await GET(new Request("http://localhost:3000/api/cost-events/export"));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toContain("attachment");
    expect(res.headers.get("content-disposition")).toContain("nullspend-cost-events-");

    const csv = await res.text();
    const lines = csv.split("\n");
    expect(lines[0]).toBe("id,request_id,provider,model,input_tokens,output_tokens,cached_input_tokens,reasoning_tokens,cost_microdollars,cost_usd,duration_ms,source,session_id,trace_id,key_name,created_at,cost_breakdown_input,cost_breakdown_output,cost_breakdown_cached,cost_breakdown_reasoning,cost_breakdown_tool_definition");
    expect(lines[1]).toContain("evt-1");
    expect(lines[1]).toContain("gpt-4o");
    expect(lines[1]).toContain("0.001500");
    expect(lines[1]).toContain("My Key");
    // Breakdown columns: input=800, output=600, cached=100, reasoning empty, tool_definition empty
    expect(lines[1]).toContain("800,600,100,,");
  });

  it("exports empty breakdown columns when costBreakdown is null", async () => {
    mockDbChain([
      {
        id: "evt-null-bd",
        requestId: "req-null",
        provider: "openai",
        model: "gpt-4o",
        inputTokens: 100,
        outputTokens: 50,
        cachedInputTokens: 0,
        reasoningTokens: 0,
        costMicrodollars: 1500,
        durationMs: 320,
        source: "api",
        sessionId: null,
        traceId: null,
        keyName: null,
        createdAt: new Date("2026-03-27T14:00:00.000Z"),
        costBreakdown: null,
      },
    ]);

    const res = await GET(new Request("http://localhost:3000/api/cost-events/export"));
    const csv = await res.text();
    const dataLine = csv.split("\n")[1];
    // Last 5 columns should all be empty
    expect(dataLine).toMatch(/,,,,$/);
  });

  it("returns empty CSV with only headers when no data", async () => {
    mockDbChain([]);

    const res = await GET(new Request("http://localhost:3000/api/cost-events/export"));
    const csv = await res.text();
    const lines = csv.split("\n");

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("id,request_id");
  });

  it("escapes commas and quotes in model names", async () => {
    mockDbChain([
      {
        id: "evt-2",
        requestId: "req-002",
        provider: "openai",
        model: 'gpt-4o,"special"',
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        reasoningTokens: 0,
        costMicrodollars: 0,
        durationMs: null,
        source: "proxy",
        sessionId: "session-1",
        traceId: "abc123",
        keyName: null,
        createdAt: new Date("2026-03-27T14:00:00.000Z"),
      },
    ]);

    const res = await GET(new Request("http://localhost:3000/api/cost-events/export"));
    const csv = await res.text();

    expect(csv).toContain('"gpt-4o,""special"""');
  });

  it("escapes commas in session IDs and other string fields", async () => {
    mockDbChain([
      {
        id: "evt-3",
        requestId: "req-003",
        provider: "openai",
        model: "gpt-4o",
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        reasoningTokens: 0,
        costMicrodollars: 0,
        durationMs: null,
        source: "proxy",
        sessionId: "task,with,commas",
        traceId: null,
        keyName: 'Key "Production"',
        createdAt: new Date("2026-03-27T14:00:00.000Z"),
      },
    ]);

    const res = await GET(new Request("http://localhost:3000/api/cost-events/export"));
    const csv = await res.text();
    const dataLine = csv.split("\n")[1];

    // Session ID with commas should be quoted
    expect(dataLine).toContain('"task,with,commas"');
    // Key name with quotes should be double-escaped
    expect(dataLine).toContain('"Key ""Production"""');
  });

  it("passes filters through to query", async () => {
    const chain = mockDbChain([]);

    await GET(new Request("http://localhost:3000/api/cost-events/export?provider=openai&model=gpt-4o"));

    expect(chain.where).toHaveBeenCalled();
  });

  it("returns 401 when not authenticated", async () => {
    const { AuthenticationRequiredError } = await import("@/lib/auth/errors");
    mockedResolveSessionContext.mockRejectedValueOnce(new AuthenticationRequiredError());

    const res = await GET(new Request("http://localhost:3000/api/cost-events/export"));
    expect(res.status).toBe(401);
  });

  it("caps at 10,000 rows", async () => {
    const chain = mockDbChain([]);

    await GET(new Request("http://localhost:3000/api/cost-events/export"));

    expect(chain.limit).toHaveBeenCalledWith(10_000);
  });
});
