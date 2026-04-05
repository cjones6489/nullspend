import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
const mockResolveSessionContext = vi.fn();
const mockAssertOrgRole = vi.fn();
const mockGetDb = vi.fn();
const mockEncryptStripeKey = vi.fn();
const mockStripeCustomersList = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  resolveSessionContext: () => mockResolveSessionContext(),
}));
vi.mock("@/lib/auth/org-authorization", () => ({
  assertOrgRole: (...args: unknown[]) => mockAssertOrgRole(...args),
}));
vi.mock("@/lib/db/client", () => ({
  getDb: () => mockGetDb(),
}));
vi.mock("@/lib/margins/encryption", () => ({
  encryptStripeKey: (...args: unknown[]) => mockEncryptStripeKey(...args),
}));
vi.mock("stripe", () => {
  class StripeAuthenticationError extends Error {
    constructor(msg = "auth error") {
      super(msg);
      this.name = "StripeAuthenticationError";
    }
  }
  class StripeClass {
    customers = { list: (...args: unknown[]) => mockStripeCustomersList(...args) };
    constructor() {}
    static errors = { StripeAuthenticationError };
  }
  return { default: StripeClass };
});

// Re-export the error class for use in tests
const { default: Stripe } = await vi.importMock<{ default: { errors: { StripeAuthenticationError: typeof Error } } }>("stripe");
const MockStripeAuthError = Stripe.errors.StripeAuthenticationError;

import { POST } from "./route";

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/stripe/connect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function mockDbForSuccess() {
  mockGetDb.mockReturnValue({
    select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }),
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => ({
          returning: () =>
            Promise.resolve([
              {
                id: "conn-1",
                keyPrefix: "rk_live_tes...3456",
                status: "active",
                createdAt: new Date("2026-04-04T00:00:00Z"),
              },
            ]),
        }),
      }),
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveSessionContext.mockResolvedValue({ userId: "user-1", orgId: "org-1", role: "admin" });
  mockAssertOrgRole.mockResolvedValue({ userId: "user-1", orgId: "org-1", role: "admin" });
  mockEncryptStripeKey.mockReturnValue("encrypted-key-base64");
  mockStripeCustomersList.mockResolvedValue({ data: [] });
});

describe("POST /api/stripe/connect", () => {
  it("returns 400 if stripeKey is missing", async () => {
    const res = await POST(jsonRequest({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("validation_error");
  });

  it("returns 400 if key is not a restricted key", async () => {
    const res = await POST(jsonRequest({ stripeKey: "sk_live_abc" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toContain("restricted");
  });

  it("returns 409 if org already has a connection", async () => {
    mockGetDb.mockReturnValue({
      select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([{ id: "existing-id" }]) }) }) }),
    });

    const res = await POST(jsonRequest({ stripeKey: "rk_live_test123" }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("conflict");
  });

  it("returns 400 if Stripe key validation fails", async () => {
    mockGetDb.mockReturnValue({
      select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }),
    });
    mockStripeCustomersList.mockRejectedValue(new MockStripeAuthError());

    const res = await POST(jsonRequest({ stripeKey: "rk_live_test123" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("stripe_validation_failed");
  });

  it("returns 201 on successful connection", async () => {
    mockDbForSuccess();

    const res = await POST(jsonRequest({ stripeKey: "rk_live_test123456" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.id).toBe("conn-1");
    expect(body.data.status).toBe("active");
  });

  it("trims whitespace from key", async () => {
    mockDbForSuccess();

    const res = await POST(jsonRequest({ stripeKey: "  rk_live_test123456  " }));
    expect(res.status).toBe(201);
    expect(mockEncryptStripeKey).toHaveBeenCalledWith("rk_live_test123456", "org-1");
  });

  it("encrypts with correct orgId", async () => {
    mockDbForSuccess();

    await POST(jsonRequest({ stripeKey: "rk_live_test123456" }));
    expect(mockEncryptStripeKey).toHaveBeenCalledWith("rk_live_test123456", "org-1");
  });
});
