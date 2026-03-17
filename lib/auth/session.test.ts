import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AuthenticationRequiredError,
  SupabaseEnvError,
} from "@/lib/auth/errors";
import { resolveApprovalActor, resolveSessionUserId } from "@/lib/auth/session";
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
