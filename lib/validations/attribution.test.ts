import { describe, expect, it } from "vitest";

import {
  attributionDetailResponseSchema,
  attributionGroupSchema,
  attributionQuerySchema,
} from "./attribution";

describe("attributionQuerySchema", () => {
  it("parses valid input with all fields", () => {
    const result = attributionQuerySchema.parse({
      groupBy: "api_key",
      period: "7d",
      limit: "50",
      excludeEstimated: "true",
      format: "csv",
    });

    expect(result.groupBy).toBe("api_key");
    expect(result.period).toBe("7d");
    expect(result.limit).toBe(50);
    expect(result.excludeEstimated).toBe("true");
    expect(result.format).toBe("csv");
  });

  it("fails when groupBy is missing", () => {
    expect(() =>
      attributionQuerySchema.parse({
        period: "30d",
      }),
    ).toThrow();
  });

  it("fails when groupBy exceeds 100 characters", () => {
    expect(() =>
      attributionQuerySchema.parse({
        groupBy: "a".repeat(101),
      }),
    ).toThrow();
  });

  it("defaults period to 30d when not specified", () => {
    const result = attributionQuerySchema.parse({
      groupBy: "api_key",
    });

    expect(result.period).toBe("30d");
  });

  it("fails for invalid period value", () => {
    expect(() =>
      attributionQuerySchema.parse({
        groupBy: "api_key",
        period: "14d",
      }),
    ).toThrow();
  });

  it("defaults limit to 100 when not specified", () => {
    const result = attributionQuerySchema.parse({
      groupBy: "api_key",
    });

    expect(result.limit).toBe(100);
  });

  it("fails when limit exceeds 500", () => {
    expect(() =>
      attributionQuerySchema.parse({
        groupBy: "api_key",
        limit: "501",
      }),
    ).toThrow();
  });

  it("fails when limit is less than 1", () => {
    expect(() =>
      attributionQuerySchema.parse({
        groupBy: "api_key",
        limit: "0",
      }),
    ).toThrow();
  });

  it("defaults format to json when not specified", () => {
    const result = attributionQuerySchema.parse({
      groupBy: "api_key",
    });

    expect(result.format).toBe("json");
  });
});

describe("attributionGroupSchema", () => {
  it("parses a valid group object", () => {
    const result = attributionGroupSchema.parse({
      key: "Production Key",
      keyId: "550e8400-e29b-41d4-a716-446655440000",
      totalCostMicrodollars: 8_000_000,
      requestCount: 40,
      avgCostMicrodollars: 200_000,
    });

    expect(result.key).toBe("Production Key");
    expect(result.keyId).toBe("ns_key_550e8400-e29b-41d4-a716-446655440000");
    expect(result.totalCostMicrodollars).toBe(8_000_000);
  });

  it("fails when totalCostMicrodollars is negative", () => {
    expect(() =>
      attributionGroupSchema.parse({
        key: "Test",
        keyId: null,
        totalCostMicrodollars: -1,
        requestCount: 0,
        avgCostMicrodollars: 0,
      }),
    ).toThrow();
  });
});

describe("attributionDetailResponseSchema", () => {
  it("parses a valid detail response", () => {
    const result = attributionDetailResponseSchema.parse({
      key: "key-abc",
      totalCostMicrodollars: 8_000_000,
      requestCount: 40,
      avgCostMicrodollars: 200_000,
      daily: [
        { date: "2026-03-25", cost: 3_000_000, count: 15 },
        { date: "2026-03-26", cost: 5_000_000, count: 25 },
      ],
      models: [
        { model: "gpt-4o", cost: 6_000_000, count: 30 },
      ],
    });

    expect(result.key).toBe("key-abc");
    expect(result.daily).toHaveLength(2);
    expect(result.models).toHaveLength(1);
    expect(result.totalCostMicrodollars).toBe(8_000_000);
    expect(result.requestCount).toBe(40);
    expect(result.avgCostMicrodollars).toBe(200_000);
  });
});
