import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CircuitBreaker, CircuitOpenError, CircuitTimeoutError } from "./circuit-breaker";

vi.mock("@/lib/observability", () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe("CircuitBreaker", () => {
  let cb: CircuitBreaker;

  beforeEach(() => {
    cb = new CircuitBreaker({
      name: "test",
      failureThreshold: 3,
      resetTimeoutMs: 1000,
      requestTimeoutMs: 500,
    });
  });

  afterEach(() => {
    cb._resetForTesting();
  });

  it("CLOSED: successful calls pass through", async () => {
    const result = await cb.call(() => Promise.resolve("ok"));
    expect(result).toBe("ok");
    expect(cb.getState()).toBe("CLOSED");
  });

  it("CLOSED: failures increment counter but don't open circuit below threshold", async () => {
    for (let i = 0; i < 2; i++) {
      await expect(cb.call(() => Promise.reject(new Error("fail")))).rejects.toThrow("fail");
    }
    expect(cb.getState()).toBe("CLOSED");
  });

  it("CLOSED → OPEN after N consecutive failures", async () => {
    for (let i = 0; i < 3; i++) {
      await expect(cb.call(() => Promise.reject(new Error("fail")))).rejects.toThrow("fail");
    }
    expect(cb.getState()).toBe("OPEN");
  });

  it("OPEN: calls fail immediately with CircuitOpenError without executing fn", async () => {
    // Trip the circuit
    for (let i = 0; i < 3; i++) {
      await expect(cb.call(() => Promise.reject(new Error("fail")))).rejects.toThrow();
    }
    expect(cb.getState()).toBe("OPEN");

    const fn = vi.fn();
    await expect(cb.call(fn)).rejects.toThrow(CircuitOpenError);
    expect(fn).not.toHaveBeenCalled();
  });

  it("OPEN → HALF_OPEN after reset timeout", async () => {
    // Trip the circuit
    for (let i = 0; i < 3; i++) {
      await expect(cb.call(() => Promise.reject(new Error("fail")))).rejects.toThrow();
    }
    expect(cb.getState()).toBe("OPEN");

    // Advance time past reset timeout
    vi.useFakeTimers();
    vi.advanceTimersByTime(1001);

    // Next call should transition to HALF_OPEN and execute
    const result = await cb.call(() => Promise.resolve("recovered"));
    expect(result).toBe("recovered");
    expect(cb.getState()).toBe("CLOSED");

    vi.useRealTimers();
  });

  it("HALF_OPEN success → CLOSED, resets counter", async () => {
    // Trip the circuit
    for (let i = 0; i < 3; i++) {
      await expect(cb.call(() => Promise.reject(new Error("fail")))).rejects.toThrow();
    }

    vi.useFakeTimers();
    vi.advanceTimersByTime(1001);

    await cb.call(() => Promise.resolve("ok"));
    expect(cb.getState()).toBe("CLOSED");

    // Should be able to handle failures again without immediately opening
    await expect(cb.call(() => Promise.reject(new Error("fail")))).rejects.toThrow();
    expect(cb.getState()).toBe("CLOSED"); // Only 1 failure, threshold is 3

    vi.useRealTimers();
  });

  it("HALF_OPEN failure → back to OPEN", async () => {
    // Trip the circuit
    for (let i = 0; i < 3; i++) {
      await expect(cb.call(() => Promise.reject(new Error("fail")))).rejects.toThrow();
    }

    vi.useFakeTimers();
    vi.advanceTimersByTime(1001);

    await expect(cb.call(() => Promise.reject(new Error("still down")))).rejects.toThrow("still down");
    expect(cb.getState()).toBe("OPEN");

    vi.useRealTimers();
  });

  it("success resets consecutive failure counter", async () => {
    // 2 failures (below threshold of 3)
    for (let i = 0; i < 2; i++) {
      await expect(cb.call(() => Promise.reject(new Error("fail")))).rejects.toThrow();
    }

    // 1 success — resets counter
    await cb.call(() => Promise.resolve("ok"));
    expect(cb.getState()).toBe("CLOSED");

    // 2 more failures — still below threshold because counter was reset
    for (let i = 0; i < 2; i++) {
      await expect(cb.call(() => Promise.reject(new Error("fail")))).rejects.toThrow();
    }
    expect(cb.getState()).toBe("CLOSED");
  });

  it("timeout triggers failure with CircuitTimeoutError (fn exceeds requestTimeoutMs)", async () => {
    await expect(
      cb.call(() => new Promise((resolve) => setTimeout(resolve, 2000))),
    ).rejects.toBeInstanceOf(CircuitTimeoutError);
  });

  it("_resetForTesting() resets all state", async () => {
    // Trip the circuit
    for (let i = 0; i < 3; i++) {
      await expect(cb.call(() => Promise.reject(new Error("fail")))).rejects.toThrow();
    }
    expect(cb.getState()).toBe("OPEN");

    cb._resetForTesting();
    expect(cb.getState()).toBe("CLOSED");

    // Should work normally after reset
    const result = await cb.call(() => Promise.resolve("ok"));
    expect(result).toBe("ok");
  });
});
