import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveSessionContext } from "@/lib/auth/session";
import { ForbiddenError } from "@/lib/auth/errors";
import { GET, PATCH } from "./route";

const ORG_UUID_RAW = "00000000-0000-4000-a000-000000000001";
const ORG_ID = `ns_org_${ORG_UUID_RAW}`;
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

const mockLogAuditEvent = vi.fn();
vi.mock("@/lib/audit/log", () => ({
  logAuditEvent: (...args: unknown[]) => mockLogAuditEvent(...args),
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
    const res = await GET(req, makeContext(ORG_ID, CUSTOMER_ID));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.customerId).toBe(CUSTOMER_ID);
    expect(body.data.upgradeUrl).toBe("https://acme.com/customer-upgrade");
  });

  it("returns null when no row exists for the customer", async () => {
    mockSelectLimit.mockResolvedValue([]);

    const req = new Request(`http://localhost/api/orgs/${ORG_UUID_RAW}/customers/${CUSTOMER_ID}/upgrade-url`);
    const res = await GET(req, makeContext(ORG_ID, CUSTOMER_ID));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.upgradeUrl).toBeNull();
  });

  it("returns null when row exists but upgrade_url column is null", async () => {
    mockSelectLimit.mockResolvedValue([{ upgradeUrl: null }]);

    const req = new Request(`http://localhost/api/orgs/${ORG_UUID_RAW}/customers/${CUSTOMER_ID}/upgrade-url`);
    const res = await GET(req, makeContext(ORG_ID, CUSTOMER_ID));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.upgradeUrl).toBeNull();
  });

  it("rejects non-member (403)", async () => {
    mockAssertOrgMember.mockRejectedValueOnce(new ForbiddenError("Not a member"));

    const req = new Request(`http://localhost/api/orgs/${ORG_UUID_RAW}/customers/${CUSTOMER_ID}/upgrade-url`);
    const res = await GET(req, makeContext(ORG_ID, CUSTOMER_ID));

    expect(res.status).toBe(403);
  });

  it("rejects raw UUID (must be prefixed form ns_org_*)", async () => {
    // E1 regression guard: pre-fix this accepted raw UUID. Now must be prefixed.
    const req = new Request(`http://localhost/api/orgs/${ORG_UUID_RAW}/customers/${CUSTOMER_ID}/upgrade-url`);
    const res = await GET(req, makeContext(ORG_UUID_RAW, CUSTOMER_ID));

    expect(res.status).toBe(400);
  });

  it("rejects malformed prefixed orgId", async () => {
    const req = new Request(`http://localhost/api/orgs/ns_org_not-a-uuid/customers/${CUSTOMER_ID}/upgrade-url`);
    const res = await GET(req, makeContext("ns_org_not-a-uuid", CUSTOMER_ID));

    expect(res.status).toBe(400);
  });

  it("rejects customerId over 256 chars", async () => {
    const longCustomerId = "x".repeat(300);
    const req = new Request(`http://localhost/api/orgs/${ORG_ID}/customers/${longCustomerId}/upgrade-url`);
    const res = await GET(req, makeContext(ORG_ID, longCustomerId));

    expect(res.status).toBe(400);
  });

  it("rejects customerId with characters outside SDK charset", async () => {
    // E7: dashboard validator must match SDK regex — otherwise URLs get orphaned
    const invalidIds = ["acme corp", "acme@host", "acme/prod", "acme#tag", "acme?x=1"];
    for (const bad of invalidIds) {
      const res = await GET(
        new Request(`http://localhost/api/orgs/${ORG_ID}/customers/${encodeURIComponent(bad)}/upgrade-url`),
        makeContext(ORG_ID, bad),
      );
      expect(res.status, `expected 400 for customerId="${bad}"`).toBe(400);
    }
  });

  it("accepts customerId with SDK-approved characters", async () => {
    // Mirrors packages/sdk/src/customer-id.ts regex: alphanumerics + . _ : -
    mockSelectLimit.mockResolvedValue([{ upgradeUrl: null }]);
    const validIds = ["acme", "acme-corp", "acme.prod", "acme_test", "acme:v1", "a1b2c3"];
    for (const good of validIds) {
      const res = await GET(
        new Request(`http://localhost/api/orgs/${ORG_ID}/customers/${good}/upgrade-url`),
        makeContext(ORG_ID, good),
      );
      expect(res.status, `expected 200 for customerId="${good}"`).toBe(200);
    }
  });

  it("T8: trims whitespace on customerId (mirrors SDK's validateCustomerId)", async () => {
    // Dashboard schema .trim() normalizes leading/trailing whitespace so a
    // URL segment like "/customers/ acme /upgrade-url" passes validation
    // the same way the SDK would handle it at the client boundary.
    mockSelectLimit.mockResolvedValue([{ upgradeUrl: null }]);
    const res = await GET(
      new Request(`http://localhost/api/orgs/${ORG_ID}/customers/${encodeURIComponent(" acme ")}/upgrade-url`),
      makeContext(ORG_ID, " acme "),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    // Trimmed value is returned to the caller
    expect(body.data.customerId).toBe("acme");
  });

  it("T8: whitespace-only customerId is rejected (empty after trim)", async () => {
    const res = await GET(
      new Request(`http://localhost/api/orgs/${ORG_ID}/customers/${encodeURIComponent("   ")}/upgrade-url`),
      makeContext(ORG_ID, "   "),
    );
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

    const req = new Request(`http://localhost/api/orgs/${ORG_ID}/customers/${CUSTOMER_ID}/upgrade-url`, {
      method: "PATCH",
    });
    const res = await PATCH(req, makeContext(ORG_ID, CUSTOMER_ID));

    // No 404 here — the old route returned 404 if no customer_mappings row existed.
    // The new route upserts via customer_settings, so first write always succeeds.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.customerId).toBe(CUSTOMER_ID);
    expect(body.data.upgradeUrl).toBe("https://acme.com/c/billing");
    expect(mockOnConflictDoUpdate).toHaveBeenCalled();
    // E4 regression guard: per-customer PATCH should NOT invalidate the auth
    // cache (per-customer URL is uncached — the lookup is fresh per denial).
    // Audit log entry IS written for the write.
    expect(mockLogAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: ORG_UUID_RAW,
        actorId: "user-1",
        action: "customer_upgrade_url.updated",
        resourceType: "customer_settings",
        resourceId: CUSTOMER_ID,
        metadata: { upgradeUrl: "https://acme.com/c/billing" },
      }),
    );
  });

  it("clears the URL when null is passed", async () => {
    vi.mocked(readJsonBody).mockResolvedValue({ upgradeUrl: null });

    const req = new Request(`http://localhost/api/orgs/${ORG_UUID_RAW}/customers/${CUSTOMER_ID}/upgrade-url`, {
      method: "PATCH",
    });
    const res = await PATCH(req, makeContext(ORG_ID, CUSTOMER_ID));

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
    const res = await PATCH(req, makeContext(ORG_ID, CUSTOMER_ID));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.upgradeUrl).toBe(url);
  });

  it("rejects non-HTTPS URLs", async () => {
    vi.mocked(readJsonBody).mockResolvedValue({ upgradeUrl: "http://acme.com/c" });

    const req = new Request(`http://localhost/api/orgs/${ORG_UUID_RAW}/customers/${CUSTOMER_ID}/upgrade-url`, {
      method: "PATCH",
    });
    const res = await PATCH(req, makeContext(ORG_ID, CUSTOMER_ID));

    expect(res.status).toBe(400);
    expect(mockOnConflictDoUpdate).not.toHaveBeenCalled();
  });

  it("rejects non-owner", async () => {
    mockAssertOrgRole.mockRejectedValueOnce(new ForbiddenError("Owner role required"));
    vi.mocked(readJsonBody).mockResolvedValue({ upgradeUrl: "https://acme.com/c" });

    const req = new Request(`http://localhost/api/orgs/${ORG_UUID_RAW}/customers/${CUSTOMER_ID}/upgrade-url`, {
      method: "PATCH",
    });
    const res = await PATCH(req, makeContext(ORG_ID, CUSTOMER_ID));

    expect(res.status).toBe(403);
    expect(mockOnConflictDoUpdate).not.toHaveBeenCalled();
  });

  it("returns 401 when session is invalid", async () => {
    const { AuthenticationRequiredError } = await import("@/lib/auth/errors");
    vi.mocked(resolveSessionContext).mockRejectedValueOnce(new AuthenticationRequiredError());

    const req = new Request(`http://localhost/api/orgs/${ORG_UUID_RAW}/customers/${CUSTOMER_ID}/upgrade-url`, {
      method: "PATCH",
    });
    const res = await PATCH(req, makeContext(ORG_ID, CUSTOMER_ID));

    expect(res.status).toBe(401);
  });

  it("clear (null) writes an audit log entry with null upgradeUrl", async () => {
    vi.mocked(readJsonBody).mockResolvedValue({ upgradeUrl: null });

    const req = new Request(`http://localhost/api/orgs/${ORG_ID}/customers/${CUSTOMER_ID}/upgrade-url`, {
      method: "PATCH",
    });
    const res = await PATCH(req, makeContext(ORG_ID, CUSTOMER_ID));

    expect(res.status).toBe(200);
    expect(mockLogAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "customer_upgrade_url.updated",
        metadata: { upgradeUrl: null },
      }),
    );
  });

  it("rejects PATCH with customerId outside SDK charset", async () => {
    vi.mocked(readJsonBody).mockResolvedValue({ upgradeUrl: "https://acme.com/c" });

    const req = new Request(`http://localhost/api/orgs/${ORG_ID}/customers/bad%20id/upgrade-url`, {
      method: "PATCH",
    });
    const res = await PATCH(req, makeContext(ORG_ID, "bad id"));

    expect(res.status).toBe(400);
    expect(mockOnConflictDoUpdate).not.toHaveBeenCalled();
    expect(mockLogAuditEvent).not.toHaveBeenCalled();
  });
});
