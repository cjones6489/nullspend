import { describe, it, expect } from "vitest";

import { marginKeys } from "@/lib/queries/margins";
import { retryOnServerError, ApiError } from "@/lib/api/client";

/**
 * Regression: customer detail page showed blank skeleton for ~6s on
 * non-existent customers because React Query retried the 404 three times.
 * Fixed by adding retry: retryOnServerError to useCustomerDetail.
 * Found by /qa on 2026-04-10.
 */
describe("marginKeys", () => {
  it("detail key includes customer and period", () => {
    expect(marginKeys.detail("acme-corp", "2026-04")).toEqual([
      "margins", "detail", "acme-corp", "2026-04",
    ]);
  });

  it("different customers produce different keys", () => {
    expect(marginKeys.detail("acme", "2026-04")).not.toEqual(
      marginKeys.detail("beta", "2026-04"),
    );
  });

  it("different periods produce different keys", () => {
    expect(marginKeys.detail("acme", "2026-04")).not.toEqual(
      marginKeys.detail("acme", "2026-03"),
    );
  });

  it("table key includes period", () => {
    expect(marginKeys.table("2026-04")).toEqual(["margins", "table", "2026-04"]);
  });

  it("connection key is stable", () => {
    expect(marginKeys.connection()).toEqual(["margins", "connection"]);
  });
});

describe("retryOnServerError (used by useCustomerDetail)", () => {
  it("does NOT retry on 404 (customer not found)", () => {
    const error = new ApiError("Customer mapping not found.", 404, "not_found");
    expect(retryOnServerError(0, error)).toBe(false);
  });

  it("does NOT retry on 400 (bad request)", () => {
    const error = new ApiError("Bad request", 400, "validation_error");
    expect(retryOnServerError(0, error)).toBe(false);
  });

  it("does NOT retry on 401 (unauthorized)", () => {
    const error = new ApiError("Unauthorized", 401, "authentication_required");
    expect(retryOnServerError(0, error)).toBe(false);
  });

  it("retries on 500 (server error) up to 2 times", () => {
    const error = new ApiError("Internal error", 500, "internal_error");
    expect(retryOnServerError(0, error)).toBe(true);
    expect(retryOnServerError(1, error)).toBe(true);
    expect(retryOnServerError(2, error)).toBe(false);
  });

  it("retries on 503 (service unavailable)", () => {
    const error = new ApiError("Service unavailable", 503);
    expect(retryOnServerError(0, error)).toBe(true);
  });

  it("retries on non-ApiError (network failure)", () => {
    const error = new Error("fetch failed");
    expect(retryOnServerError(0, error)).toBe(true);
  });
});

/**
 * Contract test: useCustomerDetail must use retryOnServerError.
 * Without it, 404s cause a ~6s loading skeleton (3 retries × 2s backoff).
 */
describe("useCustomerDetail retry contract", () => {
  it("must use retryOnServerError to skip retries on 4xx", async () => {
    const { readFileSync } = await import("fs");
    const source = readFileSync("lib/queries/margins.ts", "utf-8");
    expect(source).toContain("retry: retryOnServerError");
    expect(source).toContain("import { apiDelete, apiGet, apiPost, retryOnServerError }");
  });
});
