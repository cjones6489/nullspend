import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// getEnv() caches the parsed env in a module-level _env variable.
// vi.resetModules() clears the ESM cache so each test gets a fresh module.
async function freshGetEnv() {
  vi.resetModules();
  const mod = await import("./env");
  return mod.getEnv as typeof import("./env").getEnv;
}

describe("lib/env.ts — Zod env schema", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset to a clean baseline — remove everything the schema validates
    // so each test can set exactly what it needs.
    delete process.env.DATABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    delete process.env.LOG_LEVEL;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("regression: ISSUE-P0-2 (Supabase env var name mismatch)", () => {
    // Regression: misnamed env var in Zod schema
    // Found by /qa on 2026-04-08
    // Report: .gstack/qa-reports/qa-report-nullspend-dev-2026-04-08.md
    //
    // BUG: lib/env.ts required NEXT_PUBLIC_SUPABASE_ANON_KEY but the actual
    // Supabase client code in lib/auth/supabase.ts and lib/auth/supabase-browser.ts
    // reads NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (Supabase renamed anon -> publishable
    // in their naming migration). The old name was never set in Vercel prod because
    // nothing downstream uses it, so every route that called getDb() -> getEnv()
    // threw on the Zod check. Symptoms: /api/health degraded, every authed API
    // route 500-ing with "Missing or invalid environment variables" in prod logs.
    //
    // FIX: Zod schema renamed to match actual consumer.
    //
    // Detection gap filed: G-23 (add a test that every Zod schema key is referenced
    // in the codebase outside lib/env.ts — would have caught this immediately).

    it("accepts NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (the new Supabase name)", async () => {
      process.env.DATABASE_URL = "postgres://localhost:5432/test";
      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abc.supabase.co";
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_fake";

      const getEnv = await freshGetEnv();
      const env = getEnv();

      expect(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).toBe("sb_publishable_fake");
      expect(env.DATABASE_URL).toBe("postgres://localhost:5432/test");
      expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe("https://abc.supabase.co");
    });

    it("throws when NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is missing", async () => {
      process.env.DATABASE_URL = "postgres://localhost:5432/test";
      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abc.supabase.co";
      // Intentionally NOT setting PUBLISHABLE_KEY

      const getEnv = await freshGetEnv();
      expect(() => getEnv()).toThrow(/NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
    });

    it("does NOT require the legacy NEXT_PUBLIC_SUPABASE_ANON_KEY name", async () => {
      // Users who set ANON_KEY based on the old docs/.env.example would have
      // set a var that nothing downstream uses. Validate that a config with
      // PUBLISHABLE_KEY but no ANON_KEY passes validation.
      process.env.DATABASE_URL = "postgres://localhost:5432/test";
      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abc.supabase.co";
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_fake";
      // Intentionally NOT setting NEXT_PUBLIC_SUPABASE_ANON_KEY

      const getEnv = await freshGetEnv();
      expect(() => getEnv()).not.toThrow();
    });
  });

  describe("DATABASE_URL validation", () => {
    it("requires DATABASE_URL to be a string", async () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abc.supabase.co";
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_fake";
      // Intentionally NOT setting DATABASE_URL

      const getEnv = await freshGetEnv();
      expect(() => getEnv()).toThrow(/DATABASE_URL/);
    });
  });

  describe("NEXT_PUBLIC_SUPABASE_URL validation", () => {
    it("requires https:// prefix", async () => {
      process.env.DATABASE_URL = "postgres://localhost:5432/test";
      process.env.NEXT_PUBLIC_SUPABASE_URL = "http://abc.supabase.co"; // http not https
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_fake";

      const getEnv = await freshGetEnv();
      expect(() => getEnv()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
    });
  });

  describe("optional fields", () => {
    it("accepts config without optional Upstash/Sentry vars", async () => {
      process.env.DATABASE_URL = "postgres://localhost:5432/test";
      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abc.supabase.co";
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_fake";

      const getEnv = await freshGetEnv();
      expect(() => getEnv()).not.toThrow();
    });
  });
});
