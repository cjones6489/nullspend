import { describe, expect, it } from "vitest";

import {
  createApiKeyInputSchema,
  updateApiKeyInputSchema,
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

    it("defaults defaultTags to empty object when not provided", () => {
      const result = createApiKeyInputSchema.parse({ name: "Test" });
      expect(result.defaultTags).toEqual({});
    });

    it("accepts valid defaultTags", () => {
      const result = createApiKeyInputSchema.parse({
        name: "Test",
        defaultTags: { project: "openclaw", team: "backend" },
      });
      expect(result.defaultTags).toEqual({ project: "openclaw", team: "backend" });
    });

    it("rejects defaultTags with >10 keys", () => {
      const tags: Record<string, string> = {};
      for (let i = 0; i < 11; i++) tags[`key${i}`] = `v${i}`;
      expect(() =>
        createApiKeyInputSchema.parse({ name: "Test", defaultTags: tags }),
      ).toThrow();
    });

    it("rejects defaultTags with _ns_ prefix key", () => {
      expect(() =>
        createApiKeyInputSchema.parse({ name: "Test", defaultTags: { _ns_internal: "bad" } }),
      ).toThrow();
    });

    it("rejects defaultTags with invalid key characters", () => {
      expect(() =>
        createApiKeyInputSchema.parse({ name: "Test", defaultTags: { "bad key": "val" } }),
      ).toThrow();
    });

    it("rejects defaultTags with key over 64 characters", () => {
      expect(() =>
        createApiKeyInputSchema.parse({ name: "Test", defaultTags: { ["a".repeat(65)]: "val" } }),
      ).toThrow();
    });

    it("rejects defaultTags with value over 256 characters", () => {
      expect(() =>
        createApiKeyInputSchema.parse({ name: "Test", defaultTags: { key: "x".repeat(257) } }),
      ).toThrow();
    });

    it("accepts tags with alphanumeric, underscore, and hyphen keys", () => {
      const result = createApiKeyInputSchema.parse({
        name: "Test",
        defaultTags: { "abc-123_DEF": "val" },
      });
      expect(result.defaultTags).toEqual({ "abc-123_DEF": "val" });
    });

    it("accepts exactly 10 tags", () => {
      const tags: Record<string, string> = {};
      for (let i = 0; i < 10; i++) tags[`key${i}`] = `v${i}`;
      const result = createApiKeyInputSchema.parse({ name: "Test", defaultTags: tags });
      expect(Object.keys(result.defaultTags).length).toBe(10);
    });

    it("rejects defaultTags with null bytes in values", () => {
      expect(() =>
        createApiKeyInputSchema.parse({ name: "Test", defaultTags: { key: "val\u0000ue" } }),
      ).toThrow();
    });
  });

  describe("updateApiKeyInputSchema", () => {
    it("accepts name only", () => {
      const result = updateApiKeyInputSchema.parse({ name: "New Name" });
      expect(result.name).toBe("New Name");
      expect(result.defaultTags).toBeUndefined();
    });

    it("accepts defaultTags only", () => {
      const result = updateApiKeyInputSchema.parse({ defaultTags: { env: "prod" } });
      expect(result.defaultTags).toEqual({ env: "prod" });
      expect(result.name).toBeUndefined();
    });

    it("accepts both name and defaultTags", () => {
      const result = updateApiKeyInputSchema.parse({ name: "New", defaultTags: { env: "prod" } });
      expect(result.name).toBe("New");
      expect(result.defaultTags).toEqual({ env: "prod" });
    });

    it("rejects empty object (no fields to update)", () => {
      expect(() => updateApiKeyInputSchema.parse({})).toThrow();
    });

    it("applies same tag validation rules as create", () => {
      expect(() =>
        updateApiKeyInputSchema.parse({ defaultTags: { _ns_bad: "val" } }),
      ).toThrow();
    });

    it("accepts allowedModels only", () => {
      const result = updateApiKeyInputSchema.parse({ allowedModels: ["gpt-4o"] });
      expect(result.allowedModels).toEqual(["gpt-4o"]);
    });

    it("accepts allowedProviders only", () => {
      const result = updateApiKeyInputSchema.parse({ allowedProviders: ["openai"] });
      expect(result.allowedProviders).toEqual(["openai"]);
    });

    it("accepts null allowedModels to clear restriction", () => {
      const result = updateApiKeyInputSchema.parse({ allowedModels: null });
      expect(result.allowedModels).toBeNull();
    });

    it("accepts null allowedProviders to clear restriction", () => {
      const result = updateApiKeyInputSchema.parse({ allowedProviders: null });
      expect(result.allowedProviders).toBeNull();
    });
  });

  describe("createApiKeyInputSchema allowedModels/Providers", () => {
    it("accepts allowedModels as array of strings", () => {
      const result = createApiKeyInputSchema.parse({ name: "Test", allowedModels: ["gpt-4o", "gpt-4o-mini"] });
      expect(result.allowedModels).toEqual(["gpt-4o", "gpt-4o-mini"]);
    });

    it("accepts null allowedModels (unrestricted)", () => {
      const result = createApiKeyInputSchema.parse({ name: "Test", allowedModels: null });
      expect(result.allowedModels).toBeNull();
    });

    it("defaults allowedModels to undefined when not provided", () => {
      const result = createApiKeyInputSchema.parse({ name: "Test" });
      expect(result.allowedModels).toBeUndefined();
    });

    it("rejects allowedModels with more than 50 entries", () => {
      const models = Array.from({ length: 51 }, (_, i) => `model-${i}`);
      expect(() => createApiKeyInputSchema.parse({ name: "Test", allowedModels: models })).toThrow();
    });

    it("rejects allowedModels with empty string entries", () => {
      expect(() => createApiKeyInputSchema.parse({ name: "Test", allowedModels: [""] })).toThrow();
    });

    it("rejects allowedModels with entries over 100 characters", () => {
      expect(() => createApiKeyInputSchema.parse({ name: "Test", allowedModels: ["x".repeat(101)] })).toThrow();
    });

    it("accepts allowedProviders as array of valid providers", () => {
      const result = createApiKeyInputSchema.parse({ name: "Test", allowedProviders: ["openai", "anthropic"] });
      expect(result.allowedProviders).toEqual(["openai", "anthropic"]);
    });

    it("rejects allowedProviders with unknown provider", () => {
      expect(() => createApiKeyInputSchema.parse({ name: "Test", allowedProviders: ["google"] })).toThrow();
    });

    it("accepts null allowedProviders (unrestricted)", () => {
      const result = createApiKeyInputSchema.parse({ name: "Test", allowedProviders: null });
      expect(result.allowedProviders).toBeNull();
    });

    it("accepts empty allowedModels array (deny all)", () => {
      const result = createApiKeyInputSchema.parse({ name: "Test", allowedModels: [] });
      expect(result.allowedModels).toEqual([]);
    });

    it("accepts empty allowedProviders array", () => {
      const result = createApiKeyInputSchema.parse({ name: "Test", allowedProviders: [] });
      expect(result.allowedProviders).toEqual([]);
    });
  });

  describe("apiKeyRecordSchema", () => {
    it("accepts a valid record and transforms id to ns_key_ prefix", () => {
      const result = apiKeyRecordSchema.parse({
        id: "550e8400-e29b-41d4-a716-446655440000",
        name: "Production",
        keyPrefix: "ns_live_sk_3f8a1b2c",
        defaultTags: { project: "alpha" },
        allowedModels: null,
        allowedProviders: null,
        lastUsedAt: null,
        createdAt: "2026-03-07T12:00:00.000Z",
      });
      expect(result.id).toBe("ns_key_550e8400-e29b-41d4-a716-446655440000");
      expect(result.name).toBe("Production");
      expect(result.defaultTags).toEqual({ project: "alpha" });
      expect(result.lastUsedAt).toBeNull();
    });

    it("accepts lastUsedAt as a string", () => {
      const result = apiKeyRecordSchema.parse({
        id: "550e8400-e29b-41d4-a716-446655440000",
        name: "Dev",
        keyPrefix: "ns_live_sk_abcd1234",
        defaultTags: {},
        allowedModels: ["gpt-4o"],
        allowedProviders: ["openai"],
        lastUsedAt: "2026-03-07T15:00:00.000Z",
        createdAt: "2026-03-07T12:00:00.000Z",
      });
      expect(result.id).toBe("ns_key_550e8400-e29b-41d4-a716-446655440000");
      expect(result.lastUsedAt).toBe("2026-03-07T15:00:00.000Z");
      expect(result.allowedModels).toEqual(["gpt-4o"]);
      expect(result.allowedProviders).toEqual(["openai"]);
    });
  });

  describe("createApiKeyResponseSchema", () => {
    it("includes rawKey in response and transforms id to ns_key_ prefix", () => {
      const result = createApiKeyResponseSchema.parse({
        id: "550e8400-e29b-41d4-a716-446655440000",
        name: "Production",
        keyPrefix: "ns_live_sk_3f8a1b2c",
        defaultTags: { project: "alpha" },
        allowedModels: null,
        allowedProviders: null,
        rawKey: "ns_live_sk_3f8a1b2c9d4e5f6a7b8c9d0e1f2a3b4c",
        createdAt: "2026-03-07T12:00:00.000Z",
      });
      expect(result.id).toBe("ns_key_550e8400-e29b-41d4-a716-446655440000");
      expect(result.rawKey).toContain("ns_live_sk_");
      expect(result.defaultTags).toEqual({ project: "alpha" });
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
