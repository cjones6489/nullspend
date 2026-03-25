import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({
  resolveSessionContext: vi.fn(),
}));

vi.mock("@/lib/stripe/client", () => ({
  getStripe: vi.fn(),
  getOrigin: vi.fn(),
}));

vi.mock("@/lib/stripe/subscription", () => ({
  getSubscriptionByUserId: vi.fn(),
}));

import { resolveSessionContext } from "@/lib/auth/session";
import { getStripe, getOrigin } from "@/lib/stripe/client";
import { getSubscriptionByUserId } from "@/lib/stripe/subscription";
import { POST } from "./route";

const mockedResolveSession = vi.mocked(resolveSessionContext);
const mockedGetStripe = vi.mocked(getStripe);
const mockedGetOrigin = vi.mocked(getOrigin);
const mockedGetSubscription = vi.mocked(getSubscriptionByUserId);

function makeRequest(): Request {
  return new Request("http://localhost:3000/api/stripe/portal", {
    method: "POST",
  });
}

describe("POST /api/stripe/portal", () => {
  let mockPortalCreate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockedResolveSession.mockResolvedValue({ userId: "user-123", orgId: "org-test-1", role: "owner" });
    mockedGetOrigin.mockReturnValue("http://localhost:3000");

    mockPortalCreate = vi.fn().mockResolvedValue({
      url: "https://billing.stripe.com/session_456",
    });

    mockedGetStripe.mockReturnValue({
      billingPortal: { sessions: { create: mockPortalCreate } },
    } as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates portal session and returns URL", async () => {
    mockedGetSubscription.mockResolvedValue({
      stripeCustomerId: "cus_123",
    } as never);

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toBe("https://billing.stripe.com/session_456");
    expect(mockPortalCreate).toHaveBeenCalledWith({
      customer: "cus_123",
      return_url: "http://localhost:3000/app/billing",
    });
  });

  it("returns 400 when no subscription exists", async () => {
    mockedGetSubscription.mockResolvedValue(null as never);

    const res = await POST(makeRequest());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("no_subscription");
    expect(body.error.message).toMatch(/No active subscription/);
  });

  it("returns 400 when subscription has no stripeCustomerId", async () => {
    mockedGetSubscription.mockResolvedValue({
      stripeCustomerId: null,
    } as never);

    const res = await POST(makeRequest());
    expect(res.status).toBe(400);
  });
});
