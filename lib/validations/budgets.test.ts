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
  budgetEntitySchema,
  listBudgetsResponseSchema,
  policySchema,
} from "./budgets";
import { handleRouteError } from "@/lib/utils/http";

const validInput = {
  entityType: "api_key" as const,
  entityId: "ns_key_550e8400-e29b-41d4-a716-446655440000",
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
      entityId: "ns_usr_550e8400-e29b-41d4-a716-446655440000",
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

  describe("tag entity type", () => {
    it("accepts valid tag entityId", () => {
      const result = createBudgetInputSchema.parse({
        ...validInput,
        entityType: "tag",
        entityId: "project=openclaw",
      });
      expect(result.entityType).toBe("tag");
      expect(result.entityId).toBe("project=openclaw");
    });

    it("passes tag entityId through without prefix transformation", () => {
      const result = createBudgetInputSchema.parse({
        ...validInput,
        entityType: "tag",
        entityId: "customer=acme-corp",
      });
      // Tag IDs are not UUIDs, no ns_ prefix wrapping
      expect(result.entityId).toBe("customer=acme-corp");
    });

    it("accepts tag value with equals sign", () => {
      const result = createBudgetInputSchema.parse({
        ...validInput,
        entityType: "tag",
        entityId: "query=x=1",
      });
      expect(result.entityId).toBe("query=x=1");
    });

    it("rejects tag entityId missing equals sign", () => {
      expect(() =>
        createBudgetInputSchema.parse({
          ...validInput,
          entityType: "tag",
          entityId: "no-equals-sign",
        }),
      ).toThrow(ZodError);
    });

    it("rejects tag entityId with empty key", () => {
      expect(() =>
        createBudgetInputSchema.parse({
          ...validInput,
          entityType: "tag",
          entityId: "=value",
        }),
      ).toThrow(ZodError);
    });

    it("rejects tag key starting with _ns_ (reserved)", () => {
      expect(() =>
        createBudgetInputSchema.parse({
          ...validInput,
          entityType: "tag",
          entityId: "_ns_internal=value",
        }),
      ).toThrow(ZodError);
    });
  });

  it("rejects unprefixed entityId", () => {
    expect(() =>
      createBudgetInputSchema.parse({ ...validInput, entityId: "not-a-uuid" }),
    ).toThrow(ZodError);
  });

  it("rejects raw UUID entityId (must be prefixed)", () => {
    expect(() =>
      createBudgetInputSchema.parse({ ...validInput, entityId: "550e8400-e29b-41d4-a716-446655440000" }),
    ).toThrow(ZodError);
  });

  it("rejects wrong prefix for entityType", () => {
    expect(() =>
      createBudgetInputSchema.parse({ ...validInput, entityType: "api_key", entityId: "ns_usr_550e8400-e29b-41d4-a716-446655440000" }),
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

  it("accepts yearly resetInterval", () => {
    const result = createBudgetInputSchema.parse({ ...validInput, resetInterval: "yearly" });
    expect(result.resetInterval).toBe("yearly");
  });

  it("rejects invalid resetInterval", () => {
    expect(() =>
      createBudgetInputSchema.parse({ ...validInput, resetInterval: "biweekly" }),
    ).toThrow(ZodError);
  });

  describe("thresholdPercentages", () => {
    it("accepts valid thresholdPercentages", () => {
      const result = createBudgetInputSchema.parse({
        ...validInput,
        thresholdPercentages: [50, 80, 90],
      });
      expect(result.thresholdPercentages).toEqual([50, 80, 90]);
    });

    it("accepts empty array (disables alerts)", () => {
      const result = createBudgetInputSchema.parse({
        ...validInput,
        thresholdPercentages: [],
      });
      expect(result.thresholdPercentages).toEqual([]);
    });

    it("rejects unsorted values", () => {
      expect(() =>
        createBudgetInputSchema.parse({
          ...validInput,
          thresholdPercentages: [80, 50],
        }),
      ).toThrow(ZodError);
    });

    it("rejects duplicates", () => {
      expect(() =>
        createBudgetInputSchema.parse({
          ...validInput,
          thresholdPercentages: [50, 50],
        }),
      ).toThrow(ZodError);
    });

    it("rejects out-of-range value 0", () => {
      expect(() =>
        createBudgetInputSchema.parse({
          ...validInput,
          thresholdPercentages: [0],
        }),
      ).toThrow(ZodError);
    });

    it("rejects out-of-range value 101", () => {
      expect(() =>
        createBudgetInputSchema.parse({
          ...validInput,
          thresholdPercentages: [101],
        }),
      ).toThrow(ZodError);
    });

    it("rejects non-integers", () => {
      expect(() =>
        createBudgetInputSchema.parse({
          ...validInput,
          thresholdPercentages: [50.5],
        }),
      ).toThrow(ZodError);
    });

    it("rejects more than 10 elements", () => {
      expect(() =>
        createBudgetInputSchema.parse({
          ...validInput,
          thresholdPercentages: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
        }),
      ).toThrow(ZodError);
    });

    it("omitting is valid (optional — DB default applies)", () => {
      const result = createBudgetInputSchema.parse(validInput);
      expect(result.thresholdPercentages).toBeUndefined();
    });
  });

  describe("velocity limits", () => {
    it("accepts valid velocity config", () => {
      const result = createBudgetInputSchema.parse({
        ...validInput,
        velocityLimitMicrodollars: 5_000_000,
        velocityWindowSeconds: 60,
        velocityCooldownSeconds: 120,
      });
      expect(result.velocityLimitMicrodollars).toBe(5_000_000);
      expect(result.velocityWindowSeconds).toBe(60);
      expect(result.velocityCooldownSeconds).toBe(120);
    });

    it("omitting velocity fields is valid (opt-in)", () => {
      const result = createBudgetInputSchema.parse(validInput);
      expect(result.velocityLimitMicrodollars).toBeUndefined();
      expect(result.velocityWindowSeconds).toBeUndefined();
      expect(result.velocityCooldownSeconds).toBeUndefined();
    });

    it("rejects non-positive velocityLimitMicrodollars", () => {
      expect(() =>
        createBudgetInputSchema.parse({ ...validInput, velocityLimitMicrodollars: 0 }),
      ).toThrow(ZodError);
      expect(() =>
        createBudgetInputSchema.parse({ ...validInput, velocityLimitMicrodollars: -100 }),
      ).toThrow(ZodError);
    });

    it("rejects float velocityLimitMicrodollars", () => {
      expect(() =>
        createBudgetInputSchema.parse({ ...validInput, velocityLimitMicrodollars: 1.5 }),
      ).toThrow(ZodError);
    });

    it("rejects velocityWindowSeconds below 10", () => {
      expect(() =>
        createBudgetInputSchema.parse({ ...validInput, velocityWindowSeconds: 5 }),
      ).toThrow(ZodError);
    });

    it("rejects velocityWindowSeconds above 3600", () => {
      expect(() =>
        createBudgetInputSchema.parse({ ...validInput, velocityWindowSeconds: 7200 }),
      ).toThrow(ZodError);
    });

    it("rejects velocityCooldownSeconds below 10", () => {
      expect(() =>
        createBudgetInputSchema.parse({ ...validInput, velocityCooldownSeconds: 1 }),
      ).toThrow(ZodError);
    });

    it("rejects velocityCooldownSeconds above 3600", () => {
      expect(() =>
        createBudgetInputSchema.parse({ ...validInput, velocityCooldownSeconds: 5000 }),
      ).toThrow(ZodError);
    });

    it("accepts boundary values (10 and 3600)", () => {
      const result = createBudgetInputSchema.parse({
        ...validInput,
        velocityLimitMicrodollars: 1,
        velocityWindowSeconds: 10,
        velocityCooldownSeconds: 3600,
      });
      expect(result.velocityWindowSeconds).toBe(10);
      expect(result.velocityCooldownSeconds).toBe(3600);
    });
  });

  describe("session limits", () => {
    it("accepts valid sessionLimitMicrodollars", () => {
      const result = createBudgetInputSchema.parse({
        ...validInput,
        sessionLimitMicrodollars: 5_000_000,
      });
      expect(result.sessionLimitMicrodollars).toBe(5_000_000);
    });

    it("accepts null sessionLimitMicrodollars (disable)", () => {
      const result = createBudgetInputSchema.parse({
        ...validInput,
        sessionLimitMicrodollars: null,
      });
      expect(result.sessionLimitMicrodollars).toBeNull();
    });

    it("omitting sessionLimitMicrodollars is valid (optional)", () => {
      const result = createBudgetInputSchema.parse(validInput);
      expect(result.sessionLimitMicrodollars).toBeUndefined();
    });

    it("rejects non-positive sessionLimitMicrodollars", () => {
      expect(() =>
        createBudgetInputSchema.parse({ ...validInput, sessionLimitMicrodollars: 0 }),
      ).toThrow(ZodError);
      expect(() =>
        createBudgetInputSchema.parse({ ...validInput, sessionLimitMicrodollars: -100 }),
      ).toThrow(ZodError);
    });

    it("rejects float sessionLimitMicrodollars", () => {
      expect(() =>
        createBudgetInputSchema.parse({ ...validInput, sessionLimitMicrodollars: 1.5 }),
      ).toThrow(ZodError);
    });
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
    thresholdPercentages: [50, 80, 90, 95],
    velocityLimitMicrodollars: null,
    velocityWindowSeconds: 60,
    velocityCooldownSeconds: 60,
    sessionLimitMicrodollars: null,
  };

  it("accepts valid budget response shape", () => {
    const result = budgetResponseSchema.parse(validResponse);
    expect(result.id).toBe("ns_bgt_550e8400-e29b-41d4-a716-446655440000");
    expect(result.entityId).toBe("ns_key_550e8400-e29b-41d4-a716-446655440001");
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

  it("includes thresholdPercentages in output", () => {
    const result = budgetResponseSchema.parse(validResponse);
    expect(result.thresholdPercentages).toEqual([50, 80, 90, 95]);
  });

  it("passes tag entityId through without UUID prefix wrapping", () => {
    const result = budgetResponseSchema.parse({
      ...validResponse,
      entityType: "tag",
      entityId: "project=openclaw",
    });
    // Tag IDs are key=value strings, not UUIDs — no ns_ prefix
    expect(result.entityId).toBe("project=openclaw");
    expect(result.id).toBe("ns_bgt_550e8400-e29b-41d4-a716-446655440000");
  });

  it("handles unknown entityType without crashing", () => {
    const result = budgetResponseSchema.parse({
      ...validResponse,
      entityType: "agent",
      entityId: "some-id",
    });
    // Unknown types pass through rather than crash the entire response
    expect(result.entityId).toBe("some-id");
  });
});

describe("budgetEntitySchema", () => {
  it("includes thresholdPercentages in output", () => {
    const result = budgetEntitySchema.parse({
      entityType: "user",
      entityId: "550e8400-e29b-41d4-a716-446655440000",
      limitMicrodollars: 10_000_000,
      spendMicrodollars: 3_000_000,
      remainingMicrodollars: 7_000_000,
      policy: "strict_block",
      resetInterval: "monthly",
      currentPeriodStart: "2026-03-01T00:00:00.000Z",
      thresholdPercentages: [25, 50, 75],
      velocityLimitMicrodollars: 5_000_000,
      velocityWindowSeconds: 60,
      velocityCooldownSeconds: 120,
      sessionLimitMicrodollars: null,
    });
    expect(result.thresholdPercentages).toEqual([25, 50, 75]);
  });

  it("includes velocity fields in output", () => {
    const result = budgetEntitySchema.parse({
      entityType: "user",
      entityId: "550e8400-e29b-41d4-a716-446655440000",
      limitMicrodollars: 10_000_000,
      spendMicrodollars: 3_000_000,
      remainingMicrodollars: 7_000_000,
      policy: "strict_block",
      resetInterval: null,
      currentPeriodStart: null,
      thresholdPercentages: [],
      velocityLimitMicrodollars: 5_000_000,
      velocityWindowSeconds: 30,
      velocityCooldownSeconds: 90,
      sessionLimitMicrodollars: null,
    });
    expect(result.velocityLimitMicrodollars).toBe(5_000_000);
    expect(result.velocityWindowSeconds).toBe(30);
    expect(result.velocityCooldownSeconds).toBe(90);
  });

  it("accepts null velocity fields", () => {
    const result = budgetEntitySchema.parse({
      entityType: "user",
      entityId: "550e8400-e29b-41d4-a716-446655440000",
      limitMicrodollars: 10_000_000,
      spendMicrodollars: 0,
      remainingMicrodollars: 10_000_000,
      policy: "strict_block",
      resetInterval: null,
      currentPeriodStart: null,
      thresholdPercentages: [],
      velocityLimitMicrodollars: null,
      velocityWindowSeconds: null,
      velocityCooldownSeconds: null,
      sessionLimitMicrodollars: null,
    });
    expect(result.velocityLimitMicrodollars).toBeNull();
  });

  it("includes sessionLimitMicrodollars in output", () => {
    const result = budgetEntitySchema.parse({
      entityType: "user",
      entityId: "550e8400-e29b-41d4-a716-446655440000",
      limitMicrodollars: 10_000_000,
      spendMicrodollars: 0,
      remainingMicrodollars: 10_000_000,
      policy: "strict_block",
      resetInterval: null,
      currentPeriodStart: null,
      thresholdPercentages: [50, 80, 90, 95],
      velocityLimitMicrodollars: null,
      velocityWindowSeconds: null,
      velocityCooldownSeconds: null,
      sessionLimitMicrodollars: 5_000_000,
    });
    expect(result.sessionLimitMicrodollars).toBe(5_000_000);
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
    expect(body.error.code).toBe("validation_error");
    expect(body.error.message).toBe("Request validation failed.");
    expect(body.error.details.issues).toHaveLength(1);
    expect(body.error.details.issues[0]).toEqual({
      path: ["maxBudgetMicrodollars"],
      message: "Expected number, received string",
    });
    expect(body.error.details.issues[0]).not.toHaveProperty("code");
    expect(body.error.details.issues[0]).not.toHaveProperty("expected");
    expect(body.error.details.issues[0]).not.toHaveProperty("received");
  });
});

// ---------------------------------------------------------------------------
// Policy schema + policy in create/response schemas
// ---------------------------------------------------------------------------

describe("policySchema", () => {
  it("accepts strict_block", () => {
    expect(policySchema.parse("strict_block")).toBe("strict_block");
  });

  it("accepts soft_block", () => {
    expect(policySchema.parse("soft_block")).toBe("soft_block");
  });

  it("accepts warn", () => {
    expect(policySchema.parse("warn")).toBe("warn");
  });

  it("rejects invalid policy values", () => {
    expect(() => policySchema.parse("block")).toThrow();
    expect(() => policySchema.parse("")).toThrow();
    expect(() => policySchema.parse("STRICT_BLOCK")).toThrow();
  });
});

describe("createBudgetInputSchema policy field", () => {
  const validBase = {
    entityType: "user",
    entityId: "ns_usr_550e8400-e29b-41d4-a716-446655440000",
    maxBudgetMicrodollars: 10_000_000,
  };

  it("accepts policy: strict_block", () => {
    const result = createBudgetInputSchema.safeParse({ ...validBase, policy: "strict_block" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.policy).toBe("strict_block");
  });

  it("accepts policy: soft_block", () => {
    const result = createBudgetInputSchema.safeParse({ ...validBase, policy: "soft_block" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.policy).toBe("soft_block");
  });

  it("accepts policy: warn", () => {
    const result = createBudgetInputSchema.safeParse({ ...validBase, policy: "warn" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.policy).toBe("warn");
  });

  it("accepts omitted policy (defaults to DB level)", () => {
    const result = createBudgetInputSchema.safeParse(validBase);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.policy).toBeUndefined();
  });

  it("rejects invalid policy value", () => {
    const result = createBudgetInputSchema.safeParse({ ...validBase, policy: "block_all" });
    expect(result.success).toBe(false);
  });
});

describe("budgetResponseSchema policy enum", () => {
  const validResponse = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    entityType: "api_key",
    entityId: "550e8400-e29b-41d4-a716-446655440001",
    maxBudgetMicrodollars: 50_000_000,
    spendMicrodollars: 10_000_000,
    policy: "strict_block",
    resetInterval: null,
    currentPeriodStart: null,
    createdAt: "2026-02-15T12:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
    thresholdPercentages: [50, 80, 90, 95],
    velocityLimitMicrodollars: null,
    velocityWindowSeconds: null,
    velocityCooldownSeconds: null,
    sessionLimitMicrodollars: null,
  };

  it("accepts soft_block in response", () => {
    const result = budgetResponseSchema.parse({ ...validResponse, policy: "soft_block" });
    expect(result.policy).toBe("soft_block");
  });

  it("accepts warn in response", () => {
    const result = budgetResponseSchema.parse({ ...validResponse, policy: "warn" });
    expect(result.policy).toBe("warn");
  });

  it("rejects invalid policy in response", () => {
    expect(() => budgetResponseSchema.parse({ ...validResponse, policy: "invalid" })).toThrow();
  });
});

describe("budgetEntitySchema policy enum", () => {
  const validEntity = {
    entityType: "user",
    entityId: "550e8400-e29b-41d4-a716-446655440000",
    limitMicrodollars: 10_000_000,
    spendMicrodollars: 3_000_000,
    remainingMicrodollars: 7_000_000,
    policy: "strict_block",
    resetInterval: null,
    currentPeriodStart: null,
    thresholdPercentages: [],
    velocityLimitMicrodollars: null,
    velocityWindowSeconds: null,
    velocityCooldownSeconds: null,
    sessionLimitMicrodollars: null,
  };

  it("accepts soft_block", () => {
    const result = budgetEntitySchema.parse({ ...validEntity, policy: "soft_block" });
    expect(result.policy).toBe("soft_block");
  });

  it("accepts warn", () => {
    const result = budgetEntitySchema.parse({ ...validEntity, policy: "warn" });
    expect(result.policy).toBe("warn");
  });

  it("rejects invalid policy", () => {
    expect(() => budgetEntitySchema.parse({ ...validEntity, policy: "none" })).toThrow();
  });
});
