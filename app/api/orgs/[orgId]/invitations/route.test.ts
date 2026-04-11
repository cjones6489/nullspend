import { afterEach, describe, expect, it, vi } from "vitest";

import { ForbiddenError } from "@/lib/auth/errors";
import { LimitExceededError } from "@/lib/utils/http";
import { GET, POST } from "./route";

const ORG_UUID = "00000000-0000-4000-a000-000000000001";
const ORG_ID = `ns_org_${ORG_UUID}`;

vi.mock("@/lib/auth/session", () => ({
  resolveSessionContext: vi.fn().mockResolvedValue({ userId: "user-1", orgId: "org-test-1", role: "owner" }),
}));

vi.mock("@/lib/observability/sentry", () => ({
  captureExceptionWithContext: vi.fn(),
}));

vi.mock("@/lib/audit/log", () => ({
  logAuditEvent: vi.fn(),
}));

const mockAssertOrgRole = vi.fn().mockResolvedValue({ userId: "user-1", orgId: ORG_UUID, role: "admin" });

vi.mock("@/lib/auth/org-authorization", () => ({
  assertOrgMember: vi.fn(),
  assertOrgRole: (...args: unknown[]) => mockAssertOrgRole(...args),
}));

/* ---- DB mock ---- */
/**
 * Each call to db.select().from().where() pops the next entry from selectQueue.
 * Each entry is { rows, limitRows? }:
 *   - `rows` is returned when the chain is directly awaited (no .limit()).
 *   - `limitRows` is returned when .limit() is chained before awaiting.
 */
interface QueueEntry { rows: unknown[]; limitRows?: unknown[] }
let selectQueue: QueueEntry[] = [];
const mockInsertReturning = vi.fn();

function pushSelects(...entries: QueueEntry[]) {
  selectQueue.push(...entries);
}

vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(() => ({
    select: () => ({
      from: () => ({
        where: () => {
          const entry = selectQueue.shift() ?? { rows: [] };
          // Return a thenable object with an optional .limit() method.
          // When awaited directly, resolves to entry.rows.
          // When .limit() is called first, that returns a promise of entry.limitRows.
          return {
            then(resolve: (v: unknown) => void, reject?: (e: unknown) => void) {
              return Promise.resolve(entry.rows).then(resolve, reject);
            },
            limit: () => Promise.resolve(entry.limitRows ?? entry.rows),
          };
        },
      }),
    }),
    insert: () => ({
      values: () => ({
        returning: mockInsertReturning,
      }),
    }),
  })),
}));

/* ---- Supabase mock (ISSUE-014: self-invite prevention) ---- */
const mockGetUser = vi.fn().mockResolvedValue({
  data: { user: { id: "user-1", email: "admin@org.com" } },
  error: null,
});
vi.mock("@/lib/auth/supabase", () => ({
  createServerSupabaseClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
  }),
}));

/* ---- Invitation token helpers ---- */
const mockGenerateInviteToken = vi.fn().mockReturnValue("tok_raw_abc123");
const mockHashInviteToken = vi.fn().mockReturnValue("sha256_hashed");
const mockExtractTokenPrefix = vi.fn().mockReturnValue("tok_raw_");

vi.mock("@/lib/auth/invitation", () => ({
  generateInviteToken: (...args: unknown[]) => mockGenerateInviteToken(...args),
  hashInviteToken: (...args: unknown[]) => mockHashInviteToken(...args),
  extractTokenPrefix: (...args: unknown[]) => mockExtractTokenPrefix(...args),
}));

/* ---- Feature gate ---- */
const mockResolveOrgTier = vi.fn().mockResolvedValue({ tier: "free", label: "Free" });
const mockAssertCountBelowLimit = vi.fn();

vi.mock("@/lib/stripe/feature-gate", () => ({
  resolveOrgTier: (...args: unknown[]) => mockResolveOrgTier(...args),
  assertCountBelowLimit: (...args: unknown[]) => mockAssertCountBelowLimit(...args),
}));

/* ---- HTTP helpers ---- */
vi.mock("@/lib/utils/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils/http")>();
  return {
    ...actual,
    readJsonBody: vi.fn(),
    readRouteParams: vi.fn(async (p: unknown) => p),
  };
});

import { readJsonBody } from "@/lib/utils/http";

function makeContext(orgId: string) {
  return { params: Promise.resolve({ orgId }) };
}

const NOW = new Date("2026-01-15T00:00:00Z");
const EXPIRES = new Date("2026-01-22T00:00:00Z");

const SAMPLE_INVITATION = {
  id: "aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee",
  email: "alice@example.com",
  role: "member" as const,
  status: "pending" as const,
  invitedBy: "user-1",
  tokenPrefix: "tok_raw_",
  tokenHash: "sha256_hashed",
  expiresAt: EXPIRES,
  createdAt: NOW,
};

/* ================================================================== */
/*  GET /api/orgs/[orgId]/invitations                                  */
/* ================================================================== */
describe("GET /api/orgs/[orgId]/invitations", () => {
  afterEach(() => {
    vi.clearAllMocks();
    selectQueue = [];
  });

  it("returns pending invitations for admin — 200", async () => {
    pushSelects({ rows: [SAMPLE_INVITATION] });

    const req = new Request("http://localhost/api/orgs/" + ORG_ID + "/invitations");
    const res = await GET(req, makeContext(ORG_ID));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe(SAMPLE_INVITATION.id);
    expect(body.data[0].email).toBe("alice@example.com");
    expect(body.data[0].role).toBe("member");
    expect(body.data[0].status).toBe("pending");
    expect(body.data[0].invitedBy).toBe("user-1");
    expect(body.data[0].tokenPrefix).toBe("tok_raw_");
    expect(mockAssertOrgRole).toHaveBeenCalledWith("user-1", ORG_UUID, "admin");
  });

  it("returns 403 for non-admin (member/viewer)", async () => {
    mockAssertOrgRole.mockRejectedValueOnce(new ForbiddenError("This action requires the admin role or higher."));

    const req = new Request("http://localhost/api/orgs/" + ORG_ID + "/invitations");
    const res = await GET(req, makeContext(ORG_ID));

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("forbidden");
  });
});

/* ================================================================== */
/*  POST /api/orgs/[orgId]/invitations                                 */
/* ================================================================== */
describe("POST /api/orgs/[orgId]/invitations", () => {
  afterEach(() => {
    vi.clearAllMocks();
    selectQueue = [];
  });

  /**
   * Helper: configure the DB mock chain for a successful POST.
   *
   * POST does three selects in order:
   *   1. duplicate check (limit) → .where().limit()   → [] (no existing invite)
   *   2. member count            → .where()           → [{ value: 1 }]
   *   3. pending invite count    → .where()           → [{ value: 0 }]
   * Then one insert → .returning() → [invitation]
   */
  function setupSuccessfulPost() {
    pushSelects(
      { rows: [], limitRows: [] },         // 1. duplicate check (no match)
      { rows: [{ value: 1 }] },           // 2. member count
      { rows: [{ value: 0 }] },           // 3. pending invite count
    );
    mockInsertReturning.mockResolvedValue([SAMPLE_INVITATION]);
  }

  it("creates invitation and returns it with 201 — token included", async () => {
    vi.mocked(readJsonBody).mockResolvedValue({ email: "alice@example.com", role: "member" });
    setupSuccessfulPost();

    const req = new Request("http://localhost/api/orgs/" + ORG_ID + "/invitations", { method: "POST" });
    const res = await POST(req, makeContext(ORG_ID));

    expect(res.status).toBe(201);
    const body = await res.json();

    // invitationRecordSchema fields
    expect(body.data.id).toBe(SAMPLE_INVITATION.id);
    expect(body.data.email).toBe("alice@example.com");
    expect(body.data.role).toBe("member");
    expect(body.data.status).toBe("pending");
    expect(body.data.invitedBy).toBe("user-1");
    expect(body.data.tokenPrefix).toBe("tok_raw_");

    // Raw token is included only in create response
    expect(body.data.token).toBe("tok_raw_abc123");

    expect(mockAssertOrgRole).toHaveBeenCalledWith("user-1", ORG_UUID, "admin");
    expect(mockGenerateInviteToken).toHaveBeenCalled();
    expect(mockHashInviteToken).toHaveBeenCalledWith("tok_raw_abc123");
    expect(mockExtractTokenPrefix).toHaveBeenCalledWith("tok_raw_abc123");
  });

  it("returns 400 for invalid email", async () => {
    vi.mocked(readJsonBody).mockResolvedValue({ email: "not-an-email", role: "member" });

    const req = new Request("http://localhost/api/orgs/" + ORG_ID + "/invitations", { method: "POST" });
    const res = await POST(req, makeContext(ORG_ID));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("validation_error");
  });

  it("returns 400 for invalid role", async () => {
    vi.mocked(readJsonBody).mockResolvedValue({ email: "alice@example.com", role: "owner" });

    const req = new Request("http://localhost/api/orgs/" + ORG_ID + "/invitations", { method: "POST" });
    const res = await POST(req, makeContext(ORG_ID));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("validation_error");
  });

  it("returns 409 for duplicate pending invitation (application-level check)", async () => {
    vi.mocked(readJsonBody).mockResolvedValue({ email: "alice@example.com", role: "member" });
    pushSelects(
      // Duplicate check finds existing invitation
      { rows: [{ id: "existing-invite-id" }], limitRows: [{ id: "existing-invite-id" }] },
    );

    const req = new Request("http://localhost/api/orgs/" + ORG_ID + "/invitations", { method: "POST" });
    const res = await POST(req, makeContext(ORG_ID));

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("conflict");
    expect(body.error.message).toContain("pending invitation already exists");
    // Insert should NOT have been called — caught before insert
    expect(mockInsertReturning).not.toHaveBeenCalled();
  });

  it("returns 409 for duplicate pending invitation (DB constraint fallback)", async () => {
    vi.mocked(readJsonBody).mockResolvedValue({ email: "alice@example.com", role: "member" });
    pushSelects(
      { rows: [], limitRows: [] },         // duplicate check passes (race condition)
      { rows: [{ value: 1 }] },           // member count
      { rows: [{ value: 0 }] },           // pending invite count
    );

    // Insert throws a Postgres unique-constraint error (race: invite created between check and insert)
    const pgError = Object.assign(new Error("duplicate key"), { code: "23505" });
    mockInsertReturning.mockRejectedValueOnce(pgError);

    const req = new Request("http://localhost/api/orgs/" + ORG_ID + "/invitations", { method: "POST" });
    const res = await POST(req, makeContext(ORG_ID));

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("conflict");
    expect(body.error.message).toContain("pending invitation already exists");
  });

  it("returns 409 (limit_exceeded) when maxTeamMembers reached", async () => {
    vi.mocked(readJsonBody).mockResolvedValue({ email: "alice@example.com", role: "member" });

    pushSelects(
      { rows: [], limitRows: [] },         // duplicate check (no match)
      { rows: [{ value: 3 }] },           // member count (at limit)
      { rows: [{ value: 0 }] },           // pending invite count
    );

    // assertCountBelowLimit throws LimitExceededError
    mockAssertCountBelowLimit.mockImplementation(() => {
      throw new LimitExceededError("Maximum of 3 team members allowed on the Free plan. Upgrade for more.");
    });

    const req = new Request("http://localhost/api/orgs/" + ORG_ID + "/invitations", { method: "POST" });
    const res = await POST(req, makeContext(ORG_ID));

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("limit_exceeded");
    expect(body.error.message).toContain("Maximum of 3 team members");
  });

  it("viewer role invites bypass seat limit check", async () => {
    vi.mocked(readJsonBody).mockResolvedValue({ email: "viewer@example.com", role: "viewer" });

    // For viewer: duplicate check then straight to insert (no count queries).
    pushSelects(
      { rows: [], limitRows: [] },         // duplicate check (no match)
    );
    mockInsertReturning.mockResolvedValue([{ ...SAMPLE_INVITATION, email: "viewer@example.com", role: "viewer" }]);

    const req = new Request("http://localhost/api/orgs/" + ORG_ID + "/invitations", { method: "POST" });
    const res = await POST(req, makeContext(ORG_ID));

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.role).toBe("viewer");

    // The key assertion: seat limit helpers should NOT have been called
    expect(mockResolveOrgTier).not.toHaveBeenCalled();
    expect(mockAssertCountBelowLimit).not.toHaveBeenCalled();
  });

  it("ISSUE-014: returns 400 when inviting yourself", async () => {
    vi.mocked(readJsonBody).mockResolvedValue({ email: "admin@org.com", role: "member" });
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: "user-1", email: "admin@org.com" } },
      error: null,
    });

    const req = new Request("http://localhost/api/orgs/" + ORG_ID + "/invitations", { method: "POST" });
    const res = await POST(req, makeContext(ORG_ID));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("validation_error");
    expect(body.error.message).toContain("cannot invite yourself");
    // Should not reach DB at all
    expect(mockInsertReturning).not.toHaveBeenCalled();
  });

  it("ISSUE-014: self-invite check is case-insensitive", async () => {
    vi.mocked(readJsonBody).mockResolvedValue({ email: "Admin@ORG.com", role: "member" });
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: "user-1", email: "admin@org.com" } },
      error: null,
    });

    const req = new Request("http://localhost/api/orgs/" + ORG_ID + "/invitations", { method: "POST" });
    const res = await POST(req, makeContext(ORG_ID));

    expect(res.status).toBe(400);
    expect(mockInsertReturning).not.toHaveBeenCalled();
  });
});
