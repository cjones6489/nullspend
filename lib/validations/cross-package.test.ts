import { describe, it, expect } from "vitest";
import {
  ACTION_TYPES as DB_ACTION_TYPES,
  ACTION_STATUSES as DB_ACTION_STATUSES,
} from "@nullspend/db";
import {
  ACTION_TYPES as SDK_ACTION_TYPES,
  ACTION_STATUSES as SDK_ACTION_STATUSES,
} from "../../packages/sdk/src/types";
import { WEBHOOK_EVENT_TYPES } from "./webhooks";

describe("cross-package constant consistency", () => {
  it("ACTION_TYPES match between @nullspend/db and @nullspend/sdk", () => {
    expect([...DB_ACTION_TYPES]).toEqual([...SDK_ACTION_TYPES]);
  });

  it("ACTION_STATUSES match between @nullspend/db and @nullspend/sdk", () => {
    expect([...DB_ACTION_STATUSES]).toEqual([...SDK_ACTION_STATUSES]);
  });

  it("WEBHOOK_EVENT_TYPES matches proxy WebhookEventType union", () => {
    // Source of truth: apps/proxy/src/lib/webhook-events.ts WebhookEventType
    // If the proxy union changes, update this array and WEBHOOK_EVENT_TYPES in lockstep.
    const proxyWebhookEventTypes = [
      "cost_event.created",
      "budget.threshold.warning",
      "budget.threshold.critical",
      "budget.exceeded",
      "budget.reset",
      "request.blocked",
      "action.created",
      "action.approved",
      "action.rejected",
      "action.expired",
      "test.ping",
    ];

    expect([...WEBHOOK_EVENT_TYPES]).toEqual(proxyWebhookEventTypes);
  });
});
