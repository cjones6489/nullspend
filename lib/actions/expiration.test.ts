import { describe, expect, it } from "vitest";

import {
  computeExpiresAt,
  DEFAULT_EXPIRATION_SECONDS,
  MAX_EXPIRATION_SECONDS,
  isActionExpired,
} from "./expiration";

describe("isActionExpired", () => {
  it("returns true for pending action past its expiresAt", () => {
    const pastDate = new Date(Date.now() - 60_000);
    expect(isActionExpired({ status: "pending", expiresAt: pastDate })).toBe(
      true,
    );
  });

  it("returns false for pending action before its expiresAt", () => {
    const futureDate = new Date(Date.now() + 60_000);
    expect(isActionExpired({ status: "pending", expiresAt: futureDate })).toBe(
      false,
    );
  });

  it("returns false for pending action with null expiresAt (never expires)", () => {
    expect(isActionExpired({ status: "pending", expiresAt: null })).toBe(false);
  });

  it("returns false for non-pending action even if past expiresAt", () => {
    const pastDate = new Date(Date.now() - 60_000);
    expect(isActionExpired({ status: "approved", expiresAt: pastDate })).toBe(
      false,
    );
    expect(isActionExpired({ status: "expired", expiresAt: pastDate })).toBe(
      false,
    );
    expect(isActionExpired({ status: "rejected", expiresAt: pastDate })).toBe(
      false,
    );
  });

  it("returns true when expiresAt is exactly now", () => {
    const now = new Date();
    expect(isActionExpired({ status: "pending", expiresAt: now })).toBe(true);
  });
});

describe("computeExpiresAt", () => {
  it("ACT-6: caps expiresInSeconds=0 to MAX_EXPIRATION_SECONDS (no immortal actions)", () => {
    const before = Date.now();
    const result = computeExpiresAt(0);
    const after = Date.now();

    expect(result).toBeInstanceOf(Date);
    expect(result!.getTime()).toBeGreaterThanOrEqual(before + MAX_EXPIRATION_SECONDS * 1000);
    expect(result!.getTime()).toBeLessThanOrEqual(after + MAX_EXPIRATION_SECONDS * 1000);
  });

  it("ACT-6: caps expiresInSeconds=null to MAX_EXPIRATION_SECONDS (no immortal actions)", () => {
    const before = Date.now();
    const result = computeExpiresAt(null);
    const after = Date.now();

    expect(result).toBeInstanceOf(Date);
    expect(result!.getTime()).toBeGreaterThanOrEqual(before + MAX_EXPIRATION_SECONDS * 1000);
    expect(result!.getTime()).toBeLessThanOrEqual(after + MAX_EXPIRATION_SECONDS * 1000);
  });

  it("ACT-6: caps excessively large TTL to MAX_EXPIRATION_SECONDS", () => {
    const before = Date.now();
    const result = computeExpiresAt(999999999); // way over 7 days
    const after = Date.now();

    expect(result).toBeInstanceOf(Date);
    expect(result!.getTime()).toBeGreaterThanOrEqual(before + MAX_EXPIRATION_SECONDS * 1000);
    expect(result!.getTime()).toBeLessThanOrEqual(after + MAX_EXPIRATION_SECONDS * 1000);
  });

  it("uses default TTL when expiresInSeconds is undefined", () => {
    const before = Date.now();
    const result = computeExpiresAt(undefined);
    const after = Date.now();

    expect(result).toBeInstanceOf(Date);
    const expectedMin = before + DEFAULT_EXPIRATION_SECONDS * 1000;
    const expectedMax = after + DEFAULT_EXPIRATION_SECONDS * 1000;
    expect(result!.getTime()).toBeGreaterThanOrEqual(expectedMin);
    expect(result!.getTime()).toBeLessThanOrEqual(expectedMax);
  });

  it("computes correct deadline for a custom TTL", () => {
    const before = Date.now();
    const result = computeExpiresAt(120);
    const after = Date.now();

    expect(result).toBeInstanceOf(Date);
    expect(result!.getTime()).toBeGreaterThanOrEqual(before + 120_000);
    expect(result!.getTime()).toBeLessThanOrEqual(after + 120_000);
  });

  it("computes correct deadline for a very short TTL", () => {
    const before = Date.now();
    const result = computeExpiresAt(1);
    const after = Date.now();

    expect(result).toBeInstanceOf(Date);
    expect(result!.getTime()).toBeGreaterThanOrEqual(before + 1000);
    expect(result!.getTime()).toBeLessThanOrEqual(after + 1000);
  });
});
