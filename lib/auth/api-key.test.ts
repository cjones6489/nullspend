import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ApiKeyError,
  resolveDevFallbackApiKeyUserId,
} from "@/lib/auth/api-key";

describe("AGENTSEAM_DEV_MODE fallback", () => {
  const originalDevMode = process.env.AGENTSEAM_DEV_MODE;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalDevActor = process.env.AGENTSEAM_DEV_ACTOR;

  function setEnv(key: string, value: string | undefined) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  afterEach(() => {
    setEnv("AGENTSEAM_DEV_MODE", originalDevMode);
    setEnv("NODE_ENV", originalNodeEnv);
    setEnv("AGENTSEAM_DEV_ACTOR", originalDevActor);
  });

  it("allows dev fallback when AGENTSEAM_DEV_MODE=true", () => {
    setEnv("NODE_ENV", "production");
    setEnv("AGENTSEAM_DEV_MODE", "true");
    setEnv("AGENTSEAM_DEV_ACTOR", "dev-user");

    expect(resolveDevFallbackApiKeyUserId()).toBe("dev-user");
  });

  it("rejects dev fallback when only NODE_ENV=development (requires AGENTSEAM_DEV_MODE)", () => {
    setEnv("NODE_ENV", "development");
    setEnv("AGENTSEAM_DEV_MODE", undefined);
    setEnv("AGENTSEAM_DEV_ACTOR", "dev-user");

    expect(() => resolveDevFallbackApiKeyUserId()).toThrow(ApiKeyError);
  });

  it("rejects dev fallback in production without AGENTSEAM_DEV_MODE", () => {
    setEnv("NODE_ENV", "production");
    setEnv("AGENTSEAM_DEV_MODE", undefined);
    setEnv("AGENTSEAM_DEV_ACTOR", "dev-user");

    expect(() => resolveDevFallbackApiKeyUserId()).toThrow(ApiKeyError);
  });

  it("rejects when AGENTSEAM_DEV_MODE is not exactly 'true'", () => {
    setEnv("NODE_ENV", "production");
    setEnv("AGENTSEAM_DEV_MODE", "yes");
    setEnv("AGENTSEAM_DEV_ACTOR", "dev-user");

    expect(() => resolveDevFallbackApiKeyUserId()).toThrow(ApiKeyError);
  });
});
