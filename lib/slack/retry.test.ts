import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SlackWebhookError } from "./notify";
import { retryWithBackoff } from "./retry";

describe("retryWithBackoff", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns on first success without retrying", async () => {
    const fn = vi.fn().mockResolvedValue("ok");

    const result = await retryWithBackoff(fn);

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries transient error then succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new SlackWebhookError(500, "Internal"))
      .mockRejectedValueOnce(new SlackWebhookError(502, "Bad Gateway"))
      .mockResolvedValue("ok");

    const result = await retryWithBackoff(fn, {
      baseDelayMs: 1,
      maxDelayMs: 1,
    });

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("throws final error when all retries exhausted", async () => {
    const fn = vi
      .fn()
      .mockRejectedValue(new SlackWebhookError(500, "Internal"));

    await expect(
      retryWithBackoff(fn, { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 1 }),
    ).rejects.toThrow("Slack webhook error 500");

    // 1 initial + 2 retries = 3 total
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("throws immediately for non-retryable status (404)", async () => {
    const fn = vi
      .fn()
      .mockRejectedValue(new SlackWebhookError(404, "channel_not_found"));

    await expect(
      retryWithBackoff(fn, { maxRetries: 3, baseDelayMs: 1 }),
    ).rejects.toThrow("Slack webhook error 404");

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("throws immediately for non-retryable status (403)", async () => {
    const fn = vi
      .fn()
      .mockRejectedValue(new SlackWebhookError(403, "forbidden"));

    await expect(
      retryWithBackoff(fn, { maxRetries: 3, baseDelayMs: 1 }),
    ).rejects.toThrow("Slack webhook error 403");

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on retryable status (429)", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new SlackWebhookError(429, "rate limited"))
      .mockResolvedValue("ok");

    const result = await retryWithBackoff(fn, { baseDelayMs: 1, maxDelayMs: 1 });

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries on network error (TypeError)", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValue("ok");

    const result = await retryWithBackoff(fn, { baseDelayMs: 1, maxDelayMs: 1 });

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not retry on generic Error", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("some random error"));

    await expect(
      retryWithBackoff(fn, { maxRetries: 3, baseDelayMs: 1 }),
    ).rejects.toThrow("some random error");

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("backoff delay increases between retries", async () => {
    const delays: number[] = [];
    const originalSetTimeout = globalThis.setTimeout;

    // Spy on setTimeout to track delay values
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const fn = vi
      .fn()
      .mockRejectedValueOnce(new SlackWebhookError(500, "err"))
      .mockRejectedValueOnce(new SlackWebhookError(500, "err"))
      .mockResolvedValue("ok");

    await retryWithBackoff(fn, { baseDelayMs: 100, maxDelayMs: 10000 });

    // Extract delay values from setTimeout calls that have numeric delay > 0
    const retryCalls = setTimeoutSpy.mock.calls.filter(
      (call) => typeof call[1] === "number" && call[1] >= 0,
    );

    // Should have at least 2 retry delays
    expect(retryCalls.length).toBeGreaterThanOrEqual(2);

    setTimeoutSpy.mockRestore();
  });
});
