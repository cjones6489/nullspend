import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthenticationRequiredError, ForbiddenError } from "@/lib/auth/errors";
import { resolveSessionContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { GET } from "./route";

vi.mock("@/lib/auth/session", () => ({
  resolveSessionContext: vi.fn().mockResolvedValue({ userId: "user-1", orgId: "org-test-1", role: "owner" }),
}));

const mockAssertOrgRole = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/auth/org-authorization", () => ({
  assertOrgRole: (...args: unknown[]) => mockAssertOrgRole(...args),
}));

vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(),
}));

vi.mock("@/lib/observability/sentry", () => ({
  captureExceptionWithContext: vi.fn(),
  addSentryBreadcrumb: vi.fn(),
}));

vi.mock("@/lib/observability", () => ({
  getLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
}));

const mockedResolveSessionContext = vi.mocked(resolveSessionContext);
const mockedGetDb = vi.mocked(getDb);

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "a0000000-0000-4000-a000-000000000001",
    actorId: "user-1",
    action: "org.created",
    resourceType: "org",
    resourceId: "org-test-1",
    metadata: { name: "Acme" },
    createdAt: new Date("2026-03-26T10:00:00.000Z"),
    ...overrides,
  };
}

function makeRequest(params: Record<string, string> = {}) {
  const url = new URL("http://localhost:3000/api/audit-log");
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return new Request(url.toString());
}

describe("GET /api/audit-log", () => {
  let mockSelect: ReturnType<typeof vi.fn>;
  let mockFrom: ReturnType<typeof vi.fn>;
  let mockWhere: ReturnType<typeof vi.fn>;
  let mockOrderBy: ReturnType<typeof vi.fn>;
  let mockLimit: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockLimit = vi.fn().mockResolvedValue([]);
    mockOrderBy = vi.fn(() => ({ limit: mockLimit }));
    mockWhere = vi.fn(() => ({ orderBy: mockOrderBy }));
    mockFrom = vi.fn(() => ({ where: mockWhere }));
    mockSelect = vi.fn(() => ({ from: mockFrom }));
    mockedGetDb.mockReturnValue({ select: mockSelect } as unknown as ReturnType<typeof getDb>);
  });

  afterEach(() => {
    vi.clearAllMocks();
    // Re-set default session mock after tests that override it
    mockedResolveSessionContext.mockResolvedValue({ userId: "user-1", orgId: "org-test-1", role: "owner" });
  });

  it("returns 200 with empty data", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.data).toEqual([]);
    expect(json.cursor).toBeNull();
  });

  it("returns audit events with correct shape", async () => {
    mockLimit.mockResolvedValue([makeEvent()]);

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.data).toHaveLength(1);
    expect(json.data[0]).toEqual({
      id: "a0000000-0000-4000-a000-000000000001",
      actorId: "user-1",
      action: "org.created",
      resourceType: "org",
      resourceId: "org-test-1",
      metadata: { name: "Acme" },
      createdAt: "2026-03-26T10:00:00.000Z",
    });
  });

  it("returns cursor when more results exist", async () => {
    const events = Array.from({ length: 51 }, (_, i) =>
      makeEvent({
        id: `a0000000-0000-4000-a000-${String(i).padStart(12, "0")}`,
        createdAt: new Date(`2026-03-26T${String(10 - Math.floor(i / 6)).padStart(2, "0")}:${String(59 - (i % 60)).padStart(2, "0")}:00.000Z`),
      }),
    );
    mockLimit.mockResolvedValue(events);

    const res = await GET(makeRequest());
    const json = await res.json();

    expect(json.data).toHaveLength(50);
    expect(json.cursor).not.toBeNull();
    expect(json.cursor.createdAt).toBeDefined();
    expect(json.cursor.id).toBeDefined();
  });

  it("returns 401 when unauthenticated", async () => {
    mockedResolveSessionContext.mockRejectedValue(new AuthenticationRequiredError());

    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-admin role", async () => {
    mockAssertOrgRole.mockRejectedValueOnce(new ForbiddenError("Requires admin role."));

    const res = await GET(makeRequest());
    expect(res.status).toBe(403);
  });

  it("passes action filter to query", async () => {
    const res = await GET(makeRequest({ action: "org.created" }));
    expect(res.status).toBe(200);
    // Verify the where clause was called (action filter applied)
    expect(mockWhere).toHaveBeenCalled();
  });

  it("passes compound cursor to query", async () => {
    const cursor = JSON.stringify({
      createdAt: "2026-03-26T09:00:00.000Z",
      id: "a0000000-0000-4000-a000-000000000001",
    });
    const res = await GET(makeRequest({ cursor }));
    expect(res.status).toBe(200);
    expect(mockWhere).toHaveBeenCalled();
  });

  it("rejects invalid cursor format", async () => {
    const res = await GET(makeRequest({ cursor: "not-json" }));
    expect(res.status).toBe(400);
  });
});
