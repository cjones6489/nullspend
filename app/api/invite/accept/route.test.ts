import { afterEach, describe, expect, it, vi } from "vitest";

import { setActiveOrgCookie } from "@/lib/auth/session";
import { hashInviteToken } from "@/lib/auth/invitation";
import { getDb } from "@/lib/db/client";
import { POST } from "./route";

vi.mock("@/lib/auth/session", () => ({
  resolveSessionContext: vi.fn().mockResolvedValue({ userId: "user-1", orgId: "personal-org", role: "owner" }),
  setActiveOrgCookie: vi.fn().mockResolvedValue(undefined),
  invalidateMembershipCache: vi.fn(),
}));

vi.mock("@/lib/auth/invitation", () => ({
  hashInviteToken: vi.fn().mockReturnValue("hashed-token-abc"),
}));

// API-3: Mock Supabase auth to return the invited user's email
const mockGetUser = vi.fn().mockResolvedValue({
  data: { user: { id: "user-1", email: "invitee@example.com" } },
  error: null,
});
vi.mock("@/lib/auth/supabase", () => ({
  createServerSupabaseClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
  }),
}));

vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(),
}));

vi.mock("@/lib/observability/sentry", () => ({
  captureExceptionWithContext: vi.fn(),
  addSentryBreadcrumb: vi.fn(),
}));

vi.mock("@/lib/audit/log", () => ({
  logAuditEvent: vi.fn(),
}));

vi.mock("@/lib/utils/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils/http")>();
  return {
    ...actual,
    readJsonBody: vi.fn(),
  };
});

const mockedGetDb = vi.mocked(getDb);
const mockedSetActiveOrgCookie = vi.mocked(setActiveOrgCookie);
const mockedHashInviteToken = vi.mocked(hashInviteToken);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePendingInvitation(overrides: Record<string, unknown> = {}) {
  return {
    id: "inv-1",
    orgId: "org-abc",
    email: "invitee@example.com",
    role: "member",
    status: "pending",
    tokenHash: "hashed-token-abc",
    tokenPrefix: "ns_inv_aabbcc",
    expiresAt: new Date(Date.now() + 86_400_000), // 1 day in the future
    invitedBy: "user-owner",
    acceptedBy: null,
    acceptedAt: null,
    createdAt: new Date("2026-03-20T00:00:00Z"),
    updatedAt: new Date("2026-03-20T00:00:00Z"),
    ...overrides,
  };
}

/**
 * Build a mock DB object supporting the chainable Drizzle patterns
 * used by the route:
 *   1. db.select().from(orgInvitations).where(...).limit(1)  → invitation lookup
 *   2. db.select({...}).from(orgMemberships).where(...).limit(1)  → membership check
 *   3. db.transaction(cb)  — with tx.insert(...).values(...) and tx.update(...).set(...).where(...)
 *   4. db.update(orgInvitations).set(...).where(...)  — expire status write
 */
function setupDb(opts: {
  invitation?: Record<string, unknown> | null;
  existingMembership?: Record<string, unknown> | null;
}) {
  const { invitation = null, existingMembership = null } = opts;

  // Track select() call index — first call is invitation lookup, second is membership check
  let selectCallCount = 0;

  const mockTransaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
    const txUpdateWhere = vi.fn().mockResolvedValue(undefined);
    const txUpdateSet = vi.fn(() => ({ where: txUpdateWhere }));
    const txUpdate = vi.fn(() => ({ set: txUpdateSet }));
    const txInsertValues = vi.fn().mockResolvedValue(undefined);
    const txInsert = vi.fn(() => ({ values: txInsertValues }));

    return cb({ insert: txInsert, update: txUpdate });
  });

  // For the expiry write: db.update(orgInvitations).set({status:"expired"}).where(...)
  const expireUpdateWhere = vi.fn().mockResolvedValue(undefined);
  const expireUpdateSet = vi.fn(() => ({ where: expireUpdateWhere }));
  const expireUpdate = vi.fn(() => ({ set: expireUpdateSet }));

  const mockDb = {
    select: vi.fn(() => {
      selectCallCount++;
      const callIndex = selectCallCount;

      const mockLimit = vi.fn(() => {
        if (callIndex === 1) {
          return Promise.resolve(invitation ? [invitation] : []);
        }
        return Promise.resolve(existingMembership ? [existingMembership] : []);
      });
      const mockWhere = vi.fn(() => ({ limit: mockLimit }));
      const mockFrom = vi.fn(() => ({ where: mockWhere }));
      return { from: mockFrom };
    }),
    update: expireUpdate,
    transaction: mockTransaction,
  };

  mockedGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

  return { mockDb, mockTransaction };
}

function makeRequest(body?: unknown) {
  return new Request("http://localhost/api/invite/accept", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function mockReadJsonBody(value: unknown) {
  const { readJsonBody } = await import("@/lib/utils/http");
  vi.mocked(readJsonBody).mockResolvedValue(value);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/invite/accept", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("accepts valid invitation — creates membership, marks accepted, sets cookie, returns orgId + redirectUrl", async () => {
    await mockReadJsonBody({ token: "ns_inv_raw-token-value" });

    const invitation = makePendingInvitation();
    const { mockTransaction } = setupDb({ invitation, existingMembership: null });

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.orgId).toBe("org-abc");
    expect(body.role).toBe("member");
    expect(body.redirectUrl).toBe("/app");

    // Verify hashInviteToken was called with the raw token
    expect(mockedHashInviteToken).toHaveBeenCalledWith("ns_inv_raw-token-value");

    // Verify transaction was executed (membership insert + invitation update)
    expect(mockTransaction).toHaveBeenCalledTimes(1);

    // Verify setActiveOrgCookie was called with the invitation's orgId and role
    expect(mockedSetActiveOrgCookie).toHaveBeenCalledWith("org-abc", "member");
  });

  it("returns 404 for invalid token (no matching hash)", async () => {
    await mockReadJsonBody({ token: "ns_inv_nonexistent" });
    setupDb({ invitation: null });

    const res = await POST(makeRequest());
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error.code).toBe("not_found");
    expect(body.error.message).toContain("Invalid invitation token");
  });

  it("returns 409 for already-accepted invitation", async () => {
    await mockReadJsonBody({ token: "ns_inv_already-used" });

    const invitation = makePendingInvitation({ status: "accepted" });
    setupDb({ invitation });

    const res = await POST(makeRequest());
    expect(res.status).toBe(409);

    const body = await res.json();
    expect(body.error.code).toBe("conflict");
    expect(body.error.message).toContain("already been accepted");
  });

  it("returns 410 for expired invitation and updates status to expired", async () => {
    await mockReadJsonBody({ token: "ns_inv_expired-token" });

    const invitation = makePendingInvitation({
      expiresAt: new Date(Date.now() - 86_400_000), // 1 day in the past
    });
    const { mockDb } = setupDb({ invitation });

    const res = await POST(makeRequest());
    expect(res.status).toBe(410);

    const body = await res.json();
    expect(body.error.code).toBe("expired");
    expect(body.error.message).toContain("expired");

    // Verify the route updated the invitation status to "expired" in the DB
    expect(mockDb.update).toHaveBeenCalled();
  });

  it("returns 409 when user is already a member of the org", async () => {
    await mockReadJsonBody({ token: "ns_inv_valid-token" });

    const invitation = makePendingInvitation();
    const existingMembership = { id: "mem-existing" };
    setupDb({ invitation, existingMembership });

    const res = await POST(makeRequest());
    expect(res.status).toBe(409);

    const body = await res.json();
    expect(body.error.code).toBe("conflict");
    expect(body.error.message).toContain("already a member");
  });

  it("returns 400 for missing token in request body", async () => {
    await mockReadJsonBody({});

    const res = await POST(makeRequest());
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error.code).toBe("validation_error");
  });

  it("returns 409 for revoked invitation", async () => {
    await mockReadJsonBody({ token: "ns_inv_revoked-token" });

    const invitation = makePendingInvitation({ status: "revoked" });
    setupDb({ invitation });

    const res = await POST(makeRequest());
    expect(res.status).toBe(409);

    const body = await res.json();
    expect(body.error.code).toBe("conflict");
    expect(body.error.message).toContain("already been revoked");
  });

  it("API-3: returns 403 when logged-in user email does not match invitation email", async () => {
    await mockReadJsonBody({ token: "ns_inv_valid-token" });

    // Invitation is for alice@acme.com, but logged-in user is bob@evil.com
    const invitation = makePendingInvitation({ email: "alice@acme.com" });
    setupDb({ invitation });
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: "user-1", email: "bob@evil.com" } },
      error: null,
    });

    const res = await POST(makeRequest());
    expect(res.status).toBe(403);

    const body = await res.json();
    expect(body.error.code).toBe("forbidden");
    expect(body.error.message).toContain("different email address");
  });

  it("API-3: email comparison is case-insensitive", async () => {
    await mockReadJsonBody({ token: "ns_inv_valid-token" });

    const invitation = makePendingInvitation({ email: "Alice@Acme.COM" });
    const { mockTransaction } = setupDb({ invitation, existingMembership: null });
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: "user-1", email: "alice@acme.com" } },
      error: null,
    });

    const res = await POST(makeRequest());
    expect(res.status).toBe(200); // Should succeed — same email, different case
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });

  it("API-3: returns 403 when Supabase returns no user email", async () => {
    await mockReadJsonBody({ token: "ns_inv_valid-token" });

    const invitation = makePendingInvitation();
    setupDb({ invitation });
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: "user-1", email: null } },
      error: null,
    });

    const res = await POST(makeRequest());
    expect(res.status).toBe(403);

    const body = await res.json();
    expect(body.error.code).toBe("forbidden");
  });
});
