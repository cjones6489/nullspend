/**
 * Unit tests for `global-setup.ts` — the E2E framework's pre-flight
 * reachability check.
 *
 * Guards the fix for the Slice 1 audit finding BUG-1 (globalSetup env
 * mutation does not propagate to vitest workers). These tests verify
 * the behavior contract that replaced the broken env-var mechanism:
 *
 *   1. If /api/health returns 200, setup resolves cleanly
 *   2. If /api/health returns 503, setup resolves (degraded is still
 *      reachable — the health-endpoint E2E test will surface it)
 *   3. If /api/health returns any other status, setup throws with
 *      a descriptive message
 *   4. If fetch throws (network error, DNS failure, timeout), setup
 *      throws with remediation instructions
 *
 * Any reintroduction of the old env-var mechanism or silent fallback
 * would break one of these assertions.
 */

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

import setup from "./global-setup";

describe("global-setup pre-flight health check", () => {
  const originalFetch = globalThis.fetch;
  const originalBaseUrl = process.env.NULLSPEND_BASE_URL;
  const originalCI = process.env.CI;

  beforeEach(() => {
    // Pin a predictable base URL so the error messages are deterministic
    process.env.NULLSPEND_BASE_URL = "http://test-target.invalid";
    // Clear CI so we exercise the "local" branch — the behavior is the
    // same in both branches (both throw on failure), but the banner
    // string differs.
    delete process.env.CI;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env.NULLSPEND_BASE_URL = originalBaseUrl;
    if (originalCI !== undefined) process.env.CI = originalCI;
    else delete process.env.CI;
  });

  it("resolves cleanly when /api/health returns 200", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "ok" }), { status: 200 }),
    );

    const teardown = await setup();

    expect(teardown).toBeTypeOf("function");
    // Teardown is a no-op in Slice 1 but should still be callable
    await expect(teardown()).resolves.toBeUndefined();
  });

  it("resolves cleanly when /api/health returns 503 (degraded but reachable)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "degraded" }), { status: 503 }),
    );

    await expect(setup()).resolves.toBeTypeOf("function");
  });

  it("throws when /api/health returns 404", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("Not Found", { status: 404 }),
    );

    await expect(setup()).rejects.toThrow(/returned HTTP 404/);
  });

  it("throws when /api/health returns 500", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("Internal Server Error", { status: 500 }),
    );

    await expect(setup()).rejects.toThrow(/returned HTTP 500/);
  });

  it("throws when /api/health returns 502", async () => {
    // 502 Bad Gateway — upstream failure, neither ok nor degraded
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("Bad Gateway", { status: 502 }),
    );

    await expect(setup()).rejects.toThrow(/returned HTTP 502/);
  });

  it("throws when fetch rejects (network error / DNS failure)", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(
      new TypeError("fetch failed"),
    );

    await expect(setup()).rejects.toThrow(/is not reachable/);
  });

  it("throws when fetch rejects with an AbortError (timeout)", async () => {
    const abortErr = new Error("The operation was aborted");
    abortErr.name = "AbortError";
    globalThis.fetch = vi.fn().mockRejectedValue(abortErr);

    await expect(setup()).rejects.toThrow(/is not reachable/);
  });

  it("error message names the target URL", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("", { status: 500 }),
    );

    await expect(setup()).rejects.toThrow(
      /http:\/\/test-target\.invalid\/api\/health/,
    );
  });

  it("network-error message includes remediation instructions", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed"));

    await expect(setup()).rejects.toThrow(/pnpm dev|NULLSPEND_BASE_URL|Vercel/);
  });

  it("fetches exactly /api/health (not root or verbose)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "ok" }), { status: 200 }),
    );
    globalThis.fetch = fetchMock;

    await setup();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl] = fetchMock.mock.calls[0];
    expect(String(calledUrl)).toBe("http://test-target.invalid/api/health");
  });

  it("uses an AbortSignal timeout on the fetch request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "ok" }), { status: 200 }),
    );
    globalThis.fetch = fetchMock;

    await setup();

    const init = fetchMock.mock.calls[0][1];
    // AbortSignal.timeout() returns an AbortSignal with an internal
    // timer — we just verify a signal was passed.
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
});
