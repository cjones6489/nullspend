import { afterEach, describe, expect, it, vi } from "vitest";

import { authenticateApiKey } from "@/lib/auth/with-api-key-auth";
import { insertCostEventsBatch } from "@/lib/cost-events/ingest";
import { withIdempotency } from "@/lib/resilience/idempotency";
import {
  buildCostEventWebhookPayload,
  fetchWebhookEndpoints,
  dispatchToEndpoints,
} from "@/lib/webhooks/dispatch";
import { POST } from "./route";

vi.mock("@/lib/auth/with-api-key-auth", () => ({
  authenticateApiKey: vi.fn(),
  applyRateLimitHeaders: vi.fn((res: Response) => res),
}));

vi.mock("@/lib/cost-events/ingest", () => ({
  costEventBatchInputSchema: {
    parse: vi.fn((body: unknown) => body),
  },
  insertCostEventsBatch: vi.fn(),
}));

vi.mock("@/lib/resilience/idempotency", () => ({
  withIdempotency: vi.fn((_req: Request, handler: () => Promise<Response>) => handler()),
}));

vi.mock("@/lib/webhooks/dispatch", () => ({
  buildCostEventWebhookPayload: vi.fn(() => ({
    id: "evt_test",
    type: "cost_event.created",
    created_at: "2026-03-18T00:00:00Z",
    data: {},
  })),
  fetchWebhookEndpoints: vi.fn(() => Promise.resolve([
    { id: "ep-1", url: "https://example.com/hook", signingSecret: "sec", eventTypes: [] },
  ])),
  dispatchToEndpoints: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/lib/observability", () => ({
  withRequestContext: vi.fn((handler: (req: Request) => Promise<Response>) => handler),
  getLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
}));

const mockedAuthenticateApiKey = vi.mocked(authenticateApiKey);
const mockedInsertCostEventsBatch = vi.mocked(insertCostEventsBatch);
const mockedBuildCostEventWebhookPayload = vi.mocked(buildCostEventWebhookPayload);
const mockedFetchWebhookEndpoints = vi.mocked(fetchWebhookEndpoints);
const mockedDispatchToEndpoints = vi.mocked(dispatchToEndpoints);

function makeEvent(overrides?: Record<string, unknown>) {
  return {
    provider: "openai",
    model: "gpt-4o",
    inputTokens: 100,
    outputTokens: 50,
    costMicrodollars: 1500,
    ...overrides,
  };
}

function makeInsertedRow(overrides?: Record<string, unknown>) {
  return {
    id: "ce-1",
    provider: "openai",
    model: "gpt-4o",
    inputTokens: 100,
    outputTokens: 50,
    cachedInputTokens: 0,
    costMicrodollars: 1500,
    durationMs: null,
    eventType: "custom",
    toolName: null,
    toolServer: null,
    sessionId: null,
    requestId: "sdk_abc",
    source: "api",
    tags: {} as Record<string, string>,
    ...overrides,
  };
}

function makeRequest(body: unknown): Request {
  return new Request("http://localhost:3000/api/cost-events/batch", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-nullspend-key": "ns_live_sk_test0001",
    },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/cost-events/batch", () => {
  it("returns 201 with inserted count and ids", async () => {
    mockedAuthenticateApiKey.mockResolvedValue({
      userId: "user-1",
      keyId: "key-1",
      apiVersion: "2026-04-01",
    });
    mockedInsertCostEventsBatch.mockResolvedValue({
      ids: ["ce-1", "ce-2"],
      inserted: 2,
      rows: [makeInsertedRow({ id: "ce-1" }), makeInsertedRow({ id: "ce-2", model: "gpt-4o-mini" })],
    });

    const events = [makeEvent(), makeEvent({ model: "gpt-4o-mini" })];
    const res = await POST(makeRequest({ events }));
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json).toEqual({
      inserted: 2,
      ids: ["ns_evt_ce-1", "ns_evt_ce-2"],
    });
  });

  it("returns auth error when API key is invalid", async () => {
    const authError = new Response(
      JSON.stringify({ error: { code: "authentication_required", message: "authentication_required", details: null } }),
      { status: 401 },
    );
    mockedAuthenticateApiKey.mockResolvedValue(authError);

    const res = await POST(makeRequest({ events: [makeEvent()] }));
    expect(res.status).toBe(401);
  });

  it("passes correct context to insertCostEventsBatch", async () => {
    mockedAuthenticateApiKey.mockResolvedValue({
      userId: "user-2",
      keyId: "key-2",
      apiVersion: "2026-04-01",
    });
    mockedInsertCostEventsBatch.mockResolvedValue({
      ids: ["ce-3"],
      inserted: 1,
      rows: [makeInsertedRow({ id: "ce-3" })],
    });

    const events = [makeEvent()];
    await POST(makeRequest({ events }));

    expect(mockedInsertCostEventsBatch).toHaveBeenCalledWith(
      events,
      { userId: "user-2", apiKeyId: "key-2" },
    );
  });

  it("fetches endpoints once and dispatches for each inserted row", async () => {
    mockedAuthenticateApiKey.mockResolvedValue({
      userId: "user-1",
      keyId: "key-1",
      apiVersion: "2026-04-01",
    });
    mockedInsertCostEventsBatch.mockResolvedValue({
      ids: ["ce-1", "ce-2"],
      inserted: 2,
      rows: [
        makeInsertedRow({ id: "ce-1" }),
        makeInsertedRow({ id: "ce-2", model: "gpt-4o-mini" }),
      ],
    });

    const events = [makeEvent(), makeEvent({ model: "gpt-4o-mini" })];
    await POST(makeRequest({ events }));

    // Allow fire-and-forget promise to resolve
    await new Promise((r) => setTimeout(r, 10));

    // Endpoints fetched once (not per event)
    expect(mockedFetchWebhookEndpoints).toHaveBeenCalledTimes(1);
    expect(mockedFetchWebhookEndpoints).toHaveBeenCalledWith("user-1");

    // Dispatch called for each actually-inserted row
    expect(mockedDispatchToEndpoints).toHaveBeenCalledTimes(2);

    // Source is forwarded to webhook builder
    expect(mockedBuildCostEventWebhookPayload).toHaveBeenCalledTimes(2);
    for (const call of mockedBuildCostEventWebhookPayload.mock.calls) {
      expect(call[0]).toHaveProperty("source", "api");
    }
  });

  it("does not dispatch webhooks when no events inserted", async () => {
    mockedAuthenticateApiKey.mockResolvedValue({
      userId: "user-1",
      keyId: "key-1",
      apiVersion: "2026-04-01",
    });
    mockedInsertCostEventsBatch.mockResolvedValue({
      ids: [],
      inserted: 0,
      rows: [],
    });

    await POST(makeRequest({ events: [makeEvent()] }));
    await new Promise((r) => setTimeout(r, 10));
    expect(mockedFetchWebhookEndpoints).not.toHaveBeenCalled();
    expect(mockedDispatchToEndpoints).not.toHaveBeenCalled();
  });

  it("skips dispatch when no webhook endpoints configured", async () => {
    mockedAuthenticateApiKey.mockResolvedValue({
      userId: "user-1",
      keyId: "key-1",
      apiVersion: "2026-04-01",
    });
    mockedInsertCostEventsBatch.mockResolvedValue({
      ids: ["ce-1"],
      inserted: 1,
      rows: [makeInsertedRow()],
    });
    mockedFetchWebhookEndpoints.mockResolvedValue([]);

    await POST(makeRequest({ events: [makeEvent()] }));
    await new Promise((r) => setTimeout(r, 10));

    expect(mockedFetchWebhookEndpoints).toHaveBeenCalledTimes(1);
    expect(mockedDispatchToEndpoints).not.toHaveBeenCalled();
  });

  it("wraps handler with idempotency middleware", async () => {
    mockedAuthenticateApiKey.mockResolvedValue({
      userId: "user-1",
      keyId: "key-1",
      apiVersion: "2026-04-01",
    });
    mockedInsertCostEventsBatch.mockResolvedValue({
      ids: ["ce-1"],
      inserted: 1,
      rows: [makeInsertedRow()],
    });

    await POST(makeRequest({ events: [makeEvent()] }));
    expect(withIdempotency).toHaveBeenCalled();
  });
});
