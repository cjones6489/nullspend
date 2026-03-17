import { describe, expect, it } from "vitest";

import {
  actionIdParamsSchema,
  createActionInputSchema,
  listActionsQuerySchema,
  markResultInputSchema,
  MAX_EXPIRES_SECONDS,
  MAX_JSON_DEPTH,
  isWithinJsonDepth,
} from "@/lib/validations/actions";

describe("action validation schemas", () => {
  it("accepts a valid action creation payload", () => {
    const parsed = createActionInputSchema.parse({
      agentId: "sales-agent-1",
      actionType: "http_post",
      payload: {
        url: "https://example.com/hooks/outbound",
        body: {
          subject: "Follow up",
        },
      },
      metadata: {
        environment: "dev",
        sourceFramework: "custom-ts",
      },
    });

    expect(parsed.actionType).toBe("http_post");
    expect(parsed.metadata?.environment).toBe("dev");
  });

  it("rejects an unsupported action type", () => {
    expect(() =>
      createActionInputSchema.parse({
        agentId: "sales-agent-1",
        actionType: "http_patch",
        payload: {
          url: "https://example.com",
        },
      }),
    ).toThrow();
  });

  it("requires an error message for failed execution results", () => {
    expect(() =>
      markResultInputSchema.parse({
        status: "failed",
      }),
    ).toThrow();
  });

  it("rejects result payloads while execution is still in progress", () => {
    expect(() =>
      markResultInputSchema.parse({
        status: "executing",
        result: {
          ok: true,
        },
      }),
    ).toThrow();
  });
});

describe("listActionsQuerySchema", () => {
  it("parses a comma-separated statuses string", () => {
    const result = listActionsQuerySchema.parse({
      statuses: "approved,executed,failed",
    });
    expect(result.statuses).toEqual(["approved", "executed", "failed"]);
  });

  it("parses a single status in statuses", () => {
    const result = listActionsQuerySchema.parse({
      statuses: "pending",
    });
    expect(result.statuses).toEqual(["pending"]);
  });

  it("leaves statuses undefined when not provided", () => {
    const result = listActionsQuerySchema.parse({});
    expect(result.statuses).toBeUndefined();
  });

  it("rejects invalid statuses", () => {
    expect(() =>
      listActionsQuerySchema.parse({
        statuses: "approved,invalid_status",
      }),
    ).toThrow();
  });

  it("allows both status and statuses (statuses takes precedence in listActions)", () => {
    const result = listActionsQuerySchema.parse({
      status: "pending",
      statuses: "approved,executed",
    });
    expect(result.status).toBe("pending");
    expect(result.statuses).toEqual(["approved", "executed"]);
  });

  it("defaults limit to 50 when not provided", () => {
    const result = listActionsQuerySchema.parse({});
    expect(result.limit).toBe(50);
  });

  it("clamps limit to max 100", () => {
    expect(() => listActionsQuerySchema.parse({ limit: "101" })).toThrow();
  });

  it("rejects limit of 0", () => {
    expect(() => listActionsQuerySchema.parse({ limit: "0" })).toThrow();
  });

  it("rejects negative limit", () => {
    expect(() => listActionsQuerySchema.parse({ limit: "-5" })).toThrow();
  });

  it("accepts limit of 1 (minimum)", () => {
    const result = listActionsQuerySchema.parse({ limit: "1" });
    expect(result.limit).toBe(1);
  });

  it("accepts limit of 100 (maximum)", () => {
    const result = listActionsQuerySchema.parse({ limit: "100" });
    expect(result.limit).toBe(100);
  });

  it("parses a valid cursor object", () => {
    const cursor = JSON.stringify({
      createdAt: "2026-03-01T00:00:00.000Z",
      id: "550e8400-e29b-41d4-a716-446655440000",
    });
    const result = listActionsQuerySchema.parse({ cursor });
    expect(result.cursor).toEqual({
      createdAt: "2026-03-01T00:00:00.000Z",
      id: "550e8400-e29b-41d4-a716-446655440000",
    });
  });

  it("rejects cursor with invalid JSON", () => {
    expect(() =>
      listActionsQuerySchema.parse({ cursor: "not-json" }),
    ).toThrow();
  });

  it("rejects cursor with missing id field", () => {
    const cursor = JSON.stringify({ createdAt: "2026-03-01T00:00:00.000Z" });
    expect(() => listActionsQuerySchema.parse({ cursor })).toThrow();
  });

  it("rejects cursor with missing createdAt field", () => {
    const cursor = JSON.stringify({ id: "550e8400-e29b-41d4-a716-446655440000" });
    expect(() => listActionsQuerySchema.parse({ cursor })).toThrow();
  });

  it("rejects cursor with non-UUID id", () => {
    const cursor = JSON.stringify({
      createdAt: "2026-03-01T00:00:00.000Z",
      id: "not-a-uuid",
    });
    expect(() => listActionsQuerySchema.parse({ cursor })).toThrow();
  });

  it("rejects cursor with non-datetime createdAt", () => {
    const cursor = JSON.stringify({
      createdAt: "not-a-date",
      id: "550e8400-e29b-41d4-a716-446655440000",
    });
    expect(() => listActionsQuerySchema.parse({ cursor })).toThrow();
  });

  it("parses all seven valid action statuses in statuses", () => {
    const result = listActionsQuerySchema.parse({
      statuses: "pending,approved,rejected,expired,executing,executed,failed",
    });
    expect(result.statuses).toHaveLength(7);
  });

  it("rejects duplicate values if one is invalid in statuses", () => {
    expect(() =>
      listActionsQuerySchema.parse({ statuses: "pending,bogus" }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 3.2 — Upper bound on expiresInSeconds
// ---------------------------------------------------------------------------

describe("expiresInSeconds upper bound", () => {
  const validAction = {
    agentId: "test-agent",
    actionType: "file_write" as const,
    payload: { path: "/tmp/test.txt" },
  };

  it("accepts expiresInSeconds at max (30 days)", () => {
    const result = createActionInputSchema.parse({
      ...validAction,
      expiresInSeconds: MAX_EXPIRES_SECONDS,
    });
    expect(result.expiresInSeconds).toBe(2_592_000);
  });

  it("rejects expiresInSeconds above max", () => {
    expect(() =>
      createActionInputSchema.parse({
        ...validAction,
        expiresInSeconds: MAX_EXPIRES_SECONDS + 1,
      }),
    ).toThrow();
  });

  it("rejects expiresInSeconds of 999999999 (31 years)", () => {
    expect(() =>
      createActionInputSchema.parse({
        ...validAction,
        expiresInSeconds: 999_999_999,
      }),
    ).toThrow();
  });

  it("still accepts 0 (never-expire)", () => {
    const result = createActionInputSchema.parse({
      ...validAction,
      expiresInSeconds: 0,
    });
    expect(result.expiresInSeconds).toBe(0);
  });

  it("still accepts null (use default TTL)", () => {
    const result = createActionInputSchema.parse({
      ...validAction,
      expiresInSeconds: null,
    });
    expect(result.expiresInSeconds).toBeNull();
  });

  it("still accepts undefined (use default TTL)", () => {
    const result = createActionInputSchema.parse(validAction);
    expect(result.expiresInSeconds).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3.1 — JSON depth limit on payload/metadata
// ---------------------------------------------------------------------------

describe("isWithinJsonDepth", () => {
  it("returns true for flat object", () => {
    expect(isWithinJsonDepth({ a: 1, b: "two" })).toBe(true);
  });

  it("returns true for exactly max depth", () => {
    let obj: Record<string, unknown> = { value: "leaf" };
    for (let i = 0; i < 19; i++) {
      obj = { nested: obj };
    }
    // depth 0 = outer object, depth 19 = 20th level has the innermost object
    expect(isWithinJsonDepth(obj, 20)).toBe(true);
  });

  it("returns false for max depth + 1", () => {
    let obj: Record<string, unknown> = { value: "leaf" };
    for (let i = 0; i < 20; i++) {
      obj = { nested: obj };
    }
    // 21 levels of nesting
    expect(isWithinJsonDepth(obj, 20)).toBe(false);
  });

  it("checks depth in arrays", () => {
    let obj: unknown = "leaf";
    for (let i = 0; i < 21; i++) {
      obj = [obj];
    }
    expect(isWithinJsonDepth(obj, 20)).toBe(false);
  });

  it("returns true for primitives", () => {
    expect(isWithinJsonDepth("hello")).toBe(true);
    expect(isWithinJsonDepth(42)).toBe(true);
    expect(isWithinJsonDepth(null)).toBe(true);
    expect(isWithinJsonDepth(true)).toBe(true);
  });
});

describe("payload depth limit", () => {
  const baseAction = {
    agentId: "test-agent",
    actionType: "file_write" as const,
  };

  function nestedObject(depth: number): Record<string, unknown> {
    let obj: Record<string, unknown> = { value: "leaf" };
    for (let i = 1; i < depth; i++) {
      obj = { nested: obj };
    }
    return obj;
  }

  it("accepts payload at exactly 20 levels", () => {
    const result = createActionInputSchema.parse({
      ...baseAction,
      payload: nestedObject(20),
    });
    expect(result.payload).toBeDefined();
  });

  it("rejects payload at 21 levels", () => {
    expect(() =>
      createActionInputSchema.parse({
        ...baseAction,
        payload: nestedObject(21),
      }),
    ).toThrow(/nesting/);
  });

  it("accepts metadata at exactly 20 levels", () => {
    const result = createActionInputSchema.parse({
      ...baseAction,
      payload: {},
      metadata: nestedObject(20),
    });
    expect(result.metadata).toBeDefined();
  });

  it("rejects metadata at 21 levels", () => {
    expect(() =>
      createActionInputSchema.parse({
        ...baseAction,
        payload: {},
        metadata: nestedObject(21),
      }),
    ).toThrow(/nesting/);
  });
});

describe("result depth limit", () => {
  function nestedObject(depth: number): Record<string, unknown> {
    let obj: Record<string, unknown> = { value: "leaf" };
    for (let i = 1; i < depth; i++) {
      obj = { nested: obj };
    }
    return obj;
  }

  it("accepts result at exactly 20 levels", () => {
    const result = markResultInputSchema.parse({
      status: "executed",
      result: nestedObject(20),
    });
    expect(result.result).toBeDefined();
  });

  it("rejects result at 21 levels", () => {
    expect(() =>
      markResultInputSchema.parse({
        status: "executed",
        result: nestedObject(21),
      }),
    ).toThrow(/nesting/);
  });
});

// ---------------------------------------------------------------------------
// 3.4 — Zod v4 behavioral audit
// ---------------------------------------------------------------------------

describe("Zod v4 behavioral audit", () => {
  it(".default(50) on limit always resolves to 50 when undefined", () => {
    const result = listActionsQuerySchema.parse({});
    expect(result.limit).toBe(50);
    expect(typeof result.limit).toBe("number");
  });

  it(".default(50) on limit does not override explicit value", () => {
    const result = listActionsQuerySchema.parse({ limit: "10" });
    expect(result.limit).toBe(10);
  });

  it(".uuid() rejects non-RFC-4122 strings", () => {
    expect(() => actionIdParamsSchema.parse({ id: "not-a-uuid" })).toThrow();
    expect(() => actionIdParamsSchema.parse({ id: "" })).toThrow();
    // Zod 4 enforces strict RFC 4122 — version/variant bits must be valid
    expect(() => actionIdParamsSchema.parse({ id: "12345678-1234-1234-1234-123456789012" })).toThrow();
    // Valid v4 UUID passes
    expect(() => actionIdParamsSchema.parse({ id: "550e8400-e29b-41d4-a716-446655440000" })).not.toThrow();
  });

  it(".optional() fields are truly absent when not provided", () => {
    const result = createActionInputSchema.parse({
      agentId: "test",
      actionType: "file_write",
      payload: {},
    });
    expect(result.metadata).toBeUndefined();
    expect(result.expiresInSeconds).toBeUndefined();
  });
});
