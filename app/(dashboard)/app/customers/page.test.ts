import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

/**
 * Regression tests for the Customers page.
 * Tests source-level contracts since the component requires
 * React Query + Next.js router context for rendering tests.
 *
 * Found by /qa stress testing on 2026-04-10.
 */
describe("Customers page contracts", () => {
  const source = readFileSync("app/(dashboard)/app/customers/page.tsx", "utf-8");

  describe("email fallback for nameless Stripe customers (ISSUE-009)", () => {
    it("uses customerEmail as fallback before stripeCustomerId", () => {
      // The display chain should be: name → email → raw ID
      // Old code: customer.customerName ?? customer.stripeCustomerId
      // Fixed code: customer.customerName ?? customer.customerEmail ?? customer.stripeCustomerId
      expect(source).toContain("customer.customerEmail ?? customer.stripeCustomerId");
    });

    it("does NOT fall directly from name to stripeCustomerId (would skip email)", () => {
      // Ensure the old pattern without email fallback doesn't exist
      // Allow the match pattern (which doesn't have customerEmail)
      const lines = source.split("\n");
      const directFallbackLines = lines.filter(
        (l) =>
          l.includes("customerName ?? customer.stripeCustomerId") &&
          !l.includes("customerEmail") &&
          !l.includes("match.") // auto-match rows don't have customerEmail
      );
      expect(directFallbackLines).toHaveLength(0);
    });
  });

  describe("mobile responsive layout (ISSUE-013)", () => {
    it("header uses flex-wrap for mobile stacking", () => {
      expect(source).toContain("flex flex-wrap items-start justify-between");
    });

    it("button group uses flex-wrap", () => {
      expect(source).toContain("flex flex-wrap items-center gap-2");
    });

    it("table wrapper uses overflow-x-auto (not overflow-hidden)", () => {
      expect(source).toContain("overflow-x-auto rounded-lg border");
      expect(source).not.toMatch(/hidden md:block overflow-hidden rounded-lg border/);
    });
  });

  describe("img elements have eslint-disable for external Stripe avatars", () => {
    it("avatar img tags have eslint-disable-next-line", () => {
      const imgLines = source.split("\n").filter((l) => l.includes("<img "));
      const disableLines = source.split("\n").filter((l) =>
        l.includes("eslint-disable-next-line @next/next/no-img-element"),
      );
      expect(imgLines.length).toBeGreaterThan(0);
      expect(disableLines.length).toBe(imgLines.length);
    });
  });
});
