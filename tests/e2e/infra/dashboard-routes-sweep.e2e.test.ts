/**
 * Dashboard API route crash sweep — pre-auth crash detection.
 *
 * Walks every `app/api/**\/route.ts` file that exports a `GET` handler,
 * substitutes dynamic route params with placeholder values, and fires
 * an unauthenticated GET at each endpoint against the live deploy.
 * The assertion: **status is not in {500, 502, 504}** (no unhandled crash).
 *
 * # What this test DOES catch
 *
 * - Route handlers that throw at module-load time or on the pre-auth
 *   code path (env var reads, import crashes, regex literal syntax
 *   errors, null pointer exceptions before auth runs)
 * - Worker hangs that manifest as 502/504 gateway errors
 * - Any refactor that introduces a crash in the request pipeline before
 *   `resolveSessionContext()` or `authenticateApiKey()` is called
 *
 * # What this test does NOT catch
 *
 * - Post-auth crashes like P1-19 (the 2026-04-08
 *   `/api/cost-events/tag-keys` Date→timestamptz bug). That bug only
 *   surfaces AFTER successful session auth, and the sweep uses
 *   unauthenticated GETs. P1-19-class regressions are covered by the
 *   `parameterized_query` component probe in
 *   tests/e2e/infra/health-endpoint.e2e.test.ts, which runs a real
 *   drizzle parameterized query against the Supabase pooler — exactly
 *   the code path that broke P1-19.
 *
 * What counts as "handled":
 *   - 200/204 — route returned successfully (rare without auth)
 *   - 301/302/307 — redirect (likely auth-gated)
 *   - 400 — input validation rejected the request
 *   - 401/403 — auth required (the common case)
 *   - 404 — route not found or resource missing
 *   - 429 — rate limited
 *   - 503 — circuit breaker open or service degraded (has Retry-After)
 *
 * What's a crash:
 *   - 500 — unhandled exception in the route handler
 *   - 502/504 — upstream/gateway error (worker hang, timeout)
 *
 * Why unauthenticated? Crash sweeps catch bug classes that manifest
 * BEFORE auth (route resolution, query string parsing, env var reads,
 * module-load errors). Post-auth crashes are caught by the dashboard
 * E2E suite (Slice 4) and the health endpoint's parameterized_query probe.
 *
 * Where this runs: `.github/workflows/e2e-post-deploy.yml` fires on both
 * Preview and Production deploys. Running against prod is SAFE AS LONG AS
 * the Supabase auth circuit breaker does NOT count unauthenticated requests
 * as service failures — that circuit-breaker sensitivity was fixed in a
 * dedicated commit (see lib/auth/session.ts — AuthenticationRequiredError
 * is now thrown OUTSIDE the breaker wrapper). Before that fix, the sweep
 * tripped the breaker after 5 unauth'd requests and disrupted real users
 * for ~30s.
 *
 * Excluded:
 *   - Stripe webhook — requires signed payload, can't be swept
 *   - Invite accept — mutates state, handled by Slice 4
 *   - Anything under `/api/stripe/*` — Stripe rate limits + side effects
 *
 * See:
 *   - lib/auth/session.ts (circuit breaker wrapper — fixed in Slice 1e/f)
 *   - lib/utils/http.ts:161 (handleRouteError 503 on CircuitOpenError)
 *   - tests/e2e/infra/health-endpoint.e2e.test.ts (P1-19 coverage via
 *     parameterized_query component probe)
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getBaseUrl } from "../lib/env";

// Global setup (tests/e2e/lib/global-setup.ts) fails the entire run if
// the target is not reachable, so tests below can assume connectivity.

const API_ROOT = join(process.cwd(), "app", "api");

// Route path prefixes that should never be swept. Each entry has a reason.
const SWEEP_EXCLUDES: Array<{ prefix: string; reason: string }> = [
  { prefix: "/api/stripe/webhook", reason: "requires signed payload" },
  { prefix: "/api/stripe/", reason: "third-party rate limits + side effects" },
  { prefix: "/api/invite/accept", reason: "mutates state; tested in Slice 4" },
  { prefix: "/api/slack/callback", reason: "OAuth callback requires signed state" },
  { prefix: "/api/slack/test", reason: "fires real Slack webhook" },
  {
    prefix: "/api/webhooks/",
    reason: "[id]/test fires real HTTP; rotate-secret mutates state",
  },
];

// Placeholder values for dynamic route segments. These are intentionally
// not real so the handler resolves to 404/401/403, never 500.
const PARAM_PLACEHOLDERS: Record<string, string> = {
  "[id]": "00000000-0000-0000-0000-000000000000",
  "[orgId]": "00000000-0000-0000-0000-000000000000",
  "[userId]": "00000000-0000-0000-0000-000000000000",
  "[customerId]": "placeholder-customer",
  "[customer]": "placeholder-customer",
  "[sessionId]": "00000000-0000-0000-0000-000000000000",
  "[key]": "placeholder-key",
};

/**
 * Recursively walk `app/api/` and collect routes that export a `GET`
 * handler. Returns a list of URL paths with dynamic segments substituted.
 *
 * Synchronous intentionally so it can run at module-eval time and feed
 * `describe.each(...)` directly — vitest's test collector does not wait
 * for async describe bodies, so async discovery risks silently dropping
 * tests.
 */
function discoverGetRoutes(): string[] {
  const routes: string[] = [];

  function walk(dir: string): void {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.name !== "route.ts") continue;

      // Quick text scan for exported GET handler. Matches:
      //   export async function GET(...)
      //   export const GET = ...
      //   export { GET }  — rare but supported
      const src = readFileSync(full, "utf-8");
      const hasGet =
        /export\s+(async\s+)?function\s+GET\b/.test(src) ||
        /export\s+(const|let|var)\s+GET\s*=/.test(src) ||
        /export\s*\{[^}]*\bGET\b[^}]*\}/.test(src);
      if (!hasGet) continue;

      // Convert filesystem path → URL path.
      // app/api/actions/[id]/route.ts → /api/actions/[id]
      const rel = full.slice(API_ROOT.length).replace(/\\/g, "/");
      const urlPath = "/api" + rel.replace(/\/route\.ts$/, "");

      // Substitute dynamic params with placeholders.
      let resolved = urlPath;
      for (const [token, value] of Object.entries(PARAM_PLACEHOLDERS)) {
        resolved = resolved.split(token).join(value);
      }
      // If any `[*]` segment remains, skip — we don't have a placeholder for it
      if (/\[[^\]]+\]/.test(resolved)) continue;

      routes.push(resolved);
    }
  }

  walk(API_ROOT);
  return routes.sort();
}

function isExcluded(path: string): { excluded: boolean; reason?: string } {
  for (const { prefix, reason } of SWEEP_EXCLUDES) {
    if (path.startsWith(prefix)) return { excluded: true, reason };
  }
  return { excluded: false };
}

// Discover routes at module-eval time (synchronously). This runs once
// per file load, which is cheap (small filesystem scan) and makes the
// test list deterministic for vitest's collector.
const ALL_ROUTES = discoverGetRoutes();
const SWEEPABLE_ROUTES = ALL_ROUTES.filter((r) => !isExcluded(r).excluded);

describe("Dashboard API crash sweep", () => {
  const baseUrl = getBaseUrl();

  it(`discovers ${ALL_ROUTES.length} GET routes, sweeps ${SWEEPABLE_ROUTES.length}`, () => {
    // Sanity: if this count drops unexpectedly, someone probably broke
    // the route.ts GET export pattern. Hard floor based on the current
    // route inventory (45+ GET routes at time of Slice 1).
    expect(ALL_ROUTES.length).toBeGreaterThan(30);
    expect(SWEEPABLE_ROUTES.length).toBeGreaterThan(25);
  });

  // NOTE ON WHAT THIS CATCHES: These tests verify that no route handler
  // crashes with 500/502/504 on unauthenticated GET. That's a different
  // bug class than P1-19 (the 2026-04-08 Date→timestamptz issue, which
  // manifested AFTER successful auth). P1-19 regression is covered by
  // the `parameterized_query` component probe in
  // tests/e2e/infra/health-endpoint.e2e.test.ts — that probe runs a real
  // drizzle parameterized query against the Supabase pooler, exercising
  // the exact code path that broke P1-19.
  //
  // What THIS sweep catches:
  //   - Route handlers that throw before hitting auth (e.g., module-load
  //     crash from an env var read, invalid import, bad regex literal)
  //   - Worker hangs that manifest as 502/504 gateway errors
  //   - Any refactor that introduces a null-pointer exception in the
  //     pre-auth pipeline
  describe.each(SWEEPABLE_ROUTES)("GET %s", (route) => {
    it("does not crash with 500/502/504 (pre-auth crash detection)", async () => {
      const res = await fetch(`${baseUrl}${route}`, {
        method: "GET",
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      });
      // 500 = unhandled crash
      // 502/504 = worker hang / upstream timeout
      // 503 = circuit open / maintenance (handled — has Retry-After)
      // Everything else (2xx/3xx/4xx) = handled response
      const UNHANDLED = new Set([500, 502, 504]);
      expect(
        UNHANDLED.has(res.status),
        `GET ${route} returned ${res.status} (expected: not in ${[...UNHANDLED].join(",")})`,
      ).toBe(false);
    });
  });
});
