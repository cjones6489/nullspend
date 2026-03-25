import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mocks (must be before imports) ---

const mockInsertReturning = vi.fn();
const mockInsertValues = vi.fn(() => ({ returning: mockInsertReturning }));
const mockInsert = vi.fn(() => ({ values: mockInsertValues }));
const mockSelectLimit = vi.fn();
const mockSelectWhere = vi.fn(() => ({ limit: mockSelectLimit }));
const mockSelectJoinWhere = vi.fn(() => ({ limit: mockSelectLimit }));
const mockSelectJoin = vi.fn(() => ({ where: mockSelectJoinWhere }));
const mockSelectFrom = vi.fn(() => ({ where: mockSelectWhere, innerJoin: mockSelectJoin }));
const mockSelect = vi.fn(() => ({ from: mockSelectFrom }));

vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(() => ({
    insert: mockInsert,
    select: mockSelect,
  })),
}));

vi.mock("@/lib/auth/supabase", () => ({
  createServerSupabaseClient: vi.fn().mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: "user-test-123" } },
        error: null,
      }),
    },
  }),
}));

vi.mock("@/lib/observability/request-context", () => ({
  setRequestUserId: vi.fn(),
}));

vi.mock("@/lib/observability/sentry", () => ({
  addSentryBreadcrumb: vi.fn(),
  captureExceptionWithContext: vi.fn(),
}));

const mockCookieGet = vi.fn();
const mockCookieSet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    get: (...args: unknown[]) => mockCookieGet(...args),
    set: (...args: unknown[]) => mockCookieSet(...args),
  }),
}));

// --- Import after mocks ---
import { resolveSessionContext, setActiveOrgCookie } from "./session";

describe("resolveSessionContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns orgId and role from cookie on hot path (no DB hit for org)", async () => {
    mockCookieGet.mockReturnValue({ value: "org-uuid-123:owner" });

    // Membership validation — cache miss, hits DB
    mockSelectLimit.mockResolvedValueOnce([{ role: "owner" }]);

    const ctx = await resolveSessionContext();

    expect(ctx.userId).toBe("user-test-123");
    expect(ctx.orgId).toBe("org-uuid-123");
    expect(ctx.role).toBe("owner");
  });

  it("creates personal org when no cookie exists", async () => {
    mockCookieGet.mockReturnValue(undefined); // no cookie

    // ensurePersonalOrg: INSERT org succeeds
    mockInsertReturning.mockResolvedValueOnce([{ id: "new-org-uuid" }]);
    // ensurePersonalOrg: INSERT membership succeeds
    mockInsertValues.mockReturnValueOnce({ returning: mockInsertReturning });

    const ctx = await resolveSessionContext();

    expect(ctx.userId).toBe("user-test-123");
    expect(ctx.orgId).toBe("new-org-uuid");
    expect(ctx.role).toBe("owner");
    // Cookie should be set
    expect(mockCookieSet).toHaveBeenCalledWith(
      "ns-active-org",
      "new-org-uuid:owner",
      expect.objectContaining({ httpOnly: true, path: "/app" }),
    );
  });

  it("handles race condition — INSERT fails, re-queries existing org", async () => {
    mockCookieGet.mockReturnValue(undefined); // no cookie

    // ensurePersonalOrg: INSERT org fails with unique violation
    mockInsertReturning.mockRejectedValueOnce(new Error("unique_violation"));

    // Re-query: find existing personal org
    mockSelectLimit.mockResolvedValueOnce([{ orgId: "existing-org-uuid", role: "owner" }]);

    const ctx = await resolveSessionContext();

    expect(ctx.orgId).toBe("existing-org-uuid");
    expect(ctx.role).toBe("owner");
  });

  it("falls back to personal org when cookie org membership is invalid", async () => {
    mockCookieGet.mockReturnValue({ value: "invalid-org:admin" });

    // Membership validation — user is NOT a member of this org
    mockSelectLimit.mockResolvedValueOnce([]);

    // ensurePersonalOrg: INSERT succeeds
    mockInsertReturning.mockResolvedValueOnce([{ id: "personal-org-uuid" }]);
    mockInsertValues.mockReturnValueOnce({ returning: mockInsertReturning });

    const ctx = await resolveSessionContext();

    expect(ctx.orgId).toBe("personal-org-uuid");
    expect(ctx.role).toBe("owner");
  });

  it("ignores malformed cookie values", async () => {
    mockCookieGet.mockReturnValue({ value: "no-colon-here" });

    // Falls through to ensurePersonalOrg
    mockInsertReturning.mockResolvedValueOnce([{ id: "fallback-org" }]);
    mockInsertValues.mockReturnValueOnce({ returning: mockInsertReturning });

    const ctx = await resolveSessionContext();

    expect(ctx.orgId).toBe("fallback-org");
  });
});

describe("setActiveOrgCookie", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets httpOnly cookie with orgId:role format", async () => {
    await setActiveOrgCookie("org-123", "admin");

    expect(mockCookieSet).toHaveBeenCalledWith(
      "ns-active-org",
      "org-123:admin",
      expect.objectContaining({
        httpOnly: true,
        sameSite: "lax",
        path: "/app",
      }),
    );
  });
});
