import { describe, it, expect } from "vitest";
import { validateUUID, UUID_RE, stripNsPrefix } from "../lib/validation.js";

describe("validateUUID", () => {
  it("accepts valid lowercase UUID", () => {
    expect(validateUUID("550e8400-e29b-41d4-a716-446655440000")).toBe(
      "550e8400-e29b-41d4-a716-446655440000",
    );
  });

  it("accepts valid uppercase UUID", () => {
    expect(validateUUID("550E8400-E29B-41D4-A716-446655440000")).toBe(
      "550E8400-E29B-41D4-A716-446655440000",
    );
  });

  it("accepts valid mixed case UUID", () => {
    expect(validateUUID("550e8400-E29B-41d4-A716-446655440000")).toBe(
      "550e8400-E29B-41d4-A716-446655440000",
    );
  });

  it("returns null for null input", () => {
    expect(validateUUID(null)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(validateUUID("")).toBeNull();
  });

  it("rejects UUID without hyphens", () => {
    expect(validateUUID("550e8400e29b41d4a716446655440000")).toBeNull();
  });

  it("rejects UUID with extra characters", () => {
    expect(validateUUID("550e8400-e29b-41d4-a716-446655440000-extra")).toBeNull();
  });

  it("rejects non-hex characters", () => {
    expect(validateUUID("550g8400-e29b-41d4-a716-446655440000")).toBeNull();
  });

  it("rejects SQL injection attempt", () => {
    expect(validateUUID("'; DROP TABLE budgets;--")).toBeNull();
  });

  it("rejects random string", () => {
    expect(validateUUID("not-a-uuid-at-all")).toBeNull();
  });
});

describe("UUID_RE", () => {
  it("is exported for use in other modules", () => {
    expect(UUID_RE).toBeInstanceOf(RegExp);
    expect(UUID_RE.test("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
  });
});

describe("stripNsPrefix", () => {
  const UUID = "550e8400-e29b-41d4-a716-446655440000";

  it("strips ns_act_ prefix and returns UUID", () => {
    expect(stripNsPrefix("ns_act_", `ns_act_${UUID}`)).toBe(UUID);
  });

  it("returns null for null input", () => {
    expect(stripNsPrefix("ns_act_", null)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(stripNsPrefix("ns_act_", "")).toBeNull();
  });

  it("returns null for raw UUID (no prefix)", () => {
    expect(stripNsPrefix("ns_act_", UUID)).toBeNull();
  });

  it("returns null for wrong prefix", () => {
    expect(stripNsPrefix("ns_act_", `ns_bgt_${UUID}`)).toBeNull();
  });

  it("returns null when UUID after prefix is invalid", () => {
    expect(stripNsPrefix("ns_act_", "ns_act_not-a-uuid")).toBeNull();
  });

  it("returns null for SQL injection attempt", () => {
    expect(stripNsPrefix("ns_act_", "ns_act_'; DROP TABLE budgets;--")).toBeNull();
  });
});
