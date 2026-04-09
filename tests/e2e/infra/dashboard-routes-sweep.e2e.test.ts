/**
 * Dashboard API route crash sweep — P1-19 regression class.
 *
 * P1-19 was /api/cost-events/tag-keys 500ing because `getDistinctTagKeys`
 * passed a JS Date into a raw sql template that postgres.js couldn't infer
 * under fetch_types:false pooler mode. Unit tests didn't catch it because
 * they mock drizzle. The only signal was "the dashboard throws 500 when a
 * user filters by tag key."
 *
 * This test walks every `app/api/**\/route.ts` file that exports a `GET`
 * handler, substitutes dynamic route params with placeholder values, and
 * fires an unauthenticated GET at each endpoint against the live deploy.
 * The assertion: **status !== 500** (no unhandled crash).
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
 * BEFORE auth (route resolution, query string parsing, env var reads).
 * Post-auth crashes are caught by the dashboard E2E suite (Slice 4).
 *
 * Where this runs: the workflow condition on `e2e-post-deploy.yml`
 * targets `deployment_status.environment == 'Preview'`, so the sweep
 * hits preview deploys only — not production. Running it against prod
 * risks tripping the Supabase auth circuit breaker (`lib/auth/session.ts`)
 * because every unauth'd call counts as a breaker failure, opening the
 * circuit for ~30s and affecting real users. **Do not override
 * `NULLSPEND_BASE_URL` to prod for this test.**
 *
 * Known finding (logged for separate fix): the Supabase auth circuit
 * breaker at `lib/auth/session.ts:19` treats `AuthenticationRequiredError`
 * as a Supabase service failure. It should only count network/5xx
 * errors. Filing as a follow-up for a dedicated fix commit.
 *
 * Excluded:
 *   - Stripe webhook — requires signed payload, can't be swept
 *   - Invite accept — mutates state, handled by Slice 4
 *   - Anything under `/api/stripe/*` — Stripe rate limits + side effects
 *
 * See:
 *   - memory/project_session_summary_20260408_launch.md "P1-19"
 *   - lib/cost-events/aggregate-cost-events.ts
 *   - lib/auth/session.ts:19 (circuit breaker sensitivity finding)
 *   - lib/utils/http.ts:161 (handleRouteError 503 on CircuitOpenError)
 */

import { describe, it, expect } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { getBaseUrl } from "../lib/env";

const unreachable = process.env.E2E_TARGET_UNREACHABLE === "1";

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
 */
async function discoverGetRoutes(): Promise<string[]> {
  const routes: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (entry.name !== "route.ts") continue;

      // Quick text scan for exported GET handler. Matches:
      //   export async function GET(...)
      //   export const GET = ...
      //   export { GET }  — rare but supported
      const src = await readFile(full, "utf-8");
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

  await walk(API_ROOT);
  return routes.sort();
}

function isExcluded(path: string): { excluded: boolean; reason?: string } {
  for (const { prefix, reason } of SWEEP_EXCLUDES) {
    if (path.startsWith(prefix)) return { excluded: true, reason };
  }
  return { excluded: false };
}

describe.skipIf(unreachable)(
  "Dashboard API crash sweep (P1-19 regression)",
  async () => {
    const baseUrl = getBaseUrl();
    const allRoutes = await discoverGetRoutes();
    const sweepable = allRoutes.filter((r) => !isExcluded(r).excluded);

    it(`discovers ${allRoutes.length} GET routes, sweeps ${sweepable.length}`, () => {
      // Sanity: if this count drops unexpectedly, someone probably broke
      // the route.ts GET export pattern. Hard floor based on the current
      // route inventory (58 GET routes at time of Slice 1).
      expect(allRoutes.length).toBeGreaterThan(30);
      expect(sweepable.length).toBeGreaterThan(25);
    });

    describe.each(sweepable)("GET %s", (route) => {
      it("does not crash with 500 (P1-19 regression)", async () => {
        const res = await fetch(`${baseUrl}${route}`, {
          method: "GET",
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(15_000),
        });
        // 500 = unhandled crash (the P1-19 class we're guarding against)
        // 502/504 = worker hang / upstream timeout (also a crash class)
        // 503 = circuit open / maintenance (handled — has Retry-After)
        // Everything else (2xx/3xx/4xx) = handled response
        const UNHANDLED = new Set([500, 502, 504]);
        expect(
          UNHANDLED.has(res.status),
          `GET ${route} returned ${res.status} (expected: not in ${[...UNHANDLED].join(",")})`,
        ).toBe(false);
      });
    });
  },
);
