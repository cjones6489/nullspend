import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";

import {
  AuthenticationRequiredError,
  SupabaseEnvError,
} from "@/lib/auth/errors";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { getDb } from "@/lib/db/client";
import { organizations, orgMemberships } from "@nullspend/db";
import { setRequestUserId } from "@/lib/observability/request-context";
import { addSentryBreadcrumb } from "@/lib/observability/sentry";
import {
  CircuitBreaker,
  CircuitOpenError,
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

export async function getCurrentUserId(): Promise<string | null> {
  // createServerSupabaseClient() may throw SupabaseEnvError (missing env vars).
  // This is a config error that will never self-heal, so it must NOT trip the
  // circuit breaker. Only the actual auth call goes inside the circuit.
  const supabase = await createServerSupabaseClient();

  // We run `supabase.auth.getUser()` inside the circuit breaker to protect
  // against actual Supabase outages (network errors, 5xx responses,
  // timeouts). But `auth.getUser()` NEVER throws on "no session" — it
  // returns `{ data: { user: null }, error: AuthError }` where the error
  // indicates a client-side condition (missing cookie, expired JWT, etc.),
  // NOT a Supabase service failure.
  //
  // Previously we threw `AuthenticationRequiredError` INSIDE the breaker
  // callback. The breaker counted every unauthenticated request as a
  // service failure and opened after 5 consecutive 401s. In production,
  // any scan / crawler / legitimate unauth'd test hit opened the circuit
  // and returned 503 with Retry-After:30 to ALL users on that Vercel
  // instance — including authenticated ones.
  //
  // Fix: return the auth result from the circuit callback as a success
  // (the Supabase SERVICE succeeded — it responded with "no session").
  // Throw `AuthenticationRequiredError` OUTSIDE the breaker so the
  // circuit only counts real service failures.
  //
  // Regression guard: `lib/auth/session.test.ts` includes a test that
  // fires 10+ no-session calls and asserts the circuit stays closed.
  //
  // See: memory/project_finding_supabase_circuit_breaker_sensitivity.md
  const result = await supabaseCircuit.call(async () => {
    return await supabase.auth.getUser();
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
    // Fall back to dev actor for missing Supabase config, auth failures, and circuit breaker open.
    if (
      error instanceof SupabaseEnvError ||
      error instanceof AuthenticationRequiredError ||
      error instanceof CircuitOpenError
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
