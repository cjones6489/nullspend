import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AuthenticationRequiredError,
  SupabaseEnvError,
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

describe("getCurrentUserId circuit breaker sensitivity (Slice 1g regression)", () => {
  // These tests guard against reintroducing the bug where the Supabase
  // auth circuit breaker counted `AuthenticationRequiredError` as a
  // service failure. The old behavior: 5 consecutive unauthenticated
  // requests would open the circuit, then every subsequent request
  // (including authenticated ones) returned 503 for 30s.
  //
  // The fix: `AuthenticationRequiredError` is thrown OUTSIDE the breaker
  // callback. The breaker only sees Supabase responses — success (user
  // OR null user) or actual service errors (network, 5xx, timeout).
  //
  // See:
  //   - lib/auth/session.ts:getCurrentUserId
  //   - memory/project_finding_supabase_circuit_breaker_sensitivity.md

  beforeEach(() => {
    _supabaseCircuitForTesting._resetForTesting();
  });

  afterEach(() => {
    _supabaseCircuitForTesting._resetForTesting();
    vi.resetAllMocks();
  });

  it("does NOT trip the circuit on repeated no-session responses", async () => {
    // Simulate a browser that never attached a session cookie: Supabase
    // returns `{ data: { user: null }, error: AuthError("Auth session missing!") }`
    // on every call. Under the OLD behavior, this would open the circuit
    // after 5 consecutive calls. Under the fix, the circuit stays CLOSED
    // because the breaker sees these as successful service responses.
    const authError = { message: "Auth session missing!", name: "AuthSessionMissingError" };
    mockedCreateServerSupabaseClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: authError,
        }),
      },
    } as never);

    // Fire 15 calls — well past the 5-failure threshold.
    const N = 15;
    let authRequiredCount = 0;
    for (let i = 0; i < N; i++) {
      try {
        await getCurrentUserId();
      } catch (err) {
        if (err instanceof AuthenticationRequiredError) {
          authRequiredCount++;
        } else {
          throw err;
        }
      }
    }

    // All 15 calls should have thrown AuthenticationRequiredError...
    expect(authRequiredCount).toBe(N);
    // ...but the circuit breaker must still be CLOSED (not OPEN).
    expect(_supabaseCircuitForTesting.getState()).toBe("CLOSED");
  });

  it("does NOT trip the circuit when Supabase returns a valid user (obvious success)", async () => {
    mockedCreateServerSupabaseClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-abc" } },
          error: null,
        }),
      },
    } as never);

    for (let i = 0; i < 10; i++) {
      const userId = await getCurrentUserId();
      expect(userId).toBe("user-abc");
    }
    expect(_supabaseCircuitForTesting.getState()).toBe("CLOSED");
  });

  it("DOES trip the circuit on repeated Supabase service errors (network down)", async () => {
    // The breaker MUST still protect against real service outages.
    // Simulate Supabase throwing (network error, timeout, 5xx from
    // auth.getUser's underlying HTTP call).
    mockedCreateServerSupabaseClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockRejectedValue(new Error("ECONNREFUSED supabase.co")),
      },
    } as never);

    // Fire 6 calls — one past the 5-failure threshold.
    let networkFailures = 0;
    let circuitOpenFailures = 0;
    for (let i = 0; i < 6; i++) {
      try {
        await getCurrentUserId();
      } catch (err) {
        if (err instanceof Error && err.message.includes("ECONNREFUSED")) {
          networkFailures++;
        } else if (err instanceof Error && err.name === "CircuitOpenError") {
          circuitOpenFailures++;
        } else {
          throw err;
        }
      }
    }

    // First 5 calls should be network failures; the 6th should be
    // CircuitOpenError because the breaker opened after call 5.
    expect(networkFailures).toBe(5);
    expect(circuitOpenFailures).toBe(1);
    expect(_supabaseCircuitForTesting.getState()).toBe("OPEN");
  });

  it("returns null when auth succeeds with no user (not an error, not a trip)", async () => {
    // This is the "no cookie + no error" edge case — Supabase successfully
    // confirmed there's no session. Should return null, NOT throw, and
    // NOT count against the circuit.
    mockedCreateServerSupabaseClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: null,
        }),
      },
    } as never);

    const userId = await getCurrentUserId();
    expect(userId).toBeNull();
    expect(_supabaseCircuitForTesting.getState()).toBe("CLOSED");
  });

  it("mixed unauth + service-error calls only count the service errors", async () => {
    // Alternating pattern: 3 no-session responses, then 5 network failures.
    // The no-session responses must NOT count toward the breaker's
    // failure counter, but the network failures should open it after 5.
    const getUserMock = vi.fn();
    const supabaseClient = { auth: { getUser: getUserMock } };
    mockedCreateServerSupabaseClient.mockResolvedValue(supabaseClient as never);

    // 3 no-session (should NOT count as breaker failures)
    for (let i = 0; i < 3; i++) {
      getUserMock.mockResolvedValueOnce({
        data: { user: null },
        error: { message: "Auth session missing!", name: "AuthSessionMissingError" },
      });
      await expect(getCurrentUserId()).rejects.toBeInstanceOf(
        AuthenticationRequiredError,
      );
    }

    expect(_supabaseCircuitForTesting.getState()).toBe("CLOSED");

    // 5 network failures (should trip the breaker on the 5th)
    for (let i = 0; i < 5; i++) {
      getUserMock.mockRejectedValueOnce(new Error("ECONNREFUSED supabase.co"));
      await expect(getCurrentUserId()).rejects.toThrow("ECONNREFUSED");
    }

    expect(_supabaseCircuitForTesting.getState()).toBe("OPEN");
  });
});
