/**
 * Dashboard /api/health regression — P0-C, P0-D, P0-E, P1-19 from
 * 2026-04-08 launch night.
 *
 * The health endpoint was reporting `{status: "degraded"}` in production for
 * days before launch and nothing alerted on it. Root cause was a chain of
 * independent bugs, all detectable via the verbose check:
 *
 *   - P0-C: DATABASE_URL pointed at IPv6-only direct URL → ENOTFOUND
 *   - P0-D: REQUIRED_SCHEMA had drifted column names vs drizzle schema
 *   - P0-E: COOKIE_SECRET missing in prod → getCookieSecret() threw
 *   - P1-19: Date→timestamptz cast broke under fetch_types:false pooler mode
 *
 * Post-launch, `app/api/health/route.ts` gained explicit component probes
 * for each failure mode:
 *   - database       — SELECT 1
 *   - schema         — REQUIRED_SCHEMA vs information_schema.columns
 *   - parameterized_query — drizzle .select().from().where(eq(...)) against pooler
 *   - supabase_auth  — createServerSupabaseClient + auth.getUser()
 *   - cookie_secret  — COOKIE_SECRET / NEXTAUTH_SECRET presence in prod
 *   - redis          — rate limiter ping (if configured)
 *
 * This test asserts ALL components are `ok`. Any regression on any of
 * the launch-night P0 classes now fails the deploy automatically.
 *
 * See:
 *   - app/api/health/route.ts
 *   - memory/project_session_summary_20260408_launch.md
 */

import { describe, it, expect } from "vitest";
import { getBaseUrl } from "../lib/env";

const unreachable = process.env.E2E_TARGET_UNREACHABLE === "1";

interface ComponentStatus {
  status: "ok" | "error";
  error?: string;
}

interface VerboseHealth {
  status: "ok" | "degraded";
  components: Record<string, ComponentStatus>;
}

describe.skipIf(unreachable)("Dashboard /api/health (launch-night P0 regression)", () => {
  const baseUrl = getBaseUrl();

  it("GET /api/health returns 200 + { status: 'ok' }", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("ok");
  });

  it("GET /api/health?verbose=1 returns all components OK", async () => {
    const res = await fetch(`${baseUrl}/api/health?verbose=1`);
    const body = (await res.json()) as VerboseHealth;
    const failed = Object.entries(body.components).filter(
      ([, c]) => c.status !== "ok",
    );
    // Surface the full failure list in the assertion message so the CI
    // artifact shows which component is broken without spelunking logs.
    expect(
      failed,
      `Degraded components: ${JSON.stringify(failed, null, 2)}`,
    ).toEqual([]);
    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
  });

  describe("component-level probes", () => {
    // Each of these tests maps to a specific launch-night P0 that the
    // health check is designed to catch. A failure here names the bug
    // class directly in the test name so triage is one line.

    it("database: connectivity check passes (P0-C regression)", async () => {
      const res = await fetch(`${baseUrl}/api/health?verbose=1`);
      const body = (await res.json()) as VerboseHealth;
      expect(body.components.database?.status).toBe("ok");
    });

    it("schema: REQUIRED_SCHEMA matches drizzle (P0-D regression)", async () => {
      const res = await fetch(`${baseUrl}/api/health?verbose=1`);
      const body = (await res.json()) as VerboseHealth;
      expect(body.components.schema?.status).toBe("ok");
    });

    it("parameterized_query: Supabase pooler compat (P1-19 regression)", async () => {
      // This probe runs the exact drizzle query pattern that broke in
      // P1-19 (getDistinctTagKeys). If fetch_types:false ever regresses
      // or a new query hits the same type-inference bug, this fails.
      const res = await fetch(`${baseUrl}/api/health?verbose=1`);
      const body = (await res.json()) as VerboseHealth;
      expect(body.components.parameterized_query?.status).toBe("ok");
    });

    it("supabase_auth: auth client initializes (P0-B regression)", async () => {
      // P0-B was `NEXT_PUBLIC_SUPABASE_ANON_KEY` vs `_PUBLISHABLE_KEY` name
      // drift. If Supabase env vars are missing, supabase_auth fails here.
      const res = await fetch(`${baseUrl}/api/health?verbose=1`);
      const body = (await res.json()) as VerboseHealth;
      expect(body.components.supabase_auth?.status).toBe("ok");
    });

    it("cookie_secret: present in production (P0-E regression)", async () => {
      // P0-E was missing COOKIE_SECRET in Vercel prod → every authed
      // dashboard API route 500'd because getCookieSecret() threw.
      const res = await fetch(`${baseUrl}/api/health?verbose=1`);
      const body = (await res.json()) as VerboseHealth;
      expect(body.components.cookie_secret?.status).toBe("ok");
    });

    it("devMode: NULLSPEND_DEV_MODE NOT enabled", async () => {
      // Dev mode = auth bypass. Must never be true in production.
      // The health route only sets this component if dev mode is ON
      // (as an error). If it's absent or ok, we're fine.
      const res = await fetch(`${baseUrl}/api/health?verbose=1`);
      const body = (await res.json()) as VerboseHealth;
      if (body.components.devMode) {
        expect(body.components.devMode.status).toBe("ok");
      }
    });
  });
});
