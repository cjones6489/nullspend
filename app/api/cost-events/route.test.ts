import { afterEach, describe, expect, it, vi } from "vitest";

import { authenticateApiKey } from "@/lib/auth/with-api-key-auth";
import { insertCostEvent } from "@/lib/cost-events/ingest";
import { listCostEvents } from "@/lib/cost-events/list-cost-events";
import { withIdempotency } from "@/lib/resilience/idempotency";
import { dispatchCostEventToEndpoints, fetchWebhookEndpoints } from "@/lib/webhooks/dispatch";
import { GET, POST } from "./route";

vi.mock("@/lib/auth/with-api-key-auth", () => ({
  authenticateApiKey: vi.fn(),
  applyRateLimitHeaders: vi.fn((res: Response) => res),
}));

vi.mock("@/lib/auth/session", () => ({
  resolveSessionContext: vi.fn().mockResolvedValue({ userId: "user-1", orgId: "org-test-1", role: "owner" }),
}));

vi.mock("@/lib/auth/org-authorization", () => ({
  assertOrgRole: vi.fn().mockResolvedValue({ userId: "user-1", orgId: "org-test-1", role: "owner" }),
  assertOrgMember: vi.fn().mockResolvedValue({ userId: "user-1", orgId: "org-test-1", role: "owner" }),
}));

vi.mock("@/lib/cost-events/ingest", () => ({
  costEventInputSchema: {
    parse: vi.fn((body: unknown) => body),
  },
  insertCostEvent: vi.fn(),
}));

vi.mock("@/lib/cost-events/list-cost-events", () => ({
  listCostEvents: vi.fn(() => Promise.resolve({ data: [], cursor: null })),
}));

vi.mock("@/lib/api-version", () => ({
  CURRENT_VERSION: "2026-04-01",
}));

vi.mock("@/lib/resilience/idempotency", () => ({
  withIdempotency: vi.fn((_req: Request, handler: () => Promise<Response>) => handler()),
}));

vi.mock("@/lib/webhooks/dispatch", () => ({
  fetchWebhookEndpoints: vi.fn(() => Promise.resolve([
    { id: "ep-1", url: "https://example.com/hook", signingSecret: "sec", eventTypes: [] },
  ])),
  dispatchCostEventToEndpoints: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/lib/observability", () => ({
  withRequestContext: vi.fn((handler: (req: Request) => Promise<Response>) => handler),
  getLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
}));

const mockedAuthenticateApiKey = vi.mocked(authenticateApiKey);
const mockedInsertCostEvent = vi.mocked(insertCostEvent);
const mockedFetchWebhookEndpoints = vi.mocked(fetchWebhookEndpoints);
const mockedDispatchCostEventToEndpoints = vi.mocked(dispatchCostEventToEndpoints);

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
      orgId: "org-test-1",
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
    expect(json.data).toEqual({
      id: "ns_evt_ce-1",
      createdAt: "2026-03-18T00:00:00.000Z",
    });
  });

  it("returns 200 for deduplicated event", async () => {
    mockedAuthenticateApiKey.mockResolvedValue({
      userId: "user-1",
      orgId: "org-test-1",
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
      orgId: "org-test-1",
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
      { userId: "user-1", orgId: "org-test-1", apiKeyId: "key-1" },
      "ns_abc",
    );
  });

  it("dispatches webhook on new event", async () => {
    mockedAuthenticateApiKey.mockResolvedValue({
      userId: "user-1",
      orgId: "org-test-1",
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
    expect(mockedFetchWebhookEndpoints).toHaveBeenCalledWith("org-test-1");
    expect(mockedDispatchCostEventToEndpoints).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ source: "api" }),
    );
  });

  it("does not dispatch webhook on deduplicated event", async () => {
    mockedAuthenticateApiKey.mockResolvedValue({
      userId: "user-1",
      orgId: "org-test-1",
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
    expect(mockedDispatchCostEventToEndpoints).not.toHaveBeenCalled();
  });

  it("wraps handler with idempotency middleware", async () => {
    mockedAuthenticateApiKey.mockResolvedValue({
      userId: "user-1",
      orgId: "org-test-1",
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

// ---------------------------------------------------------------------------
// GET /api/cost-events — tag filtering
// ---------------------------------------------------------------------------

const mockedListCostEvents = vi.mocked(listCostEvents);

describe("GET /api/cost-events", () => {
  it("passes tag.* query params to listCostEvents as tags filter", async () => {
    mockedListCostEvents.mockResolvedValue({ data: [], cursor: null });

    const request = new Request(
      "http://localhost:3000/api/cost-events?tag.project=alpha&tag.env=prod",
    );
    await GET(request);

    expect(mockedListCostEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        tags: { project: "alpha", env: "prod" },
      }),
    );
  });

  it("does not pass tags when no tag.* params present", async () => {
    mockedListCostEvents.mockResolvedValue({ data: [], cursor: null });

    const request = new Request("http://localhost:3000/api/cost-events");
    await GET(request);

    expect(mockedListCostEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org-test-1",
      }),
    );
    const callArgs = mockedListCostEvents.mock.calls[0][0];
    expect(callArgs.tags).toBeUndefined();
  });

  it("filters by requestId when provided", async () => {
    mockedListCostEvents.mockResolvedValue({ data: [], cursor: null });

    const request = new Request(
      "http://localhost:3000/api/cost-events?requestId=req-123",
    );
    await GET(request);

    expect(mockedListCostEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org-test-1",
        requestId: "req-123",
      }),
    );
  });

  it("filters by sessionId when provided", async () => {
    mockedListCostEvents.mockResolvedValue({ data: [], cursor: null });

    const request = new Request(
      "http://localhost:3000/api/cost-events?sessionId=session-abc-123",
    );
    await GET(request);

    expect(mockedListCostEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org-test-1",
        sessionId: "session-abc-123",
      }),
    );
  });
});
