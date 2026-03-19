import { describe, it, expect, vi } from "vitest";

// Mock pg and db-semaphore so that importing auth.ts (which imports api-key-auth.ts) works
vi.mock("pg", () => ({
  Client: function MockClient() {
    return { connect: vi.fn(), end: vi.fn(), on: vi.fn(), query: vi.fn() };
  },
}));

vi.mock("../lib/db-semaphore.js", () => ({
  withDbConnection: vi.fn(async (fn: () => Promise<unknown>) => fn()),
}));

const mockAuthenticateApiKey = vi.fn();
vi.mock("../lib/api-key-auth.js", () => ({
  authenticateApiKey: (...args: unknown[]) => mockAuthenticateApiKey(...args),
}));

import { authenticateRequest } from "../lib/auth.js";
import { beforeEach } from "vitest";

describe("authenticateRequest", () => {
  beforeEach(() => {
    mockAuthenticateApiKey.mockReset();
  });

  it("returns identity for valid API key", async () => {
    mockAuthenticateApiKey.mockResolvedValue({
      userId: "user-1",
      keyId: "key-1",
      hasWebhooks: false,
    });

    const request = new Request("http://localhost/v1/chat/completions", {
      headers: { "x-nullspend-key": "ns_live_sk_valid_key" },
    });

    const result = await authenticateRequest(request, "postgresql://localhost");
    expect(result).toEqual({ userId: "user-1", keyId: "key-1", hasWebhooks: false });
  });

  it("returns null when x-nullspend-key header is missing", async () => {
    const request = new Request("http://localhost/v1/chat/completions");

    const result = await authenticateRequest(request, "postgresql://localhost");
    expect(result).toBeNull();
    expect(mockAuthenticateApiKey).not.toHaveBeenCalled();
  });

  it("returns null when API key is invalid", async () => {
    mockAuthenticateApiKey.mockResolvedValue(null);

    const request = new Request("http://localhost/v1/chat/completions", {
      headers: { "x-nullspend-key": "ns_live_sk_invalid_key" },
    });

    const result = await authenticateRequest(request, "postgresql://localhost");
    expect(result).toBeNull();
  });

});
