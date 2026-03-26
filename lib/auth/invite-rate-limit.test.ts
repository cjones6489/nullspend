import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  checkInviteRateLimit,
  _resetInviteRateLimitForTesting,
} from "./invite-rate-limit";

describe("checkInviteRateLimit", () => {
  beforeEach(() => {
    _resetInviteRateLimitForTesting();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows requests under the limit (10/min)", () => {
    for (let i = 0; i < 9; i++) {
      const result = checkInviteRateLimit("192.168.1.1");
      expect(result).toEqual({ allowed: true });
    }
  });

  it("blocks requests at the limit and returns retryAfterSeconds", () => {
    for (let i = 0; i < 10; i++) {
      checkInviteRateLimit("10.0.0.1");
    }

    const result = checkInviteRateLimit("10.0.0.1");
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
    expect(result.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it("different IPs have independent limits", () => {
    // Exhaust IP A
    for (let i = 0; i < 10; i++) {
      checkInviteRateLimit("1.1.1.1");
    }
    expect(checkInviteRateLimit("1.1.1.1").allowed).toBe(false);

    // IP B is still fine
    const result = checkInviteRateLimit("2.2.2.2");
    expect(result).toEqual({ allowed: true });
  });

  it("returns allowed:true when IP is null (no rate limiting)", () => {
    const result = checkInviteRateLimit(null);
    expect(result).toEqual({ allowed: true });
  });

  it("after the window expires, requests are allowed again", () => {
    vi.useFakeTimers();

    // Exhaust the limit
    for (let i = 0; i < 10; i++) {
      checkInviteRateLimit("172.16.0.1");
    }
    expect(checkInviteRateLimit("172.16.0.1").allowed).toBe(false);

    // Advance time past the 60-second window
    vi.advanceTimersByTime(60_001);

    const result = checkInviteRateLimit("172.16.0.1");
    expect(result.allowed).toBe(true);
  });
});
