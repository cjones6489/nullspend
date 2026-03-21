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
