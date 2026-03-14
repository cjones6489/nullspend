import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AuthenticationRequiredError,
  SupabaseEnvError,
} from "@/lib/auth/errors";
import { resolveApprovalActor } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/auth/supabase";

vi.mock("@/lib/auth/supabase", () => ({
  createServerSupabaseClient: vi.fn(),
}));

const mockedCreateServerSupabaseClient = vi.mocked(createServerSupabaseClient);

describe("resolveApprovalActor", () => {
  const originalDevMode = process.env.AGENTSEAM_DEV_MODE;
  const originalDevActor = process.env.AGENTSEAM_DEV_ACTOR;

  afterEach(() => {
    process.env.AGENTSEAM_DEV_MODE = originalDevMode;
    process.env.AGENTSEAM_DEV_ACTOR = originalDevActor;
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

  it("uses AGENTSEAM_DEV_ACTOR when dev mode is enabled and auth is unavailable", async () => {
    process.env.AGENTSEAM_DEV_MODE = "true";
    process.env.AGENTSEAM_DEV_ACTOR = "env-dev-actor";
    mockedCreateServerSupabaseClient.mockRejectedValue(
      new SupabaseEnvError("NEXT_PUBLIC_SUPABASE_URL"),
    );

    await expect(resolveApprovalActor()).resolves.toBe("env-dev-actor");
  });

  it("uses AGENTSEAM_DEV_ACTOR in dev mode when auth returns no user", async () => {
    process.env.AGENTSEAM_DEV_MODE = "true";
    process.env.AGENTSEAM_DEV_ACTOR = "env-dev-actor";
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

  it("throws in dev mode when auth fails and AGENTSEAM_DEV_ACTOR is not set", async () => {
    process.env.AGENTSEAM_DEV_MODE = "true";
    delete process.env.AGENTSEAM_DEV_ACTOR;
    mockedCreateServerSupabaseClient.mockRejectedValue(
      new SupabaseEnvError("NEXT_PUBLIC_SUPABASE_URL"),
    );

    await expect(resolveApprovalActor()).rejects.toBeInstanceOf(SupabaseEnvError);
  });

  it("does NOT use dev fallback when only NODE_ENV=development (requires AGENTSEAM_DEV_MODE)", async () => {
    delete process.env.AGENTSEAM_DEV_MODE;
    process.env.AGENTSEAM_DEV_ACTOR = "env-dev-actor";
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

  it("requires auth in production even when AGENTSEAM_DEV_ACTOR is set", async () => {
    delete process.env.AGENTSEAM_DEV_MODE;
    process.env.AGENTSEAM_DEV_ACTOR = "env-dev-actor";
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
