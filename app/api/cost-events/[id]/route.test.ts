import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthenticationRequiredError } from "@/lib/auth/errors";
import { resolveSessionUserId } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { GET } from "./route";

vi.mock("@/lib/auth/session", () => ({
  resolveSessionUserId: vi.fn(),
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

const mockedResolveSessionUserId = vi.mocked(resolveSessionUserId);
const mockedGetDb = vi.mocked(getDb);

const VALID_UUID = "a0000000-0000-4000-a000-000000000001";
const PREFIXED_ID = `ns_evt_${VALID_UUID}`;

function makeCostEventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: VALID_UUID,
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
    createdAt: new Date("2026-03-18T00:00:00.000Z"),
    traceId: null,
    source: "proxy",
    tags: {},
    keyName: "My Key",
    ...overrides,
  };
}

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makeRequest() {
  return new Request("http://localhost:3000/api/cost-events/" + VALID_UUID);
}

describe("GET /api/cost-events/[id]", () => {
  let mockSelect: ReturnType<typeof vi.fn>;
  let mockFrom: ReturnType<typeof vi.fn>;
  let mockInnerJoin: ReturnType<typeof vi.fn>;
  let mockWhere: ReturnType<typeof vi.fn>;
  let mockLimit: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockLimit = vi.fn();
    mockWhere = vi.fn(() => ({ limit: mockLimit }));
    mockInnerJoin = vi.fn(() => ({ where: mockWhere }));
    mockFrom = vi.fn(() => ({ innerJoin: mockInnerJoin }));
    mockSelect = vi.fn(() => ({ from: mockFrom }));
    mockedGetDb.mockReturnValue({ select: mockSelect } as unknown as ReturnType<typeof getDb>);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 200 for owned cost event", async () => {
    mockedResolveSessionUserId.mockResolvedValue("user-1");
    const row = makeCostEventRow();
    mockLimit.mockResolvedValue([row]);

    const res = await GET(makeRequest(), makeContext(VALID_UUID));
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.data).toEqual(
      expect.objectContaining({
        id: PREFIXED_ID,
        requestId: "req-001",
        provider: "openai",
        model: "gpt-4o",
        inputTokens: 100,
        outputTokens: 50,
        cachedInputTokens: 0,
        reasoningTokens: 0,
        costMicrodollars: 1500,
        durationMs: 320,
        createdAt: "2026-03-18T00:00:00.000Z",
        source: "proxy",
        traceId: null,
        tags: {},
        keyName: "My Key",
      }),
    );
  });

  it("returns 404 for missing event", async () => {
    mockedResolveSessionUserId.mockResolvedValue("user-1");
    mockLimit.mockResolvedValue([]);

    const res = await GET(makeRequest(), makeContext(VALID_UUID));
    expect(res.status).toBe(404);

    const json = await res.json();
    expect(json.error.code).toBe("not_found");
    expect(json.error.message).toBe("Cost event not found.");
  });

  it("returns 404 for another user's event (different userId on apiKey)", async () => {
    // The query joins on apiKeys.userId = sessionUserId,
    // so a different user's event simply returns no rows.
    mockedResolveSessionUserId.mockResolvedValue("user-other");
    mockLimit.mockResolvedValue([]);

    const res = await GET(makeRequest(), makeContext(VALID_UUID));
    expect(res.status).toBe(404);

    const json = await res.json();
    expect(json.error.code).toBe("not_found");
  });

  it("returns 401 when unauthenticated", async () => {
    mockedResolveSessionUserId.mockRejectedValue(
      new AuthenticationRequiredError(),
    );

    const res = await GET(makeRequest(), makeContext(VALID_UUID));
    expect(res.status).toBe(401);

    const json = await res.json();
    expect(json.error.code).toBe("authentication_required");
  });

  it("returns 400 for invalid ID format", async () => {
    mockedResolveSessionUserId.mockResolvedValue("user-1");

    const res = await GET(makeRequest(), makeContext("not-a-uuid"));
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error.code).toBe("validation_error");
    expect(json.error.message).toBe("Invalid cost event ID.");
  });

  it("accepts ns_evt_ prefixed ID", async () => {
    mockedResolveSessionUserId.mockResolvedValue("user-1");
    const row = makeCostEventRow();
    mockLimit.mockResolvedValue([row]);

    const res = await GET(makeRequest(), makeContext(PREFIXED_ID));
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.data.id).toBe(PREFIXED_ID);
  });

  it("response shape matches costEventRecordSchema", async () => {
    mockedResolveSessionUserId.mockResolvedValue("user-1");
    const row = makeCostEventRow();
    mockLimit.mockResolvedValue([row]);

    const res = await GET(makeRequest(), makeContext(VALID_UUID));
    const json = await res.json();

    // Verify all expected fields are present
    const data = json.data;
    expect(data).toHaveProperty("id");
    expect(data).toHaveProperty("requestId");
    expect(data).toHaveProperty("apiKeyId");
    expect(data).toHaveProperty("provider");
    expect(data).toHaveProperty("model");
    expect(data).toHaveProperty("inputTokens");
    expect(data).toHaveProperty("outputTokens");
    expect(data).toHaveProperty("cachedInputTokens");
    expect(data).toHaveProperty("reasoningTokens");
    expect(data).toHaveProperty("costMicrodollars");
    expect(data).toHaveProperty("durationMs");
    expect(data).toHaveProperty("createdAt");
    expect(data).toHaveProperty("source");
    expect(data).toHaveProperty("traceId");
    expect(data).toHaveProperty("tags");
    expect(data).toHaveProperty("keyName");

    // Verify ID fields are prefixed
    expect(data.id).toMatch(/^ns_evt_/);
    expect(data.apiKeyId).toMatch(/^ns_key_/);

    // Verify date is ISO string
    expect(data.createdAt).toBe("2026-03-18T00:00:00.000Z");
  });

  it("returns 404 for cost event with null apiKeyId (innerJoin excludes it)", async () => {
    // When apiKeyId is null on the cost_events row, the INNER JOIN with
    // api_keys produces no matching rows — the event is effectively invisible.
    mockedResolveSessionUserId.mockResolvedValue("user-1");
    mockLimit.mockResolvedValue([]);

    const res = await GET(makeRequest(), makeContext(VALID_UUID));
    expect(res.status).toBe(404);

    const json = await res.json();
    expect(json.error.code).toBe("not_found");
    expect(json.error.message).toBe("Cost event not found.");
  });
});
