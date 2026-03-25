import { describe, expect, it } from "vitest";

import { isAtLeastTier } from "@/lib/hooks/use-org-tier";

// useOrgTier is a React hook — test it indirectly through components or integration tests.
// isAtLeastTier is a pure function — test it thoroughly here.

describe("isAtLeastTier", () => {
  describe("free tier comparisons", () => {
    it("free >= free", () => expect(isAtLeastTier("free", "free")).toBe(true));
    it("free < pro", () => expect(isAtLeastTier("free", "pro")).toBe(false));
    it("free < enterprise", () =>
      expect(isAtLeastTier("free", "enterprise")).toBe(false));
  });

  describe("pro tier comparisons", () => {
    it("pro >= free", () => expect(isAtLeastTier("pro", "free")).toBe(true));
    it("pro >= pro", () => expect(isAtLeastTier("pro", "pro")).toBe(true));
    it("pro < enterprise", () =>
      expect(isAtLeastTier("pro", "enterprise")).toBe(false));
  });

  describe("enterprise tier comparisons", () => {
    it("enterprise >= free", () =>
      expect(isAtLeastTier("enterprise", "free")).toBe(true));
    it("enterprise >= pro", () =>
      expect(isAtLeastTier("enterprise", "pro")).toBe(true));
    it("enterprise >= enterprise", () =>
      expect(isAtLeastTier("enterprise", "enterprise")).toBe(true));
  });
});
