import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveSessionContext } from "@/lib/auth/session";
import { ForbiddenError } from "@/lib/auth/errors";
import { GET, PATCH } from "./route";

const ORG_UUID_RAW = "00000000-0000-4000-a000-000000000001";
const CUSTOMER_ID = "acme-corp";

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

const mockSelectLimit = vi.fn();
const mockOnConflictDoUpdate = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(() => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: mockSelectLimit,
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: mockOnConflictDoUpdate,
      }),
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

function makeContext(orgId: string, customerId: string) {
  return { params: Promise.resolve({ orgId, customerId }) };
}

/* ------------------------------------------------------------------ */
/*  GET /api/orgs/[orgId]/customers/[customerId]/upgrade-url          */
/* ------------------------------------------------------------------ */
describe("GET /api/orgs/[orgId]/customers/[customerId]/upgrade-url", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns the configured URL when a customer_settings row exists", async () => {
    mockSelectLimit.mockResolvedValue([{ upgradeUrl: "https://acme.com/customer-upgrade" }]);

    const req = new Request(`http://localhost/api/orgs/${ORG_UUID_RAW}/customers/${CUSTOMER_ID}/upgrade-url`);
    const res = await GET(req, makeContext(ORG_UUID_RAW, CUSTOMER_ID));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.customerId).toBe(CUSTOMER_ID);
    expect(body.data.upgradeUrl).toBe("https://acme.com/customer-upgrade");
  });

  it("returns null when no row exists for the customer", async () => {
    mockSelectLimit.mockResolvedValue([]);

    const req = new Request(`http://localhost/api/orgs/${ORG_UUID_RAW}/customers/${CUSTOMER_ID}/upgrade-url`);
    const res = await GET(req, makeContext(ORG_UUID_RAW, CUSTOMER_ID));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.upgradeUrl).toBeNull();
  });

  it("returns null when row exists but upgrade_url column is null", async () => {
    mockSelectLimit.mockResolvedValue([{ upgradeUrl: null }]);

    const req = new Request(`http://localhost/api/orgs/${ORG_UUID_RAW}/customers/${CUSTOMER_ID}/upgrade-url`);
    const res = await GET(req, makeContext(ORG_UUID_RAW, CUSTOMER_ID));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.upgradeUrl).toBeNull();
  });

  it("rejects non-member (403)", async () => {
    mockAssertOrgMember.mockRejectedValueOnce(new ForbiddenError("Not a member"));

    const req = new Request(`http://localhost/api/orgs/${ORG_UUID_RAW}/customers/${CUSTOMER_ID}/upgrade-url`);
    const res = await GET(req, makeContext(ORG_UUID_RAW, CUSTOMER_ID));

    expect(res.status).toBe(403);
  });

  it("rejects invalid orgId param (non-UUID)", async () => {
    const req = new Request(`http://localhost/api/orgs/not-a-uuid/customers/${CUSTOMER_ID}/upgrade-url`);
    const res = await GET(req, makeContext("not-a-uuid", CUSTOMER_ID));

    expect(res.status).toBe(400);
  });

  it("rejects customerId over 256 chars", async () => {
    const longCustomerId = "x".repeat(300);
    const req = new Request(`http://localhost/api/orgs/${ORG_UUID_RAW}/customers/${longCustomerId}/upgrade-url`);
    const res = await GET(req, makeContext(ORG_UUID_RAW, longCustomerId));

    expect(res.status).toBe(400);
  });
});

/* ------------------------------------------------------------------ */
/*  PATCH /api/orgs/[orgId]/customers/[customerId]/upgrade-url        */
/* ------------------------------------------------------------------ */
describe("PATCH /api/orgs/[orgId]/customers/[customerId]/upgrade-url", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("upserts a valid URL for a customer that has no existing row", async () => {
    vi.mocked(readJsonBody).mockResolvedValue({ upgradeUrl: "https://acme.com/c/billing" });

    const req = new Request(`http://localhost/api/orgs/${ORG_UUID_RAW}/customers/${CUSTOMER_ID}/upgrade-url`, {
      method: "PATCH",
    });
    const res = await PATCH(req, makeContext(ORG_UUID_RAW, CUSTOMER_ID));

    // No 404 here — the old route returned 404 if no customer_mappings row existed.
    // The new route upserts via customer_settings, so first write always succeeds.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.customerId).toBe(CUSTOMER_ID);
    expect(body.data.upgradeUrl).toBe("https://acme.com/c/billing");
    expect(mockOnConflictDoUpdate).toHaveBeenCalled();
    expect(mockInvalidateProxyCache).toHaveBeenCalledWith({ action: "auth_only", ownerId: ORG_UUID_RAW });
  });

  it("clears the URL when null is passed", async () => {
    vi.mocked(readJsonBody).mockResolvedValue({ upgradeUrl: null });

    const req = new Request(`http://localhost/api/orgs/${ORG_UUID_RAW}/customers/${CUSTOMER_ID}/upgrade-url`, {
      method: "PATCH",
    });
    const res = await PATCH(req, makeContext(ORG_UUID_RAW, CUSTOMER_ID));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.upgradeUrl).toBeNull();
  });

  it("accepts URLs with {customer_id} placeholder", async () => {
    const url = "https://acme.com/c/{customer_id}/billing";
    vi.mocked(readJsonBody).mockResolvedValue({ upgradeUrl: url });

    const req = new Request(`http://localhost/api/orgs/${ORG_UUID_RAW}/customers/${CUSTOMER_ID}/upgrade-url`, {
      method: "PATCH",
    });
    const res = await PATCH(req, makeContext(ORG_UUID_RAW, CUSTOMER_ID));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.upgradeUrl).toBe(url);
  });

  it("rejects non-HTTPS URLs", async () => {
    vi.mocked(readJsonBody).mockResolvedValue({ upgradeUrl: "http://acme.com/c" });

    const req = new Request(`http://localhost/api/orgs/${ORG_UUID_RAW}/customers/${CUSTOMER_ID}/upgrade-url`, {
      method: "PATCH",
    });
    const res = await PATCH(req, makeContext(ORG_UUID_RAW, CUSTOMER_ID));

    expect(res.status).toBe(400);
    expect(mockOnConflictDoUpdate).not.toHaveBeenCalled();
  });

  it("rejects non-owner", async () => {
    mockAssertOrgRole.mockRejectedValueOnce(new ForbiddenError("Owner role required"));
    vi.mocked(readJsonBody).mockResolvedValue({ upgradeUrl: "https://acme.com/c" });

    const req = new Request(`http://localhost/api/orgs/${ORG_UUID_RAW}/customers/${CUSTOMER_ID}/upgrade-url`, {
      method: "PATCH",
    });
    const res = await PATCH(req, makeContext(ORG_UUID_RAW, CUSTOMER_ID));

    expect(res.status).toBe(403);
    expect(mockOnConflictDoUpdate).not.toHaveBeenCalled();
  });

  it("returns 401 when session is invalid", async () => {
    const { AuthenticationRequiredError } = await import("@/lib/auth/errors");
    vi.mocked(resolveSessionContext).mockRejectedValueOnce(new AuthenticationRequiredError());

    const req = new Request(`http://localhost/api/orgs/${ORG_UUID_RAW}/customers/${CUSTOMER_ID}/upgrade-url`, {
      method: "PATCH",
    });
    const res = await PATCH(req, makeContext(ORG_UUID_RAW, CUSTOMER_ID));

    expect(res.status).toBe(401);
  });

  it("invalidation failure does not block success", async () => {
    mockInvalidateProxyCache.mockRejectedValueOnce(new Error("proxy down"));
    vi.mocked(readJsonBody).mockResolvedValue({ upgradeUrl: "https://acme.com/c" });

    const req = new Request(`http://localhost/api/orgs/${ORG_UUID_RAW}/customers/${CUSTOMER_ID}/upgrade-url`, {
      method: "PATCH",
    });
    const res = await PATCH(req, makeContext(ORG_UUID_RAW, CUSTOMER_ID));

    expect(res.status).toBe(200);
  });
});
