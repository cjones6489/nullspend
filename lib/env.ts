import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().startsWith("https://"),
  // Supabase renamed "anon key" to "publishable key" in their naming migration.
  // lib/auth/supabase.ts + lib/auth/supabase-browser.ts read the new name
  // (NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) directly via process.env. Validating
  // the OLD name here (NEXT_PUBLIC_SUPABASE_ANON_KEY) caused every server route
  // that calls getDb() -> getEnv() to throw on the Zod check in production,
  // even though the actual Supabase client was reading a different var.
  // Found by /qa on 2026-04-08: /api/health degraded + every authed API
  // route 500-ing with "Missing or invalid environment variables".
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string(),
  // Cookie signing secret for the ns-active-org HMAC-signed cookie.
  // lib/auth/session.ts:getCookieSecret() requires this in production —
  // missing it caused every dashboard API route to 500 on first-login
  // cold path when setActiveOrgCookie() was called (P0-E, found 2026-04-08).
  // Accepts either COOKIE_SECRET or NEXTAUTH_SECRET; validated via refine
  // because zod doesn't have a native "one of" for process.env fields.
  COOKIE_SECRET: z.string().optional(),
  NEXTAUTH_SECRET: z.string().optional(),
  UPSTASH_REDIS_REST_URL: z.string().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
  NEXT_PUBLIC_SENTRY_DSN: z.string().optional(),
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .optional(),
}).refine(
  (env) => {
    // In production, at least one cookie signing secret must be set.
    // Dev falls back to a hardcoded dev secret.
    if (process.env.NODE_ENV !== "production") return true;
    return Boolean(env.COOKIE_SECRET || env.NEXTAUTH_SECRET);
  },
  {
    message:
      "COOKIE_SECRET or NEXTAUTH_SECRET must be set in production (required by lib/auth/session.ts:getCookieSecret for HMAC-signing the ns-active-org cookie)",
    path: ["COOKIE_SECRET"],
  },
);

type Env = z.infer<typeof envSchema>;

let _env: Env | undefined;

export function getEnv(): Env {
  if (_env) return _env;

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");

    throw new Error(
      `Missing or invalid environment variables:\n${formatted}\n\nCheck your .env.local file.`,
    );
  }

  _env = result.data;
  return _env;
}
