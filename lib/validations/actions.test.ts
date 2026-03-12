import { describe, expect, it } from "vitest";

import {
  createActionInputSchema,
  listActionsQuerySchema,
  markResultInputSchema,
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
