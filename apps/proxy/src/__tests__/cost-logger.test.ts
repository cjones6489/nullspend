/**
 * Unit tests for the cost-logger module.
 * Covers isLocalConnection flag-based detection and logCostEvent behavior
 * in local dev mode (console fallback) and error resilience.
 *
 * Important: The cost-logger module is designed to NEVER throw,
 * because it runs inside waitUntil() where unhandled rejections
 * could crash the Cloudflare Workers runtime.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isLocalConnection } from "../lib/cost-logger.js";

function makeCostEvent(overrides: Record<string, unknown> = {}) {
  return {
    requestId: "req-test-123",
    provider: "openai",
    model: "gpt-4o-mini",
    inputTokens: 50,
    outputTokens: 10,
    cachedInputTokens: 0,
    reasoningTokens: 0,
    costMicrodollars: 150,
    durationMs: 250,
    userId: null,
    apiKeyId: null,
    actionId: null,
    ...overrides,
  };
}

describe("isLocalConnection", () => {
  const globals = globalThis as Record<string, unknown>;

  afterEach(() => {
    delete globals.__FORCE_DB_PERSIST;
    delete globals.__SKIP_DB_PERSIST;
  });

  it("returns false by default (production: always persist)", () => {
    expect(isLocalConnection("postgresql://user:pass@127.0.0.1:5432/db")).toBe(false);
    expect(isLocalConnection("postgresql://user:pass@localhost:5432/db")).toBe(false);
    expect(isLocalConnection("postgresql://user:pass@db.supabase.co:5432/db")).toBe(false);
  });

  it("returns true when __SKIP_DB_PERSIST is set", () => {
    globals.__SKIP_DB_PERSIST = true;
    expect(isLocalConnection("postgresql://user:pass@db.supabase.co:5432/db")).toBe(true);
    expect(isLocalConnection("postgresql://user:pass@127.0.0.1:5432/db")).toBe(true);
  });

  it("returns false when __FORCE_DB_PERSIST is set (overrides skip)", () => {
    globals.__FORCE_DB_PERSIST = true;
    globals.__SKIP_DB_PERSIST = true;
    expect(isLocalConnection("postgresql://user:pass@127.0.0.1:5432/db")).toBe(false);
  });

  it("__FORCE_DB_PERSIST alone returns false", () => {
    globals.__FORCE_DB_PERSIST = true;
    expect(isLocalConnection("postgresql://user:pass@127.0.0.1:5432/db")).toBe(false);
  });
});

describe("logCostEvent", () => {
  let logCostEvent: typeof import("../lib/cost-logger.js").logCostEvent;
  const globals = globalThis as Record<string, unknown>;

  beforeEach(async () => {
    vi.resetModules();
    globals.__SKIP_DB_PERSIST = true;
    const mod = await import("../lib/cost-logger.js");
    logCostEvent = mod.logCostEvent;
  });

  afterEach(() => {
    delete globals.__FORCE_DB_PERSIST;
    delete globals.__SKIP_DB_PERSIST;
  });

  it("does not throw when DB persistence is skipped", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(
      logCostEvent("postgresql://postgres:postgres@127.0.0.1:54322/postgres", makeCostEvent()),
    ).resolves.toBeUndefined();
    consoleSpy.mockRestore();
  });

  it("logs cost event to console when skipping DB", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await logCostEvent("postgresql://postgres:postgres@localhost:5432/db", makeCostEvent());

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const logArgs = consoleSpy.mock.calls[0];
    expect(logArgs[0]).toContain("[cost-logger]");
    expect(logArgs[0]).toContain("Local dev");

    const loggedEvent = logArgs[1] as Record<string, unknown>;
    expect(loggedEvent.requestId).toBe("req-test-123");
    expect(loggedEvent.provider).toBe("openai");
    expect(loggedEvent.model).toBe("gpt-4o-mini");
    expect(loggedEvent.inputTokens).toBe(50);
    expect(loggedEvent.outputTokens).toBe(10);
    expect(loggedEvent.costMicrodollars).toBe(150);
    consoleSpy.mockRestore();
  });

  it("includes durationMs in console log when skipping DB", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await logCostEvent(
      "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
      makeCostEvent({ durationMs: 1234 }),
    );

    const loggedEvent = consoleSpy.mock.calls[0][1] as Record<string, unknown>;
    expect(loggedEvent.durationMs).toBe(1234);
    consoleSpy.mockRestore();
  });

  it("does not attempt pg connection when skipping DB", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await logCostEvent("postgresql://postgres:postgres@localhost:5432/db", makeCostEvent());

    expect(errorSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("does not throw for unreachable remote connection (graceful error handling)", async () => {
    delete globals.__SKIP_DB_PERSIST;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      logCostEvent("postgresql://user:pass@192.0.2.1:5432/db", makeCostEvent()),
    ).resolves.toBeUndefined();

    errorSpy.mockRestore();
  }, 15_000);

  it("handles missing durationMs gracefully", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await logCostEvent(
      "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
      makeCostEvent({ durationMs: undefined }),
    );

    const loggedEvent = consoleSpy.mock.calls[0][1] as Record<string, unknown>;
    expect(loggedEvent.durationMs).toBeUndefined();
    consoleSpy.mockRestore();
  });

  it("handles zero-value cost event", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await logCostEvent(
      "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
      makeCostEvent({
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        reasoningTokens: 0,
        costMicrodollars: 0,
      }),
    );

    const loggedEvent = consoleSpy.mock.calls[0][1] as Record<string, unknown>;
    expect(loggedEvent.inputTokens).toBe(0);
    expect(loggedEvent.outputTokens).toBe(0);
    expect(loggedEvent.costMicrodollars).toBe(0);
    consoleSpy.mockRestore();
  });

  it("handles very large token counts without overflow", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await logCostEvent(
      "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
      makeCostEvent({
        inputTokens: 128_000,
        outputTokens: 16_384,
        costMicrodollars: 9_999_999,
      }),
    );

    const loggedEvent = consoleSpy.mock.calls[0][1] as Record<string, unknown>;
    expect(loggedEvent.inputTokens).toBe(128_000);
    expect(loggedEvent.outputTokens).toBe(16_384);
    expect(loggedEvent.costMicrodollars).toBe(9_999_999);
    consoleSpy.mockRestore();
  });
});
