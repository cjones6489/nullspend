import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ApiKeyError,
  assertApiKeyWithIdentity,
  resolveDevFallbackApiKeyUserId,
} from "@/lib/auth/api-key";
import { getDb } from "@/lib/db/client";

vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(),
}));

function makeRequest(headers?: Record<string, string>): Request {
  return new Request("http://localhost/api/actions", {
    method: "POST",
    headers,
  });
}

const mockedGetDb = vi.mocked(getDb);

function mockDb(updateResult: unknown[]) {
  const updateChain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(updateResult),
  };

  mockedGetDb.mockReturnValue({
    update: vi.fn().mockReturnValue(updateChain),
  } as never);
}

describe("DB-backed API key auth", () => {
  const originalDevMode = process.env.NULLSPEND_DEV_MODE;
  const originalApiKey = process.env.NULLSPEND_API_KEY;
  const originalDevActor = process.env.NULLSPEND_DEV_ACTOR;

  afterEach(() => {
    process.env.NULLSPEND_DEV_MODE = originalDevMode;
    process.env.NULLSPEND_API_KEY = originalApiKey;
    process.env.NULLSPEND_DEV_ACTOR = originalDevActor;
    vi.resetAllMocks();
  });

  it("returns the DB-backed key identity when a managed key matches", async () => {
    mockDb([{ id: "key-123", userId: "user-123" }]);

    await expect(
      assertApiKeyWithIdentity(
        makeRequest({ "x-nullspend-key": "ns_live_sk_0123456789abcdef0123456789abcdef" }),
      ),
    ).resolves.toEqual({
      keyId: "key-123",
      userId: "user-123",
    });
  });

  it("falls back to the env key only when NULLSPEND_DEV_MODE is enabled", async () => {
    process.env.NULLSPEND_DEV_MODE = "true";
    process.env.NULLSPEND_API_KEY = "env-secret";

    mockDb([]);

    await expect(
      assertApiKeyWithIdentity(
        makeRequest({ "x-nullspend-key": "env-secret" }),
      ),
    ).resolves.toBeNull();
  });

  it("throws when neither the managed key nor env fallback match", async () => {
    mockDb([]);

    await expect(
      assertApiKeyWithIdentity(
        makeRequest({ "x-nullspend-key": "ns_live_sk_ff00ff00ff00ff00ff00ff00ff00ff00" }),
      ),
    ).rejects.toBeInstanceOf(ApiKeyError);
  });

  it("resolves the dev actor for env fallback when NULLSPEND_DEV_MODE=true", () => {
    process.env.NULLSPEND_DEV_MODE = "true";
    process.env.NULLSPEND_DEV_ACTOR = "dev-user";

    expect(resolveDevFallbackApiKeyUserId()).toBe("dev-user");
  });

  it("rejects env fallback ownership resolution without NULLSPEND_DEV_MODE", () => {
    delete process.env.NULLSPEND_DEV_MODE;
    process.env.NULLSPEND_DEV_ACTOR = "dev-user";

    expect(() => resolveDevFallbackApiKeyUserId()).toThrow(ApiKeyError);
  });
});
