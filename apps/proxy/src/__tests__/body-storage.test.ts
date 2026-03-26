import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("cloudflare:workers", () => ({
  waitUntil: vi.fn((p: Promise<unknown>) => { p.catch(() => {}); }),
}));

import {
  storeRequestBody,
  storeResponseBody,
  retrieveBodies,
} from "../lib/body-storage.js";

describe("body-storage", () => {
  let mockBucket: {
    put: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockBucket = {
      put: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(null),
    };
    vi.clearAllMocks();
  });

  describe("storeRequestBody", () => {
    it("stores body at correct R2 key", async () => {
      await storeRequestBody(
        mockBucket as unknown as R2Bucket,
        "org_123",
        "req_abc",
        '{"model":"gpt-4"}',
      );

      expect(mockBucket.put).toHaveBeenCalledWith(
        "org_123/req_abc/request.json",
        '{"model":"gpt-4"}',
        { httpMetadata: { contentType: "application/json" } },
      );
    });

    it("skips bodies exceeding 1MB", async () => {
      const largeBody = "x".repeat(1_048_577);
      await storeRequestBody(
        mockBucket as unknown as R2Bucket,
        "org_123",
        "req_abc",
        largeBody,
      );

      expect(mockBucket.put).not.toHaveBeenCalled();
    });

    it("does not throw on R2 error", async () => {
      mockBucket.put.mockRejectedValueOnce(new Error("R2 unavailable"));

      await expect(
        storeRequestBody(
          mockBucket as unknown as R2Bucket,
          "org_123",
          "req_abc",
          '{"model":"gpt-4"}',
        ),
      ).resolves.toBeUndefined();
    });
  });

  describe("storeResponseBody", () => {
    it("stores body at correct R2 key", async () => {
      await storeResponseBody(
        mockBucket as unknown as R2Bucket,
        "org_123",
        "req_abc",
        '{"choices":[]}',
      );

      expect(mockBucket.put).toHaveBeenCalledWith(
        "org_123/req_abc/response.json",
        '{"choices":[]}',
        { httpMetadata: { contentType: "application/json" } },
      );
    });

    it("skips bodies exceeding 1MB", async () => {
      const largeBody = "x".repeat(1_048_577);
      await storeResponseBody(
        mockBucket as unknown as R2Bucket,
        "org_123",
        "req_abc",
        largeBody,
      );

      expect(mockBucket.put).not.toHaveBeenCalled();
    });

    it("does not throw on R2 error", async () => {
      mockBucket.put.mockRejectedValueOnce(new Error("R2 write failed"));

      await expect(
        storeResponseBody(
          mockBucket as unknown as R2Bucket,
          "org_123",
          "req_abc",
          '{"choices":[]}',
        ),
      ).resolves.toBeUndefined();
    });
  });

  describe("retrieveBodies", () => {
    it("returns both bodies when present", async () => {
      mockBucket.get
        .mockResolvedValueOnce({ text: () => Promise.resolve('{"model":"gpt-4"}') })
        .mockResolvedValueOnce({ text: () => Promise.resolve('{"choices":[]}') });

      const result = await retrieveBodies(
        mockBucket as unknown as R2Bucket,
        "org_123",
        "req_abc",
      );

      expect(result).toEqual({
        requestBody: '{"model":"gpt-4"}',
        responseBody: '{"choices":[]}',
      });

      expect(mockBucket.get).toHaveBeenCalledWith("org_123/req_abc/request.json");
      expect(mockBucket.get).toHaveBeenCalledWith("org_123/req_abc/response.json");
    });

    it("returns null for missing bodies", async () => {
      const result = await retrieveBodies(
        mockBucket as unknown as R2Bucket,
        "org_123",
        "req_abc",
      );

      expect(result).toEqual({
        requestBody: null,
        responseBody: null,
      });
    });

    it("returns partial when only request exists", async () => {
      mockBucket.get
        .mockResolvedValueOnce({ text: () => Promise.resolve('{"model":"gpt-4"}') })
        .mockResolvedValueOnce(null);

      const result = await retrieveBodies(
        mockBucket as unknown as R2Bucket,
        "org_123",
        "req_abc",
      );

      expect(result).toEqual({
        requestBody: '{"model":"gpt-4"}',
        responseBody: null,
      });
    });
  });
});
