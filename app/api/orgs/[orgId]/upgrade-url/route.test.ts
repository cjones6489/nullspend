import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveSessionContext } from "@/lib/auth/session";
import { ForbiddenError } from "@/lib/auth/errors";
import { GET, PATCH } from "./route";

const ORG_UUID_RAW = "00000000-0000-4000-a000-000000000001";
const ORG_ID = `ns_org_${ORG_UUID_RAW}`;

vi.mock("@/lib/auth/session", () => ({
  resolveSessionContext: vi.fn().mockResolvedValue({
    userId: "user-1",
    orgId: "00000000-0000-4000-a000-000000000001",
    role: "owner",
  }),
}));

vi.mock("@/lib/observability/sentry", () => ({
  captureExceptionWithContext: vi.fn(),
}));

const mockAssertOrgMember = vi.fn().mockResolvedValue({ userId: "user-1", orgId: ORG_UUID_RAW, role: "owner" });
const mockAssertOrgRole = vi.fn().mockResolvedValue({ userId: "user-1", orgId: ORG_UUID_RAW, role: "owner" });

vi.mock("@/lib/auth/org-authorization", () => ({
  assertOrgMember: (...args: unknown[]) => mockAssertOrgMember(...args),
  assertOrgRole: (...args: unknown[]) => mockAssertOrgRole(...args),
}));

const mockSelectResult = vi.fn();
const mockUpdateSet = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });

vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(() => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: mockSelectResult,
        }),
      }),
    }),
    update: () => ({
      set: mockUpdateSet,
    }),
  })),
}));

const mockInvalidateProxyCache = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/proxy-invalidate", () => ({
  invalidateProxyCache: (...args: unknown[]) => mockInvalidateProxyCache(...args),
}));

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

/* ------------------------------------------------------------------ */
/*  GET /api/orgs/[orgId]/upgrade-url                                 */
/* ------------------------------------------------------------------ */
describe("GET /api/orgs/[orgId]/upgrade-url", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns the configured upgrade URL for a member", async () => {
    mockSelectResult.mockResolvedValue([
      { metadata: { upgradeUrl: "https://acme.com/upgrade?customer={customer_id}" } },
    ]);

    const req = new Request(`http://localhost/api/orgs/${ORG_ID}/upgrade-url`);
    const res = await GET(req, makeContext(ORG_ID));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.upgradeUrl).toBe("https://acme.com/upgrade?customer={customer_id}");
    expect(mockAssertOrgMember).toHaveBeenCalledWith("user-1", ORG_UUID_RAW);
  });

  it("returns null when metadata has no upgradeUrl key", async () => {
    mockSelectResult.mockResolvedValue([{ metadata: {} }]);

    const req = new Request(`http://localhost/api/orgs/${ORG_ID}/upgrade-url`);
    const res = await GET(req, makeContext(ORG_ID));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.upgradeUrl).toBeNull();
  });

  it("returns null when metadata column is null", async () => {
    mockSelectResult.mockResolvedValue([{ metadata: null }]);

    const req = new Request(`http://localhost/api/orgs/${ORG_ID}/upgrade-url`);
    const res = await GET(req, makeContext(ORG_ID));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.upgradeUrl).toBeNull();
  });

  it("returns null when upgradeUrl value is not a string (defensive type check)", async () => {
    mockSelectResult.mockResolvedValue([{ metadata: { upgradeUrl: 42 } }]);

    const req = new Request(`http://localhost/api/orgs/${ORG_ID}/upgrade-url`);
    const res = await GET(req, makeContext(ORG_ID));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.upgradeUrl).toBeNull();
  });

  it("returns 404 when org does not exist", async () => {
    mockSelectResult.mockResolvedValue([]);

    const req = new Request(`http://localhost/api/orgs/${ORG_ID}/upgrade-url`);
    const res = await GET(req, makeContext(ORG_ID));

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("not_found");
  });

  it("returns 403 for non-member", async () => {
    mockAssertOrgMember.mockRejectedValueOnce(new ForbiddenError("You are not a member of this organization."));

    const req = new Request(`http://localhost/api/orgs/${ORG_ID}/upgrade-url`);
    const res = await GET(req, makeContext(ORG_ID));

    expect(res.status).toBe(403);
  });

  it("returns 401 when session is invalid", async () => {
    const { AuthenticationRequiredError } = await import("@/lib/auth/errors");
    vi.mocked(resolveSessionContext).mockRejectedValueOnce(new AuthenticationRequiredError());

    const req = new Request(`http://localhost/api/orgs/${ORG_ID}/upgrade-url`);
    const res = await GET(req, makeContext(ORG_ID));

    expect(res.status).toBe(401);
  });
});

/* ------------------------------------------------------------------ */
/*  PATCH /api/orgs/[orgId]/upgrade-url                               */
/* ------------------------------------------------------------------ */
describe("PATCH /api/orgs/[orgId]/upgrade-url", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("sets a valid HTTPS URL", async () => {
    vi.mocked(readJsonBody).mockResolvedValue({ upgradeUrl: "https://acme.com/upgrade" });

    const req = new Request(`http://localhost/api/orgs/${ORG_ID}/upgrade-url`, {
      method: "PATCH",
      body: JSON.stringify({ upgradeUrl: "https://acme.com/upgrade" }),
    });
    const res = await PATCH(req, makeContext(ORG_ID));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.upgradeUrl).toBe("https://acme.com/upgrade");
    expect(mockAssertOrgRole).toHaveBeenCalledWith("user-1", ORG_UUID_RAW, "owner");
    expect(mockInvalidateProxyCache).toHaveBeenCalledWith({ action: "auth_only", ownerId: ORG_UUID_RAW });
  });

  it("accepts URLs with {customer_id} placeholder", async () => {
    const url = "https://acme.com/upgrade?customer={customer_id}";
    vi.mocked(readJsonBody).mockResolvedValue({ upgradeUrl: url });

    const req = new Request(`http://localhost/api/orgs/${ORG_ID}/upgrade-url`, { method: "PATCH" });
    const res = await PATCH(req, makeContext(ORG_ID));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.upgradeUrl).toBe(url);
  });

  it("clears the URL when null is passed", async () => {
    vi.mocked(readJsonBody).mockResolvedValue({ upgradeUrl: null });

    const req = new Request(`http://localhost/api/orgs/${ORG_ID}/upgrade-url`, { method: "PATCH" });
    const res = await PATCH(req, makeContext(ORG_ID));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.upgradeUrl).toBeNull();
    expect(mockInvalidateProxyCache).toHaveBeenCalled();
  });

  it("rejects non-HTTPS URLs with 400", async () => {
    vi.mocked(readJsonBody).mockResolvedValue({ upgradeUrl: "http://acme.com/upgrade" });

    const req = new Request(`http://localhost/api/orgs/${ORG_ID}/upgrade-url`, { method: "PATCH" });
    const res = await PATCH(req, makeContext(ORG_ID));

    expect(res.status).toBe(400);
    expect(mockInvalidateProxyCache).not.toHaveBeenCalled();
  });

  it("rejects URLs pointing at localhost", async () => {
    vi.mocked(readJsonBody).mockResolvedValue({ upgradeUrl: "https://localhost:8080/u" });

    const req = new Request(`http://localhost/api/orgs/${ORG_ID}/upgrade-url`, { method: "PATCH" });
    const res = await PATCH(req, makeContext(ORG_ID));

    expect(res.status).toBe(400);
  });

  it("rejects URLs with user-info (SSRF / display-confusable attack)", async () => {
    vi.mocked(readJsonBody).mockResolvedValue({ upgradeUrl: "https://evil.com@good.com/path" });

    const req = new Request(`http://localhost/api/orgs/${ORG_ID}/upgrade-url`, { method: "PATCH" });
    const res = await PATCH(req, makeContext(ORG_ID));

    expect(res.status).toBe(400);
  });

  it("rejects URLs over 2048 chars", async () => {
    const oversized = "https://acme.com/" + "x".repeat(2100);
    vi.mocked(readJsonBody).mockResolvedValue({ upgradeUrl: oversized });

    const req = new Request(`http://localhost/api/orgs/${ORG_ID}/upgrade-url`, { method: "PATCH" });
    const res = await PATCH(req, makeContext(ORG_ID));

    expect(res.status).toBe(400);
  });

  it("rejects non-owner (admin gets 403)", async () => {
    mockAssertOrgRole.mockRejectedValueOnce(new ForbiddenError("Owner role required."));
    vi.mocked(readJsonBody).mockResolvedValue({ upgradeUrl: "https://acme.com/upgrade" });

    const req = new Request(`http://localhost/api/orgs/${ORG_ID}/upgrade-url`, { method: "PATCH" });
    const res = await PATCH(req, makeContext(ORG_ID));

    expect(res.status).toBe(403);
    expect(mockInvalidateProxyCache).not.toHaveBeenCalled();
  });

  it("returns 401 when session is invalid", async () => {
    const { AuthenticationRequiredError } = await import("@/lib/auth/errors");
    vi.mocked(resolveSessionContext).mockRejectedValueOnce(new AuthenticationRequiredError());

    const req = new Request(`http://localhost/api/orgs/${ORG_ID}/upgrade-url`, { method: "PATCH" });
    const res = await PATCH(req, makeContext(ORG_ID));

    expect(res.status).toBe(401);
  });

  it("invalidation failure does not block the PATCH success response", async () => {
    mockInvalidateProxyCache.mockRejectedValueOnce(new Error("proxy unreachable"));
    vi.mocked(readJsonBody).mockResolvedValue({ upgradeUrl: "https://acme.com/upgrade" });

    const req = new Request(`http://localhost/api/orgs/${ORG_ID}/upgrade-url`, { method: "PATCH" });
    const res = await PATCH(req, makeContext(ORG_ID));

    // PATCH still returns 200 — invalidation is fire-and-forget
    expect(res.status).toBe(200);
  });
});
