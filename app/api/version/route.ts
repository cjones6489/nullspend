import { NextResponse } from "next/server";

/**
 * Public deployment metadata endpoint.
 *
 * Exposes the git commit SHA, branch, and Vercel environment of the
 * currently-serving deployment. Consumed by the post-deploy E2E
 * workflow to detect Vercel auto-rollbacks and atomic-swap races.
 *
 * # The bug class this prevents
 *
 * Vercel's `deployment_status` webhook fires when a deployment
 * transitions to state=success. For Production deploys, the
 * post-deploy E2E workflow resolves the target URL to the stable
 * public domain (`www.nullspend.dev`). But by the time the workflow
 * runs its tests, one of these edge cases could apply:
 *
 *   1. Vercel auto-rolled back the deployment (e.g., health check
 *      failure on the new build) — the stable URL is serving the
 *      PRIOR commit, not the one that triggered the workflow.
 *   2. Multiple Production deploys landed in quick succession — the
 *      stable URL is serving a NEWER commit than the one triggered.
 *   3. Brief atomic-swap window (~1s) between deployment_status
 *      firing and the stable URL pointing at the new deploy.
 *
 * In all three cases, the workflow would report "tests passed" for
 * commit X while actually testing commit Y. The intended
 * "every commit gets validated in production" guarantee is silently
 * broken.
 *
 * Fix: the workflow fetches this endpoint BEFORE running tests and
 * compares the returned `commit_sha` against `${{ github.sha }}`. If
 * they differ, the workflow fails with an explicit "deploy rolled
 * back or hasn't propagated" message, preventing the false-green.
 *
 * # Response shape (stable public API)
 *
 * {
 *   "commit_sha": "fa1eade47b73733d6312d5abfad33ce9e4068081",
 *   "commit_ref": "main",
 *   "env": "production",
 *   "deployed_at": "2026-04-09T22:30:00.000Z"
 * }
 *
 * All fields are strings. `commit_sha` is null when running locally
 * (no Vercel env). `env` is one of "production" | "preview" |
 * "development" | "local".
 *
 * # Caching
 *
 * Cached at the CDN edge is SAFE because the commit SHA is immutable
 * for the lifetime of a deployment. Each new deploy gets a new
 * invocation boundary. But to be safe and avoid stale reads during
 * the atomic-swap window, we set `Cache-Control: no-store` so every
 * request hits the live Vercel function.
 *
 * # Why public
 *
 * Commit SHAs are not secrets — they're present in GitHub commit URLs,
 * release notes, and source map manifests. Exposing them on a public
 * endpoint is standard practice for deployment verification tooling.
 * If we ever need to hide them (e.g., source code is private and
 * commit metadata could reveal naming patterns), we can gate this
 * behind the same internal-auth pattern used by /api/health?verbose=1.
 */

interface VersionResponse {
  commit_sha: string | null;
  commit_ref: string | null;
  env: "production" | "preview" | "development" | "local";
  deployed_at: string | null;
}

export async function GET() {
  // Vercel sets these at both build time and runtime. Use the plain
  // (non-NEXT_PUBLIC_) variant because on the server both variants
  // are runtime process.env reads that always resolve to the same
  // value. The NEXT_PUBLIC_ prefix only matters for client-side code
  // (where it's inlined at build time). No fallback value is gained
  // by checking both.
  const commitSha = process.env.VERCEL_GIT_COMMIT_SHA ?? null;
  const commitRef = process.env.VERCEL_GIT_COMMIT_REF ?? null;

  // VERCEL_ENV is set by Vercel: "production" | "preview" |
  // "development". "development" means `vercel dev` locally. Plain
  // `pnpm dev` (no Vercel CLI) has no VERCEL_ENV — we label that "local".
  const rawEnv = process.env.VERCEL_ENV as
    | "production"
    | "preview"
    | "development"
    | undefined;
  const env: VersionResponse["env"] = rawEnv ?? "local";

  // Vercel doesn't expose a deploy timestamp directly, but we can
  // approximate with the build time baked into the bundle. For now,
  // return the current time (the function-invocation time), which is
  // close enough for "when is this code running" diagnostics. A more
  // precise value would require a build-time constant.
  const deployedAt = new Date().toISOString();

  const body: VersionResponse = {
    commit_sha: commitSha,
    commit_ref: commitRef,
    env,
    deployed_at: deployedAt,
  };

  return NextResponse.json(body, {
    headers: {
      // Stale commit metadata during an atomic-swap window would
      // defeat the whole point of the endpoint. Force every request
      // to hit the live function.
      "Cache-Control": "private, no-store",
    },
  });
}
