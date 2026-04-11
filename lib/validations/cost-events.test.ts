import { describe, it, expect } from "vitest";
import { ZodError } from "zod";

import { listCostEventsQuerySchema } from "./cost-events";

describe("listCostEventsQuerySchema — requestId filter", () => {
  it("accepts requestId filter", () => {
    const result = listCostEventsQuerySchema.parse({ requestId: "req-123" });
    expect(result.requestId).toBe("req-123");
  });

  it("rejects empty requestId", () => {
    expect(() =>
      listCostEventsQuerySchema.parse({ requestId: "" }),
    ).toThrow(ZodError);
  });

  it("requestId is optional", () => {
    const result = listCostEventsQuerySchema.parse({});
    expect(result.requestId).toBeUndefined();
  });
});

describe("listCostEventsQuerySchema — sessionId filter", () => {
  it("accepts sessionId filter", () => {
    const result = listCostEventsQuerySchema.parse({ sessionId: "session-abc-123" });
    expect(result.sessionId).toBe("session-abc-123");
  });

  it("rejects empty sessionId", () => {
    expect(() =>
      listCostEventsQuerySchema.parse({ sessionId: "" }),
    ).toThrow(ZodError);
  });

  it("rejects sessionId exceeding 200 characters", () => {
    expect(() =>
      listCostEventsQuerySchema.parse({ sessionId: "x".repeat(201) }),
    ).toThrow(ZodError);
  });

  it("sessionId is optional", () => {
    const result = listCostEventsQuerySchema.parse({});
    expect(result.sessionId).toBeUndefined();
  });
});

describe("listCostEventsQuerySchema — cursor validation (API-8)", () => {
  it("rejects malformed cursor JSON with ZodError (not SyntaxError)", () => {
    const result = listCostEventsQuerySchema.safeParse({ cursor: "not-json" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe("Invalid cursor JSON");
    }
  });

  it("accepts valid cursor JSON", () => {
    const cursor = JSON.stringify({ createdAt: "2026-04-01T00:00:00.000Z", id: "ns_evt_a0000000-0000-4000-a000-000000000001" });
    const result = listCostEventsQuerySchema.safeParse({ cursor });
    expect(result.success).toBe(true);
  });
});
