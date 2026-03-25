/**
 * Permission enforcement tests — verify that role-based access control
 * rejects insufficient permissions with 403 across key route boundaries.
 *
 * Strategy: mock assertOrgRole to REJECT, verify routes return 403.
 * This tests only the permission check, not the full route logic.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ForbiddenError } from "@/lib/auth/errors";

// ---------------------------------------------------------------------------
// Shared mocks — all routes need these
// ---------------------------------------------------------------------------

vi.mock("@/lib/auth/session", () => ({
  resolveSessionContext: vi.fn().mockResolvedValue({
    userId: "user-1",
    orgId: "org-1",
    role: "owner",
  }),
}));

vi.mock("@/lib/auth/org-authorization", () => ({
  assertOrgRole: vi.fn().mockRejectedValue(new ForbiddenError("Forbidden")),
  assertOrgMember: vi.fn().mockResolvedValue({ userId: "user-1", orgId: "org-1", role: "owner" }),
}));

vi.mock("@/lib/db/client", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/observability/sentry", () => ({
  captureExceptionWithContext: vi.fn(),
  addSentryBreadcrumb: vi.fn(),
}));
vi.mock("@/lib/utils/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils/http")>();
  return { ...actual, readJsonBody: vi.fn().mockResolvedValue({}) };
});
vi.mock("@/lib/stripe/subscription", () => ({
  getSubscriptionByOrgId: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/stripe/tiers", () => ({
  getTierForUser: vi.fn().mockReturnValue("free"),
  TIERS: { free: { label: "Free" } },
}));
vi.mock("@/lib/proxy-invalidate", () => ({
  invalidateProxyCache: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/webhooks/invalidate-cache", () => ({
  invalidateWebhookCacheForUser: vi.fn().mockResolvedValue(undefined),
}));

import { assertOrgRole } from "@/lib/auth/org-authorization";
const mockAssertOrgRole = vi.mocked(assertOrgRole);

function reject(minRole: string) {
  mockAssertOrgRole.mockRejectedValueOnce(
    new ForbiddenError(`This action requires the ${minRole} role or higher.`),
  );
}

// ---------------------------------------------------------------------------
// Tests: every route that calls assertOrgRole should 403 when it rejects
// ---------------------------------------------------------------------------

describe("Permission enforcement — viewer cannot write", () => {
  beforeEach(() => vi.clearAllMocks());

  it("POST /api/budgets → 403 (requires member)", async () => {
    reject("member");
    const { POST } = await import("@/app/api/budgets/route");
    const res = await POST(new Request("http://localhost/api/budgets", { method: "POST" }));
    expect(res.status).toBe(403);
  });

  it("POST /api/keys → 403 (requires member)", async () => {
    reject("member");
    const { POST } = await import("@/app/api/keys/route");
    const res = await POST(new Request("http://localhost/api/keys", { method: "POST" }));
    expect(res.status).toBe(403);
  });

  it("POST /api/webhooks → 403 (requires admin)", async () => {
    reject("admin");
    const { POST } = await import("@/app/api/webhooks/route");
    const res = await POST(new Request("http://localhost/api/webhooks", { method: "POST" }));
    expect(res.status).toBe(403);
  });
});

describe("Permission enforcement — member cannot admin", () => {
  beforeEach(() => vi.clearAllMocks());

  it("POST /api/slack/config → 403 (requires admin)", async () => {
    reject("admin");
    const { POST } = await import("@/app/api/slack/config/route");
    const res = await POST(new Request("http://localhost/api/slack/config", { method: "POST" }));
    expect(res.status).toBe(403);
  });
});

describe("Permission enforcement — admin cannot owner", () => {
  beforeEach(() => vi.clearAllMocks());

  it("POST /api/stripe/checkout → 403 (requires owner)", async () => {
    reject("owner");
    const { POST } = await import("@/app/api/stripe/checkout/route");
    const res = await POST(new Request("http://localhost/api/stripe/checkout", { method: "POST" }));
    expect(res.status).toBe(403);
  });

  it("POST /api/stripe/portal → 403 (requires owner)", async () => {
    reject("owner");
    const { POST } = await import("@/app/api/stripe/portal/route");
    const res = await POST(new Request("http://localhost/api/stripe/portal", { method: "POST" }));
    expect(res.status).toBe(403);
  });
});
