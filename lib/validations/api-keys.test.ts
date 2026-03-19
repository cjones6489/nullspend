import { describe, expect, it } from "vitest";

import {
  createApiKeyInputSchema,
  apiKeyRecordSchema,
  createApiKeyResponseSchema,
  keyIdParamsSchema,
} from "@/lib/validations/api-keys";

describe("API key validation schemas", () => {
  describe("createApiKeyInputSchema", () => {
    it("accepts a valid name", () => {
      const result = createApiKeyInputSchema.parse({ name: "Production" });
      expect(result.name).toBe("Production");
    });

    it("trims whitespace from name", () => {
      const result = createApiKeyInputSchema.parse({ name: "  Dev  " });
      expect(result.name).toBe("Dev");
    });

    it("rejects empty name", () => {
      expect(() =>
        createApiKeyInputSchema.parse({ name: "" }),
      ).toThrow();
    });

    it("rejects name over 50 characters", () => {
      expect(() =>
        createApiKeyInputSchema.parse({ name: "a".repeat(51) }),
      ).toThrow();
    });
  });

  describe("apiKeyRecordSchema", () => {
    it("accepts a valid record and transforms id to ns_key_ prefix", () => {
      const result = apiKeyRecordSchema.parse({
        id: "550e8400-e29b-41d4-a716-446655440000",
        name: "Production",
        keyPrefix: "ask_3f8a1b2c",
        lastUsedAt: null,
        createdAt: "2026-03-07T12:00:00.000Z",
      });
      expect(result.id).toBe("ns_key_550e8400-e29b-41d4-a716-446655440000");
      expect(result.name).toBe("Production");
      expect(result.lastUsedAt).toBeNull();
    });

    it("accepts lastUsedAt as a string", () => {
      const result = apiKeyRecordSchema.parse({
        id: "550e8400-e29b-41d4-a716-446655440000",
        name: "Dev",
        keyPrefix: "ask_abcd1234",
        lastUsedAt: "2026-03-07T15:00:00.000Z",
        createdAt: "2026-03-07T12:00:00.000Z",
      });
      expect(result.id).toBe("ns_key_550e8400-e29b-41d4-a716-446655440000");
      expect(result.lastUsedAt).toBe("2026-03-07T15:00:00.000Z");
    });
  });

  describe("createApiKeyResponseSchema", () => {
    it("includes rawKey in response and transforms id to ns_key_ prefix", () => {
      const result = createApiKeyResponseSchema.parse({
        id: "550e8400-e29b-41d4-a716-446655440000",
        name: "Production",
        keyPrefix: "ask_3f8a1b2c",
        rawKey: "ask_3f8a1b2c9d4e5f6a7b8c9d0e1f2a3b",
        createdAt: "2026-03-07T12:00:00.000Z",
      });
      expect(result.id).toBe("ns_key_550e8400-e29b-41d4-a716-446655440000");
      expect(result.rawKey).toContain("ask_");
    });
  });

  describe("keyIdParamsSchema", () => {
    it("accepts ns_key_ prefixed id and strips to raw UUID", () => {
      const result = keyIdParamsSchema.parse({
        id: "ns_key_550e8400-e29b-41d4-a716-446655440000",
      });
      expect(result.id).toBe("550e8400-e29b-41d4-a716-446655440000");
    });

    it("rejects unprefixed UUID", () => {
      expect(() =>
        keyIdParamsSchema.parse({ id: "550e8400-e29b-41d4-a716-446655440000" }),
      ).toThrow();
    });

    it("rejects wrong prefix", () => {
      expect(() =>
        keyIdParamsSchema.parse({ id: "ns_act_550e8400-e29b-41d4-a716-446655440000" }),
      ).toThrow();
    });
  });
});
