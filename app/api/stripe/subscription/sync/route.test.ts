import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({
  resolveSessionContext: vi.fn(),
}));

vi.mock("@/lib/auth/org-authorization", () => ({
  assertOrgRole: vi.fn(),
}));

vi.mock("@/lib/stripe/client", () => ({
  getStripe: vi.fn(),
}));

vi.mock("@/lib/stripe/subscription", () => ({
  upsertSubscription: vi.fn(),
}));

vi.mock("@/lib/stripe/tiers", () => ({
  tierFromPriceId: vi.fn(),
}));

import { resolveSessionContext } from "@/lib/auth/session";
import { getStripe } from "@/lib/stripe/client";
import { upsertSubscription } from "@/lib/stripe/subscription";
import { tierFromPriceId } from "@/lib/stripe/tiers";
import { POST } from "./route";

const mockedResolveSession = vi.mocked(resolveSessionContext);
const mockedGetStripe = vi.mocked(getStripe);
const mockedUpsertSubscription = vi.mocked(upsertSubscription);
const mockedTierFromPriceId = vi.mocked(tierFromPriceId);

function makeRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost:3000/api/stripe/subscription/sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/stripe/subscription/sync", () => {
  let mockSessionRetrieve: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockedResolveSession.mockResolvedValue({ userId: "user-123", orgId: "org-test-1", role: "owner" });
    mockedTierFromPriceId.mockReturnValue("pro");

    mockSessionRetrieve = vi.fn();
    mockedGetStripe.mockReturnValue({
      checkout: { sessions: { retrieve: mockSessionRetrieve } },
    } as never);

    mockedUpsertSubscription.mockResolvedValue({
      id: "sub-uuid",
      tier: "pro",
      status: "active",
      currentPeriodStart: new Date(1710000000000),
      currentPeriodEnd: new Date(1712678400000),
      cancelAtPeriodEnd: false,
      createdAt: new Date(),
    } as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("syncs checkout session and returns subscription", async () => {
    mockSessionRetrieve.mockResolvedValue({
      metadata: { orgId: "org-test-1", tier: "pro" },
      customer: "cus_123",
      subscription: {
        id: "sub_123",
        status: "active",
        cancel_at_period_end: false,
        items: {
          data: [
            {
              price: { id: "price_pro" },
              current_period_start: 1710000000,
              current_period_end: 1712678400,
            },
          ],
        },
      },
    });

    const res = await POST(makeRequest({ sessionId: "cs_123" }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.tier).toBe("pro");
    expect(body.data.status).toBe("active");

    expect(mockedUpsertSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org-test-1",
        userId: "user-123",
        stripeCustomerId: "cus_123",
        tier: "pro",
      }),
    );
  });

  it("returns 403 when session belongs to a different org", async () => {
    mockSessionRetrieve.mockResolvedValue({
      metadata: { orgId: "org-OTHER" },
      customer: "cus_123",
      subscription: { id: "sub_123" },
    });

    const res = await POST(makeRequest({ sessionId: "cs_123" }));
    expect(res.status).toBe(403);
  });

  it("returns 400 when no subscription on session", async () => {
    mockSessionRetrieve.mockResolvedValue({
      metadata: { orgId: "org-test-1" },
      customer: "cus_123",
      subscription: null,
    });

    const res = await POST(makeRequest({ sessionId: "cs_123" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when no customer on session", async () => {
    mockSessionRetrieve.mockResolvedValue({
      metadata: { orgId: "org-test-1" },
      customer: null,
      subscription: {
        id: "sub_123",
        status: "active",
        cancel_at_period_end: false,
        items: { data: [{ price: { id: "price_pro" } }] },
      },
    });

    const res = await POST(makeRequest({ sessionId: "cs_123" }));
    expect(res.status).toBe(400);
  });

  it("STRIPE-9: rejects unknown price ID instead of defaulting to free", async () => {
    mockedTierFromPriceId.mockReturnValue(null);

    mockSessionRetrieve.mockResolvedValue({
      metadata: { orgId: "org-test-1" },
      customer: "cus_123",
      subscription: {
        id: "sub_123",
        status: "active",
        cancel_at_period_end: false,
        items: {
          data: [
            {
              price: { id: "price_unknown" },
              current_period_start: 1710000000,
              current_period_end: 1712678400,
            },
          ],
        },
      },
    });

    const res = await POST(makeRequest({ sessionId: "cs_123" }));
    // STRIPE-9: unknown price IDs now fail closed (500) instead of silently downgrading to free
    expect(res.status).toBe(500);
  });

  it("returns 400 for missing sessionId", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });
});
