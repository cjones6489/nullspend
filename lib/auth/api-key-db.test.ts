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
  const originalNodeEnv = process.env.NODE_ENV;
  const originalApiKey = process.env.AGENTSEAM_API_KEY;
  const originalDevActor = process.env.AGENTSEAM_DEV_ACTOR;

  function setNodeEnv(value: string | undefined) {
    Object.assign(process.env, { NODE_ENV: value });
  }

  afterEach(() => {
    setNodeEnv(originalNodeEnv);
    process.env.AGENTSEAM_API_KEY = originalApiKey;
    process.env.AGENTSEAM_DEV_ACTOR = originalDevActor;
    vi.resetAllMocks();
  });

  it("returns the DB-backed key identity when a managed key matches", async () => {
    mockDb([{ id: "key-123", userId: "user-123" }]);

    await expect(
      assertApiKeyWithIdentity(
        makeRequest({ "x-agentseam-key": "ask_0123456789abcdef0123456789abcdef" }),
      ),
    ).resolves.toEqual({
      keyId: "key-123",
      userId: "user-123",
    });
  });

  it("falls back to the env key only when no managed key matches", async () => {
    setNodeEnv("development");
    process.env.AGENTSEAM_API_KEY = "env-secret";

    mockDb([]);

    await expect(
      assertApiKeyWithIdentity(
        makeRequest({ "x-agentseam-key": "env-secret" }),
      ),
    ).resolves.toBeNull();
  });

  it("throws when neither the managed key nor env fallback match", async () => {
    mockDb([]);

    await expect(
      assertApiKeyWithIdentity(
        makeRequest({ "x-agentseam-key": "ask_wrong0000000000000000000000000000" }),
      ),
    ).rejects.toBeInstanceOf(ApiKeyError);
  });

  it("resolves the dev actor for env fallback only in development", () => {
    setNodeEnv("development");
    process.env.AGENTSEAM_DEV_ACTOR = "dev-user";

    expect(resolveDevFallbackApiKeyUserId()).toBe("dev-user");
  });

  it("rejects env fallback ownership resolution outside development", () => {
    setNodeEnv("production");
    process.env.AGENTSEAM_DEV_ACTOR = "dev-user";

    expect(() => resolveDevFallbackApiKeyUserId()).toThrow(ApiKeyError);
  });
});
