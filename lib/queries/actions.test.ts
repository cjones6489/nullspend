import { describe, expect, it } from "vitest";

import { actionKeys } from "@/lib/queries/actions";

describe("action query keys", () => {
  it("includes limit in list keys to avoid cache collisions", () => {
    expect(actionKeys.list("pending", 50)).not.toEqual(
      actionKeys.list("pending", 100),
    );
  });

  it("keeps different statuses isolated", () => {
    expect(actionKeys.list("pending", 50)).not.toEqual(
      actionKeys.list("approved", 50),
    );
  });
});

describe("actionKeys.listInfinite", () => {
  it("produces distinct keys for different single statuses", () => {
    expect(actionKeys.listInfinite("pending")).not.toEqual(
      actionKeys.listInfinite("approved"),
    );
  });

  it("produces distinct keys for single status vs multi-status", () => {
    expect(actionKeys.listInfinite("approved")).not.toEqual(
      actionKeys.listInfinite(undefined, ["approved", "executed"]),
    );
  });

  it("produces distinct keys for different multi-status arrays", () => {
    expect(actionKeys.listInfinite(undefined, ["approved", "executed"])).not.toEqual(
      actionKeys.listInfinite(undefined, ["approved", "failed"]),
    );
  });

  it("does not collide with useActions list keys", () => {
    const infiniteKey = actionKeys.listInfinite("pending");
    const listKey = actionKeys.list("pending", 50);
    expect(infiniteKey).not.toEqual(listKey);
  });

  it("uses 'all' default when no status is provided", () => {
    const key = actionKeys.listInfinite();
    expect(key).toContain("all");
    expect(key).toContain("none");
  });

  it("uses 'none' for statuses when statuses is undefined", () => {
    const key = actionKeys.listInfinite("pending", undefined);
    expect(key[key.length - 1]).toBe("none");
  });

  it("joins statuses with commas", () => {
    const key = actionKeys.listInfinite(undefined, ["approved", "executed", "failed"]);
    expect(key[key.length - 1]).toBe("approved,executed,failed");
  });
});
