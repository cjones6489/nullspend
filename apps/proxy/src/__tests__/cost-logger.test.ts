/**
 * Unit tests for the cost-logger module.
 * Covers isLocalConnection detection and logCostEvent behavior
 * in local dev mode (console fallback) and error resilience.
 *
 * Important: The cost-logger module is designed to NEVER throw,
 * because it runs inside waitUntil() where unhandled rejections
 * could crash the Cloudflare Workers runtime.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// We can't directly test the private `isLocalConnection` function,
// so we test it indirectly through `logCostEvent` behavior.
// However, we can also re-implement the detection logic for direct testing.

// Re-implement isLocalConnection for direct unit testing
function isLocalConnection(connectionString: string): boolean {
  try {
    const url = new URL(connectionString);
    const host = url.hostname;
    return (
      host === "127.0.0.1" ||
      host === "localhost" ||
      host === "::1" ||
      host === "[::1]" ||
      host.endsWith(".hyperdrive.local")
    );
  } catch {
    return false;
  }
}

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
    ...overrides,
  };
}

describe("isLocalConnection", () => {
  describe("local addresses", () => {
    it("detects 127.0.0.1", () => {
      expect(isLocalConnection("postgresql://user:pass@127.0.0.1:5432/db")).toBe(true);
    });

    it("detects localhost", () => {
      expect(isLocalConnection("postgresql://user:pass@localhost:5432/db")).toBe(true);
    });

    it("detects IPv6 loopback", () => {
      expect(isLocalConnection("postgresql://user:pass@[::1]:5432/db")).toBe(true);
    });

    it("detects Hyperdrive local emulation hostname", () => {
      expect(
        isLocalConnection("postgresql://user:pass@d4b0065cdf52b2240de63bd8c1c5ce9f.hyperdrive.local:5432/db"),
      ).toBe(true);
    });

    it("detects any subdomain of .hyperdrive.local", () => {
      expect(
        isLocalConnection("postgresql://user:pass@abc123.hyperdrive.local:5432/db"),
      ).toBe(true);
    });

    it("detects 127.0.0.1 with default Supabase port", () => {
      expect(isLocalConnection("postgresql://postgres:postgres@127.0.0.1:54322/postgres")).toBe(true);
    });

    it("detects localhost with no port specified", () => {
      expect(isLocalConnection("postgresql://user:pass@localhost/db")).toBe(true);
    });
  });

  describe("remote addresses", () => {
    it("rejects real Supabase host", () => {
      expect(
        isLocalConnection("postgresql://user:pass@db.abcdefghij.supabase.co:5432/postgres"),
      ).toBe(false);
    });

    it("rejects AWS RDS endpoint", () => {
      expect(
        isLocalConnection("postgresql://user:pass@mydb.cluster-12345.us-east-1.rds.amazonaws.com:5432/db"),
      ).toBe(false);
    });

    it("rejects generic remote hostname", () => {
      expect(isLocalConnection("postgresql://user:pass@postgres.example.com:5432/db")).toBe(false);
    });

    it("rejects IP address that isn't localhost", () => {
      expect(isLocalConnection("postgresql://user:pass@192.168.1.1:5432/db")).toBe(false);
    });

    it("rejects 10.0.0.1 (private but not loopback)", () => {
      expect(isLocalConnection("postgresql://user:pass@10.0.0.1:5432/db")).toBe(false);
    });

    it("rejects hyperdrive.local without subdomain (no dot prefix match)", () => {
      // .endsWith(".hyperdrive.local") won't match bare "hyperdrive.local"
      // This is correct - real Hyperdrive always uses a hash subdomain
      expect(isLocalConnection("postgresql://user:pass@hyperdrive.local:5432/db")).toBe(false);
    });
  });

  describe("invalid inputs", () => {
    it("returns false for empty string", () => {
      expect(isLocalConnection("")).toBe(false);
    });

    it("returns false for non-URL string", () => {
      expect(isLocalConnection("not a url at all")).toBe(false);
    });

    it("returns false for partial URL", () => {
      expect(isLocalConnection("localhost:5432")).toBe(false);
    });

    it("handles URL with unusual characters in password", () => {
      expect(
        isLocalConnection("postgresql://user:p%40ss%23word@127.0.0.1:5432/db"),
      ).toBe(true);
    });

    it("handles connection string with query parameters", () => {
      expect(
        isLocalConnection("postgresql://user:pass@localhost:5432/db?sslmode=disable"),
      ).toBe(true);
    });
  });
});

describe("logCostEvent", () => {
  let logCostEvent: typeof import("../lib/cost-logger.js").logCostEvent;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import("../lib/cost-logger.js");
    logCostEvent = mod.logCostEvent;
  });

  it("does not throw with a local connection string", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(
      logCostEvent("postgresql://postgres:postgres@127.0.0.1:54322/postgres", makeCostEvent()),
    ).resolves.toBeUndefined();
    consoleSpy.mockRestore();
  });

  it("logs cost event to console for local connections", async () => {
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

  it("logs to console for hyperdrive.local addresses", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await logCostEvent(
      "postgresql://user:pass@abc123.hyperdrive.local:5432/db",
      makeCostEvent({ model: "gpt-4o" }),
    );

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const loggedEvent = consoleSpy.mock.calls[0][1] as Record<string, unknown>;
    expect(loggedEvent.model).toBe("gpt-4o");
    consoleSpy.mockRestore();
  });

  it("includes durationMs in console log for local connections", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await logCostEvent(
      "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
      makeCostEvent({ durationMs: 1234 }),
    );

    const loggedEvent = consoleSpy.mock.calls[0][1] as Record<string, unknown>;
    expect(loggedEvent.durationMs).toBe(1234);
    consoleSpy.mockRestore();
  });

  it("does not attempt pg connection for local addresses", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await logCostEvent("postgresql://postgres:postgres@localhost:5432/db", makeCostEvent());

    // If it tried to connect to pg, it would call console.error on failure
    expect(errorSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("does not throw for unreachable remote connection (graceful error handling)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Use a deliberately unreachable remote address (not localhost, so it bypasses the local check)
    // This will try to connect via pg and fail, but should not throw
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
