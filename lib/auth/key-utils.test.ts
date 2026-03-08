import { describe, expect, it } from "vitest";

import {
  generateRawKey,
  hashKey,
  extractPrefix,
  API_KEY_PREFIX,
} from "@/lib/auth/api-key";

describe("API key utilities", () => {
  describe("generateRawKey", () => {
    it("starts with the ask_ prefix", () => {
      const key = generateRawKey();
      expect(key.startsWith(API_KEY_PREFIX)).toBe(true);
    });

    it("has the correct length (4 prefix + 32 hex = 36 chars)", () => {
      const key = generateRawKey();
      expect(key.length).toBe(36);
    });

    it("generates unique keys", () => {
      const keys = new Set(Array.from({ length: 10 }, () => generateRawKey()));
      expect(keys.size).toBe(10);
    });
  });

  describe("hashKey", () => {
    it("returns a 64 character hex string (SHA-256)", () => {
      const hash = hashKey("ask_test1234567890abcdef12345678");
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("produces deterministic output", () => {
      const input = "ask_abcdef1234567890abcdef12345678";
      expect(hashKey(input)).toBe(hashKey(input));
    });

    it("produces different hashes for different keys", () => {
      const hash1 = hashKey("ask_key_one_1234567890abcdef1234");
      const hash2 = hashKey("ask_key_two_1234567890abcdef1234");
      expect(hash1).not.toBe(hash2);
    });
  });

  describe("extractPrefix", () => {
    it("returns the first 12 characters", () => {
      const key = "ask_3f8a1b2c9d4e5f6a7b8c9d0e1f2a3b";
      expect(extractPrefix(key)).toBe("ask_3f8a1b2c");
    });
  });
});
