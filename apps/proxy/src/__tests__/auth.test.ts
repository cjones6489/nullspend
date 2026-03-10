import { describe, it, expect, beforeAll } from "vitest";
import { validatePlatformKey } from "../lib/auth.js";

// crypto.subtle.timingSafeEqual is a CF Workers API; polyfill for Node.js tests
beforeAll(() => {
  if (!crypto.subtle.timingSafeEqual) {
    (crypto.subtle as any).timingSafeEqual = (a: ArrayBuffer, b: ArrayBuffer) => {
      const viewA = new Uint8Array(a);
      const viewB = new Uint8Array(b);
      if (viewA.byteLength !== viewB.byteLength) return false;
      let result = 0;
      for (let i = 0; i < viewA.byteLength; i++) {
        result |= viewA[i] ^ viewB[i];
      }
      return result === 0;
    };
  }
});

describe("validatePlatformKey", () => {
  const secret = "sk-test-secret-key-12345";

  it("returns true for a valid matching key", async () => {
    expect(await validatePlatformKey(secret, secret)).toBe(true);
  });

  it("returns false for an invalid key", async () => {
    expect(await validatePlatformKey("wrong-key-same-length!!", secret)).toBe(false);
  });

  it("returns false for a different-length key (no timing leak)", async () => {
    expect(await validatePlatformKey("short", secret)).toBe(false);
    expect(await validatePlatformKey(secret + "-extra-long-suffix", secret)).toBe(false);
  });

  it("returns false for a null key", async () => {
    expect(await validatePlatformKey(null, secret)).toBe(false);
  });

  it("returns false for an empty string key", async () => {
    expect(await validatePlatformKey("", secret)).toBe(false);
  });

  it("returns false when secret is undefined (env var not set)", async () => {
    expect(await validatePlatformKey("any-key", undefined)).toBe(false);
  });

  it("returns false when both provided and secret are undefined", async () => {
    expect(await validatePlatformKey(null, undefined)).toBe(false);
  });
});
