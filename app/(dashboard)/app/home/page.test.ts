import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, it, expect } from "vitest";

const PAGE_SOURCE = readFileSync(
  resolve(__dirname, "page.tsx"),
  "utf-8",
);

/**
 * Verify that the Get Started code snippets reference real SDK exports.
 * If the SDK API changes, these tests break before users copy broken code.
 */
describe("Get Started snippet validity", () => {
  it("SDK snippet: NullSpend class exists and has createTrackedFetch", async () => {
    const { NullSpend } = await import("../../../../packages/sdk/src/client");
    expect(NullSpend).toBeDefined();
    expect(typeof NullSpend).toBe("function");
    expect(typeof NullSpend.prototype.createTrackedFetch).toBe("function");
  });

  it("SDK snippet: NullSpendConfig accepts baseUrl, apiKey, costReporting", async () => {
    const { NullSpend } = await import("../../../../packages/sdk/src/client");
    expect(() => {
      new NullSpend({
        baseUrl: "https://app.nullspend.com",
        apiKey: "ns_test_sk_abc",
        costReporting: {},
      });
    }).not.toThrow();
  });

  it("SDK snippet: trackedFetch (old wrong name) does NOT exist", async () => {
    const { NullSpend } = await import("../../../../packages/sdk/src/client");
    expect((NullSpend.prototype as unknown as Record<string, unknown>).trackedFetch).toBeUndefined();
  });

  it("Claude Agent snippet: withNullSpend is exported", async () => {
    const mod = await import("../../../../packages/claude-agent/src/with-nullspend");
    expect(mod.withNullSpend).toBeDefined();
    expect(typeof mod.withNullSpend).toBe("function");
  });
});

describe("Snippet URL safety", () => {
  it("SDK snippet does not hardcode localhost", () => {
    expect(PAGE_SOURCE).not.toMatch(/baseUrl:\s*["']http:\/\/localhost/);
    expect(PAGE_SOURCE).toContain("DASHBOARD_URL");
  });

  it("proxy snippet uses PROXY_URL variable, not hardcoded URL", () => {
    expect(PAGE_SOURCE).toContain("PROXY_URL");
    expect(PAGE_SOURCE).toMatch(/NEXT_PUBLIC_NULLSPEND_PROXY_URL.*proxy\.nullspend\.com/);
  });

  it("DASHBOARD_URL falls back to production URL", () => {
    expect(PAGE_SOURCE).toMatch(/NEXT_PUBLIC_APP_URL.*app\.nullspend\.com/);
  });
});
