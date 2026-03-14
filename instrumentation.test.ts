import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { register } from "./instrumentation";

describe("instrumentation register()", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("does nothing in non-production environments", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NULLSPEND_DEV_ACTOR", "dev-user");
    vi.stubEnv("NULLSPEND_API_KEY", "test-key");

    await register();

    expect(console.error).not.toHaveBeenCalled();
  });

  it("warns when NULLSPEND_DEV_ACTOR is set in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NULLSPEND_DEV_ACTOR", "dev-user");
    delete process.env.NULLSPEND_API_KEY;
    delete process.env.NULLSPEND_STRICT_BOOT;

    await register();

    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("NULLSPEND_DEV_ACTOR is set in production")
    );
  });

  it("warns when NULLSPEND_API_KEY is set in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.NULLSPEND_DEV_ACTOR;
    vi.stubEnv("NULLSPEND_API_KEY", "test-key");
    delete process.env.NULLSPEND_STRICT_BOOT;

    await register();

    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("NULLSPEND_API_KEY is set in production")
    );
  });

  it("warns about both vars when both are set in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NULLSPEND_DEV_ACTOR", "dev-user");
    vi.stubEnv("NULLSPEND_API_KEY", "test-key");
    delete process.env.NULLSPEND_STRICT_BOOT;

    await register();

    expect(console.error).toHaveBeenCalledTimes(2);
  });

  it("does not throw without NULLSPEND_STRICT_BOOT", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NULLSPEND_DEV_ACTOR", "dev-user");
    delete process.env.NULLSPEND_STRICT_BOOT;

    await expect(register()).resolves.toBeUndefined();
  });

  it("throws when NULLSPEND_STRICT_BOOT is true and dev vars are set", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NULLSPEND_DEV_ACTOR", "dev-user");
    vi.stubEnv("NULLSPEND_STRICT_BOOT", "true");

    await expect(register()).rejects.toThrow(
      "Refusing to start: dev-only env vars detected in production"
    );
  });

  it("does not throw with NULLSPEND_STRICT_BOOT when no dev vars are set", async () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.NULLSPEND_DEV_ACTOR;
    delete process.env.NULLSPEND_API_KEY;
    vi.stubEnv("NULLSPEND_STRICT_BOOT", "true");

    await expect(register()).resolves.toBeUndefined();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("does not throw when NULLSPEND_STRICT_BOOT is not 'true'", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NULLSPEND_DEV_ACTOR", "dev-user");
    vi.stubEnv("NULLSPEND_STRICT_BOOT", "false");

    await expect(register()).resolves.toBeUndefined();
  });
});
