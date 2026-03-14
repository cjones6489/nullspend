import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Stripe from "stripe";

vi.mock("@/lib/stripe/client", () => ({
  getStripe: vi.fn(),
}));

vi.mock("@/lib/stripe/subscription", () => ({
  getSubscriptionByStripeCustomerId: vi.fn(),
  upsertSubscription: vi.fn(),
}));

vi.mock("@/lib/stripe/tiers", () => ({
  tierFromPriceId: vi.fn(),
}));

import { getStripe } from "@/lib/stripe/client";
import {
  getSubscriptionByStripeCustomerId,
  upsertSubscription,
} from "@/lib/stripe/subscription";
import { tierFromPriceId } from "@/lib/stripe/tiers";
import { POST } from "./route";

const mockedGetStripe = vi.mocked(getStripe);
const mockedGetSubscriptionByStripeCustomerId = vi.mocked(
  getSubscriptionByStripeCustomerId,
);
const mockedUpsertSubscription = vi.mocked(upsertSubscription);
const mockedTierFromPriceId = vi.mocked(tierFromPriceId);

function makeRequest(body: string, signature = "valid_sig"): Request {
  return new Request("http://localhost:3000/api/stripe/webhook", {
    method: "POST",
    headers: {
      "stripe-signature": signature,
      "content-type": "application/json",
    },
    body,
  });
}

function makeStripeEvent(
  type: string,
  dataObject: Record<string, unknown>,
): Stripe.Event {
  return {
    id: "evt_test_123",
    type,
    data: { object: dataObject },
  } as unknown as Stripe.Event;
}

describe("POST /api/stripe/webhook", () => {
  let mockConstructEvent: ReturnType<typeof vi.fn>;
  let mockCustomersRetrieve: ReturnType<typeof vi.fn>;
  let mockSubscriptionsRetrieve: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test");

    mockConstructEvent = vi.fn();
    mockCustomersRetrieve = vi.fn();
    mockSubscriptionsRetrieve = vi.fn();

    mockedGetStripe.mockReturnValue({
      webhooks: { constructEvent: mockConstructEvent },
      customers: { retrieve: mockCustomersRetrieve },
      subscriptions: { retrieve: mockSubscriptionsRetrieve },
    } as unknown as Stripe);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("returns 400 when signature is missing", async () => {
    const req = new Request("http://localhost:3000/api/stripe/webhook", {
      method: "POST",
      body: "{}",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when signature verification fails", async () => {
    mockConstructEvent.mockImplementation(() => {
      throw new Error("Invalid signature");
    });

    const res = await POST(makeRequest("{}"));
    expect(res.status).toBe(400);
  });

  it("returns 500 when webhook secret is not set", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    delete process.env.STRIPE_WEBHOOK_SECRET;

    const res = await POST(makeRequest("{}"));
    expect(res.status).toBe(500);
  });

  describe("checkout.session.completed", () => {
    it("creates a subscription with period dates from session metadata", async () => {
      const event = makeStripeEvent("checkout.session.completed", {
        id: "cs_test",
        metadata: { userId: "user-123", tier: "pro" },
        customer: "cus_123",
        subscription: "sub_123",
      });
      mockConstructEvent.mockReturnValue(event);
      mockSubscriptionsRetrieve.mockResolvedValue({
        id: "sub_123",
        items: {
          data: [
            {
              current_period_start: 1710000000,
              current_period_end: 1712678400,
            },
          ],
        },
      });
      mockedUpsertSubscription.mockResolvedValue({} as never);

      const res = await POST(makeRequest("{}"));
      expect(res.status).toBe(200);
      expect(mockSubscriptionsRetrieve).toHaveBeenCalledWith("sub_123");
      expect(mockedUpsertSubscription).toHaveBeenCalledWith({
        userId: "user-123",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
        tier: "pro",
        status: "active",
        currentPeriodStart: new Date(1710000000 * 1000),
        currentPeriodEnd: new Date(1712678400 * 1000),
      });
    });

    it("creates subscription with null dates when retrieve fails", async () => {
      const event = makeStripeEvent("checkout.session.completed", {
        id: "cs_test",
        metadata: { userId: "user-123", tier: "pro" },
        customer: "cus_123",
        subscription: "sub_123",
      });
      mockConstructEvent.mockReturnValue(event);
      mockSubscriptionsRetrieve.mockRejectedValue(new Error("API error"));
      mockedUpsertSubscription.mockResolvedValue({} as never);

      const res = await POST(makeRequest("{}"));
      expect(res.status).toBe(200);
      expect(mockedUpsertSubscription).toHaveBeenCalledWith({
        userId: "user-123",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
        tier: "pro",
        status: "active",
        currentPeriodStart: null,
        currentPeriodEnd: null,
      });
    });

    it("skips when metadata is missing", async () => {
      const event = makeStripeEvent("checkout.session.completed", {
        id: "cs_test",
        metadata: {},
        customer: "cus_123",
        subscription: "sub_123",
      });
      mockConstructEvent.mockReturnValue(event);

      const res = await POST(makeRequest("{}"));
      expect(res.status).toBe(200);
      expect(mockedUpsertSubscription).not.toHaveBeenCalled();
    });
  });

  describe("customer.subscription.updated", () => {
    it("updates subscription from existing DB row", async () => {
      const event = makeStripeEvent("customer.subscription.updated", {
        id: "sub_123",
        customer: "cus_123",
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
      });
      mockConstructEvent.mockReturnValue(event);
      mockedGetSubscriptionByStripeCustomerId.mockResolvedValue({
        userId: "user-123",
        stripeCustomerId: "cus_123",
      } as never);
      mockedTierFromPriceId.mockReturnValue("pro");
      mockedUpsertSubscription.mockResolvedValue({} as never);

      const res = await POST(makeRequest("{}"));
      expect(res.status).toBe(200);
      expect(mockedUpsertSubscription).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user-123",
          tier: "pro",
          status: "active",
          cancelAtPeriodEnd: false,
        }),
      );
    });

    it("falls back to customer metadata when no DB row exists", async () => {
      const event = makeStripeEvent("customer.subscription.updated", {
        id: "sub_123",
        customer: "cus_123",
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
      });
      mockConstructEvent.mockReturnValue(event);
      mockedGetSubscriptionByStripeCustomerId.mockResolvedValue(null as never);
      mockCustomersRetrieve.mockResolvedValue({
        deleted: false,
        metadata: { userId: "user-456" },
      });
      mockedTierFromPriceId.mockReturnValue("pro");
      mockedUpsertSubscription.mockResolvedValue({} as never);

      const res = await POST(makeRequest("{}"));
      expect(res.status).toBe(200);
      expect(mockCustomersRetrieve).toHaveBeenCalledWith("cus_123");
      expect(mockedUpsertSubscription).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user-456",
          tier: "pro",
        }),
      );
    });

    it("skips when price is unrecognized", async () => {
      const event = makeStripeEvent("customer.subscription.updated", {
        id: "sub_123",
        customer: "cus_123",
        status: "active",
        cancel_at_period_end: false,
        items: { data: [{ price: { id: "price_unknown" } }] },
      });
      mockConstructEvent.mockReturnValue(event);
      mockedGetSubscriptionByStripeCustomerId.mockResolvedValue({
        userId: "user-123",
      } as never);
      mockedTierFromPriceId.mockReturnValue(null);

      const res = await POST(makeRequest("{}"));
      expect(res.status).toBe(200);
      expect(mockedUpsertSubscription).not.toHaveBeenCalled();
    });
  });

  describe("customer.subscription.deleted", () => {
    it("sets status to canceled", async () => {
      const event = makeStripeEvent("customer.subscription.deleted", {
        id: "sub_123",
        customer: "cus_123",
      });
      mockConstructEvent.mockReturnValue(event);
      mockedGetSubscriptionByStripeCustomerId.mockResolvedValue({
        userId: "user-123",
        tier: "pro",
      } as never);
      mockedUpsertSubscription.mockResolvedValue({} as never);

      const res = await POST(makeRequest("{}"));
      expect(res.status).toBe(200);
      expect(mockedUpsertSubscription).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "canceled",
        }),
      );
    });

    it("skips gracefully when no DB row exists", async () => {
      const event = makeStripeEvent("customer.subscription.deleted", {
        id: "sub_123",
        customer: "cus_unknown",
      });
      mockConstructEvent.mockReturnValue(event);
      mockedGetSubscriptionByStripeCustomerId.mockResolvedValue(null as never);

      const res = await POST(makeRequest("{}"));
      expect(res.status).toBe(200);
      expect(mockedUpsertSubscription).not.toHaveBeenCalled();
    });
  });

  describe("invoice.payment_failed", () => {
    it("sets status to past_due", async () => {
      const event = makeStripeEvent("invoice.payment_failed", {
        customer: "cus_123",
      });
      mockConstructEvent.mockReturnValue(event);
      mockedGetSubscriptionByStripeCustomerId.mockResolvedValue({
        userId: "user-123",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
        tier: "pro",
        status: "active",
        cancelAtPeriodEnd: false,
      } as never);
      mockedUpsertSubscription.mockResolvedValue({} as never);

      const res = await POST(makeRequest("{}"));
      expect(res.status).toBe(200);
      expect(mockedUpsertSubscription).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "past_due",
        }),
      );
    });
  });

  describe("invoice.paid", () => {
    it("reactivates past_due subscription", async () => {
      const event = makeStripeEvent("invoice.paid", {
        customer: "cus_123",
      });
      mockConstructEvent.mockReturnValue(event);
      mockedGetSubscriptionByStripeCustomerId.mockResolvedValue({
        userId: "user-123",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
        tier: "pro",
        status: "past_due",
        cancelAtPeriodEnd: false,
      } as never);
      mockedUpsertSubscription.mockResolvedValue({} as never);

      const res = await POST(makeRequest("{}"));
      expect(res.status).toBe(200);
      expect(mockedUpsertSubscription).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "active",
        }),
      );
    });

    it("does not update active subscriptions", async () => {
      const event = makeStripeEvent("invoice.paid", {
        customer: "cus_123",
      });
      mockConstructEvent.mockReturnValue(event);
      mockedGetSubscriptionByStripeCustomerId.mockResolvedValue({
        userId: "user-123",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
        tier: "pro",
        status: "active",
        cancelAtPeriodEnd: false,
      } as never);

      const res = await POST(makeRequest("{}"));
      expect(res.status).toBe(200);
      expect(mockedUpsertSubscription).not.toHaveBeenCalled();
    });

    it("skips gracefully when no DB row exists", async () => {
      const event = makeStripeEvent("invoice.paid", {
        customer: "cus_unknown",
      });
      mockConstructEvent.mockReturnValue(event);
      mockedGetSubscriptionByStripeCustomerId.mockResolvedValue(null as never);

      const res = await POST(makeRequest("{}"));
      expect(res.status).toBe(200);
      expect(mockedUpsertSubscription).not.toHaveBeenCalled();
    });
  });

  describe("invoice.payment_failed", () => {
    it("skips gracefully when no DB row exists", async () => {
      const event = makeStripeEvent("invoice.payment_failed", {
        customer: "cus_unknown",
      });
      mockConstructEvent.mockReturnValue(event);
      mockedGetSubscriptionByStripeCustomerId.mockResolvedValue(null as never);

      const res = await POST(makeRequest("{}"));
      expect(res.status).toBe(200);
      expect(mockedUpsertSubscription).not.toHaveBeenCalled();
    });
  });

  describe("cancel-at-period-end flow", () => {
    it("preserves active status with cancel_at_period_end true", async () => {
      const event = makeStripeEvent("customer.subscription.updated", {
        id: "sub_123",
        customer: "cus_123",
        status: "active",
        cancel_at_period_end: true,
        items: {
          data: [
            {
              price: { id: "price_pro" },
              current_period_start: 1710000000,
              current_period_end: 1712678400,
            },
          ],
        },
      });
      mockConstructEvent.mockReturnValue(event);
      mockedGetSubscriptionByStripeCustomerId.mockResolvedValue({
        userId: "user-123",
        stripeCustomerId: "cus_123",
      } as never);
      mockedTierFromPriceId.mockReturnValue("pro");
      mockedUpsertSubscription.mockResolvedValue({} as never);

      const res = await POST(makeRequest("{}"));
      expect(res.status).toBe(200);
      expect(mockedUpsertSubscription).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "active",
          cancelAtPeriodEnd: true,
        }),
      );
    });
  });

  describe("subscription.updated with deleted customer", () => {
    it("skips when customer is deleted", async () => {
      const event = makeStripeEvent("customer.subscription.updated", {
        id: "sub_123",
        customer: "cus_deleted",
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
      });
      mockConstructEvent.mockReturnValue(event);
      mockedGetSubscriptionByStripeCustomerId.mockResolvedValue(null as never);
      mockCustomersRetrieve.mockResolvedValue({ deleted: true });

      const res = await POST(makeRequest("{}"));
      expect(res.status).toBe(200);
      expect(mockedUpsertSubscription).not.toHaveBeenCalled();
    });
  });

  it("returns 200 for unhandled event types", async () => {
    const event = makeStripeEvent("some.other.event", {});
    mockConstructEvent.mockReturnValue(event);

    const res = await POST(makeRequest("{}"));
    expect(res.status).toBe(200);
  });

  describe("error handling", () => {
    it("returns 500 for transient errors (Stripe retries)", async () => {
      const event = makeStripeEvent("checkout.session.completed", {
        id: "cs_test",
        metadata: { userId: "user-123", tier: "pro" },
        customer: "cus_123",
        subscription: "sub_123",
      });
      mockConstructEvent.mockReturnValue(event);
      mockSubscriptionsRetrieve.mockRejectedValue(
        new Error("connect ECONNREFUSED 127.0.0.1:5432"),
      );
      mockedUpsertSubscription.mockRejectedValue(
        new Error("connect ECONNREFUSED 127.0.0.1:5432"),
      );

      const res = await POST(makeRequest("{}"));
      expect(res.status).toBe(500);
    });

    it("returns 500 for timeout errors (Stripe retries)", async () => {
      const event = makeStripeEvent("customer.subscription.updated", {
        id: "sub_123",
        customer: "cus_123",
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
      });
      mockConstructEvent.mockReturnValue(event);
      mockedGetSubscriptionByStripeCustomerId.mockRejectedValue(
        new Error("Query timeout after 30000ms"),
      );

      const res = await POST(makeRequest("{}"));
      expect(res.status).toBe(500);
    });

    it("returns 200 for permanent errors (prevents Stripe retries)", async () => {
      const event = makeStripeEvent("customer.subscription.updated", {
        id: "sub_123",
        customer: "cus_123",
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
      });
      mockConstructEvent.mockReturnValue(event);
      mockedGetSubscriptionByStripeCustomerId.mockRejectedValue(
        new Error("invalid input syntax for type uuid"),
      );

      const res = await POST(makeRequest("{}"));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.error).toBe("processing_failed");
    });
  });
});
