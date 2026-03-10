import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { register } from "./instrumentation";

describe("instrumentation register()", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("does nothing in non-production environments", async () => {
    process.env.NODE_ENV = "development";
    process.env.AGENTSEAM_DEV_ACTOR = "dev-user";
    process.env.AGENTSEAM_API_KEY = "test-key";

    await register();

    expect(console.error).not.toHaveBeenCalled();
  });

  it("warns when AGENTSEAM_DEV_ACTOR is set in production", async () => {
    process.env.NODE_ENV = "production";
    process.env.AGENTSEAM_DEV_ACTOR = "dev-user";
    delete process.env.AGENTSEAM_API_KEY;
    delete process.env.AGENTSEAM_STRICT_BOOT;

    await register();

    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("AGENTSEAM_DEV_ACTOR is set in production")
    );
  });

  it("warns when AGENTSEAM_API_KEY is set in production", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.AGENTSEAM_DEV_ACTOR;
    process.env.AGENTSEAM_API_KEY = "test-key";
    delete process.env.AGENTSEAM_STRICT_BOOT;

    await register();

    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("AGENTSEAM_API_KEY is set in production")
    );
  });

  it("warns about both vars when both are set in production", async () => {
    process.env.NODE_ENV = "production";
    process.env.AGENTSEAM_DEV_ACTOR = "dev-user";
    process.env.AGENTSEAM_API_KEY = "test-key";
    delete process.env.AGENTSEAM_STRICT_BOOT;

    await register();

    expect(console.error).toHaveBeenCalledTimes(2);
  });

  it("does not throw without AGENTSEAM_STRICT_BOOT", async () => {
    process.env.NODE_ENV = "production";
    process.env.AGENTSEAM_DEV_ACTOR = "dev-user";
    delete process.env.AGENTSEAM_STRICT_BOOT;

    await expect(register()).resolves.toBeUndefined();
  });

  it("throws when AGENTSEAM_STRICT_BOOT is true and dev vars are set", async () => {
    process.env.NODE_ENV = "production";
    process.env.AGENTSEAM_DEV_ACTOR = "dev-user";
    process.env.AGENTSEAM_STRICT_BOOT = "true";

    await expect(register()).rejects.toThrow(
      "Refusing to start: dev-only env vars detected in production"
    );
  });

  it("does not throw with AGENTSEAM_STRICT_BOOT when no dev vars are set", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.AGENTSEAM_DEV_ACTOR;
    delete process.env.AGENTSEAM_API_KEY;
    process.env.AGENTSEAM_STRICT_BOOT = "true";

    await expect(register()).resolves.toBeUndefined();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("does not throw when AGENTSEAM_STRICT_BOOT is not 'true'", async () => {
    process.env.NODE_ENV = "production";
    process.env.AGENTSEAM_DEV_ACTOR = "dev-user";
    process.env.AGENTSEAM_STRICT_BOOT = "false";

    await expect(register()).resolves.toBeUndefined();
  });
});
