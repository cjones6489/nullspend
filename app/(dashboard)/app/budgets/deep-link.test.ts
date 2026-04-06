import { describe, expect, it } from "vitest";

import { parseDeepLink } from "./deep-link";

function params(obj: Record<string, string>) {
  return { get: (key: string) => obj[key] ?? null };
}

describe("parseDeepLink", () => {
  const keyIds = ["ns_key_aaa", "ns_key_bbb"];

  it("returns none when no params present", () => {
    expect(parseDeepLink(params({}), keyIds)).toEqual({ action: "none" });
  });

  it("returns create with entityId when key exists", () => {
    const result = parseDeepLink(
      params({ create: "api_key", entityId: "ns_key_aaa" }),
      keyIds,
    );
    expect(result).toEqual({
      action: "create",
      entityType: "api_key",
      entityId: "ns_key_aaa",
    });
  });

  it("returns create without entityId when key is revoked/missing", () => {
    const result = parseDeepLink(
      params({ create: "api_key", entityId: "ns_key_gone" }),
      keyIds,
    );
    expect(result).toEqual({
      action: "create",
      entityType: "api_key",
      entityId: undefined,
    });
  });

  it("ignores create without entityId param", () => {
    const result = parseDeepLink(params({ create: "api_key" }), keyIds);
    expect(result).toEqual({ action: "none" });
  });

  it("ignores create with non-api_key type", () => {
    const result = parseDeepLink(
      params({ create: "tag", entityId: "ns_key_aaa" }),
      keyIds,
    );
    expect(result).toEqual({ action: "none" });
  });

  it("returns highlight with budgetId when selected param present", () => {
    const result = parseDeepLink(
      params({ selected: "ns_bgt_xyz" }),
      keyIds,
    );
    expect(result).toEqual({
      action: "highlight",
      budgetId: "ns_bgt_xyz",
    });
  });

  it("prefers create over selected when both present", () => {
    const result = parseDeepLink(
      params({ create: "api_key", entityId: "ns_key_aaa", selected: "ns_bgt_xyz" }),
      keyIds,
    );
    expect(result.action).toBe("create");
  });

  it("handles empty keyIds array", () => {
    const result = parseDeepLink(
      params({ create: "api_key", entityId: "ns_key_aaa" }),
      [],
    );
    expect(result.entityId).toBeUndefined();
  });
});
