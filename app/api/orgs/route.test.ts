import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveSessionContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { GET, POST } from "./route";

vi.mock("@/lib/auth/session", () => ({
  resolveSessionContext: vi.fn().mockResolvedValue({ userId: "user-1", orgId: "org-1", role: "owner" }),
}));

vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(),
}));

vi.mock("@/lib/observability/sentry", () => ({
  captureExceptionWithContext: vi.fn(),
  addSentryBreadcrumb: vi.fn(),
}));

vi.mock("@/lib/utils/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils/http")>();
  return {
    ...actual,
    readJsonBody: vi.fn(),
  };
});

const mockedResolveSessionContext = vi.mocked(resolveSessionContext);
const mockedGetDb = vi.mocked(getDb);

// ---------------------------------------------------------------------------
// GET /api/orgs
// ---------------------------------------------------------------------------

describe("GET /api/orgs", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns list of user's orgs with roles", async () => {
    mockedResolveSessionContext.mockResolvedValue({ userId: "user-1", orgId: "org-1", role: "owner" });

    const rows = [
      {
        id: "a0000000-0000-4000-a000-000000000001",
        name: "Personal",
        slug: "personal",
        isPersonal: true,
        role: "owner",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      },
      {
        id: "a0000000-0000-4000-a000-000000000002",
        name: "Acme Corp",
        slug: "acme-corp",
        isPersonal: false,
        role: "member",
        createdAt: new Date("2026-02-01T00:00:00Z"),
        updatedAt: new Date("2026-02-15T00:00:00Z"),
      },
    ];

    const mockOrderBy = vi.fn().mockResolvedValue(rows);
    const mockWhere = vi.fn(() => ({ orderBy: mockOrderBy }));
    const mockInnerJoin = vi.fn(() => ({ where: mockWhere }));
    const mockFrom = vi.fn(() => ({ innerJoin: mockInnerJoin }));
    const mockSelect = vi.fn(() => ({ from: mockFrom }));
    mockedGetDb.mockReturnValue({ select: mockSelect } as unknown as ReturnType<typeof getDb>);

    const req = new Request("http://localhost/api/orgs");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(2);

    expect(body.data[0].name).toBe("Personal");
    expect(body.data[0].slug).toBe("personal");
    expect(body.data[0].isPersonal).toBe(true);
    expect(body.data[0].role).toBe("owner");
    expect(body.data[0].id).toBe("ns_org_a0000000-0000-4000-a000-000000000001");
    expect(body.data[0].createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(body.data[0].updatedAt).toBe("2026-01-01T00:00:00.000Z");

    expect(body.data[1].name).toBe("Acme Corp");
    expect(body.data[1].role).toBe("member");
    expect(body.data[1].isPersonal).toBe(false);
  });

  it("returns empty array when user has no orgs", async () => {
    mockedResolveSessionContext.mockResolvedValue({ userId: "user-1", orgId: "org-1", role: "owner" });

    const mockOrderBy = vi.fn().mockResolvedValue([]);
    const mockWhere = vi.fn(() => ({ orderBy: mockOrderBy }));
    const mockInnerJoin = vi.fn(() => ({ where: mockWhere }));
    const mockFrom = vi.fn(() => ({ innerJoin: mockInnerJoin }));
    const mockSelect = vi.fn(() => ({ from: mockFrom }));
    mockedGetDb.mockReturnValue({ select: mockSelect } as unknown as ReturnType<typeof getDb>);

    const req = new Request("http://localhost/api/orgs");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// POST /api/orgs
// ---------------------------------------------------------------------------

describe("POST /api/orgs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function setupTransactionDb(createdOrg: Record<string, unknown>) {
    const mockInsertReturning = vi.fn().mockResolvedValue([createdOrg]);
    const mockInsertValues = vi.fn(() => ({ returning: mockInsertReturning }));

    // The second insert (orgMemberships) has no returning()
    const mockMembershipValues = vi.fn().mockResolvedValue(undefined);

    // First call = organizations insert (has .returning()), second = memberships insert
    let insertCallCount = 0;
    const txInsert = vi.fn(() => {
      insertCallCount++;
      if (insertCallCount === 1) return { values: mockInsertValues };
      return { values: mockMembershipValues };
    });

    const mockTx = { insert: txInsert };

    mockedGetDb.mockReturnValue({
      transaction: vi.fn((cb: (tx: unknown) => Promise<unknown>) => cb(mockTx)),
    } as unknown as ReturnType<typeof getDb>);

    return { txInsert, mockInsertValues, mockMembershipValues };
  }

  it("creates team org and returns it with 201", async () => {
    mockedResolveSessionContext.mockResolvedValue({ userId: "user-1", orgId: "org-1", role: "owner" });

    const { readJsonBody } = await import("@/lib/utils/http");
    vi.mocked(readJsonBody).mockResolvedValue({ name: "My Team", slug: "my-team" });

    const createdOrg = {
      id: "a0000000-0000-4000-a000-000000000010",
      name: "My Team",
      slug: "my-team",
      isPersonal: false,
      createdBy: "user-1",
      createdAt: new Date("2026-03-01T00:00:00Z"),
      updatedAt: new Date("2026-03-01T00:00:00Z"),
    };

    setupTransactionDb(createdOrg);

    const req = new Request("http://localhost/api/orgs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    const res = await POST(req);

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe("ns_org_a0000000-0000-4000-a000-000000000010");
    expect(body.name).toBe("My Team");
    expect(body.slug).toBe("my-team");
    expect(body.isPersonal).toBe(false);
    expect(body.createdAt).toBe("2026-03-01T00:00:00.000Z");
    expect(body.updatedAt).toBe("2026-03-01T00:00:00.000Z");
  });

  it("creates owner membership in same transaction", async () => {
    mockedResolveSessionContext.mockResolvedValue({ userId: "user-1", orgId: "org-1", role: "owner" });

    const { readJsonBody } = await import("@/lib/utils/http");
    vi.mocked(readJsonBody).mockResolvedValue({ name: "Team X", slug: "team-x" });

    const createdOrg = {
      id: "a0000000-0000-4000-a000-000000000020",
      name: "Team X",
      slug: "team-x",
      isPersonal: false,
      createdBy: "user-1",
      createdAt: new Date("2026-03-01T00:00:00Z"),
      updatedAt: new Date("2026-03-01T00:00:00Z"),
    };

    const { txInsert, mockMembershipValues } = setupTransactionDb(createdOrg);

    const req = new Request("http://localhost/api/orgs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    await POST(req);

    // Two insert calls inside the transaction: organizations + orgMemberships
    expect(txInsert).toHaveBeenCalledTimes(2);

    // The second insert (membership) receives the correct owner role values
    expect(mockMembershipValues).toHaveBeenCalledWith({
      orgId: "a0000000-0000-4000-a000-000000000020",
      userId: "user-1",
      role: "owner",
    });
  });

  it("returns 400 for missing name", async () => {
    mockedResolveSessionContext.mockResolvedValue({ userId: "user-1", orgId: "org-1", role: "owner" });

    const { readJsonBody } = await import("@/lib/utils/http");
    vi.mocked(readJsonBody).mockResolvedValue({ slug: "valid-slug" });

    const req = new Request("http://localhost/api/orgs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("validation_error");
  });

  it("returns 400 for invalid slug with spaces", async () => {
    mockedResolveSessionContext.mockResolvedValue({ userId: "user-1", orgId: "org-1", role: "owner" });

    const { readJsonBody } = await import("@/lib/utils/http");
    vi.mocked(readJsonBody).mockResolvedValue({ name: "Test", slug: "has spaces" });

    const req = new Request("http://localhost/api/orgs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("validation_error");
  });

  it("returns 400 for invalid slug with uppercase", async () => {
    mockedResolveSessionContext.mockResolvedValue({ userId: "user-1", orgId: "org-1", role: "owner" });

    const { readJsonBody } = await import("@/lib/utils/http");
    vi.mocked(readJsonBody).mockResolvedValue({ name: "Test", slug: "UpperCase" });

    const req = new Request("http://localhost/api/orgs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("validation_error");
  });

  it("returns 400 for slug that is too short", async () => {
    mockedResolveSessionContext.mockResolvedValue({ userId: "user-1", orgId: "org-1", role: "owner" });

    const { readJsonBody } = await import("@/lib/utils/http");
    vi.mocked(readJsonBody).mockResolvedValue({ name: "Test", slug: "ab" });

    const req = new Request("http://localhost/api/orgs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("validation_error");
  });

  it("returns 409 for duplicate slug (unique constraint violation)", async () => {
    mockedResolveSessionContext.mockResolvedValue({ userId: "user-1", orgId: "org-1", role: "owner" });

    const { readJsonBody } = await import("@/lib/utils/http");
    vi.mocked(readJsonBody).mockResolvedValue({ name: "Dupe Team", slug: "dupe-team" });

    // Simulate Postgres unique constraint violation inside the transaction
    const uniqueViolation = Object.assign(new Error("unique_violation"), { code: "23505" });

    mockedGetDb.mockReturnValue({
      transaction: vi.fn().mockRejectedValue(uniqueViolation),
    } as unknown as ReturnType<typeof getDb>);

    const req = new Request("http://localhost/api/orgs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    const res = await POST(req);

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("conflict");
    expect(body.error.message).toContain("slug");
  });
});
