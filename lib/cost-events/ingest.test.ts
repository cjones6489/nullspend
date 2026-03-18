import { describe, expect, it } from "vitest";

import {
  costEventInputSchema,
  costEventBatchInputSchema,
} from "./ingest";

// ---------------------------------------------------------------------------
// costEventInputSchema validation
// ---------------------------------------------------------------------------

describe("costEventInputSchema", () => {
  const valid = {
    provider: "openai",
    model: "gpt-4o",
    inputTokens: 100,
    outputTokens: 50,
    costMicrodollars: 1500,
  };

  it("accepts minimal valid input", () => {
    const result = costEventInputSchema.parse(valid);
    expect(result.provider).toBe("openai");
    expect(result.eventType).toBeUndefined();
  });

  it("accepts all optional fields", () => {
    const full = {
      ...valid,
      cachedInputTokens: 10,
      reasoningTokens: 5,
      durationMs: 200,
      sessionId: "sess-1",
      eventType: "llm" as const,
      toolName: "search",
      toolServer: "mcp-server",
      idempotencyKey: "ns_abc",
    };
    const result = costEventInputSchema.parse(full);
    expect(result.eventType).toBe("llm");
    expect(result.idempotencyKey).toBe("ns_abc");
  });

  it("rejects missing required fields", () => {
    expect(() => costEventInputSchema.parse({})).toThrow();
    expect(() => costEventInputSchema.parse({ provider: "openai" })).toThrow();
  });

  it("rejects empty provider", () => {
    expect(() =>
      costEventInputSchema.parse({ ...valid, provider: "" }),
    ).toThrow();
  });

  it("rejects negative inputTokens", () => {
    expect(() =>
      costEventInputSchema.parse({ ...valid, inputTokens: -1 }),
    ).toThrow();
  });

  it("rejects non-integer costMicrodollars", () => {
    expect(() =>
      costEventInputSchema.parse({ ...valid, costMicrodollars: 1.5 }),
    ).toThrow();
  });

  it("rejects invalid eventType", () => {
    expect(() =>
      costEventInputSchema.parse({ ...valid, eventType: "invalid" }),
    ).toThrow();
  });

  it("accepts eventType custom", () => {
    const result = costEventInputSchema.parse({ ...valid, eventType: "custom" });
    expect(result.eventType).toBe("custom");
  });

  it("accepts eventType tool", () => {
    const result = costEventInputSchema.parse({ ...valid, eventType: "tool" });
    expect(result.eventType).toBe("tool");
  });

  it("rejects provider over 100 chars", () => {
    expect(() =>
      costEventInputSchema.parse({ ...valid, provider: "x".repeat(101) }),
    ).toThrow();
  });

  it("does not accept metadata field", () => {
    const result = costEventInputSchema.parse({
      ...valid,
      metadata: { key: "value" },
    });
    // Zod strict mode strips unknown keys by default
    expect((result as Record<string, unknown>).metadata).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// costEventBatchInputSchema validation
// ---------------------------------------------------------------------------

describe("costEventBatchInputSchema", () => {
  const validEvent = {
    provider: "openai",
    model: "gpt-4o",
    inputTokens: 100,
    outputTokens: 50,
    costMicrodollars: 1500,
  };

  it("accepts 1 event", () => {
    const result = costEventBatchInputSchema.parse({ events: [validEvent] });
    expect(result.events).toHaveLength(1);
  });

  it("accepts 100 events", () => {
    const events = Array.from({ length: 100 }, () => ({ ...validEvent }));
    const result = costEventBatchInputSchema.parse({ events });
    expect(result.events).toHaveLength(100);
  });

  it("rejects empty events array", () => {
    expect(() =>
      costEventBatchInputSchema.parse({ events: [] }),
    ).toThrow();
  });

  it("rejects > 100 events", () => {
    const events = Array.from({ length: 101 }, () => ({ ...validEvent }));
    expect(() =>
      costEventBatchInputSchema.parse({ events }),
    ).toThrow();
  });

  it("rejects missing events key", () => {
    expect(() => costEventBatchInputSchema.parse({})).toThrow();
  });

  it("rejects invalid event in batch", () => {
    expect(() =>
      costEventBatchInputSchema.parse({
        events: [validEvent, { provider: "openai" }], // second event missing required fields
      }),
    ).toThrow();
  });
});
