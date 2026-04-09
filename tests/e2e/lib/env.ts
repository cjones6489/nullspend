/**
 * Env var loading + validation for E2E tests.
 *
 * `.env.e2e` is loaded by `vitest.e2e.config.ts` before tests run. This
 * module provides a typed accessor + a `requireEnv()` helper that throws
 * with a clear message when a required var is missing.
 *
 * Keep this file minimal — it's imported by every E2E test. No heavy deps.
 */

/**
 * Required env vars for E2E tests. The keys here match what CI secrets and
 * `.env.e2e.example` reference. Slice 0 ships with a stub list; subsequent
 * slices extend it.
 */
export const E2E_ENV_KEYS = {
  /** Target URL for dashboard E2E tests. Defaults to local dev if unset. */
  NULLSPEND_BASE_URL: "NULLSPEND_BASE_URL",
  /** Test API key for authenticated dashboard calls. */
  NULLSPEND_API_KEY: "NULLSPEND_API_KEY",
  /** Dev actor header for bypassing session auth on local + preview. */
  NULLSPEND_DEV_ACTOR: "NULLSPEND_DEV_ACTOR",
  /** Direct Postgres connection for test-scoped cleanup. */
  DATABASE_URL: "DATABASE_URL",
  /** Proxy worker URL for proxy-layer E2E tests. */
  NULLSPEND_PROXY_URL: "NULLSPEND_PROXY_URL",
  /** OpenAI API key for model-matrix nightly runs. */
  OPENAI_API_KEY: "OPENAI_API_KEY",
  /** Anthropic API key for model-matrix nightly runs. */
  ANTHROPIC_API_KEY: "ANTHROPIC_API_KEY",
  /**
   * Optional shared secret for the /api/health?verbose=1 gate
   * (Drift-3 / G-18). If set, the health-endpoint E2E test sends
   * this value as the `x-ops-health-secret` header.
   */
  INTERNAL_HEALTH_SECRET: "INTERNAL_HEALTH_SECRET",
} as const;

export type E2EEnvKey = keyof typeof E2E_ENV_KEYS;

/**
 * Returns the env var value or throws with a clear message naming the key
 * and the `.env.e2e.example` file that documents it.
 */
export function requireEnv(key: E2EEnvKey): string {
  const value = process.env[key];
  if (!value || value.trim() === "") {
    throw new Error(
      `E2E env var ${key} is not set. Add it to .env.e2e (see .env.e2e.example) or to GitHub Actions secrets for CI runs.`,
    );
  }
  return value;
}

/**
 * Returns the env var value or a fallback. Use for optional config like
 * `NULLSPEND_BASE_URL` which defaults to the local dev server.
 */
export function optionalEnv(key: E2EEnvKey, fallback: string): string {
  const value = process.env[key];
  return value && value.trim() !== "" ? value : fallback;
}

/** Target URL for dashboard E2E tests. Defaults to local dev. */
export function getBaseUrl(): string {
  return optionalEnv("NULLSPEND_BASE_URL", "http://127.0.0.1:3000");
}

/** Proxy worker URL for proxy-layer E2E tests. Defaults to production. */
export function getProxyUrl(): string {
  return optionalEnv("NULLSPEND_PROXY_URL", "https://proxy.nullspend.dev");
}
