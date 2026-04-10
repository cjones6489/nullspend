import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AuthenticationRequiredError,
  SupabaseEnvError,
  UpstreamServiceError,
} from "@/lib/auth/errors";
import {
  _supabaseCircuitForTesting,
  getCurrentUserId,
  resolveApprovalActor,
  resolveSessionUserId,
} from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { setRequestUserId } from "@/lib/observability/request-context";
import { addSentryBreadcrumb } from "@/lib/observability/sentry";

vi.mock("@/lib/auth/supabase", () => ({
  createServerSupabaseClient: vi.fn(),
}));

vi.mock("@/lib/observability/request-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/observability/request-context")>();
  return {
    ...actual,
    setRequestUserId: vi.fn(),
  };
});

vi.mock("@/lib/observability/sentry", () => ({
  addSentryBreadcrumb: vi.fn(),
}));

const mockedCreateServerSupabaseClient = vi.mocked(createServerSupabaseClient);
const mockedSetRequestUserId = vi.mocked(setRequestUserId);
const mockedAddSentryBreadcrumb = vi.mocked(addSentryBreadcrumb);

describe("resolveApprovalActor", () => {
  const originalDevMode = process.env.NULLSPEND_DEV_MODE;
  const originalDevActor = process.env.NULLSPEND_DEV_ACTOR;

  afterEach(() => {
    process.env.NULLSPEND_DEV_MODE = originalDevMode;
    process.env.NULLSPEND_DEV_ACTOR = originalDevActor;
    vi.resetAllMocks();
  });

  it("uses the authenticated Supabase user id when available", async () => {
    mockedCreateServerSupabaseClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-123" } },
          error: null,
        }),
      },
    } as never);

    await expect(resolveApprovalActor()).resolves.toBe("user-123");
  });

  it("uses NULLSPEND_DEV_ACTOR when dev mode is enabled and auth is unavailable", async () => {
    process.env.NULLSPEND_DEV_MODE = "true";
    process.env.NULLSPEND_DEV_ACTOR = "env-dev-actor";
    mockedCreateServerSupabaseClient.mockRejectedValue(
      new SupabaseEnvError("NEXT_PUBLIC_SUPABASE_URL"),
    );

    await expect(resolveApprovalActor()).resolves.toBe("env-dev-actor");
  });

  it("uses NULLSPEND_DEV_ACTOR in dev mode when auth returns no user", async () => {
    process.env.NULLSPEND_DEV_MODE = "true";
    process.env.NULLSPEND_DEV_ACTOR = "env-dev-actor";
    mockedCreateServerSupabaseClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: null,
        }),
      },
    } as never);

    await expect(resolveApprovalActor()).resolves.toBe("env-dev-actor");
  });

  it("throws in dev mode when auth fails and NULLSPEND_DEV_ACTOR is not set", async () => {
    process.env.NULLSPEND_DEV_MODE = "true";
    delete process.env.NULLSPEND_DEV_ACTOR;
    mockedCreateServerSupabaseClient.mockRejectedValue(
      new SupabaseEnvError("NEXT_PUBLIC_SUPABASE_URL"),
    );

    await expect(resolveApprovalActor()).rejects.toBeInstanceOf(SupabaseEnvError);
  });

  it("does NOT use dev fallback when only NODE_ENV=development (requires NULLSPEND_DEV_MODE)", async () => {
    delete process.env.NULLSPEND_DEV_MODE;
    process.env.NULLSPEND_DEV_ACTOR = "env-dev-actor";
    mockedCreateServerSupabaseClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: null,
        }),
      },
    } as never);

    await expect(resolveApprovalActor()).rejects.toBeInstanceOf(
      AuthenticationRequiredError,
    );
  });

  it("uses NULLSPEND_DEV_ACTOR in dev mode when upstream service fails (UpstreamServiceError)", async () => {
    process.env.NULLSPEND_DEV_MODE = "true";
    process.env.NULLSPEND_DEV_ACTOR = "env-dev-actor";
    mockedCreateServerSupabaseClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: {
            name: "AuthRetryableFetchError",
            message: "Failed to fetch",
            status: 0,
            __isAuthError: true,
          },
        }),
      },
    } as never);

    await expect(resolveApprovalActor()).resolves.toBe("env-dev-actor");
  });

  it("requires auth in production even when NULLSPEND_DEV_ACTOR is set", async () => {
    delete process.env.NULLSPEND_DEV_MODE;
    process.env.NULLSPEND_DEV_ACTOR = "env-dev-actor";
    mockedCreateServerSupabaseClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: null,
        }),
      },
    } as never);

    await expect(resolveApprovalActor()).rejects.toBeInstanceOf(
      AuthenticationRequiredError,
    );
  });
});

describe("session auth breadcrumbs", () => {
  const originalDevMode = process.env.NULLSPEND_DEV_MODE;
  const originalDevActor = process.env.NULLSPEND_DEV_ACTOR;

  afterEach(() => {
    process.env.NULLSPEND_DEV_MODE = originalDevMode;
    process.env.NULLSPEND_DEV_ACTOR = originalDevActor;
    vi.resetAllMocks();
  });

  it("sets userId and adds session breadcrumb on real auth", async () => {
    mockedCreateServerSupabaseClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-999" } },
          error: null,
        }),
      },
    } as never);

    await resolveSessionUserId();

    expect(mockedSetRequestUserId).toHaveBeenCalledWith("user-999");
    expect(mockedAddSentryBreadcrumb).toHaveBeenCalledWith(
      "auth", "Session authenticated", { userId: "user-999" },
    );
  });

  it("sets userId and adds dev fallback breadcrumb on fallback", async () => {
    process.env.NULLSPEND_DEV_MODE = "true";
    process.env.NULLSPEND_DEV_ACTOR = "dev-actor-42";
    mockedCreateServerSupabaseClient.mockRejectedValue(
      new SupabaseEnvError("NEXT_PUBLIC_SUPABASE_URL"),
    );

    await resolveSessionUserId();

    expect(mockedSetRequestUserId).toHaveBeenCalledWith("dev-actor-42");
    expect(mockedAddSentryBreadcrumb).toHaveBeenCalledWith(
      "auth", "Dev fallback authenticated", { userId: "dev-actor-42" },
    );
  });

  it("does not set userId or breadcrumb when auth throws non-fallback error", async () => {
    mockedCreateServerSupabaseClient.mockRejectedValue(new Error("network down"));

    await expect(resolveSessionUserId()).rejects.toThrow("network down");

    expect(mockedSetRequestUserId).not.toHaveBeenCalled();
    expect(mockedAddSentryBreadcrumb).not.toHaveBeenCalled();
  });
});

describe("getCurrentUserId circuit breaker classification (Slice 1i)", () => {
  // These tests guard the fix for the circuit breaker bug and its
  // reverse regression (Slice 1i). The correct behavior is:
  //
  //   1. Supabase-js NEVER throws for auth errors — everything comes
  //      back as `{ data: { user: null }, error }`. Verified against
  //      @supabase/auth-js v2.98.0 GoTrueClient._getUser source.
  //
  //   2. The breaker only counts SERVICE failures (network, 5xx,
  //      AuthRetryableFetchError), not CLIENT conditions (missing
  //      session, invalid JWT, 401, 403).
  //
  //   3. Service-class errors are promoted to thrown exceptions INSIDE
  //      the circuit callback (via `isSupabaseServiceFailure`) so the
  //      breaker counts them.
  //
  // These tests use realistic `mockResolvedValue` patterns that match
  // what supabase-js actually returns. The earlier Slice 1g tests used
  // `mockRejectedValue` (synchronous throws), which is inconsistent
  // with the library's documented behavior and would pass vacuously.
  //
  // See:
  //   - lib/auth/session.ts:isSupabaseServiceFailure + getCurrentUserId
  //   - memory/project_finding_supabase_circuit_breaker_sensitivity.md
  //   - @supabase/auth-js dist/module/lib/errors.ts (error class source)
  //   - @supabase/auth-js dist/module/GoTrueClient.js (_getUser catch block)

  // Minimal mocks of the real supabase-js error objects. Supabase sets
  // `name` in each class constructor and includes `status` for all
  // error subclasses. See errors.ts for the full hierarchy.
  const AUTH_SESSION_MISSING = {
    name: "AuthSessionMissingError",
    message: "Auth session missing!",
    status: 400,
    __isAuthError: true,
  };
  const AUTH_API_401 = {
    name: "AuthApiError",
    message: "Invalid JWT",
    status: 401,
    __isAuthError: true,
  };
  const AUTH_API_500 = {
    name: "AuthApiError",
    message: "Internal server error",
    status: 500,
    __isAuthError: true,
  };
  const AUTH_RETRYABLE_FETCH_NETWORK = {
    name: "AuthRetryableFetchError",
    message: "Failed to fetch",
    status: 0, // supabase uses 0 for network-level failures
    __isAuthError: true,
  };
  const AUTH_RETRYABLE_FETCH_502 = {
    name: "AuthRetryableFetchError",
    message: "Bad gateway",
    status: 502,
    __isAuthError: true,
  };

  beforeEach(() => {
    _supabaseCircuitForTesting._resetForTesting();
  });

  afterEach(() => {
    _supabaseCircuitForTesting._resetForTesting();
    vi.resetAllMocks();
  });

  // --- Client-class: breaker should NOT trip ---

  it("does NOT trip on AuthSessionMissingError (no cookie, status 400)", async () => {
    mockedCreateServerSupabaseClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: AUTH_SESSION_MISSING,
        }),
      },
    } as never);

    // Fire 15 calls — well past the 5-failure threshold.
    for (let i = 0; i < 15; i++) {
      await expect(getCurrentUserId()).rejects.toBeInstanceOf(
        AuthenticationRequiredError,
      );
    }
    expect(_supabaseCircuitForTesting.getState()).toBe("CLOSED");
  });

  it("does NOT trip on AuthApiError with status 401 (client auth error)", async () => {
    mockedCreateServerSupabaseClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: AUTH_API_401,
        }),
      },
    } as never);

    for (let i = 0; i < 15; i++) {
      await expect(getCurrentUserId()).rejects.toBeInstanceOf(
        AuthenticationRequiredError,
      );
    }
    expect(_supabaseCircuitForTesting.getState()).toBe("CLOSED");
  });

  it("does NOT trip on happy-path successful auth", async () => {
    mockedCreateServerSupabaseClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-abc" } },
          error: null,
        }),
      },
    } as never);

    for (let i = 0; i < 10; i++) {
      expect(await getCurrentUserId()).toBe("user-abc");
    }
    expect(_supabaseCircuitForTesting.getState()).toBe("CLOSED");
  });

  it("returns null when Supabase reports no user and no error", async () => {
    // Edge case: successful call, no session, no error. Should return
    // null, NOT throw, NOT trip the breaker.
    mockedCreateServerSupabaseClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: null,
        }),
      },
    } as never);

    expect(await getCurrentUserId()).toBeNull();
    expect(_supabaseCircuitForTesting.getState()).toBe("CLOSED");
  });

  // --- Service-class: breaker SHOULD trip ---

  it("DOES trip on AuthRetryableFetchError with status 0 (network down)", async () => {
    // Realistic scenario: supabase-js's internal fetch fails (DNS,
    // TCP reset, connection refused, fetch abort). The library catches
    // it and returns it as `{error: AuthRetryableFetchError}` with
    // status: 0. This matches real @supabase/auth-js behavior.
    mockedCreateServerSupabaseClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: AUTH_RETRYABLE_FETCH_NETWORK,
        }),
      },
    } as never);

    // First 5 calls propagate the error as UpstreamServiceError; the 6th should be CircuitOpenError.
    let upstreamErrorCount = 0;
    let circuitOpenCount = 0;
    for (let i = 0; i < 6; i++) {
      try {
        await getCurrentUserId();
        throw new Error("should have thrown");
      } catch (err) {
        if (err instanceof Error && err.name === "CircuitOpenError") {
          circuitOpenCount++;
        } else if (err instanceof UpstreamServiceError) {
          upstreamErrorCount++;
          // Verify the raw Supabase error is preserved as cause
          expect((err.cause as { name?: string })?.name).toBe("AuthRetryableFetchError");
        } else {
          throw err;
        }
      }
    }
    expect(upstreamErrorCount).toBe(5);
    expect(circuitOpenCount).toBe(1);
    expect(_supabaseCircuitForTesting.getState()).toBe("OPEN");
  });

  it("DOES trip on AuthRetryableFetchError with status 502 (gateway)", async () => {
    mockedCreateServerSupabaseClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: AUTH_RETRYABLE_FETCH_502,
        }),
      },
    } as never);

    // 5 failures → breaker opens. Errors are wrapped in UpstreamServiceError.
    for (let i = 0; i < 5; i++) {
      await expect(getCurrentUserId()).rejects.toBeInstanceOf(UpstreamServiceError);
    }
    expect(_supabaseCircuitForTesting.getState()).toBe("OPEN");
  });

  it("DOES trip on AuthApiError with status 500 (server error)", async () => {
    // AuthApiError with a 5xx status means the Supabase backend returned
    // an HTTP 500-class response. supabase-js catches this and returns
    // it via `{error}` — but it's still a server-side failure that
    // the breaker should treat as a service outage.
    mockedCreateServerSupabaseClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: AUTH_API_500,
        }),
      },
    } as never);

    for (let i = 0; i < 5; i++) {
      const rejection = getCurrentUserId();
      await expect(rejection).rejects.toBeInstanceOf(UpstreamServiceError);
      // Verify the raw error is preserved as cause
      await rejection.catch((err: UpstreamServiceError) => {
        expect((err.cause as { name?: string })?.name).toBe("AuthApiError");
        expect((err.cause as { status?: number })?.status).toBe(500);
      });
    }
    expect(_supabaseCircuitForTesting.getState()).toBe("OPEN");
  });

  // --- Mixed / precedence ---

  it("mixed unauth + service-error calls only count the service errors", async () => {
    const getUserMock = vi.fn();
    mockedCreateServerSupabaseClient.mockResolvedValue({
      auth: { getUser: getUserMock },
    } as never);

    // 3 no-session calls — should NOT count as failures
    for (let i = 0; i < 3; i++) {
      getUserMock.mockResolvedValueOnce({
        data: { user: null },
        error: AUTH_SESSION_MISSING,
      });
      await expect(getCurrentUserId()).rejects.toBeInstanceOf(
        AuthenticationRequiredError,
      );
    }
    expect(_supabaseCircuitForTesting.getState()).toBe("CLOSED");

    // 5 AuthRetryableFetchError — should open on the 5th (wrapped as UpstreamServiceError)
    for (let i = 0; i < 5; i++) {
      getUserMock.mockResolvedValueOnce({
        data: { user: null },
        error: AUTH_RETRYABLE_FETCH_NETWORK,
      });
      await expect(getCurrentUserId()).rejects.toBeInstanceOf(UpstreamServiceError);
    }
    expect(_supabaseCircuitForTesting.getState()).toBe("OPEN");
  });

  // --- Unit test of the classifier itself ---

  it("isSupabaseServiceFailure classifies errors correctly", async () => {
    // Re-exported from the module for direct testing.
    const { isSupabaseServiceFailure } = await import("@/lib/auth/session");

    // Service failures
    expect(isSupabaseServiceFailure(AUTH_RETRYABLE_FETCH_NETWORK)).toBe(true);
    expect(isSupabaseServiceFailure(AUTH_RETRYABLE_FETCH_502)).toBe(true);
    expect(isSupabaseServiceFailure(AUTH_API_500)).toBe(true);
    expect(isSupabaseServiceFailure({ name: "AuthUnknownError", message: "unexpected body" })).toBe(true);
    expect(isSupabaseServiceFailure({ name: "AuthApiError", status: 429, __isAuthError: true })).toBe(true);
    expect(isSupabaseServiceFailure({ name: "Other", status: 503 })).toBe(true);
    expect(isSupabaseServiceFailure({ name: "Other", status: 500 })).toBe(true);

    // Client conditions (not service failures)
    expect(isSupabaseServiceFailure(AUTH_SESSION_MISSING)).toBe(false);
    expect(isSupabaseServiceFailure(AUTH_API_401)).toBe(false);
    expect(isSupabaseServiceFailure({ name: "Other", status: 400 })).toBe(false);
    expect(isSupabaseServiceFailure({ name: "Other", status: 429 })).toBe(false); // 429 only for AuthApiError
    expect(isSupabaseServiceFailure({ name: "Other", status: 499 })).toBe(false);

    // Malformed / unclassifiable inputs default to "not a service failure"
    expect(isSupabaseServiceFailure(null)).toBe(false);
    expect(isSupabaseServiceFailure(undefined)).toBe(false);
    expect(isSupabaseServiceFailure("string error")).toBe(false);
    expect(isSupabaseServiceFailure(42)).toBe(false);
    expect(isSupabaseServiceFailure({})).toBe(false);
    expect(isSupabaseServiceFailure({ name: "Unknown" })).toBe(false);
    expect(isSupabaseServiceFailure({ status: "500" /* string */ })).toBe(false);
  });
});
