import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPublishJSON, MockQStashClient } = vi.hoisted(() => {
  const mockPublishJSON = vi.fn().mockResolvedValue({ messageId: "msg_1" });
  const MockQStashClient = vi.fn().mockImplementation(function (this: any) {
    this.publishJSON = mockPublishJSON;
  });
  return { mockPublishJSON, MockQStashClient };
});

vi.mock("@upstash/qstash", () => ({
  Client: MockQStashClient,
}));

vi.mock("../lib/webhook-signer.js", () => ({
  signWebhookPayload: vi.fn().mockResolvedValue("t=1000,v1=abc123"),
}));

import { createWebhookDispatcher, dispatchToEndpoints } from "../lib/webhook-dispatch.js";
import type { WebhookEndpointWithSecret } from "../lib/webhook-cache.js";
import type { WebhookEvent } from "../lib/webhook-events.js";

function makeEndpoint(overrides: Partial<WebhookEndpointWithSecret> = {}): WebhookEndpointWithSecret {
  return {
    id: "ep-1",
    url: "https://hooks.example.com/webhook",
    signingSecret: "whsec_secret",
    eventTypes: [],
    apiVersion: "2026-04-01",
    ...overrides,
  };
}

function makeEvent(overrides: Partial<WebhookEvent> = {}): WebhookEvent {
  return {
    id: "evt_test123",
    type: "cost_event.created",
    api_version: "2026-04-01",
    created_at: 1710547200,
    data: { object: { request_id: "req_1" } },
    ...overrides,
  };
}

describe("createWebhookDispatcher", () => {
  it("returns null when qstashToken is undefined", () => {
    const dispatcher = createWebhookDispatcher(undefined);
    expect(dispatcher).toBeNull();
  });

  it("returns null when qstashToken is empty string", () => {
    const dispatcher = createWebhookDispatcher("");
    expect(dispatcher).toBeNull();
  });

  it("returns a dispatcher when qstashToken is provided", () => {
    const dispatcher = createWebhookDispatcher("qstash_test_token");
    expect(dispatcher).not.toBeNull();
    expect(dispatcher!.dispatch).toBeInstanceOf(Function);
  });
});

describe("dispatcher.dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPublishJSON.mockResolvedValue({ messageId: "msg_1" });
  });

  it("publishes event with correct headers", async () => {
    const dispatcher = createWebhookDispatcher("qstash_token")!;
    const endpoint = makeEndpoint();
    const event = makeEvent();

    await dispatcher.dispatch(endpoint, event);

    expect(mockPublishJSON).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://hooks.example.com/webhook",
        body: event,
        retries: 5,
        headers: expect.objectContaining({
          "X-NullSpend-Webhook-Id": "evt_test123",
          "User-Agent": "NullSpend-Webhooks/1.0",
        }),
      }),
    );
  });

  it("skips dispatch when endpoint filters don't match event type", async () => {
    const dispatcher = createWebhookDispatcher("qstash_token")!;
    const endpoint = makeEndpoint({ eventTypes: ["budget.exceeded"] });
    const event = makeEvent({ type: "cost_event.created" });

    await dispatcher.dispatch(endpoint, event);
    expect(mockPublishJSON).not.toHaveBeenCalled();
  });

  it("dispatches when endpoint has matching event type", async () => {
    const dispatcher = createWebhookDispatcher("qstash_token")!;
    const endpoint = makeEndpoint({ eventTypes: ["cost_event.created", "budget.exceeded"] });
    const event = makeEvent({ type: "cost_event.created" });

    await dispatcher.dispatch(endpoint, event);
    expect(mockPublishJSON).toHaveBeenCalled();
  });

  it("dispatches when endpoint has empty event types (all events)", async () => {
    const dispatcher = createWebhookDispatcher("qstash_token")!;
    const endpoint = makeEndpoint({ eventTypes: [] });
    const event = makeEvent({ type: "budget.threshold.warning" });

    await dispatcher.dispatch(endpoint, event);
    expect(mockPublishJSON).toHaveBeenCalled();
  });
});

describe("dispatchToEndpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockPublishJSON.mockResolvedValue({ messageId: "msg_1" });
  });

  it("dispatches to all matching endpoints", async () => {
    const dispatcher = createWebhookDispatcher("qstash_token")!;
    const endpoints = [
      makeEndpoint({ id: "ep-1", url: "https://hooks.example.com/1" }),
      makeEndpoint({ id: "ep-2", url: "https://hooks.example.com/2" }),
    ];
    const event = makeEvent();

    await dispatchToEndpoints(dispatcher, endpoints, event);
    expect(mockPublishJSON).toHaveBeenCalledTimes(2);
  });

  it("continues dispatching after individual endpoint failure", async () => {
    mockPublishJSON
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce({ messageId: "msg_2" });

    const dispatcher = createWebhookDispatcher("qstash_token")!;
    const endpoints = [
      makeEndpoint({ id: "ep-1" }),
      makeEndpoint({ id: "ep-2" }),
    ];

    await dispatchToEndpoints(dispatcher, endpoints, makeEvent());
    expect(mockPublishJSON).toHaveBeenCalledTimes(2);
  });

  it("does not throw on dispatch errors (fail-open)", async () => {
    mockPublishJSON.mockRejectedValue(new Error("all fail"));

    const dispatcher = createWebhookDispatcher("qstash_token")!;
    await expect(
      dispatchToEndpoints(dispatcher, [makeEndpoint()], makeEvent()),
    ).resolves.not.toThrow();
  });
});
