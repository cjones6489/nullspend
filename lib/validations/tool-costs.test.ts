import { describe, expect, it } from "vitest";

import { discoverToolCostsInputSchema } from "@/lib/validations/tool-costs";

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
