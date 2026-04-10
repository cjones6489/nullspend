/**
 * Shared postgres.js connection options for E2E tests that need direct
 * DB access. Mirrors the critical settings from `lib/db/client.ts` to
 * ensure Supabase Transaction pooler compatibility.
 *
 * Extracted to avoid config duplication across E2E test files that
 * create their own postgres clients (e.g., proxy-reachable Gap-7 DB
 * verification). If `lib/db/client.ts` changes its pooler compat
 * settings, update this file too.
 *
 * See: lib/db/client.ts for the canonical dashboard config.
 */
import type { Options } from "postgres";

export const E2E_POSTGRES_OPTIONS: Options<Record<string, never>> = {
  // Required for Supabase Transaction mode pooler compatibility.
  prepare: false,
  fetch_types: false,
  // Lightweight pool for test usage.
  max: 2,
  idle_timeout: 20,
  connect_timeout: 10,
};
