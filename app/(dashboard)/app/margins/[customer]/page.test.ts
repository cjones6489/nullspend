import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

/**
 * Regression tests for the Customer Detail (margins) page.
 * Tests source-level contracts for the 404 handling fix.
 *
 * ISSUE-006: Page showed blank skeleton for non-existent customers.
 * Root cause: React Query retried the 404 three times (~6s loading).
 * Fix: useCustomerDetail uses retryOnServerError to skip 4xx retries.
 * Found by /qa on 2026-04-10.
 */
describe("Customer detail page contracts", () => {
  const source = readFileSync(
    "app/(dashboard)/app/margins/[customer]/page.tsx",
    "utf-8",
  );

  it("renders a not-found message when isError or data is null", () => {
    // The component must have an error/empty state that shows a user-friendly message
    expect(source).toContain("Customer not found or data unavailable");
  });

  it("shows a back link in the error state", () => {
    // Users on a 404 detail page need a way back to the margins list
    expect(source).toContain("Back to Margins");
  });

  it("error state comes before the main content render", () => {
    // The isError check must be an early return, not buried inside the layout
    const errorIdx = source.indexOf("isError || !data");
    const mainIdx = source.indexOf("chartData");
    expect(errorIdx).toBeGreaterThan(-1);
    expect(mainIdx).toBeGreaterThan(-1);
    expect(errorIdx).toBeLessThan(mainIdx);
  });

  it("has eslint-disable for external avatar img", () => {
    if (source.includes("<img ")) {
      expect(source).toContain("eslint-disable-next-line @next/next/no-img-element");
    }
  });

  it("uses useCustomerDetail hook (which has retryOnServerError)", () => {
    expect(source).toContain("useCustomerDetail");
  });
});
