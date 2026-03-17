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
    vi.stubEnv("NULLSPEND_DEV_MODE", "true");

    await register();

    expect(console.error).not.toHaveBeenCalled();
  });

  it("warns when NULLSPEND_DEV_ACTOR is set in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NULLSPEND_DEV_ACTOR", "dev-user");
    delete process.env.NULLSPEND_API_KEY;
    delete process.env.NULLSPEND_DEV_MODE;

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
    delete process.env.NULLSPEND_DEV_MODE;

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
    delete process.env.NULLSPEND_DEV_MODE;

    await register();

    expect(console.error).toHaveBeenCalledTimes(2);
  });

  it("throws when NULLSPEND_DEV_MODE=true in production (hard block)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NULLSPEND_DEV_MODE", "true");

    await expect(register()).rejects.toThrow(
      "REFUSING TO START: NULLSPEND_DEV_MODE=true in production"
    );
  });

  it("does not throw when NULLSPEND_DEV_MODE is absent in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NULLSPEND_DEV_ACTOR", "dev-user");
    delete process.env.NULLSPEND_DEV_MODE;

    await expect(register()).resolves.toBeUndefined();
  });

  it("does not throw when NULLSPEND_DEV_MODE is 'false' in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NULLSPEND_DEV_ACTOR", "dev-user");
    vi.stubEnv("NULLSPEND_DEV_MODE", "false");

    await expect(register()).resolves.toBeUndefined();
  });

  it("throws on DEV_MODE even when DEV_ACTOR and API_KEY are also set (warnings not logged)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NULLSPEND_DEV_MODE", "true");
    vi.stubEnv("NULLSPEND_DEV_ACTOR", "dev-user");
    vi.stubEnv("NULLSPEND_API_KEY", "test-key");

    await expect(register()).rejects.toThrow(
      "REFUSING TO START: NULLSPEND_DEV_MODE=true in production"
    );
    // Throw happens before warnings are logged
    expect(console.error).not.toHaveBeenCalled();
  });

  it("does not warn when no dev vars are set in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.NULLSPEND_DEV_ACTOR;
    delete process.env.NULLSPEND_API_KEY;
    delete process.env.NULLSPEND_DEV_MODE;

    await expect(register()).resolves.toBeUndefined();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("does not import sentry.server.config when DSN is absent", async () => {
    vi.stubEnv("NODE_ENV", "development");
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;

    await register();

    // No Sentry init — just completes without error
    expect(console.error).not.toHaveBeenCalled();
  });
});
