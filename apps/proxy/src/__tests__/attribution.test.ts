import { describe, it, expect } from "vitest";
import { extractAttribution } from "../lib/request-utils.js";

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request("https://example.com", { headers });
}

describe("extractAttribution", () => {
  describe("valid headers extracted correctly", () => {
    it("extracts all three headers when present and valid", () => {
      const req = makeRequest({
        "x-agentseam-user-id": "user_abc123",
        "x-agentseam-key-id": "key_xyz789",
        "x-agentseam-action-id": "action_42",
      });
      const result = extractAttribution(req);
      expect(result).toEqual({
        userId: "user_abc123",
        apiKeyId: "key_xyz789",
        actionId: "action_42",
      });
    });
  });

  describe("missing headers return null", () => {
    it("returns all nulls when no attribution headers are present", () => {
      const req = makeRequest();
      const result = extractAttribution(req);
      expect(result).toEqual({
        userId: null,
        apiKeyId: null,
        actionId: null,
      });
    });

    it("returns all nulls when only unrelated headers are present", () => {
      const req = makeRequest({
        "content-type": "application/json",
        authorization: "Bearer sk-test",
      });
      const result = extractAttribution(req);
      expect(result).toEqual({
        userId: null,
        apiKeyId: null,
        actionId: null,
      });
    });
  });

  describe("partially missing headers", () => {
    it("extracts only userId when others are absent", () => {
      const req = makeRequest({ "x-agentseam-user-id": "user_1" });
      const result = extractAttribution(req);
      expect(result).toEqual({
        userId: "user_1",
        apiKeyId: null,
        actionId: null,
      });
    });

    it("extracts only apiKeyId when others are absent", () => {
      const req = makeRequest({ "x-agentseam-key-id": "key_2" });
      const result = extractAttribution(req);
      expect(result).toEqual({
        userId: null,
        apiKeyId: "key_2",
        actionId: null,
      });
    });

    it("extracts only actionId when others are absent", () => {
      const req = makeRequest({ "x-agentseam-action-id": "action_3" });
      const result = extractAttribution(req);
      expect(result).toEqual({
        userId: null,
        apiKeyId: null,
        actionId: "action_3",
      });
    });

    it("extracts userId and actionId but not apiKeyId", () => {
      const req = makeRequest({
        "x-agentseam-user-id": "user_4",
        "x-agentseam-action-id": "action_5",
      });
      const result = extractAttribution(req);
      expect(result).toEqual({
        userId: "user_4",
        apiKeyId: null,
        actionId: "action_5",
      });
    });
  });

  describe("length validation", () => {
    it("rejects headers exceeding 128 characters", () => {
      const longValue = "a".repeat(129);
      const req = makeRequest({
        "x-agentseam-user-id": longValue,
        "x-agentseam-key-id": "valid_key",
      });
      const result = extractAttribution(req);
      expect(result.userId).toBeNull();
      expect(result.apiKeyId).toBe("valid_key");
    });

    it("accepts headers exactly 128 characters long", () => {
      const exactValue = "a".repeat(128);
      const req = makeRequest({ "x-agentseam-user-id": exactValue });
      const result = extractAttribution(req);
      expect(result.userId).toBe(exactValue);
    });

    it("rejects headers much longer than 128 characters", () => {
      const veryLongValue = "x".repeat(1000);
      const req = makeRequest({ "x-agentseam-action-id": veryLongValue });
      const result = extractAttribution(req);
      expect(result.actionId).toBeNull();
    });
  });

  describe("invalid characters rejected", () => {
    it("rejects header with spaces", () => {
      const req = makeRequest({ "x-agentseam-user-id": "user id with spaces" });
      expect(extractAttribution(req).userId).toBeNull();
    });

    it("rejects header with dots", () => {
      const req = makeRequest({ "x-agentseam-user-id": "user.id" });
      expect(extractAttribution(req).userId).toBeNull();
    });

    it("rejects header with slashes", () => {
      const req = makeRequest({ "x-agentseam-key-id": "key/id" });
      expect(extractAttribution(req).apiKeyId).toBeNull();
    });

    it("rejects header with @ symbol", () => {
      const req = makeRequest({ "x-agentseam-user-id": "user@domain" });
      expect(extractAttribution(req).userId).toBeNull();
    });

    it("rejects header with unicode characters", () => {
      const req = makeRequest({ "x-agentseam-user-id": "user\u00e9" });
      expect(extractAttribution(req).userId).toBeNull();
    });

    it("Headers API rejects emoji (non-ByteString) — never reaches our validator", () => {
      expect(() => makeRequest({ "x-agentseam-action-id": "action\u{1F600}" })).toThrow();
    });

    it("rejects header with special characters", () => {
      const specialChars = ["!", "#", "$", "%", "^", "&", "*", "(", ")", "+", "=", "~", "`"];
      for (const char of specialChars) {
        const req = makeRequest({ "x-agentseam-user-id": `user${char}id` });
        expect(extractAttribution(req).userId).toBeNull();
      }
    });

    it("rejects header with colon", () => {
      const req = makeRequest({ "x-agentseam-key-id": "key:id" });
      expect(extractAttribution(req).apiKeyId).toBeNull();
    });
  });

  describe("valid characters accepted", () => {
    it("accepts lowercase alphanumeric", () => {
      const req = makeRequest({ "x-agentseam-user-id": "abc123" });
      expect(extractAttribution(req).userId).toBe("abc123");
    });

    it("accepts uppercase alphanumeric", () => {
      const req = makeRequest({ "x-agentseam-user-id": "ABC123" });
      expect(extractAttribution(req).userId).toBe("ABC123");
    });

    it("accepts mixed case with underscores and hyphens", () => {
      const req = makeRequest({ "x-agentseam-user-id": "User_123-ABC" });
      expect(extractAttribution(req).userId).toBe("User_123-ABC");
    });

    it("accepts all-underscore value", () => {
      const req = makeRequest({ "x-agentseam-key-id": "___" });
      expect(extractAttribution(req).apiKeyId).toBe("___");
    });

    it("accepts all-hyphen value", () => {
      const req = makeRequest({ "x-agentseam-action-id": "---" });
      expect(extractAttribution(req).actionId).toBe("---");
    });

    it("accepts single character", () => {
      const req = makeRequest({ "x-agentseam-user-id": "a" });
      expect(extractAttribution(req).userId).toBe("a");
    });
  });

  describe("empty string rejected", () => {
    it("rejects empty string header (fails regex)", () => {
      const req = makeRequest({ "x-agentseam-user-id": "" });
      expect(extractAttribution(req).userId).toBeNull();
    });
  });

  describe("injection attempts rejected", () => {
    // The Headers API itself rejects newlines, CR, CRLF, and null bytes
    // at construction time (per HTTP spec). This is defense-in-depth:
    // even if headers somehow arrived, our regex would reject them.

    it("Headers API rejects newline — never reaches our validator", () => {
      expect(() => makeRequest({ "x-agentseam-user-id": "user\nid" })).toThrow();
    });

    it("Headers API rejects carriage return — never reaches our validator", () => {
      expect(() => makeRequest({ "x-agentseam-user-id": "user\rid" })).toThrow();
    });

    it("Headers API rejects CRLF — never reaches our validator", () => {
      expect(() => makeRequest({ "x-agentseam-user-id": "user\r\nid" })).toThrow();
    });

    it("rejects header with tab character via regex", () => {
      // Tab is allowed by HTTP spec but rejected by our pattern
      const req = makeRequest({ "x-agentseam-user-id": "user\tid" });
      expect(extractAttribution(req).userId).toBeNull();
    });

    it("Headers API rejects null byte — never reaches our validator", () => {
      expect(() => makeRequest({ "x-agentseam-user-id": "user\0id" })).toThrow();
    });
  });
});
