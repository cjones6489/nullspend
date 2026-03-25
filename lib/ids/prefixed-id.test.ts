import { describe, expect, it } from "vitest";

import {
  toExternalId,
  fromExternalIdOfType,
  nsIdInput,
  nsIdOutput,
  nsIdOutputNullable,
  PREFIX_MAP,
} from "./prefixed-id";

const TEST_UUID = "550e8400-e29b-41d4-a716-446655440000";

describe("toExternalId", () => {
  it.each(Object.entries(PREFIX_MAP))("prefixes %s → %s", (type, prefix) => {
    expect(toExternalId(type as keyof typeof PREFIX_MAP, TEST_UUID)).toBe(
      `${prefix}${TEST_UUID}`,
    );
  });
});

describe("fromExternalIdOfType", () => {
  it.each(Object.entries(PREFIX_MAP))(
    "strips %s prefix and returns UUID",
    (type, prefix) => {
      expect(
        fromExternalIdOfType(type as keyof typeof PREFIX_MAP, `${prefix}${TEST_UUID}`),
      ).toBe(TEST_UUID);
    },
  );

  it("throws on wrong prefix type", () => {
    expect(() =>
      fromExternalIdOfType("act", `ns_bgt_${TEST_UUID}`),
    ).toThrow(/Expected ID with prefix "ns_act_"/);
  });

  it("throws on raw UUID (no prefix)", () => {
    expect(() => fromExternalIdOfType("act", TEST_UUID)).toThrow(
      /Expected ID with prefix "ns_act_"/,
    );
  });

  it("throws on invalid UUID after stripping prefix", () => {
    expect(() =>
      fromExternalIdOfType("act", "ns_act_not-a-valid-uuid"),
    ).toThrow(/Invalid UUID/);
  });

  it("throws on empty string", () => {
    expect(() => fromExternalIdOfType("act", "")).toThrow(
      /Expected ID with prefix/,
    );
  });

  it("truncates long invalid input in error message", () => {
    const longInput = "x".repeat(100);
    expect(() => fromExternalIdOfType("act", longInput)).toThrow(/…/);
  });
});

describe("nsIdOutput", () => {
  it("transforms a raw UUID to prefixed ID", () => {
    const schema = nsIdOutput("act");
    expect(schema.parse(TEST_UUID)).toBe(`ns_act_${TEST_UUID}`);
  });

  it("rejects non-UUID input", () => {
    const schema = nsIdOutput("act");
    expect(() => schema.parse("not-a-uuid")).toThrow();
  });

  it("works for all prefix types", () => {
    for (const [type, prefix] of Object.entries(PREFIX_MAP)) {
      const schema = nsIdOutput(type as keyof typeof PREFIX_MAP);
      expect(schema.parse(TEST_UUID)).toBe(`${prefix}${TEST_UUID}`);
    }
  });
});

describe("nsIdInput", () => {
  it("strips prefix and returns raw UUID", () => {
    const schema = nsIdInput("act");
    expect(schema.parse(`ns_act_${TEST_UUID}`)).toBe(TEST_UUID);
  });

  it("rejects raw UUID (no prefix)", () => {
    const schema = nsIdInput("act");
    expect(() => schema.parse(TEST_UUID)).toThrow();
  });

  it("rejects wrong prefix type", () => {
    const schema = nsIdInput("act");
    expect(() => schema.parse(`ns_bgt_${TEST_UUID}`)).toThrow();
  });

  it("rejects invalid UUID after valid prefix", () => {
    const schema = nsIdInput("act");
    expect(() => schema.parse("ns_act_not-a-uuid")).toThrow();
  });

  it("rejects empty string", () => {
    const schema = nsIdInput("act");
    expect(() => schema.parse("")).toThrow();
  });

  it("produces proper Zod validation error with prefix in message", () => {
    const schema = nsIdInput("act");
    const result = schema.safeParse("invalid-input");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.length).toBeGreaterThan(0);
      const messages = result.error.issues.map((i) => i.message).join(" ");
      expect(messages).toContain("ns_act_");
    }
  });

  it("produces Zod error (not plain Error) for wrong prefix", () => {
    const schema = nsIdInput("act");
    const result = schema.safeParse(`ns_bgt_${TEST_UUID}`);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(" ");
      expect(messages).toContain("ns_act_");
    }
  });

  it("produces Zod error for invalid UUID after valid prefix", () => {
    const schema = nsIdInput("act");
    const result = schema.safeParse("ns_act_not-valid");
    expect(result.success).toBe(false);
    if (!result.success) {
      // Should fail at the .pipe(z.string().uuid()) stage
      expect(result.error.issues.length).toBeGreaterThan(0);
    }
  });

  it("works for all prefix types", () => {
    for (const [type, prefix] of Object.entries(PREFIX_MAP)) {
      const schema = nsIdInput(type as keyof typeof PREFIX_MAP);
      expect(schema.parse(`${prefix}${TEST_UUID}`)).toBe(TEST_UUID);
    }
  });
});

describe("nsIdOutputNullable", () => {
  it("transforms a raw UUID to prefixed ID", () => {
    const schema = nsIdOutputNullable("key");
    expect(schema.parse(TEST_UUID)).toBe(`ns_key_${TEST_UUID}`);
  });

  it("passes null through", () => {
    const schema = nsIdOutputNullable("key");
    expect(schema.parse(null)).toBeNull();
  });
});

describe("round-trip", () => {
  it("output → input preserves UUID", () => {
    const prefixed = nsIdOutput("evt").parse(TEST_UUID);
    const uuid = nsIdInput("evt").parse(prefixed);
    expect(uuid).toBe(TEST_UUID);
  });

  it("works for all prefix types", () => {
    for (const type of Object.keys(PREFIX_MAP)) {
      const t = type as keyof typeof PREFIX_MAP;
      const prefixed = nsIdOutput(t).parse(TEST_UUID);
      const uuid = nsIdInput(t).parse(prefixed);
      expect(uuid).toBe(TEST_UUID);
    }
  });
});
