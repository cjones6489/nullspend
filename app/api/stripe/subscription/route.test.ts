import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({
  resolveSessionContext: vi.fn(),
}));

vi.mock("@/lib/auth/org-authorization", () => ({
  assertOrgRole: vi.fn().mockResolvedValue({ userId: "user-123", orgId: "org-test-1", role: "owner" }),
  assertOrgMember: vi.fn().mockResolvedValue({ userId: "user-123", orgId: "org-test-1", role: "owner" }),
}));

vi.mock("@/lib/stripe/subscription", () => ({
  getSubscriptionByUserId: vi.fn(),
}));

import { resolveSessionContext } from "@/lib/auth/session";
import { getSubscriptionByUserId } from "@/lib/stripe/subscription";
import { GET } from "./route";

const mockedResolveSession = vi.mocked(resolveSessionContext);
const mockedGetSubscription = vi.mocked(getSubscriptionByUserId);

describe("GET /api/stripe/subscription", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedResolveSession.mockResolvedValue({ userId: "user-123", orgId: "org-test-1", role: "owner" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null when no subscription exists", async () => {
    mockedGetSubscription.mockResolvedValue(null as never);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeNull();
  });

  it("returns subscription data when it exists", async () => {
    const now = new Date();
    const later = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    mockedGetSubscription.mockResolvedValue({
      id: "sub-uuid-123",
      tier: "pro",
      status: "active",
      currentPeriodStart: now,
      currentPeriodEnd: later,
      cancelAtPeriodEnd: false,
      createdAt: now,
    } as never);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("sub-uuid-123");
    expect(body.tier).toBe("pro");
    expect(body.status).toBe("active");
    expect(body.cancelAtPeriodEnd).toBe(false);
    expect(body.currentPeriodStart).toBe(now.toISOString());
    expect(body.currentPeriodEnd).toBe(later.toISOString());
  });

  it("returns null dates when period dates are null", async () => {
    mockedGetSubscription.mockResolvedValue({
      id: "sub-uuid-123",
      tier: "pro",
      status: "active",
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      createdAt: new Date(),
    } as never);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.currentPeriodStart).toBeNull();
    expect(body.currentPeriodEnd).toBeNull();
  });
});
