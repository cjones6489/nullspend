import { describe, expect, it } from "vitest";

import {
  generateRawKey,
  hashKey,
  extractPrefix,
  API_KEY_PREFIX,
} from "@/lib/auth/api-key";

describe("API key utilities", () => {
  describe("generateRawKey", () => {
    it("starts with the ns_live_sk_ prefix", () => {
      const key = generateRawKey();
      expect(key.startsWith(API_KEY_PREFIX)).toBe(true);
    });

    it("has the correct length (11 prefix + 32 hex = 43 chars)", () => {
      const key = generateRawKey();
      expect(key.length).toBe(43);
    });

    it("generates unique keys", () => {
      const keys = new Set(Array.from({ length: 10 }, () => generateRawKey()));
      expect(keys.size).toBe(10);
    });
  });

  describe("hashKey", () => {
    it("returns a 64 character hex string (SHA-256)", () => {
      const hash = hashKey("ns_live_sk_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6");
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("produces deterministic output", () => {
      const input = "ns_live_sk_abcdef1234567890abcdef1234567890";
      expect(hashKey(input)).toBe(hashKey(input));
    });

    it("produces different hashes for different keys", () => {
      const hash1 = hashKey("ns_live_sk_aaaa0000bbbb1111cccc2222dddd3333");
      const hash2 = hashKey("ns_live_sk_eeee4444ffff5555aaaa6666bbbb7777");
      expect(hash1).not.toBe(hash2);
    });
  });

  describe("extractPrefix", () => {
    it("returns the first 19 characters", () => {
      const key = "ns_live_sk_3f8a1b2c9d4e5f6a7b8c9d0e1f2a3b4c";
      expect(extractPrefix(key)).toBe("ns_live_sk_3f8a1b2c");
    });

    it("produces keys matching the exact format regex", () => {
      expect(generateRawKey()).toMatch(/^ns_live_sk_[a-f0-9]{32}$/);
    });

    it("produces extractPrefix matching format regex", () => {
      expect(extractPrefix(generateRawKey())).toMatch(/^ns_live_sk_[a-f0-9]{8}$/);
    });

    it("does not produce keys with old ask_ prefix", () => {
      expect(generateRawKey()).not.toMatch(/^ask_/);
    });
  });
});
