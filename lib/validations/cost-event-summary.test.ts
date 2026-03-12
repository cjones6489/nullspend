import { describe, it, expect } from "vitest";
import { ZodError } from "zod";

import {
  costSummaryQuerySchema,
  dailySpendSchema,
  modelBreakdownSchema,
  keyBreakdownSchema,
  totalsSchema,
  costSummaryResponseSchema,
} from "./cost-event-summary";

describe("costSummaryQuerySchema", () => {
  it("accepts 7d period", () => {
    expect(costSummaryQuerySchema.parse({ period: "7d" }).period).toBe("7d");
  });

  it("accepts 30d period", () => {
    expect(costSummaryQuerySchema.parse({ period: "30d" }).period).toBe("30d");
  });

  it("accepts 90d period", () => {
    expect(costSummaryQuerySchema.parse({ period: "90d" }).period).toBe("90d");
  });

  it("defaults to 30d when period is not provided", () => {
    expect(costSummaryQuerySchema.parse({}).period).toBe("30d");
  });

  it("defaults to 30d when period is undefined", () => {
    expect(costSummaryQuerySchema.parse({ period: undefined }).period).toBe("30d");
  });

  it("rejects invalid period values", () => {
    expect(() => costSummaryQuerySchema.parse({ period: "14d" })).toThrow(ZodError);
    expect(() => costSummaryQuerySchema.parse({ period: "1y" })).toThrow(ZodError);
    expect(() => costSummaryQuerySchema.parse({ period: "all" })).toThrow(ZodError);
    expect(() => costSummaryQuerySchema.parse({ period: "" })).toThrow(ZodError);
  });

  it("rejects numeric period (must be string)", () => {
    expect(() => costSummaryQuerySchema.parse({ period: 30 })).toThrow(ZodError);
  });
});

describe("dailySpendSchema", () => {
  it("accepts valid daily spend entry", () => {
    const result = dailySpendSchema.parse({
      date: "2026-03-07",
      totalCostMicrodollars: 5_000_000,
    });
    expect(result.date).toBe("2026-03-07");
    expect(result.totalCostMicrodollars).toBe(5_000_000);
  });

  it("accepts zero cost", () => {
    const result = dailySpendSchema.parse({
      date: "2026-03-07",
      totalCostMicrodollars: 0,
    });
    expect(result.totalCostMicrodollars).toBe(0);
  });

  it("rejects missing date", () => {
    expect(() => dailySpendSchema.parse({ totalCostMicrodollars: 100 })).toThrow(ZodError);
  });

  it("rejects missing totalCostMicrodollars", () => {
    expect(() => dailySpendSchema.parse({ date: "2026-03-07" })).toThrow(ZodError);
  });

  it("rejects string cost (must be number)", () => {
    expect(() =>
      dailySpendSchema.parse({ date: "2026-03-07", totalCostMicrodollars: "5000000" }),
    ).toThrow(ZodError);
  });
});

describe("modelBreakdownSchema", () => {
  const validModel = {
    model: "gpt-4o",
    totalCostMicrodollars: 10_000_000,
    requestCount: 42,
    inputTokens: 50000,
    outputTokens: 12000,
    cachedInputTokens: 3000,
    reasoningTokens: 0,
  };

  it("accepts valid model breakdown entry", () => {
    const result = modelBreakdownSchema.parse(validModel);
    expect(result.model).toBe("gpt-4o");
    expect(result.requestCount).toBe(42);
  });

  it("rejects float requestCount (must be integer)", () => {
    expect(() =>
      modelBreakdownSchema.parse({ ...validModel, requestCount: 1.5 }),
    ).toThrow(ZodError);
  });

  it("rejects float token counts (must be integer)", () => {
    expect(() =>
      modelBreakdownSchema.parse({ ...validModel, inputTokens: 1.5 }),
    ).toThrow(ZodError);
    expect(() =>
      modelBreakdownSchema.parse({ ...validModel, outputTokens: 1.5 }),
    ).toThrow(ZodError);
  });

  it("rejects missing required fields", () => {
    expect(() => modelBreakdownSchema.parse({ model: "gpt-4o" })).toThrow(ZodError);
  });
});

describe("keyBreakdownSchema", () => {
  const validKey = {
    apiKeyId: "550e8400-e29b-41d4-a716-446655440000",
    keyName: "Production Key",
    totalCostMicrodollars: 5_000_000,
    requestCount: 100,
  };

  it("accepts valid key breakdown entry", () => {
    const result = keyBreakdownSchema.parse(validKey);
    expect(result.keyName).toBe("Production Key");
  });

  it("rejects non-UUID apiKeyId", () => {
    expect(() =>
      keyBreakdownSchema.parse({ ...validKey, apiKeyId: "not-a-uuid" }),
    ).toThrow(ZodError);
  });

  it("rejects float requestCount", () => {
    expect(() =>
      keyBreakdownSchema.parse({ ...validKey, requestCount: 1.5 }),
    ).toThrow(ZodError);
  });
});

describe("totalsSchema", () => {
  it("accepts valid totals", () => {
    const result = totalsSchema.parse({
      totalCostMicrodollars: 25_000_000,
      totalRequests: 500,
    });
    expect(result.totalCostMicrodollars).toBe(25_000_000);
    expect(result.totalRequests).toBe(500);
  });

  it("accepts zero totals", () => {
    const result = totalsSchema.parse({
      totalCostMicrodollars: 0,
      totalRequests: 0,
    });
    expect(result.totalCostMicrodollars).toBe(0);
    expect(result.totalRequests).toBe(0);
  });

  it("rejects float totalRequests", () => {
    expect(() =>
      totalsSchema.parse({ totalCostMicrodollars: 0, totalRequests: 1.5 }),
    ).toThrow(ZodError);
  });
});

describe("costSummaryResponseSchema", () => {
  const validResponse = {
    daily: [{ date: "2026-03-07", totalCostMicrodollars: 1_000_000 }],
    models: [
      {
        model: "gpt-4o",
        totalCostMicrodollars: 1_000_000,
        requestCount: 10,
        inputTokens: 5000,
        outputTokens: 1000,
        cachedInputTokens: 0,
        reasoningTokens: 0,
      },
    ],
    keys: [
      {
        apiKeyId: "550e8400-e29b-41d4-a716-446655440000",
        keyName: "Test Key",
        totalCostMicrodollars: 1_000_000,
        requestCount: 10,
      },
    ],
    totals: {
      totalCostMicrodollars: 1_000_000,
      totalRequests: 10,
      period: "30d",
    },
  };

  it("accepts valid complete response", () => {
    const result = costSummaryResponseSchema.parse(validResponse);
    expect(result.daily).toHaveLength(1);
    expect(result.models).toHaveLength(1);
    expect(result.keys).toHaveLength(1);
    expect(result.totals.period).toBe("30d");
  });

  it("accepts empty arrays", () => {
    const result = costSummaryResponseSchema.parse({
      daily: [],
      models: [],
      keys: [],
      totals: { totalCostMicrodollars: 0, totalRequests: 0, period: "7d" },
    });
    expect(result.daily).toHaveLength(0);
    expect(result.models).toHaveLength(0);
    expect(result.keys).toHaveLength(0);
  });

  it("rejects response missing totals period", () => {
    expect(() =>
      costSummaryResponseSchema.parse({
        ...validResponse,
        totals: { totalCostMicrodollars: 0, totalRequests: 0 },
      }),
    ).toThrow(ZodError);
  });

  it("rejects response missing daily array", () => {
    expect(() =>
      costSummaryResponseSchema.parse({
        models: validResponse.models,
        keys: validResponse.keys,
        totals: validResponse.totals,
      }),
    ).toThrow(ZodError);
  });
});
