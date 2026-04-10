/**
 * Drift test for E2E postgres connection config.
 *
 * Verifies that `E2E_POSTGRES_OPTIONS` includes the critical Supabase
 * pooler compatibility settings from `lib/db/client.ts`. If the
 * canonical config adds a new required setting, this test catches the
 * drift at CI time instead of silently failing in E2E DB queries.
 *
 * Only checks the two settings that are REQUIRED for Supabase
 * Transaction mode pooler compatibility: `prepare: false` and
 * `fetch_types: false`. Other settings (max, idle_timeout, etc.) can
 * differ between the dashboard and E2E contexts.
 */

import { describe, it, expect } from "vitest";

import { E2E_POSTGRES_OPTIONS } from "./db-config";

describe("E2E postgres config drift guard", () => {
  it("has prepare: false (required for Supabase Transaction pooler)", () => {
    expect(E2E_POSTGRES_OPTIONS.prepare).toBe(false);
  });

  it("has fetch_types: false (required for Supabase Transaction pooler)", () => {
    expect(E2E_POSTGRES_OPTIONS.fetch_types).toBe(false);
  });

  it("has connect_timeout set (fail fast on connection issues)", () => {
    expect(typeof E2E_POSTGRES_OPTIONS.connect_timeout).toBe("number");
    expect(E2E_POSTGRES_OPTIONS.connect_timeout).toBeGreaterThan(0);
  });
});
