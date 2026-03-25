import { describe, expect, it } from "vitest";

import {
  generateInviteToken,
  hashInviteToken,
  extractTokenPrefix,
} from "@/lib/auth/invitation";

describe("Invitation token utilities", () => {
  describe("generateInviteToken", () => {
    it("starts with the ns_inv_ prefix", () => {
      const token = generateInviteToken();
      expect(token.startsWith("ns_inv_")).toBe(true);
    });

    it("has the correct length (7 prefix + 48 hex = 55 chars)", () => {
      const token = generateInviteToken();
      expect(token.length).toBe(55);
    });

    it("generates unique tokens", () => {
      const tokens = new Set(Array.from({ length: 10 }, () => generateInviteToken()));
      expect(tokens.size).toBe(10);
    });

    it("produces tokens matching the exact format regex", () => {
      expect(generateInviteToken()).toMatch(/^ns_inv_[a-f0-9]{48}$/);
    });
  });

  describe("hashInviteToken", () => {
    it("returns a 64 character hex string (SHA-256)", () => {
      const hash = hashInviteToken("ns_inv_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2");
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("produces deterministic output", () => {
      const input = "ns_inv_abcdef1234567890abcdef1234567890abcdef12345678";
      expect(hashInviteToken(input)).toBe(hashInviteToken(input));
    });

    it("produces different hashes for different tokens", () => {
      const hash1 = hashInviteToken("ns_inv_aaaa0000bbbb1111cccc2222dddd3333eeee4444ffff5555");
      const hash2 = hashInviteToken("ns_inv_ffff5555eeee4444dddd3333cccc2222bbbb1111aaaa0000");
      expect(hash1).not.toBe(hash2);
    });
  });

  describe("extractTokenPrefix", () => {
    it("returns the first 15 characters", () => {
      const token = "ns_inv_3f8a1b2c9d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c";
      expect(extractTokenPrefix(token)).toBe("ns_inv_3f8a1b2c");
    });

    it("produces prefix matching format regex", () => {
      expect(extractTokenPrefix(generateInviteToken())).toMatch(/^ns_inv_[a-f0-9]{8}$/);
    });
  });
});
