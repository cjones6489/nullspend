/**
 * Budget Validation Schema Tests
 *
 * Pure Zod schema unit tests for createBudgetInputSchema,
 * budgetResponseSchema, and handleRouteError security sanitization.
 * No route mocking, no database calls.
 */
import { describe, it, expect } from "vitest";
import { ZodError } from "zod";
import {
  createBudgetInputSchema,
  budgetResponseSchema,
  listBudgetsResponseSchema,
} from "./budgets";
import { handleRouteError } from "@/lib/utils/http";

const validInput = {
  entityType: "api_key" as const,
  entityId: "550e8400-e29b-41d4-a716-446655440000",
  maxBudgetMicrodollars: 50_000_000,
};

describe("createBudgetInputSchema", () => {
  it("accepts valid input with entityType api_key", () => {
    const result = createBudgetInputSchema.parse(validInput);
    expect(result.entityType).toBe("api_key");
    expect(result.maxBudgetMicrodollars).toBe(50_000_000);
  });

  it("accepts valid input with entityType user", () => {
    const result = createBudgetInputSchema.parse({
      ...validInput,
      entityType: "user",
    });
    expect(result.entityType).toBe("user");
  });

  it("accepts valid input with resetInterval daily", () => {
    const result = createBudgetInputSchema.parse({
      ...validInput,
      resetInterval: "daily",
    });
    expect(result.resetInterval).toBe("daily");
  });

  it("accepts valid input with resetInterval weekly", () => {
    const result = createBudgetInputSchema.parse({
      ...validInput,
      resetInterval: "weekly",
    });
    expect(result.resetInterval).toBe("weekly");
  });

  it("accepts valid input with resetInterval monthly", () => {
    const result = createBudgetInputSchema.parse({
      ...validInput,
      resetInterval: "monthly",
    });
    expect(result.resetInterval).toBe("monthly");
  });

  it("accepts valid input without resetInterval (optional)", () => {
    const result = createBudgetInputSchema.parse(validInput);
    expect(result.resetInterval).toBeUndefined();
  });

  it("rejects missing entityType", () => {
    expect(() =>
      createBudgetInputSchema.parse({
        entityId: validInput.entityId,
        maxBudgetMicrodollars: validInput.maxBudgetMicrodollars,
      }),
    ).toThrow(ZodError);
  });

  it("rejects invalid entityType", () => {
    expect(() =>
      createBudgetInputSchema.parse({ ...validInput, entityType: "team" }),
    ).toThrow(ZodError);

    expect(() =>
      createBudgetInputSchema.parse({ ...validInput, entityType: "agent" }),
    ).toThrow(ZodError);
  });

  it("rejects non-UUID entityId", () => {
    expect(() =>
      createBudgetInputSchema.parse({ ...validInput, entityId: "not-a-uuid" }),
    ).toThrow(ZodError);
  });

  it("rejects maxBudgetMicrodollars of 0 (must be positive)", () => {
    expect(() =>
      createBudgetInputSchema.parse({ ...validInput, maxBudgetMicrodollars: 0 }),
    ).toThrow(ZodError);
  });

  it("rejects negative maxBudgetMicrodollars", () => {
    expect(() =>
      createBudgetInputSchema.parse({ ...validInput, maxBudgetMicrodollars: -100 }),
    ).toThrow(ZodError);
  });

  it("rejects float maxBudgetMicrodollars", () => {
    expect(() =>
      createBudgetInputSchema.parse({ ...validInput, maxBudgetMicrodollars: 1.5 }),
    ).toThrow(ZodError);
  });

  it("rejects maxBudgetMicrodollars as string", () => {
    expect(() =>
      createBudgetInputSchema.parse({ ...validInput, maxBudgetMicrodollars: "1000" }),
    ).toThrow(ZodError);
  });

  it("rejects invalid resetInterval", () => {
    expect(() =>
      createBudgetInputSchema.parse({ ...validInput, resetInterval: "yearly" }),
    ).toThrow(ZodError);
  });
});

describe("budgetResponseSchema", () => {
  const validResponse = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    entityType: "api_key",
    entityId: "550e8400-e29b-41d4-a716-446655440001",
    maxBudgetMicrodollars: 50_000_000,
    spendMicrodollars: 10_000_000,
    policy: "strict_block",
    resetInterval: "monthly",
    currentPeriodStart: "2026-03-01T00:00:00.000Z",
    createdAt: "2026-02-15T12:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
  };

  it("accepts valid budget response shape", () => {
    const result = budgetResponseSchema.parse(validResponse);
    expect(result.id).toBe(validResponse.id);
  });

  it("accepts resetInterval null and currentPeriodStart null", () => {
    const result = budgetResponseSchema.parse({
      ...validResponse,
      resetInterval: null,
      currentPeriodStart: null,
    });
    expect(result.resetInterval).toBeNull();
    expect(result.currentPeriodStart).toBeNull();
  });

  it("listBudgetsResponseSchema wraps array of budget responses", () => {
    const result = listBudgetsResponseSchema.parse({
      data: [validResponse],
    });
    expect(result.data).toHaveLength(1);
  });
});

describe("handleRouteError Zod sanitization", () => {
  it("Zod validation error only contains path and message, not code/expected/received", async () => {
    const zodError = new ZodError([
      {
        code: "invalid_type",
        expected: "number",
        path: ["maxBudgetMicrodollars"],
        message: "Expected number, received string",
      } as any,
    ]);

    const response = handleRouteError(zodError);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error).toBe("validation_error");
    expect(body.message).toBe("Request validation failed.");
    expect(body.issues).toHaveLength(1);
    expect(body.issues[0]).toEqual({
      path: ["maxBudgetMicrodollars"],
      message: "Expected number, received string",
    });
    expect(body.issues[0]).not.toHaveProperty("code");
    expect(body.issues[0]).not.toHaveProperty("expected");
    expect(body.issues[0]).not.toHaveProperty("received");
  });
});
