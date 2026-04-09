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

// Global setup (tests/e2e/lib/global-setup.ts) fails the entire run if
// the target is not reachable, so tests below can assume connectivity.

interface ComponentStatus {
  status: "ok" | "error";
  error?: string;
}

interface VerboseHealth {
  status: "ok" | "degraded";
  components: Record<string, ComponentStatus>;
}

describe("Dashboard /api/health (launch-night P0 regression)", () => {
  const baseUrl = getBaseUrl();

  // Drift-3 / G-18: verbose mode is behind an opt-in gate. If the
  // server has `INTERNAL_HEALTH_SECRET` set, we need to pass the
  // matching `x-ops-health-secret` header to read verbose. If the
  // gate isn't activated on this server, the header is ignored
  // (and harmless) and we get verbose anyway.
  //
  // The secret is read from the same env var on the test side
  // (propagated via GitHub Actions secrets → workflow env →
  // vitest.e2e.config.ts .env.e2e loader).
  const healthSecret = process.env.INTERNAL_HEALTH_SECRET;
  const verboseHeaders: Record<string, string> = {};
  if (healthSecret) {
    verboseHeaders["x-ops-health-secret"] = healthSecret;
  }

  async function fetchVerbose(): Promise<VerboseHealth> {
    const res = await fetch(`${baseUrl}/api/health?verbose=1`, {
      headers: verboseHeaders,
    });
    return (await res.json()) as VerboseHealth;
  }

  it("GET /api/health returns 200 + { status: 'ok' }", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("ok");
  });

  it("GET /api/health?verbose=1 returns all components OK", async () => {
    const body = await fetchVerbose();
    // If the gate is active AND we don't have the secret, verbose
    // downgrades to non-verbose (no `components` key). In that case,
    // the test can only verify top-level status. The component-level
    // probes below will also skip gracefully.
    if (!body.components) {
      expect(body.status).toBe("ok");
      return;
    }
    const failed = Object.entries(body.components).filter(
      ([, c]) => c.status !== "ok",
    );
    // Surface the full failure list in the assertion message so the CI
    // artifact shows which component is broken without spelunking logs.
    expect(
      failed,
      `Degraded components: ${JSON.stringify(failed, null, 2)}`,
    ).toEqual([]);
    expect(body.status).toBe("ok");
  });

  describe("component-level probes", () => {
    // Each of these tests maps to a specific launch-night P0 that the
    // health check is designed to catch. A failure here names the bug
    // class directly in the test name so triage is one line.
    //
    // If the verbose gate is active and we don't have the secret,
    // these tests skip gracefully via an early return — non-verbose
    // responses have no `components` to check.

    async function assertComponent(name: string): Promise<void> {
      const body = await fetchVerbose();
      if (!body.components) {
        // Gate is active without the secret. Skip assertion.
        return;
      }
      expect(body.components[name]?.status).toBe("ok");
    }

    it("database: connectivity check passes (P0-C regression)", async () => {
      await assertComponent("database");
    });

    it("schema: REQUIRED_SCHEMA matches drizzle (P0-D regression)", async () => {
      await assertComponent("schema");
    });

    it("parameterized_query: Supabase pooler compat (P1-19 regression)", async () => {
      await assertComponent("parameterized_query");
    });

    it("supabase_auth: auth client initializes (P0-B regression)", async () => {
      await assertComponent("supabase_auth");
    });

    it("cookie_secret: present in production (P0-E regression)", async () => {
      // P0-E was missing COOKIE_SECRET in Vercel prod → every authed
      // dashboard API route 500'd because getCookieSecret() threw.
      await assertComponent("cookie_secret");
    });

    it("devMode: NULLSPEND_DEV_MODE NOT enabled", async () => {
      // Dev mode = auth bypass. Must never be true in production.
      // The health route only sets this component if dev mode is ON
      // (as an error). If it's absent or ok, we're fine.
      const body = await fetchVerbose();
      if (!body.components) return; // gate active without secret
      if (body.components.devMode) {
        expect(body.components.devMode.status).toBe("ok");
      }
    });
  });
});
