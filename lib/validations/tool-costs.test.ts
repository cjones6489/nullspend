import { describe, expect, it } from "vitest";

import {
  discoverToolCostsInputSchema,
  toolCostResponseSchema,
  deleteRouteParamsSchema,
} from "@/lib/validations/tool-costs";

describe("discoverToolCostsInputSchema annotations depth limit", () => {
  const baseTool = {
    name: "test-tool",
    tierCost: 100,
  };

  const basePayload = {
    serverName: "test-server",
    tools: [baseTool],
  };

  function nestedObject(depth: number): Record<string, unknown> {
    let obj: Record<string, unknown> = { value: "leaf" };
    for (let i = 1; i < depth; i++) {
      obj = { nested: obj };
    }
    return obj;
  }

  it("accepts annotations at exactly 20 levels", () => {
    const result = discoverToolCostsInputSchema.parse({
      ...basePayload,
      tools: [{ ...baseTool, annotations: nestedObject(20) }],
    });
    expect(result.tools[0].annotations).toBeDefined();
  });

  it("rejects annotations at 21 levels", () => {
    expect(() =>
      discoverToolCostsInputSchema.parse({
        ...basePayload,
        tools: [{ ...baseTool, annotations: nestedObject(21) }],
      }),
    ).toThrow(/nesting/);
  });

  it("accepts null annotations", () => {
    const result = discoverToolCostsInputSchema.parse({
      ...basePayload,
      tools: [{ ...baseTool, annotations: null }],
    });
    expect(result.tools[0].annotations).toBeNull();
  });

  it("accepts omitted annotations", () => {
    const result = discoverToolCostsInputSchema.parse(basePayload);
    expect(result.tools[0].annotations).toBeUndefined();
  });

  it("accepts flat annotations", () => {
    const result = discoverToolCostsInputSchema.parse({
      ...basePayload,
      tools: [{ ...baseTool, annotations: { audience: ["internal"], priority: 0.5 } }],
    });
    expect(result.tools[0].annotations).toEqual({ audience: ["internal"], priority: 0.5 });
  });
});

describe("toolCostResponseSchema", () => {
  const validRecord = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    userId: "660e8400-e29b-41d4-a716-446655440000",
    serverName: "test-server",
    toolName: "test-tool",
    costMicrodollars: 100,
    source: "manual",
    description: null,
    annotations: null,
    lastSeenAt: null,
    createdAt: "2026-03-07T12:00:00.000Z",
    updatedAt: "2026-03-07T12:00:00.000Z",
  };

  it("transforms id to ns_tc_ prefix and userId to ns_usr_ prefix", () => {
    const result = toolCostResponseSchema.parse(validRecord);
    expect(result.id).toBe("ns_tc_550e8400-e29b-41d4-a716-446655440000");
    expect(result.userId).toBe("ns_usr_660e8400-e29b-41d4-a716-446655440000");
  });

  it("preserves other fields", () => {
    const result = toolCostResponseSchema.parse(validRecord);
    expect(result.serverName).toBe("test-server");
    expect(result.toolName).toBe("test-tool");
    expect(result.costMicrodollars).toBe(100);
    expect(result.source).toBe("manual");
  });

  it("rejects non-UUID id", () => {
    expect(() =>
      toolCostResponseSchema.parse({ ...validRecord, id: "not-a-uuid" }),
    ).toThrow();
  });
});

describe("deleteRouteParamsSchema", () => {
  it("accepts ns_tc_ prefixed id and strips to raw UUID", () => {
    const result = deleteRouteParamsSchema.parse({
      id: "ns_tc_550e8400-e29b-41d4-a716-446655440000",
    });
    expect(result.id).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("rejects unprefixed UUID", () => {
    expect(() =>
      deleteRouteParamsSchema.parse({ id: "550e8400-e29b-41d4-a716-446655440000" }),
    ).toThrow();
  });

  it("rejects wrong prefix", () => {
    expect(() =>
      deleteRouteParamsSchema.parse({ id: "ns_key_550e8400-e29b-41d4-a716-446655440000" }),
    ).toThrow();
  });
});
