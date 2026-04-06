import { describe, expect, it } from "vitest";

import { validateTagKey, validateTagValue, validateTagAdd } from "@/components/keys/tag-utils";

// ---------------------------------------------------------------------------
// validateTagKey — mirrors server-side tagKeySchema
// ---------------------------------------------------------------------------

describe("validateTagKey", () => {
  it("rejects empty key", () => {
    expect(validateTagKey("")).toBe("Key is required");
  });

  it("rejects whitespace-only key", () => {
    expect(validateTagKey("   ")).toBe("Key is required");
  });

  it("rejects _ns_ prefix", () => {
    expect(validateTagKey("_ns_internal")).toBe("Tags starting with _ns_ are reserved");
  });

  it("accepts alphanumeric keys", () => {
    expect(validateTagKey("customer")).toBeNull();
  });

  it("accepts keys with hyphens and underscores", () => {
    expect(validateTagKey("cost-center_01")).toBeNull();
  });

  it("accepts single character key", () => {
    expect(validateTagKey("a")).toBeNull();
  });

  // Format enforcement (regex parity with server)
  it("rejects keys with dots", () => {
    expect(validateTagKey("cost.center")).toBe("Keys must be alphanumeric, underscore, or hyphen");
  });

  it("rejects keys with spaces", () => {
    expect(validateTagKey("my tag")).toBe("Keys must be alphanumeric, underscore, or hyphen");
  });

  it("rejects keys with special characters", () => {
    expect(validateTagKey("key@123")).toBe("Keys must be alphanumeric, underscore, or hyphen");
  });

  it("rejects keys with slashes", () => {
    expect(validateTagKey("team/frontend")).toBe("Keys must be alphanumeric, underscore, or hyphen");
  });

  it("rejects keys with equals sign", () => {
    expect(validateTagKey("key=value")).toBe("Keys must be alphanumeric, underscore, or hyphen");
  });

  // Length enforcement
  it("accepts 64-char key (at limit)", () => {
    expect(validateTagKey("a".repeat(64))).toBeNull();
  });

  it("rejects 65-char key (over limit)", () => {
    expect(validateTagKey("a".repeat(65))).toBe("Keys must be 64 characters or fewer");
  });

  // Trim then validate
  it("trims before validating format", () => {
    expect(validateTagKey("  customer  ")).toBeNull();
  });

  it("trims before checking _ns_ prefix", () => {
    expect(validateTagKey("  _ns_foo")).toBe("Tags starting with _ns_ are reserved");
  });
});

// ---------------------------------------------------------------------------
// validateTagValue — mirrors server-side tagValueSchema
// ---------------------------------------------------------------------------

describe("validateTagValue", () => {
  it("accepts empty string", () => {
    expect(validateTagValue("")).toBeNull();
  });

  it("accepts normal value", () => {
    expect(validateTagValue("acme-corp")).toBeNull();
  });

  it("accepts value with special characters", () => {
    expect(validateTagValue("hello world! @#$%")).toBeNull();
  });

  it("accepts 256-char value (at limit)", () => {
    expect(validateTagValue("x".repeat(256))).toBeNull();
  });

  it("rejects 257-char value (over limit)", () => {
    expect(validateTagValue("x".repeat(257))).toBe("Values must be 256 characters or fewer");
  });

  it("rejects value containing null byte", () => {
    expect(validateTagValue("hello\0world")).toBe("Values must not contain null bytes");
  });

  it("rejects null byte alone", () => {
    expect(validateTagValue("\0")).toBe("Values must not contain null bytes");
  });
});

// ---------------------------------------------------------------------------
// validateTagAdd — composite validation
// ---------------------------------------------------------------------------

describe("validateTagAdd", () => {
  it("allows adding when under limit", () => {
    expect(validateTagAdd("c", { a: "1", b: "2" })).toBeNull();
  });

  it("allows updating an existing key at the limit", () => {
    const existing: Record<string, string> = {};
    for (let i = 0; i < 10; i++) existing[`k${i}`] = `v${i}`;
    expect(validateTagAdd("k0", existing)).toBeNull();
  });

  it("rejects adding a new key at the limit", () => {
    const existing: Record<string, string> = {};
    for (let i = 0; i < 10; i++) existing[`k${i}`] = `v${i}`;
    expect(validateTagAdd("k10", existing)).toBe("Maximum 10 tags");
  });

  it("allows adding when exactly at 9", () => {
    const existing: Record<string, string> = {};
    for (let i = 0; i < 9; i++) existing[`k${i}`] = `v${i}`;
    expect(validateTagAdd("k9", existing)).toBeNull();
  });

  it("rejects _ns_ prefix even when under limit", () => {
    expect(validateTagAdd("_ns_foo", { a: "1" })).toBe("Tags starting with _ns_ are reserved");
  });

  it("rejects empty key", () => {
    expect(validateTagAdd("", {})).toBe("Key is required");
  });

  // Key format validation flows through
  it("rejects invalid key format", () => {
    expect(validateTagAdd("bad.key", {})).toBe("Keys must be alphanumeric, underscore, or hyphen");
  });

  it("rejects overlength key", () => {
    expect(validateTagAdd("a".repeat(65), {})).toBe("Keys must be 64 characters or fewer");
  });

  // Value validation when provided
  it("accepts valid key+value pair", () => {
    expect(validateTagAdd("customer", {}, "acme")).toBeNull();
  });

  it("rejects overlength value", () => {
    expect(validateTagAdd("customer", {}, "x".repeat(257))).toBe("Values must be 256 characters or fewer");
  });

  it("rejects null byte in value", () => {
    expect(validateTagAdd("customer", {}, "bad\0value")).toBe("Values must not contain null bytes");
  });

  it("skips value validation when value is undefined", () => {
    expect(validateTagAdd("customer", {})).toBeNull();
  });

  // Combined: key error takes precedence over value error
  it("reports key error before value error", () => {
    expect(validateTagAdd("bad.key", {}, "x".repeat(257))).toBe(
      "Keys must be alphanumeric, underscore, or hyphen",
    );
  });
});
