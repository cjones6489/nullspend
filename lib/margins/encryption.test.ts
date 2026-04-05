import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { encryptStripeKey, decryptStripeKey } from "./encryption";
import { randomBytes } from "node:crypto";

const TEST_KEY = randomBytes(32).toString("base64");

beforeAll(() => {
  vi.stubEnv("STRIPE_ENCRYPTION_KEY", TEST_KEY);
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe("encryptStripeKey + decryptStripeKey", () => {
  it("round-trips plaintext correctly", () => {
    const plaintext = "rk_live_abc123def456";
    const orgId = "org-1";
    const encrypted = encryptStripeKey(plaintext, orgId);
    const decrypted = decryptStripeKey(encrypted, orgId);
    expect(decrypted).toBe(plaintext);
  });

  it("produces different ciphertext for different plaintexts", () => {
    const a = encryptStripeKey("rk_live_aaa", "org-1");
    const b = encryptStripeKey("rk_live_bbb", "org-1");
    expect(a).not.toBe(b);
  });

  it("produces different ciphertext for same plaintext (different IV)", () => {
    const a = encryptStripeKey("rk_live_same", "org-1");
    const b = encryptStripeKey("rk_live_same", "org-1");
    expect(a).not.toBe(b);
  });

  it("fails to decrypt with wrong orgId (AAD mismatch)", () => {
    const encrypted = encryptStripeKey("rk_live_secret", "org-1");
    expect(() => decryptStripeKey(encrypted, "org-2")).toThrow();
  });

  it("fails on truncated ciphertext", () => {
    expect(() => decryptStripeKey("dG9vc2hvcnQ=", "org-1")).toThrow("too short");
  });

  it("fails on corrupted ciphertext", () => {
    const encrypted = encryptStripeKey("rk_live_test", "org-1");
    const corrupted = encrypted.slice(0, -5) + "AAAAA";
    expect(() => decryptStripeKey(corrupted, "org-1")).toThrow();
  });

  it("output is valid base64", () => {
    const encrypted = encryptStripeKey("rk_live_test", "org-1");
    expect(() => Buffer.from(encrypted, "base64")).not.toThrow();
    const decoded = Buffer.from(encrypted, "base64");
    expect(decoded.length).toBeGreaterThan(28); // IV(12) + at least 1 byte cipher + tag(16)
  });
});

describe("missing encryption key", () => {
  it("throws when STRIPE_ENCRYPTION_KEY is unset", () => {
    vi.stubEnv("STRIPE_ENCRYPTION_KEY", "");
    expect(() => encryptStripeKey("rk_live_test", "org-1")).toThrow("STRIPE_ENCRYPTION_KEY");
    vi.stubEnv("STRIPE_ENCRYPTION_KEY", TEST_KEY);
  });

  it("throws when key is wrong length", () => {
    vi.stubEnv("STRIPE_ENCRYPTION_KEY", Buffer.from("short").toString("base64"));
    expect(() => encryptStripeKey("rk_live_test", "org-1")).toThrow("32-byte");
    vi.stubEnv("STRIPE_ENCRYPTION_KEY", TEST_KEY);
  });
});
