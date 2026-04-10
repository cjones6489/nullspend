import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";

import {
  AuthenticationRequiredError,
  SupabaseEnvError,
  UpstreamServiceError,
} from "@/lib/auth/errors";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { getDb } from "@/lib/db/client";
import { organizations, orgMemberships } from "@nullspend/db";
import { setRequestUserId } from "@/lib/observability/request-context";
import { addSentryBreadcrumb } from "@/lib/observability/sentry";
import {
  CircuitBreaker,
  CircuitOpenError,
  CircuitTimeoutError,
} from "@/lib/resilience/circuit-breaker";
import { ORG_ROLES, type OrgRole } from "@/lib/validations/orgs";

const supabaseCircuit = new CircuitBreaker({
  name: "supabase-auth",
  failureThreshold: Number(process.env.NULLSPEND_CB_FAILURE_THRESHOLD) || 5,
  resetTimeoutMs: Number(process.env.NULLSPEND_CB_RESET_TIMEOUT_MS) || 30_000,
  requestTimeoutMs: 5_000,
});

/** @internal Expose circuit breaker for testing only. */
export const _supabaseCircuitForTesting = supabaseCircuit;

function canUseDevelopmentFallback(): boolean {
  return process.env.NULLSPEND_DEV_MODE === "true";
}

export function getDevActor(): string | undefined {
  return process.env.NULLSPEND_DEV_ACTOR;
}

/**
 * Classify a Supabase auth error as either a "service failure" (Supabase
 * itself is broken) or a "client condition" (the caller is unauthenticated
 * or has an invalid session).
 *
 * Supabase-js never throws for either class — both are returned via
 * `{ data: { user: null }, error }`. We manually promote service failures
 * to thrown exceptions inside the circuit breaker callback so the breaker
 * can trip on real Supabase outages without also tripping on routine
 * unauthenticated requests.
 *
 * Classification rules (verified against `@supabase/auth-js` source code
 * in `node_modules/.../dist/module/lib/errors.ts`):
 *
 *   - `AuthRetryableFetchError` — network down, fetch abort, Cloudflare
 *     5xx, rate-limited. ALWAYS a service failure.
 *   - `AuthUnknownError` — auth-js can't parse the response JSON (CDN
 *     interstitial, HTML error page). Treated as a service failure.
 *   - `AuthApiError` with status 429 — Supabase rate-limited us.
 *     Repeated 429s suggest we should back off, same as 5xx.
 *   - Any error with numeric `status >= 500` — server-side failure.
 *   - Everything else (including `AuthSessionMissingError` with status
 *     400, `AuthApiError` with status 401/403, `AuthInvalidJwtError`,
 *     etc.) — client-side condition, does NOT trip the breaker.
 *
 * Why check `error.name` as a string: `isAuthRetryableFetchError` is
 * exported from `@supabase/auth-js` but not re-exported from the top-
 * level `@supabase/supabase-js` or `@supabase/ssr` packages we use.
 * String-based `.name` comparison avoids a direct dep on auth-js and
 * is stable across supabase-js versions (the name is part of the
 * public API contract — breaking it would break every user's
 * `error.name === "..."` guard code).
 */
export function isSupabaseServiceFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { name?: unknown; status?: unknown };
  if (e.name === "AuthRetryableFetchError") return true;
  // AuthUnknownError: auth-js can't parse response JSON (CDN interstitial, HTML error page)
  if (e.name === "AuthUnknownError") return true;
  // Supabase 429: rate-limited. Repeated 429s mean we should back off.
  if (e.name === "AuthApiError" && e.status === 429) return true;
  if (typeof e.status === "number" && e.status >= 500) return true;
  return false;
}

export async function getCurrentUserId(): Promise<string | null> {
  // createServerSupabaseClient() may throw SupabaseEnvError (missing env vars).
  // This is a config error that will never self-heal, so it must NOT trip the
  // circuit breaker. Only the actual auth call goes inside the circuit.
  const supabase = await createServerSupabaseClient();

  // IMPORTANT: `supabase.auth.getUser()` NEVER throws for auth errors
  // OR for HTTP 5xx from the Supabase backend OR for network failures.
  // Supabase-js (since v1.0.1, confirmed via auth-js v2.98.0
  // GoTrueClient._getUser) catches all `AuthError` subclasses inside a
  // try block and returns them via `{ data: { user: null }, error }`.
  //
  // This means a naive `supabaseCircuit.call(() => auth.getUser())`
  // NEVER counts a failure — the callback always resolves, even when
  // Supabase is completely down. The breaker would be dead code.
  //
  // Fix: inside the circuit callback, classify the returned `error`
  // via `isSupabaseServiceFailure()` and THROW for service-class
  // errors so the breaker counts them. Client-class errors (no session,
  // bad JWT, 401) return normally and get thrown OUTSIDE the breaker
  // as `AuthenticationRequiredError` — which the caller can catch
  // and treat as "user is not logged in" without tripping the breaker.
  //
  // This preserves BOTH properties we need:
  //   1. Breaker protects against real Supabase outages (5xx, network)
  //   2. Breaker does NOT trip on routine unauthenticated requests
  //      (fixes the circuit-breaker sensitivity bug where 5 anon GETs
  //       against session-authed routes took down all users for 30s)
  //
  // Regression tests in `lib/auth/session.test.ts` cover:
  //   - AuthSessionMissingError via {error}          → does NOT trip
  //   - AuthApiError with 401 via {error}            → does NOT trip
  //   - AuthApiError with 500 via {error}            → DOES trip
  //   - AuthRetryableFetchError via {error}          → DOES trip
  //   - Mixed: 3 unauth + 5 retryable                → trips after the 5
  //   - Valid user                                   → does NOT trip
  //
  // See: memory/project_finding_supabase_circuit_breaker_sensitivity.md
  const result = await supabaseCircuit.call(async () => {
    const res = await supabase.auth.getUser();
    if (res.error && isSupabaseServiceFailure(res.error)) {
      // Promote service failures to thrown exceptions so the breaker
      // counts them. Wrap in UpstreamServiceError so handleRouteError
      // maps to 503 + Retry-After instead of generic 500 + Sentry.
      throw new UpstreamServiceError(
        `Supabase auth service failure: ${res.error.message}`,
        res.error,
      );
    }
    return res;
  });

  if (result.error) {
    throw new AuthenticationRequiredError(result.error.message);
  }

  return result.data.user?.id ?? null;
}

function tryDevFallback(warn?: boolean): string | undefined {
  if (!canUseDevelopmentFallback()) return undefined;
  const devActor = getDevActor();
  if (!devActor) return undefined;
  if (warn) {
    console.warn(
      "[NullSpend] Using NULLSPEND_DEV_ACTOR fallback — do not use in production.",
    );
  }
  return devActor;
}

async function resolveUserId(options?: {
  warnOnFallback?: boolean;
  errorMessage?: string;
}): Promise<string> {
  try {
    const userId = await getCurrentUserId();
    if (userId) {
      setRequestUserId(userId);
      addSentryBreadcrumb("auth", "Session authenticated", { userId });
      return userId;
    }
  } catch (error) {
    // Fall back to dev actor for missing Supabase config, auth failures,
    // upstream service errors, and circuit breaker open.
    if (
      error instanceof SupabaseEnvError ||
      error instanceof AuthenticationRequiredError ||
      error instanceof CircuitOpenError ||
      error instanceof CircuitTimeoutError ||
      error instanceof UpstreamServiceError
    ) {
      const fallback = tryDevFallback(options?.warnOnFallback);
      if (fallback) {
        setRequestUserId(fallback);
        addSentryBreadcrumb("auth", "Dev fallback authenticated", { userId: fallback });
        return fallback;
      }
    }
    throw error;
  }

  const fallback = tryDevFallback(options?.warnOnFallback);
  if (fallback) {
    setRequestUserId(fallback);
    addSentryBreadcrumb("auth", "Dev fallback authenticated", { userId: fallback });
    return fallback;
  }

  throw new AuthenticationRequiredError(
    options?.errorMessage ?? "A valid session is required.",
  );
}

export async function assertSession(): Promise<void> {
  await resolveUserId();
}

export async function resolveSessionUserId(): Promise<string> {
  return resolveUserId();
}

export async function resolveApprovalActor(): Promise<string> {
  return resolveUserId({
    warnOnFallback: true,
    errorMessage: "Approval requires an authenticated Supabase user.",
  });
}

// ---------------------------------------------------------------------------
// Org context — cookie-embedded, zero DB on hot path
// ---------------------------------------------------------------------------

const ORG_COOKIE = "ns-active-org";
const MEMBERSHIP_CACHE_TTL_MS = 60_000;

interface CachedMembership {
  orgId: string;
  role: OrgRole;
  expiresAt: number;
}

const membershipCache = new Map<string, CachedMembership>();

/** @internal Expose for testing only. */
export const _membershipCacheForTesting = membershipCache;

/**
 * Invalidate cached membership for a user in a specific org.
 * Call after role changes, member removal, or ownership transfer.
 */
export function invalidateMembershipCache(userId: string, orgId: string): void {
  membershipCache.delete(`${userId}:${orgId}`);
}

/**
 * Create a personal org for a new user.
 * Uses a partial unique index to prevent duplicates from concurrent requests.
 * If the INSERT violates the constraint, re-queries the existing org.
 */
async function ensurePersonalOrg(
  userId: string,
): Promise<{ orgId: string; role: OrgRole }> {
  const db = getDb();

  try {
    // Transaction: both org + membership or neither
    const [org] = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(organizations)
        .values({
          name: "Personal",
          slug: `user-${userId.slice(0, 8)}-${Date.now().toString(36)}`,
          isPersonal: true,
          createdBy: userId,
        })
        .returning({ id: organizations.id });

      await tx.insert(orgMemberships).values({
        orgId: created.id,
        userId,
        role: "owner",
      });

      return [created];
    });

    return { orgId: org.id, role: "owner" };
  } catch (err) {
    // Only recover from Postgres unique_violation (23505) — rethrow everything else.
    // Drizzle wraps the original PostgresError as `cause`, so check both levels.
    const pgCode = (err as { code?: string }).code
      ?? (err as { cause?: { code?: string } }).cause?.code;
    if (pgCode !== "23505") throw err;

    // Partial unique index violation — another concurrent request created the org
    const existing = await db
      .select({ orgId: orgMemberships.orgId, role: orgMemberships.role })
      .from(orgMemberships)
      .innerJoin(organizations, eq(organizations.id, orgMemberships.orgId))
      .where(
        and(
          eq(orgMemberships.userId, userId),
          eq(organizations.isPersonal, true),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      return { orgId: existing[0].orgId, role: existing[0].role as OrgRole };
    }

    throw err;
  }
}

// Cookie signing — HMAC-SHA256
import { createHmac, timingSafeEqual } from "node:crypto";

function getCookieSecret(): string {
  const secret = process.env.COOKIE_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("COOKIE_SECRET or NEXTAUTH_SECRET must be set in production");
    }
    return "nullspend-dev-cookie-secret";
  }
  return secret;
}

/** @internal Expose for testing only. */
export function _signCookieValueForTesting(payload: string): string {
  return signCookieValue(payload);
}

function signCookieValue(payload: string): string {
  const sig = createHmac("sha256", getCookieSecret()).update(payload).digest("hex").slice(0, 16);
  return `${payload}.${sig}`;
}

function verifyCookieValue(signed: string): string | null {
  const dotIdx = signed.lastIndexOf(".");
  if (dotIdx < 1) return null;
  const payload = signed.slice(0, dotIdx);
  const expected = signCookieValue(payload);
  if (expected.length !== signed.length) return null;
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signed))) return null;
  return payload;
}

/**
 * Set the active org cookie. Called after ensurePersonalOrg or org switch.
 * Cookie value is HMAC-signed: `orgId:role.signature`
 */
export async function setActiveOrgCookie(orgId: string, role: OrgRole): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(ORG_COOKIE, signCookieValue(`${orgId}:${role}`), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // 1 year
  });
}

/**
 * Parse and verify the active org cookie. Returns null if missing, malformed, or tampered.
 */
async function readActiveOrgCookie(): Promise<{ orgId: string; role: OrgRole } | null> {
  try {
    const cookieStore = await cookies();
    const raw = cookieStore.get(ORG_COOKIE)?.value;
    if (!raw) return null;

    const value = verifyCookieValue(raw);
    if (!value) return null; // Signature mismatch — tampered or stale

    const sep = value.indexOf(":");
    if (sep < 1) return null;

    const orgId = value.slice(0, sep);
    const role = value.slice(sep + 1) as OrgRole;
    if (!(ORG_ROLES as readonly string[]).includes(role)) return null;

    return { orgId, role };
  } catch {
    return null;
  }
}

export interface SessionContext {
  userId: string;
  orgId: string;
  role: OrgRole;
}

export async function resolveSessionContext(): Promise<SessionContext> {
  const userId = await resolveUserId({ warnOnFallback: true });

  // Hot path: read from cookie
  const cookieOrg = await readActiveOrgCookie();
  if (cookieOrg) {
    // Check in-memory cache for membership validity
    const cacheKey = `${userId}:${cookieOrg.orgId}`;
    const cached = membershipCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return { userId, orgId: cached.orgId, role: cached.role };
    }

    // Cache miss — validate membership in DB
    const db = getDb();
    const [membership] = await db
      .select({ role: orgMemberships.role })
      .from(orgMemberships)
      .where(
        and(
          eq(orgMemberships.userId, userId),
          eq(orgMemberships.orgId, cookieOrg.orgId),
        ),
      )
      .limit(1);

    if (membership) {
      const role = membership.role as OrgRole;
      membershipCache.set(cacheKey, {
        orgId: cookieOrg.orgId,
        role,
        expiresAt: Date.now() + MEMBERSHIP_CACHE_TTL_MS,
      });
      // Update cookie if role changed
      if (role !== cookieOrg.role) {
        await setActiveOrgCookie(cookieOrg.orgId, role);
      }
      return { userId, orgId: cookieOrg.orgId, role };
    }

    // Cookie org is invalid (user not a member) — fall through to personal org
  }

  // Cold path: no cookie or invalid — ensure personal org
  const { orgId, role } = await ensurePersonalOrg(userId);
  await setActiveOrgCookie(orgId, role);

  const cacheKey = `${userId}:${orgId}`;
  membershipCache.set(cacheKey, {
    orgId,
    role,
    expiresAt: Date.now() + MEMBERSHIP_CACHE_TTL_MS,
  });

  return { userId, orgId, role };
}
