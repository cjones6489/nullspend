import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateApiKey } from "@/lib/auth/with-api-key-auth";
import { updateBudgetSpendFromCostEvent } from "@/lib/budgets/update-spend";
import { insertCostEventsBatch } from "@/lib/cost-events/ingest";
import { withIdempotency } from "@/lib/resilience/idempotency";
import { detectThresholdCrossings } from "@/lib/budgets/threshold-detection";
import { invalidateProxyCache } from "@/lib/proxy-invalidate";
import {
  dispatchCostEventToEndpoints,
  dispatchToEndpoints,
  fetchWebhookEndpoints,
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
  fetchWebhookEndpoints: vi.fn(() => Promise.resolve([
    { id: "ep-1", url: "https://example.com/hook", signingSecret: "sec", eventTypes: [] },
  ])),
  dispatchCostEventToEndpoints: vi.fn(() => Promise.resolve()),
  dispatchToEndpoints: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/lib/budgets/update-spend", () => ({
  updateBudgetSpendFromCostEvent: vi.fn(() => Promise.resolve({ updatedEntities: [] })),
}));

vi.mock("@/lib/budgets/threshold-detection", () => ({
  detectThresholdCrossings: vi.fn(() => []),
}));

vi.mock("@/lib/proxy-invalidate", () => ({
  invalidateProxyCache: vi.fn(() => Promise.resolve()),
}));

const mockLogger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/observability", () => ({
  withRequestContext: vi.fn((handler: (req: Request) => Promise<Response>) => handler),
  getLogger: vi.fn(() => mockLogger),
}));

const mockedAuthenticateApiKey = vi.mocked(authenticateApiKey);
const mockedInsertCostEventsBatch = vi.mocked(insertCostEventsBatch);
const mockedFetchWebhookEndpoints = vi.mocked(fetchWebhookEndpoints);
const mockedDispatchCostEventToEndpoints = vi.mocked(dispatchCostEventToEndpoints);
const mockedDispatchToEndpoints = vi.mocked(dispatchToEndpoints);
const mockedUpdateBudgetSpend = vi.mocked(updateBudgetSpendFromCostEvent);
const mockedDetectThresholdCrossings = vi.mocked(detectThresholdCrossings);
const mockedInvalidateProxyCache = vi.mocked(invalidateProxyCache);

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
    costBreakdown: null,
    durationMs: null,
    eventType: "custom",
    toolName: null,
    toolServer: null,
    sessionId: null,
    traceId: null as string | null,
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
      orgId: "org-test-1",
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
      orgId: "org-test-1",
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
      { userId: "user-2", orgId: "org-test-1", apiKeyId: "key-2" },
    );
  });

  it("fetches endpoints once and dispatches for each inserted row", async () => {
    mockedAuthenticateApiKey.mockResolvedValue({
      userId: "user-1",
      orgId: "org-test-1",
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
    expect(mockedFetchWebhookEndpoints).toHaveBeenCalledWith("org-test-1");

    // Dispatch called for each actually-inserted row
    expect(mockedDispatchCostEventToEndpoints).toHaveBeenCalledTimes(2);

    // Source and traceId are forwarded to dispatch
    for (const call of mockedDispatchCostEventToEndpoints.mock.calls) {
      expect(call[1]).toHaveProperty("source", "api");
      expect(call[1]).toHaveProperty("traceId", null);
    }
  });

  it("forwards traceId from inserted rows to webhook builder", async () => {
    mockedAuthenticateApiKey.mockResolvedValue({
      userId: "user-1",
      orgId: "org-test-1",
      keyId: "key-1",
      apiVersion: "2026-04-01",
    });
    mockedInsertCostEventsBatch.mockResolvedValue({
      ids: ["ce-1"],
      inserted: 1,
      rows: [makeInsertedRow({ id: "ce-1", traceId: "aabbccdd11223344aabbccdd11223344" })],
    });

    const events = [makeEvent()];
    await POST(makeRequest({ events }));
    await new Promise((r) => setTimeout(r, 10));

    expect(mockedDispatchCostEventToEndpoints).toHaveBeenCalledTimes(1);
    expect(mockedDispatchCostEventToEndpoints.mock.calls[0][1]).toHaveProperty(
      "traceId",
      "aabbccdd11223344aabbccdd11223344",
    );
  });

  it("does not dispatch webhooks when no events inserted", async () => {
    mockedAuthenticateApiKey.mockResolvedValue({
      userId: "user-1",
      orgId: "org-test-1",
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
    expect(mockedDispatchCostEventToEndpoints).not.toHaveBeenCalled();
  });

  it("skips dispatch when no webhook endpoints configured", async () => {
    mockedAuthenticateApiKey.mockResolvedValue({
      userId: "user-1",
      orgId: "org-test-1",
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
    expect(mockedDispatchCostEventToEndpoints).not.toHaveBeenCalled();
  });

  it("wraps handler with idempotency middleware", async () => {
    mockedAuthenticateApiKey.mockResolvedValue({
      userId: "user-1",
      orgId: "org-test-1",
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

  it("calls updateBudgetSpendFromCostEvent per-event with individual costs", async () => {
    mockedAuthenticateApiKey.mockResolvedValue({
      userId: "user-1",
      orgId: "org-test-1",
      keyId: "key-1",
      apiVersion: "2026-04-01",
    });
    mockedInsertCostEventsBatch.mockResolvedValue({
      ids: ["ce-1", "ce-2"],
      inserted: 2,
      rows: [
        makeInsertedRow({ id: "ce-1", costMicrodollars: 1500 }),
        makeInsertedRow({ id: "ce-2", costMicrodollars: 2500 }),
      ],
    });
    mockedFetchWebhookEndpoints.mockResolvedValue([
      { id: "ep-1", url: "https://example.com/hook", signingSecret: "sec", eventTypes: [], apiVersion: "2026-04-01", payloadMode: "full" as const, previousSigningSecret: null, secretRotatedAt: null },
    ]);
    mockedUpdateBudgetSpend.mockResolvedValue({ updatedEntities: [] });

    await POST(makeRequest({ events: [makeEvent(), makeEvent()] }));
    await vi.waitFor(() => {
      expect(mockedUpdateBudgetSpend).toHaveBeenCalledTimes(2);
    });

    // Per-event: 1500 + 2500, NOT aggregated 4000
    expect(mockedUpdateBudgetSpend).toHaveBeenNthCalledWith(1,
      "org-test-1", "key-1", 1500, undefined, "user-1",
    );
    expect(mockedUpdateBudgetSpend).toHaveBeenNthCalledWith(2,
      "org-test-1", "key-1", 2500, undefined, "user-1",
    );
  });

  it("does not call updateBudgetSpendFromCostEvent when no events inserted", async () => {
    mockedAuthenticateApiKey.mockResolvedValue({
      userId: "user-1",
      orgId: "org-test-1",
      keyId: "key-1",
      apiVersion: "2026-04-01",
    });
    mockedInsertCostEventsBatch.mockResolvedValue({
      ids: [],
      inserted: 0,
      rows: [],
    });

    await POST(makeRequest({ events: [makeEvent()] }));
    await new Promise((r) => setTimeout(r, 50));

    expect(mockedUpdateBudgetSpend).not.toHaveBeenCalled();
  });

  it("budget update failure does not break response", async () => {
    mockedAuthenticateApiKey.mockResolvedValue({
      userId: "user-1",
      orgId: "org-test-1",
      keyId: "key-1",
      apiVersion: "2026-04-01",
    });
    mockedInsertCostEventsBatch.mockResolvedValue({
      ids: ["ce-1"],
      inserted: 1,
      rows: [makeInsertedRow()],
    });
    mockedFetchWebhookEndpoints.mockResolvedValue([
      { id: "ep-1", url: "https://example.com/hook", signingSecret: "sec", eventTypes: [], apiVersion: "2026-04-01", payloadMode: "full" as const, previousSigningSecret: null, secretRotatedAt: null },
    ]);
    mockedUpdateBudgetSpend.mockRejectedValue(new Error("DB timeout"));

    const res = await POST(makeRequest({ events: [makeEvent()] }));
    // Response should still be 201 — budget update is fire-and-forget
    expect(res.status).toBe(201);

    await vi.waitFor(() => {
      expect(mockedUpdateBudgetSpend).toHaveBeenCalled();
    });
  });

  it("updates budget spend even when no webhook endpoints configured", async () => {
    mockedAuthenticateApiKey.mockResolvedValue({
      userId: "user-1",
      orgId: "org-test-1",
      keyId: "key-1",
      apiVersion: "2026-04-01",
    });
    mockedInsertCostEventsBatch.mockResolvedValue({
      ids: ["ce-1"],
      inserted: 1,
      rows: [makeInsertedRow({ costMicrodollars: 5000 })],
    });
    mockedFetchWebhookEndpoints.mockResolvedValue([]);
    mockedUpdateBudgetSpend.mockResolvedValue({ updatedEntities: [] });

    await POST(makeRequest({ events: [makeEvent()] }));
    await vi.waitFor(() => {
      expect(mockedUpdateBudgetSpend).toHaveBeenCalled();
    });

    // Webhook dispatch skipped (no endpoints) but budget update still ran
    expect(mockedDispatchCostEventToEndpoints).not.toHaveBeenCalled();
    expect(mockedUpdateBudgetSpend).toHaveBeenCalledTimes(1);
    expect(mockedUpdateBudgetSpend).toHaveBeenCalledWith(
      "org-test-1",
      "key-1",
      5000,
      undefined,
      "user-1",
    );
  });

  it("accepts all three eventType values: llm, tool, custom", async () => {
    const authResult = {
      userId: "user-1",
      orgId: "org-test-1",
      keyId: "key-1",
      apiVersion: "2026-04-01",
    };

    for (const eventType of ["llm", "tool", "custom"] as const) {
      vi.clearAllMocks();
      mockedAuthenticateApiKey.mockResolvedValue(authResult);
      mockedInsertCostEventsBatch.mockResolvedValue({
        ids: ["ce-1"],
        inserted: 1,
        rows: [makeInsertedRow({ eventType })],
      });
      mockedFetchWebhookEndpoints.mockResolvedValue([]);
      mockedUpdateBudgetSpend.mockResolvedValue({ updatedEntities: [] });

      const res = await POST(makeRequest({ events: [makeEvent({ eventType })] }));
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.inserted).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Per-event budget accounting — the math must be exact
// ---------------------------------------------------------------------------

describe("POST /api/cost-events/batch — per-event budget accounting", () => {
  const AUTH = {
    userId: "user-1",
    orgId: "org-test-1",
    keyId: "key-1",
    apiVersion: "2026-04-01",
  };

  beforeEach(() => {
    mockedAuthenticateApiKey.mockResolvedValue(AUTH);
    mockedFetchWebhookEndpoints.mockResolvedValue([]);
    mockedUpdateBudgetSpend.mockResolvedValue({ updatedEntities: [] });
  });

  it("calls updateBudgetSpend once PER EVENT with that event's exact cost", async () => {
    // Three events: $0.001, $0.002, $0.003
    mockedInsertCostEventsBatch.mockResolvedValue({
      ids: ["ce-1", "ce-2", "ce-3"],
      inserted: 3,
      rows: [
        makeInsertedRow({ id: "ce-1", requestId: "r1", costMicrodollars: 1000 }),
        makeInsertedRow({ id: "ce-2", requestId: "r2", costMicrodollars: 2000 }),
        makeInsertedRow({ id: "ce-3", requestId: "r3", costMicrodollars: 3000 }),
      ],
    });

    await POST(makeRequest({ events: [makeEvent(), makeEvent(), makeEvent()] }));

    await vi.waitFor(() => {
      expect(mockedUpdateBudgetSpend).toHaveBeenCalledTimes(3);
    });

    // Verify exact amounts — NOT the total (6000)
    const calls = mockedUpdateBudgetSpend.mock.calls;
    expect(calls[0][2]).toBe(1000); // event 1: $0.001
    expect(calls[1][2]).toBe(2000); // event 2: $0.002
    expect(calls[2][2]).toBe(3000); // event 3: $0.003

    // All calls use same orgId, keyId, userId
    for (const call of calls) {
      expect(call[0]).toBe("org-test-1");
      expect(call[1]).toBe("key-1");
      expect(call[4]).toBe("user-1");
    }
  });

  it("passes each event's own tags — not merged tags from the batch", async () => {
    // Event A: env=prod, Event B: env=dev — different tag values for same key
    mockedInsertCostEventsBatch.mockResolvedValue({
      ids: ["ce-a", "ce-b"],
      inserted: 2,
      rows: [
        makeInsertedRow({ id: "ce-a", requestId: "ra", costMicrodollars: 1000, tags: { env: "prod" } }),
        makeInsertedRow({ id: "ce-b", requestId: "rb", costMicrodollars: 2000, tags: { env: "dev" } }),
      ],
    });

    await POST(makeRequest({ events: [makeEvent(), makeEvent()] }));

    await vi.waitFor(() => {
      expect(mockedUpdateBudgetSpend).toHaveBeenCalledTimes(2);
    });

    const calls = mockedUpdateBudgetSpend.mock.calls;
    // Event A: tags = { env: "prod" }, cost = 1000
    expect(calls[0][2]).toBe(1000);
    expect(calls[0][3]).toEqual({ env: "prod" });

    // Event B: tags = { env: "dev" }, cost = 2000
    expect(calls[1][2]).toBe(2000);
    expect(calls[1][3]).toEqual({ env: "dev" });
  });

  it("handles mixed tagged and untagged events correctly", async () => {
    mockedInsertCostEventsBatch.mockResolvedValue({
      ids: ["ce-tagged", "ce-bare"],
      inserted: 2,
      rows: [
        makeInsertedRow({ id: "ce-tagged", requestId: "r1", costMicrodollars: 5000, tags: { project: "alpha" } }),
        makeInsertedRow({ id: "ce-bare", requestId: "r2", costMicrodollars: 3000, tags: {} }),
      ],
    });

    await POST(makeRequest({ events: [makeEvent(), makeEvent()] }));

    await vi.waitFor(() => {
      expect(mockedUpdateBudgetSpend).toHaveBeenCalledTimes(2);
    });

    const calls = mockedUpdateBudgetSpend.mock.calls;
    // Tagged event: passes tags through
    expect(calls[0][2]).toBe(5000);
    expect(calls[0][3]).toEqual({ project: "alpha" });

    // Untagged event: tags = undefined (empty object filtered out)
    expect(calls[1][2]).toBe(3000);
    expect(calls[1][3]).toBeUndefined();
  });

  it("skips budget update for zero-cost events in batch", async () => {
    mockedInsertCostEventsBatch.mockResolvedValue({
      ids: ["ce-free", "ce-paid"],
      inserted: 2,
      rows: [
        makeInsertedRow({ id: "ce-free", requestId: "r1", costMicrodollars: 0 }),
        makeInsertedRow({ id: "ce-paid", requestId: "r2", costMicrodollars: 5000 }),
      ],
    });

    await POST(makeRequest({ events: [makeEvent(), makeEvent()] }));

    await vi.waitFor(() => {
      expect(mockedUpdateBudgetSpend).toHaveBeenCalledTimes(1);
    });

    // Only the paid event triggers a budget update
    expect(mockedUpdateBudgetSpend.mock.calls[0][2]).toBe(5000);
  });

  it("triggers threshold detection per-event, not once at end", async () => {
    const entity1 = {
      id: "b1", entityType: "api_key", entityId: "key-1",
      previousSpend: 4_900_000, newSpend: 5_100_000,
      maxBudget: 10_000_000, thresholdPercentages: [50, 80, 90, 95],
    };
    const entity2 = {
      id: "b1", entityType: "api_key", entityId: "key-1",
      previousSpend: 5_100_000, newSpend: 5_300_000,
      maxBudget: 10_000_000, thresholdPercentages: [50, 80, 90, 95],
    };

    mockedFetchWebhookEndpoints.mockResolvedValue([
      { id: "ep-1", url: "https://example.com/hook", signingSecret: "sec", eventTypes: [], apiVersion: "2026-04-01", payloadMode: "full" as const, previousSigningSecret: null, secretRotatedAt: null },
    ]);

    // First event crosses 50%, second event doesn't cross anything new
    mockedUpdateBudgetSpend
      .mockResolvedValueOnce({ updatedEntities: [entity1] })
      .mockResolvedValueOnce({ updatedEntities: [entity2] });

    mockedDetectThresholdCrossings
      .mockReturnValueOnce([{ id: "evt_1", type: "budget.threshold.warning", api_version: "2026-04-01", created_at: 0, data: { object: { threshold_percent: 50 } } }])
      .mockReturnValueOnce([]); // second event crosses nothing

    mockedInsertCostEventsBatch.mockResolvedValue({
      ids: ["ce-1", "ce-2"],
      inserted: 2,
      rows: [
        makeInsertedRow({ id: "ce-1", requestId: "r1", costMicrodollars: 200_000 }),
        makeInsertedRow({ id: "ce-2", requestId: "r2", costMicrodollars: 200_000 }),
      ],
    });

    await POST(makeRequest({ events: [makeEvent(), makeEvent()] }));

    await vi.waitFor(() => {
      expect(mockedDetectThresholdCrossings).toHaveBeenCalledTimes(2);
    });

    // Threshold detection called once per event, not once at end
    expect(mockedDetectThresholdCrossings.mock.calls[0][0]).toEqual([entity1]);
    expect(mockedDetectThresholdCrossings.mock.calls[0][1]).toBe("r1");
    expect(mockedDetectThresholdCrossings.mock.calls[1][0]).toEqual([entity2]);
    expect(mockedDetectThresholdCrossings.mock.calls[1][1]).toBe("r2");

    // Only one threshold webhook dispatched (from first event)
    expect(mockedDispatchToEndpoints).toHaveBeenCalledTimes(1);
  });

  it("one failing event budget update does not prevent others from updating", async () => {
    mockedInsertCostEventsBatch.mockResolvedValue({
      ids: ["ce-1", "ce-2", "ce-3"],
      inserted: 3,
      rows: [
        makeInsertedRow({ id: "ce-1", requestId: "r1", costMicrodollars: 1000 }),
        makeInsertedRow({ id: "ce-2", requestId: "r2", costMicrodollars: 2000 }),
        makeInsertedRow({ id: "ce-3", requestId: "r3", costMicrodollars: 3000 }),
      ],
    });

    mockedUpdateBudgetSpend
      .mockResolvedValueOnce({ updatedEntities: [] })  // event 1: success
      .mockRejectedValueOnce(new Error("DB timeout"))  // event 2: fails
      .mockResolvedValueOnce({ updatedEntities: [] }); // event 3: success

    await POST(makeRequest({ events: [makeEvent(), makeEvent(), makeEvent()] }));

    await vi.waitFor(() => {
      expect(mockedUpdateBudgetSpend).toHaveBeenCalledTimes(3);
    });

    // All three events attempted despite event 2 failure
    expect(mockedUpdateBudgetSpend.mock.calls[0][2]).toBe(1000);
    expect(mockedUpdateBudgetSpend.mock.calls[1][2]).toBe(2000);
    expect(mockedUpdateBudgetSpend.mock.calls[2][2]).toBe(3000);
  });

  it("multiple events with same tags: api_key budget gets sum, tag budget gets sum (correct)", async () => {
    // Two events, both tagged env=prod — api_key and tag budgets both get each event's cost
    mockedInsertCostEventsBatch.mockResolvedValue({
      ids: ["ce-1", "ce-2"],
      inserted: 2,
      rows: [
        makeInsertedRow({ id: "ce-1", requestId: "r1", costMicrodollars: 1000, tags: { env: "prod" } }),
        makeInsertedRow({ id: "ce-2", requestId: "r2", costMicrodollars: 2000, tags: { env: "prod" } }),
      ],
    });

    await POST(makeRequest({ events: [makeEvent(), makeEvent()] }));

    await vi.waitFor(() => {
      expect(mockedUpdateBudgetSpend).toHaveBeenCalledTimes(2);
    });

    // Both calls pass the same tags
    expect(mockedUpdateBudgetSpend.mock.calls[0][3]).toEqual({ env: "prod" });
    expect(mockedUpdateBudgetSpend.mock.calls[1][3]).toEqual({ env: "prod" });

    // api_key budget gets 1000 + 2000 = 3000 total (via two separate calls)
    // tag budget for env=prod gets 1000 + 2000 = 3000 total (correct)
    const totalCostApplied = mockedUpdateBudgetSpend.mock.calls.reduce(
      (sum, call) => sum + (call[2] as number), 0,
    );
    expect(totalCostApplied).toBe(3000);
  });

  it("heterogeneous tags: each tag budget only gets its own events' cost", async () => {
    // Event A: env=prod $1, Event B: env=dev $2, Event C: env=prod $3
    // env=prod budget should get $1 + $3 = $4 (from two updateBudgetSpend calls)
    // env=dev budget should get $2 (from one call)
    // api_key budget should get $1 + $2 + $3 = $6 (from all three calls)
    mockedInsertCostEventsBatch.mockResolvedValue({
      ids: ["ce-a", "ce-b", "ce-c"],
      inserted: 3,
      rows: [
        makeInsertedRow({ id: "ce-a", requestId: "ra", costMicrodollars: 1_000_000, tags: { env: "prod" } }),
        makeInsertedRow({ id: "ce-b", requestId: "rb", costMicrodollars: 2_000_000, tags: { env: "dev" } }),
        makeInsertedRow({ id: "ce-c", requestId: "rc", costMicrodollars: 3_000_000, tags: { env: "prod" } }),
      ],
    });

    await POST(makeRequest({ events: [makeEvent(), makeEvent(), makeEvent()] }));

    await vi.waitFor(() => {
      expect(mockedUpdateBudgetSpend).toHaveBeenCalledTimes(3);
    });

    const calls = mockedUpdateBudgetSpend.mock.calls;

    // Event A: cost=1M, tags={env:prod}
    expect(calls[0][2]).toBe(1_000_000);
    expect(calls[0][3]).toEqual({ env: "prod" });

    // Event B: cost=2M, tags={env:dev}
    expect(calls[1][2]).toBe(2_000_000);
    expect(calls[1][3]).toEqual({ env: "dev" });

    // Event C: cost=3M, tags={env:prod}
    expect(calls[2][2]).toBe(3_000_000);
    expect(calls[2][3]).toEqual({ env: "prod" });

    // The key insight: updateBudgetSpend is called with individual costs
    // and individual tags. The function itself handles matching against
    // the correct budget entities. So env=prod budget gets 1M + 3M = 4M,
    // env=dev budget gets 2M, and api_key budget gets 1M + 2M + 3M = 6M.
    // This was previously broken (all tags merged, total cost applied once).
  });
});

// ---------------------------------------------------------------------------
// Proxy cache sync after batch spend updates
// ---------------------------------------------------------------------------

describe("POST /api/cost-events/batch — proxy cache sync", () => {
  const AUTH = {
    userId: "user-1",
    orgId: "org-test-1",
    keyId: "key-1",
    apiVersion: "2026-04-01",
  };

  beforeEach(() => {
    mockedAuthenticateApiKey.mockResolvedValue(AUTH);
    mockedFetchWebhookEndpoints.mockResolvedValue([]);
  });

  it("calls invalidateProxyCache for each updated entity after spend update", async () => {
    const updatedEntities = [
      { id: "b1", entityType: "api_key", entityId: "key-1", previousSpend: 0, newSpend: 1500, maxBudget: 10_000_000, thresholdPercentages: [50] },
      { id: "b2", entityType: "tag", entityId: "env=prod", previousSpend: 0, newSpend: 1500, maxBudget: 5_000_000, thresholdPercentages: [50] },
    ];
    mockedUpdateBudgetSpend.mockResolvedValue({ updatedEntities });
    mockedInsertCostEventsBatch.mockResolvedValue({
      ids: ["ce-1"],
      inserted: 1,
      rows: [makeInsertedRow({ costMicrodollars: 1500, tags: { env: "prod" } })],
    });

    await POST(makeRequest({ events: [makeEvent()] }));
    await vi.waitFor(() => {
      expect(mockedInvalidateProxyCache).toHaveBeenCalledTimes(2);
    });

    expect(mockedInvalidateProxyCache).toHaveBeenCalledWith({
      action: "sync",
      ownerId: "org-test-1",
      entityType: "api_key",
      entityId: "key-1",
    });
    expect(mockedInvalidateProxyCache).toHaveBeenCalledWith({
      action: "sync",
      ownerId: "org-test-1",
      entityType: "tag",
      entityId: "env=prod",
    });
  });

  it("does not call invalidateProxyCache when no entities updated", async () => {
    mockedUpdateBudgetSpend.mockResolvedValue({ updatedEntities: [] });
    mockedInsertCostEventsBatch.mockResolvedValue({
      ids: ["ce-1"],
      inserted: 1,
      rows: [makeInsertedRow({ costMicrodollars: 1500 })],
    });

    await POST(makeRequest({ events: [makeEvent()] }));
    await vi.waitFor(() => {
      expect(mockedUpdateBudgetSpend).toHaveBeenCalled();
    });
    // Small extra wait to confirm no async sync calls
    await new Promise((r) => setTimeout(r, 20));

    expect(mockedInvalidateProxyCache).not.toHaveBeenCalled();
  });

  it("proxy cache sync failure does not break budget update loop", async () => {
    mockedInvalidateProxyCache.mockRejectedValue(new Error("proxy down"));
    const entity = { id: "b1", entityType: "api_key", entityId: "key-1", previousSpend: 0, newSpend: 1500, maxBudget: 10_000_000, thresholdPercentages: [50] };
    mockedUpdateBudgetSpend
      .mockResolvedValueOnce({ updatedEntities: [entity] })
      .mockResolvedValueOnce({ updatedEntities: [entity] });

    mockedInsertCostEventsBatch.mockResolvedValue({
      ids: ["ce-1", "ce-2"],
      inserted: 2,
      rows: [
        makeInsertedRow({ id: "ce-1", costMicrodollars: 1000 }),
        makeInsertedRow({ id: "ce-2", costMicrodollars: 2000 }),
      ],
    });

    const res = await POST(makeRequest({ events: [makeEvent(), makeEvent()] }));
    expect(res.status).toBe(201);

    await vi.waitFor(() => {
      expect(mockedUpdateBudgetSpend).toHaveBeenCalledTimes(2);
    });

    // Both budget updates succeeded despite proxy sync failures
    expect(mockedUpdateBudgetSpend.mock.calls[0][2]).toBe(1000);
    expect(mockedUpdateBudgetSpend.mock.calls[1][2]).toBe(2000);
  });

  it("syncs proxy for each event's entities independently", async () => {
    const entityA = { id: "b1", entityType: "api_key", entityId: "key-1", previousSpend: 0, newSpend: 1000, maxBudget: 10_000_000, thresholdPercentages: [50] };
    const entityB = { id: "b2", entityType: "tag", entityId: "env=dev", previousSpend: 0, newSpend: 2000, maxBudget: 5_000_000, thresholdPercentages: [50] };
    mockedUpdateBudgetSpend
      .mockResolvedValueOnce({ updatedEntities: [entityA] })  // event 1: api_key entity
      .mockResolvedValueOnce({ updatedEntities: [entityB] }); // event 2: tag entity

    mockedInsertCostEventsBatch.mockResolvedValue({
      ids: ["ce-1", "ce-2"],
      inserted: 2,
      rows: [
        makeInsertedRow({ id: "ce-1", costMicrodollars: 1000, tags: {} }),
        makeInsertedRow({ id: "ce-2", costMicrodollars: 2000, tags: { env: "dev" } }),
      ],
    });

    await POST(makeRequest({ events: [makeEvent(), makeEvent()] }));
    await vi.waitFor(() => {
      expect(mockedInvalidateProxyCache).toHaveBeenCalledTimes(2);
    });

    // Each event's entities synced independently
    expect(mockedInvalidateProxyCache).toHaveBeenCalledWith({
      action: "sync", ownerId: "org-test-1", entityType: "api_key", entityId: "key-1",
    });
    expect(mockedInvalidateProxyCache).toHaveBeenCalledWith({
      action: "sync", ownerId: "org-test-1", entityType: "tag", entityId: "env=dev",
    });
  });
});

// ---------------------------------------------------------------------------
// Observability logging
// ---------------------------------------------------------------------------

describe("POST /api/cost-events/batch — observability", () => {
  const AUTH = {
    userId: "user-1",
    orgId: "org-test-1",
    keyId: "key-1",
    apiVersion: "2026-04-01",
  };

  beforeEach(() => {
    mockLogger.info.mockClear();
    mockLogger.error.mockClear();
    mockedAuthenticateApiKey.mockResolvedValue(AUTH);
    mockedFetchWebhookEndpoints.mockResolvedValue([]);
  });

  it("logs structured info for each successful budget update", async () => {
    const entity = { id: "b1", entityType: "api_key", entityId: "key-1", previousSpend: 0, newSpend: 1500, maxBudget: 10_000_000, thresholdPercentages: [50] };
    mockedUpdateBudgetSpend.mockResolvedValue({ updatedEntities: [entity] });
    mockedInsertCostEventsBatch.mockResolvedValue({
      ids: ["ce-1"],
      inserted: 1,
      rows: [makeInsertedRow({ requestId: "r1", costMicrodollars: 1500 })],
    });

    await POST(makeRequest({ events: [makeEvent()] }));
    await vi.waitFor(() => {
      expect(mockLogger.info).toHaveBeenCalled();
    });

    expect(mockLogger.info).toHaveBeenCalledWith(
      { requestId: "r1", costMicrodollars: 1500, entitiesUpdated: 1 },
      "batch_budget_spend_updated",
    );
  });

  it("logs structured error for failed budget updates", async () => {
    const dbError = new Error("connection refused");
    mockedUpdateBudgetSpend.mockRejectedValue(dbError);
    mockedInsertCostEventsBatch.mockResolvedValue({
      ids: ["ce-1"],
      inserted: 1,
      rows: [makeInsertedRow({ requestId: "r1", costMicrodollars: 5000 })],
    });

    await POST(makeRequest({ events: [makeEvent()] }));
    await vi.waitFor(() => {
      expect(mockLogger.error).toHaveBeenCalled();
    });

    expect(mockLogger.error).toHaveBeenCalledWith(
      { err: dbError, requestId: "r1", costMicrodollars: 5000 },
      "Budget spend update failed for cost event in batch",
    );
  });

  it("does not log budget info when no entities updated (zero-cost skip)", async () => {
    mockedInsertCostEventsBatch.mockResolvedValue({
      ids: ["ce-1"],
      inserted: 1,
      rows: [makeInsertedRow({ requestId: "r1", costMicrodollars: 0 })],
    });

    await POST(makeRequest({ events: [makeEvent()] }));
    await new Promise((r) => setTimeout(r, 50));

    // No budget update called (zero cost), so no info log
    expect(mockedUpdateBudgetSpend).not.toHaveBeenCalled();
    expect(mockLogger.info).not.toHaveBeenCalledWith(
      expect.objectContaining({ requestId: "r1" }),
      "batch_budget_spend_updated",
    );
  });
});

// ---------------------------------------------------------------------------
// Webhook dispatch failure isolation
// ---------------------------------------------------------------------------

describe("POST /api/cost-events/batch — dispatch failure isolation", () => {
  const AUTH = {
    userId: "user-1",
    orgId: "org-test-1",
    keyId: "key-1",
    apiVersion: "2026-04-01",
  };

  beforeEach(() => {
    mockedAuthenticateApiKey.mockResolvedValue(AUTH);
  });

  it("budget updates continue even if webhook dispatch throws for one event", async () => {
    mockedFetchWebhookEndpoints.mockResolvedValue([
      { id: "ep-1", url: "https://example.com/hook", signingSecret: "sec", eventTypes: [], apiVersion: "2026-04-01", payloadMode: "full" as const, previousSigningSecret: null, secretRotatedAt: null },
    ]);
    mockedUpdateBudgetSpend.mockResolvedValue({ updatedEntities: [] });

    // First dispatch succeeds, second throws
    mockedDispatchCostEventToEndpoints
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("webhook timeout"))
      .mockResolvedValueOnce(undefined);

    mockedInsertCostEventsBatch.mockResolvedValue({
      ids: ["ce-1", "ce-2", "ce-3"],
      inserted: 3,
      rows: [
        makeInsertedRow({ id: "ce-1", costMicrodollars: 1000 }),
        makeInsertedRow({ id: "ce-2", costMicrodollars: 2000 }),
        makeInsertedRow({ id: "ce-3", costMicrodollars: 3000 }),
      ],
    });

    const res = await POST(makeRequest({ events: [makeEvent(), makeEvent(), makeEvent()] }));
    expect(res.status).toBe(201);

    await vi.waitFor(() => {
      expect(mockedUpdateBudgetSpend).toHaveBeenCalledTimes(3);
    });

    // All three budget updates ran despite event 2's webhook failure
    expect(mockedUpdateBudgetSpend.mock.calls[0][2]).toBe(1000);
    expect(mockedUpdateBudgetSpend.mock.calls[1][2]).toBe(2000);
    expect(mockedUpdateBudgetSpend.mock.calls[2][2]).toBe(3000);
  });
});

// ---------------------------------------------------------------------------
// Arithmetic invariant tests for update-spend and threshold-detection
// ---------------------------------------------------------------------------

describe("budget math invariants (unit-level)", () => {
  it("threshold detection: Math.floor prevents false crossings from rounding", () => {
    // Edge case: 49.9% should NOT cross 50% threshold
    // 4_990_000 / 10_000_000 = 0.499 → Math.floor(49.9) = 49
    // The actual function tests are in lib/budgets/threshold-detection.test.ts.
    // This test documents the arithmetic invariant the threshold logic relies on.
    expect(Math.floor((4_990_000 / 10_000_000) * 100)).toBe(49);
    expect(Math.floor((5_000_000 / 10_000_000) * 100)).toBe(50);
    expect(Math.floor((5_000_001 / 10_000_000) * 100)).toBe(50);
  });

  it("microdollar arithmetic: no floating-point drift in integer operations", () => {
    // All costs are integers (microdollars) — verify no fp issues
    const costs = [1_500, 2_500, 3_000, 100_000, 999_999];
    const total = costs.reduce((sum, c) => sum + c, 0);
    expect(total).toBe(1_106_999);
    expect(Number.isInteger(total)).toBe(true);

    // Large batch: 100 events at max microdollar value ($1M each)
    const largeBatch = Array.from({ length: 100 }, () => 1_000_000_000);
    const largeTotal = largeBatch.reduce((sum, c) => sum + c, 0);
    expect(largeTotal).toBe(100_000_000_000); // $100K total
    expect(Number.isInteger(largeTotal)).toBe(true);
    expect(largeTotal).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });

  it("threshold percentage: boundary values at exact thresholds", () => {
    // Exactly 50.00% → Math.floor = 50 → should trigger 50% threshold
    expect(Math.floor((5_000_000 / 10_000_000) * 100)).toBe(50);

    // Just below 50% (49.99%) → Math.floor = 49 → should NOT trigger
    expect(Math.floor((4_999_999 / 10_000_000) * 100)).toBe(49);

    // 100% exactly → should trigger budget.exceeded
    expect(Math.floor((10_000_000 / 10_000_000) * 100)).toBe(100);

    // Just below 100% (99.99%) → should NOT trigger exceeded
    expect(Math.floor((9_999_999 / 10_000_000) * 100)).toBe(99);
  });
});
