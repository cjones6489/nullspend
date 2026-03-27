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
