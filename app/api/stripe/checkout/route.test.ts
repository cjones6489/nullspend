import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({
  resolveSessionUserId: vi.fn(),
}));

vi.mock("@/lib/auth/supabase", () => ({
  createServerSupabaseClient: vi.fn(),
}));

vi.mock("@/lib/stripe/client", () => ({
  getStripe: vi.fn(),
  getOrigin: vi.fn(),
}));

vi.mock("@/lib/stripe/subscription", () => ({
  getSubscriptionByUserId: vi.fn(),
}));

vi.mock("@/lib/stripe/tiers", () => ({
  isValidPriceId: vi.fn(),
  tierFromPriceId: vi.fn(),
}));

import { resolveSessionUserId } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { getStripe, getOrigin } from "@/lib/stripe/client";
import { getSubscriptionByUserId } from "@/lib/stripe/subscription";
import { isValidPriceId, tierFromPriceId } from "@/lib/stripe/tiers";
import { POST } from "./route";

const mockedResolveSession = vi.mocked(resolveSessionUserId);
const mockedGetStripe = vi.mocked(getStripe);
const mockedGetOrigin = vi.mocked(getOrigin);
const mockedGetSubscription = vi.mocked(getSubscriptionByUserId);
const mockedIsValidPriceId = vi.mocked(isValidPriceId);
const mockedTierFromPriceId = vi.mocked(tierFromPriceId);
const mockedCreateSupabaseClient = vi.mocked(createServerSupabaseClient);

function makeRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost:3000/api/stripe/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/stripe/checkout", () => {
  let mockCheckoutCreate: ReturnType<typeof vi.fn>;
  let mockCustomerCreate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockedResolveSession.mockResolvedValue("user-123");
    mockedGetOrigin.mockReturnValue("http://localhost:3000");
    mockedIsValidPriceId.mockReturnValue(true);
    mockedTierFromPriceId.mockReturnValue("pro");
    mockedGetSubscription.mockResolvedValue(null as never);

    mockCheckoutCreate = vi.fn().mockResolvedValue({
      url: "https://checkout.stripe.com/session_123",
    });
    mockCustomerCreate = vi.fn().mockResolvedValue({ id: "cus_new" });

    mockedGetStripe.mockReturnValue({
      checkout: { sessions: { create: mockCheckoutCreate } },
      customers: { create: mockCustomerCreate },
    } as never);

    mockedCreateSupabaseClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { email: "test@test.com" } } }) },
    } as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates checkout session and returns URL", async () => {
    const res = await POST(makeRequest({ priceId: "price_pro" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toBe("https://checkout.stripe.com/session_123");
    expect(mockCheckoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "subscription",
        customer: "cus_new",
        metadata: { userId: "user-123", tier: "pro" },
      }),
    );
  });

  it("reuses existing stripe customer ID", async () => {
    mockedGetSubscription.mockResolvedValue({
      stripeCustomerId: "cus_existing",
      status: "canceled",
    } as never);

    const res = await POST(makeRequest({ priceId: "price_pro" }));
    expect(res.status).toBe(200);
    expect(mockCustomerCreate).not.toHaveBeenCalled();
    expect(mockCheckoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "cus_existing" }),
    );
  });

  it("returns 400 for invalid price ID", async () => {
    mockedIsValidPriceId.mockReturnValue(false);

    const res = await POST(makeRequest({ priceId: "price_invalid" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_input");
    expect(body.message).toMatch(/Invalid price ID/);
  });

  it("returns 400 when user already has an active subscription", async () => {
    mockedGetSubscription.mockResolvedValue({
      status: "active",
      stripeCustomerId: "cus_123",
    } as never);

    const res = await POST(makeRequest({ priceId: "price_pro" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("subscription_exists");
    expect(body.message).toMatch(/already have an active subscription/);
  });

  it("returns 400 for missing priceId", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });
});
