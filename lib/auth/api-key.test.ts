import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ApiKeyError,
  resolveDevFallbackApiKeyUserId,
} from "@/lib/auth/api-key";

describe("NULLSPEND_DEV_MODE fallback", () => {
  const originalDevMode = process.env.NULLSPEND_DEV_MODE;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalDevActor = process.env.NULLSPEND_DEV_ACTOR;

  function setEnv(key: string, value: string | undefined) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  afterEach(() => {
    setEnv("NULLSPEND_DEV_MODE", originalDevMode);
    setEnv("NODE_ENV", originalNodeEnv);
    setEnv("NULLSPEND_DEV_ACTOR", originalDevActor);
  });

  it("allows dev fallback when NULLSPEND_DEV_MODE=true", () => {
    setEnv("NODE_ENV", "production");
    setEnv("NULLSPEND_DEV_MODE", "true");
    setEnv("NULLSPEND_DEV_ACTOR", "dev-user");

    expect(resolveDevFallbackApiKeyUserId()).toBe("dev-user");
  });

  it("rejects dev fallback when only NODE_ENV=development (requires NULLSPEND_DEV_MODE)", () => {
    setEnv("NODE_ENV", "development");
    setEnv("NULLSPEND_DEV_MODE", undefined);
    setEnv("NULLSPEND_DEV_ACTOR", "dev-user");

    expect(() => resolveDevFallbackApiKeyUserId()).toThrow(ApiKeyError);
  });

  it("rejects dev fallback in production without NULLSPEND_DEV_MODE", () => {
    setEnv("NODE_ENV", "production");
    setEnv("NULLSPEND_DEV_MODE", undefined);
    setEnv("NULLSPEND_DEV_ACTOR", "dev-user");

    expect(() => resolveDevFallbackApiKeyUserId()).toThrow(ApiKeyError);
  });

  it("rejects when NULLSPEND_DEV_MODE is not exactly 'true'", () => {
    setEnv("NODE_ENV", "production");
    setEnv("NULLSPEND_DEV_MODE", "yes");
    setEnv("NULLSPEND_DEV_ACTOR", "dev-user");

    expect(() => resolveDevFallbackApiKeyUserId()).toThrow(ApiKeyError);
  });
});
