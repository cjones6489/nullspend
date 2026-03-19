import { afterEach, describe, expect, it, vi } from "vitest";

import { authenticateApiKey } from "@/lib/auth/with-api-key-auth";
import { insertCostEvent } from "@/lib/cost-events/ingest";
import { withIdempotency } from "@/lib/resilience/idempotency";
import { buildCostEventWebhookPayload, dispatchWebhookEvent } from "@/lib/webhooks/dispatch";
import { POST } from "./route";

vi.mock("@/lib/auth/with-api-key-auth", () => ({
  authenticateApiKey: vi.fn(),
  applyRateLimitHeaders: vi.fn((res: Response) => res),
}));

vi.mock("@/lib/cost-events/ingest", () => ({
  costEventInputSchema: {
    parse: vi.fn((body: unknown) => body),
  },
  insertCostEvent: vi.fn(),
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
  dispatchWebhookEvent: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/lib/observability", () => ({
  withRequestContext: vi.fn((handler: (req: Request) => Promise<Response>) => handler),
  getLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
}));

const mockedAuthenticateApiKey = vi.mocked(authenticateApiKey);
const mockedInsertCostEvent = vi.mocked(insertCostEvent);
const mockedBuildCostEventWebhookPayload = vi.mocked(buildCostEventWebhookPayload);
const mockedDispatchWebhookEvent = vi.mocked(dispatchWebhookEvent);

const VALID_EVENT = {
  provider: "openai",
  model: "gpt-4o",
  inputTokens: 100,
  outputTokens: 50,
  costMicrodollars: 1500,
};

function makeRequest(body: unknown, headers?: Record<string, string>): Request {
  return new Request("http://localhost:3000/api/cost-events", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-nullspend-key": "ns_live_sk_test0001",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/cost-events", () => {
  it("returns 201 with id for valid single event", async () => {
    mockedAuthenticateApiKey.mockResolvedValue({
      userId: "user-1",
      keyId: "key-1",
      apiVersion: "2026-04-01",
    });
    mockedInsertCostEvent.mockResolvedValue({
      id: "ce-1",
      createdAt: "2026-03-18T00:00:00.000Z",
      deduplicated: false,
    });

    const res = await POST(makeRequest(VALID_EVENT));
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json).toEqual({
      id: "ns_evt_ce-1",
      createdAt: "2026-03-18T00:00:00.000Z",
    });
  });

  it("returns 200 for deduplicated event", async () => {
    mockedAuthenticateApiKey.mockResolvedValue({
      userId: "user-1",
      keyId: "key-1",
      apiVersion: "2026-04-01",
    });
    mockedInsertCostEvent.mockResolvedValue({
      id: "ce-existing",
      createdAt: "2026-03-17T00:00:00.000Z",
      deduplicated: true,
    });

    const res = await POST(makeRequest(VALID_EVENT));
    expect(res.status).toBe(200);
  });

  it("returns auth error response when API key is invalid", async () => {
    const authError = new Response(
      JSON.stringify({ error: { code: "authentication_required", message: "authentication_required", details: null } }),
      { status: 401 },
    );
    mockedAuthenticateApiKey.mockResolvedValue(authError);

    const res = await POST(makeRequest(VALID_EVENT));
    expect(res.status).toBe(401);
  });

  it("passes Idempotency-Key header to insertCostEvent", async () => {
    mockedAuthenticateApiKey.mockResolvedValue({
      userId: "user-1",
      keyId: "key-1",
      apiVersion: "2026-04-01",
    });
    mockedInsertCostEvent.mockResolvedValue({
      id: "ce-2",
      createdAt: "2026-03-18T00:00:00.000Z",
      deduplicated: false,
    });

    await POST(makeRequest(VALID_EVENT, { "Idempotency-Key": "ns_abc" }));

    expect(mockedInsertCostEvent).toHaveBeenCalledWith(
      VALID_EVENT,
      { userId: "user-1", apiKeyId: "key-1" },
      "ns_abc",
    );
  });

  it("dispatches webhook on new event", async () => {
    mockedAuthenticateApiKey.mockResolvedValue({
      userId: "user-1",
      keyId: "key-1",
      apiVersion: "2026-04-01",
    });
    mockedInsertCostEvent.mockResolvedValue({
      id: "ce-3",
      createdAt: "2026-03-18T00:00:00.000Z",
      deduplicated: false,
    });

    await POST(makeRequest(VALID_EVENT));

    // Allow fire-and-forget promise to resolve
    await new Promise((r) => setTimeout(r, 10));
    expect(mockedBuildCostEventWebhookPayload).toHaveBeenCalledWith(
      expect.objectContaining({ source: "api" }),
    );
    expect(mockedDispatchWebhookEvent).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ type: "cost_event.created" }),
    );
  });

  it("does not dispatch webhook on deduplicated event", async () => {
    mockedAuthenticateApiKey.mockResolvedValue({
      userId: "user-1",
      keyId: "key-1",
      apiVersion: "2026-04-01",
    });
    mockedInsertCostEvent.mockResolvedValue({
      id: "ce-existing",
      createdAt: "2026-03-17T00:00:00.000Z",
      deduplicated: true,
    });

    await POST(makeRequest(VALID_EVENT));
    await new Promise((r) => setTimeout(r, 10));
    expect(mockedDispatchWebhookEvent).not.toHaveBeenCalled();
  });

  it("wraps handler with idempotency middleware", async () => {
    mockedAuthenticateApiKey.mockResolvedValue({
      userId: "user-1",
      keyId: "key-1",
      apiVersion: "2026-04-01",
    });
    mockedInsertCostEvent.mockResolvedValue({
      id: "ce-4",
      createdAt: "2026-03-18T00:00:00.000Z",
      deduplicated: false,
    });

    await POST(makeRequest(VALID_EVENT));
    expect(withIdempotency).toHaveBeenCalled();
  });
});
