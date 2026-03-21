import { describe, it, expect, vi, beforeEach } from "vitest";

const { MockClient } = vi.hoisted(() => {
  const MockClient = vi.fn();
  return { MockClient };
});

vi.mock("pg", () => ({
  Client: MockClient,
}));

vi.mock("../lib/db-semaphore.js", () => ({
  withDbConnection: <T>(fn: () => Promise<T>) => fn(),
}));

vi.mock("../lib/webhook-signer.js", () => ({
  SECRET_ROTATION_WINDOW_SECONDS: 86_400,
}));

import { expireRotatedSecrets } from "../lib/webhook-expiry.js";
import type { WebhookEndpointWithSecret } from "../lib/webhook-cache.js";

function makeEndpoint(overrides: Partial<WebhookEndpointWithSecret> = {}): WebhookEndpointWithSecret {
  return {
    id: "ep-1",
    url: "https://hooks.example.com/webhook",
    signingSecret: "whsec_current",
    previousSigningSecret: null,
    secretRotatedAt: null,
    eventTypes: [],
    apiVersion: "2026-04-01",
    payloadMode: "full" as const,
    ...overrides,
  };
}

describe("expireRotatedSecrets", () => {
  const mockQuery = vi.fn().mockResolvedValue({ rowCount: 0 });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    MockClient.mockImplementation(function (this: any) {
      this.connect = vi.fn().mockResolvedValue(undefined);
      this.query = mockQuery;
      this.end = vi.fn().mockResolvedValue(undefined);
      this.on = vi.fn();
    });
  });

  it("does nothing when no endpoints have secretRotatedAt", async () => {
    await expireRotatedSecrets("postgresql://test", [
      makeEndpoint(),
      makeEndpoint({ id: "ep-2" }),
    ]);

    expect(MockClient).not.toHaveBeenCalled();
  });

  it("does nothing when all rotations are within the 24h window", async () => {
    await expireRotatedSecrets("postgresql://test", [
      makeEndpoint({
        previousSigningSecret: "whsec_old",
        secretRotatedAt: new Date().toISOString(), // just now
      }),
    ]);

    expect(MockClient).not.toHaveBeenCalled();
  });

  it("issues UPDATE for endpoints past the 24h window", async () => {
    const expired = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();

    await expireRotatedSecrets("postgresql://test", [
      makeEndpoint({
        id: "ep-expired",
        previousSigningSecret: "whsec_old",
        secretRotatedAt: expired,
      }),
    ]);

    expect(MockClient).toHaveBeenCalled();
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("previous_signing_secret = NULL"),
      [["ep-expired"]],
    );
  });

  it("batches multiple expired endpoint IDs into a single query", async () => {
    const expired = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();

    await expireRotatedSecrets("postgresql://test", [
      makeEndpoint({ id: "ep-1", previousSigningSecret: "old1", secretRotatedAt: expired }),
      makeEndpoint({ id: "ep-2", previousSigningSecret: "old2", secretRotatedAt: expired }),
      makeEndpoint({ id: "ep-3" }), // no rotation — should be filtered out
    ]);

    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("id = ANY($1)"),
      [["ep-1", "ep-2"]],
    );
  });

  it("boundary: exactly 24h elapsed is expired (>= not >)", async () => {
    const exactBoundary = new Date(Date.now() - 86_400 * 1000).toISOString();

    await expireRotatedSecrets("postgresql://test", [
      makeEndpoint({ id: "ep-boundary", previousSigningSecret: "old", secretRotatedAt: exactBoundary }),
    ]);

    expect(MockClient).toHaveBeenCalled();
    expect(mockQuery).toHaveBeenCalledWith(
      expect.any(String),
      [["ep-boundary"]],
    );
  });

  it("does not throw on DB connection error", async () => {
    MockClient.mockImplementation(function (this: any) {
      this.connect = vi.fn().mockRejectedValue(new Error("connection refused"));
      this.end = vi.fn();
      this.on = vi.fn();
    });

    const expired = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();

    // Should throw (caller is expected to .catch)
    await expect(
      expireRotatedSecrets("postgresql://test", [
        makeEndpoint({ id: "ep-1", previousSigningSecret: "old", secretRotatedAt: expired }),
      ]),
    ).rejects.toThrow();
  });
});
