import { describe, it, expect } from "vitest";

import { orgKeys } from "@/lib/queries/orgs";

/**
 * Regression: org switch only invalidated session + org queries,
 * leaving budgets/keys/cost-events/margins serving stale data from
 * the previous org. Fixed by calling queryClient.invalidateQueries()
 * with no args (invalidates everything).
 * Found by /qa on 2026-04-10.
 *
 * Note: the actual invalidation logic uses queryClient.invalidateQueries()
 * which is a React Query runtime call. We test the query key structure here
 * to catch cache key regressions, and document the invalidation contract.
 */
describe("orgKeys", () => {
  it("all key is stable", () => {
    expect(orgKeys.all).toEqual(["orgs"]);
  });

  it("list key extends all", () => {
    expect(orgKeys.list()).toEqual(["orgs", "list"]);
    expect(orgKeys.list().slice(0, 1)).toEqual(orgKeys.all);
  });

  it("list keys are referentially stable across calls", () => {
    // React Query relies on deep equality, not reference equality,
    // but structural stability matters for cache hit consistency.
    expect(orgKeys.list()).toEqual(orgKeys.list());
  });
});

/**
 * Contract test: useSwitchOrg must invalidate ALL queries on success.
 *
 * The implementation calls queryClient.invalidateQueries() with no args,
 * which clears the entire cache. This test documents the requirement so
 * a future refactor doesn't accidentally scope the invalidation back to
 * just session/org keys (which was the original bug).
 *
 * To verify: read lib/queries/orgs.ts, find useSwitchOrg's onSuccess,
 * confirm it calls invalidateQueries() with no query key filter.
 */
describe("useSwitchOrg invalidation contract", () => {
  it("onSuccess must call invalidateQueries() with no args (full cache clear)", async () => {
    const { readFileSync } = await import("fs");
    const source = readFileSync("lib/queries/orgs.ts", "utf-8");

    // The onSuccess handler must contain invalidateQueries() without a queryKey arg
    // Old broken code: queryClient.invalidateQueries({ queryKey: sessionKeys.current })
    // Fixed code: queryClient.invalidateQueries()
    expect(source).toContain("queryClient.invalidateQueries()");
    expect(source).not.toContain("queryClient.invalidateQueries({ queryKey: sessionKeys");
  });

  it("sessionKeys import should be removed (no longer needed)", async () => {
    const { readFileSync } = await import("fs");
    const source = readFileSync("lib/queries/orgs.ts", "utf-8");
    expect(source).not.toContain("import { sessionKeys }");
  });
});
