import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(),
}));

vi.mock("@nullspend/db", () => ({
  auditEvents: Symbol("auditEvents"),
}));

import { logAuditEvent } from "./log";
import { getDb } from "@/lib/db/client";
import { auditEvents } from "@nullspend/db";

function createMockDb() {
  const thenFn = vi.fn().mockReturnThis();
  const catchFn = vi.fn().mockReturnThis();
  const valuesFn = vi.fn().mockReturnValue({ then: thenFn, catch: catchFn });
  const insertFn = vi.fn().mockReturnValue({ values: valuesFn });
  return { insertFn, valuesFn, thenFn, catchFn, db: { insert: insertFn } };
}

describe("logAuditEvent", () => {
  let mock: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    vi.restoreAllMocks();
    mock = createMockDb();
    vi.mocked(getDb).mockReturnValue(mock.db as any);
  });

  it("inserts audit event into database with correct fields", () => {
    logAuditEvent({
      orgId: "org_123",
      actorId: "user_456",
      action: "member.invited",
      resourceType: "invitation",
      resourceId: "inv_789",
      metadata: { email: "test@example.com" },
    });

    expect(mock.insertFn).toHaveBeenCalledWith(auditEvents);
    expect(mock.valuesFn).toHaveBeenCalledWith({
      orgId: "org_123",
      actorId: "user_456",
      action: "member.invited",
      resourceType: "invitation",
      resourceId: "inv_789",
      metadata: { email: "test@example.com" },
    });
  });

  it("does not throw on DB error (fire-and-forget)", () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const dbError = new Error("connection refused");

    // Make then call the catch handler with the error
    mock.thenFn.mockImplementation(() => ({ catch: (fn: (err: Error) => void) => fn(dbError) }));

    expect(() => {
      logAuditEvent({
        orgId: "org_123",
        actorId: "user_456",
        action: "member.removed",
        resourceType: "member",
      });
    }).not.toThrow();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[audit] Failed to write audit event:",
      dbError,
    );
  });

  it("handles all required fields: orgId, actorId, action, resourceType", () => {
    logAuditEvent({
      orgId: "org_abc",
      actorId: "user_def",
      action: "budget.created",
      resourceType: "budget",
    });

    expect(mock.valuesFn).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org_abc",
        actorId: "user_def",
        action: "budget.created",
        resourceType: "budget",
      }),
    );
  });

  it("sets optional resourceId to null when omitted", () => {
    logAuditEvent({
      orgId: "org_1",
      actorId: "user_1",
      action: "key.rotated",
      resourceType: "api_key",
    });

    expect(mock.valuesFn).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceId: null,
      }),
    );
  });

  it("sets optional metadata to null when omitted", () => {
    logAuditEvent({
      orgId: "org_1",
      actorId: "user_1",
      action: "key.rotated",
      resourceType: "api_key",
    });

    expect(mock.valuesFn).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: null,
      }),
    );
  });
});
