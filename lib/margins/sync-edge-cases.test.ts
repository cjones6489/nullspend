import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetDb = vi.fn();
const mockDecryptStripeKey = vi.fn();
const mockRunAutoMatch = vi.fn();
const mockGetMarginTable = vi.fn();
const mockDetectWorseningCrossings = vi.fn();
const mockBuildMarginThresholdPayload = vi.fn();
const mockDispatchWebhookEvent = vi.fn();
const mockFormatPeriod = vi.fn();
const mockStripeInvoicesList = vi.fn();

vi.mock("@/lib/db/client", () => ({ getDb: () => mockGetDb() }));
vi.mock("./encryption", () => ({
  decryptStripeKey: (...args: unknown[]) => mockDecryptStripeKey(...args),
}));
vi.mock("./auto-match", () => ({
  runAutoMatch: (...args: unknown[]) => mockRunAutoMatch(...args),
}));
vi.mock("./margin-query", () => ({
  getMarginTable: (...args: unknown[]) => mockGetMarginTable(...args),
}));
vi.mock("./webhook", () => ({
  detectWorseningCrossings: (...args: unknown[]) => mockDetectWorseningCrossings(...args),
  buildMarginThresholdPayload: (...args: unknown[]) => mockBuildMarginThresholdPayload(...args),
}));
vi.mock("@/lib/webhooks/dispatch", () => ({
  dispatchWebhookEvent: (...args: unknown[]) => mockDispatchWebhookEvent(...args),
}));
vi.mock("./periods", () => ({
  formatPeriod: (...args: unknown[]) => mockFormatPeriod(...args),
}));
vi.mock("stripe", () => {
  class StripeAuthenticationError extends Error {
    constructor(msg = "auth") { super(msg); this.name = "StripeAuthenticationError"; }
  }
  class StripeClass {
    invoices = { list: (...args: unknown[]) => mockStripeInvoicesList(...args) };
    constructor() {}
    static errors = { StripeAuthenticationError };
  }
  return { default: StripeClass };
});

import { syncOrgRevenue, syncAllOrgs } from "./sync";

function mockDbWithConnection(connection: Record<string, unknown> | null) {
  const selectResult = connection ? [connection] : [];
  mockGetDb.mockReturnValue({
    select: () => ({ from: () => ({ where: () => {
      // First call: connection lookup (with .limit), second: syncAllOrgs connection list (no .limit)
      return {
        limit: () => Promise.resolve(selectResult),
        // If called without limit (syncAllOrgs path)
        then: (fn: (v: unknown[]) => unknown) => fn(selectResult),
      };
    } }) }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => {
      const tx = {
        delete: () => ({ where: () => Promise.resolve() }),
        insert: () => ({ values: () => Promise.resolve() }),
      };
      return fn(tx);
    }),
  });
}

function emptyAsyncIterator() {
  return {
    [Symbol.asyncIterator]: () => ({
      next: () => Promise.resolve({ done: true as const, value: undefined }),
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRunAutoMatch.mockResolvedValue(0);
  mockGetMarginTable.mockResolvedValue({ customers: [] });
  mockDetectWorseningCrossings.mockReturnValue([]);
  mockFormatPeriod.mockReturnValue("2026-04");
  mockStripeInvoicesList.mockReturnValue(emptyAsyncIterator());
});

describe("syncOrgRevenue edge cases", () => {
  it("skips invoices with null created timestamp", async () => {
    mockDbWithConnection({ id: "c1", orgId: "org-1", status: "active", encryptedKey: "enc" });
    mockDecryptStripeKey.mockReturnValue("sk_test_123");

    // Return invoice with created: null
    let callCount = 0;
    mockStripeInvoicesList.mockReturnValue({
      [Symbol.asyncIterator]: () => ({
        next: () => {
          callCount++;
          if (callCount === 1) {
            return Promise.resolve({
              done: false,
              value: { id: "inv_1", created: null, customer: null, currency: "usd", amount_paid: 1000 },
            });
          }
          return Promise.resolve({ done: true, value: undefined });
        },
      }),
    });

    const result = await syncOrgRevenue("org-1");
    expect(result.invoicesFetched).toBe(1);
    expect(result.invoicesSkipped).toBe(1);
    expect(result.customersProcessed).toBe(0);
  });

  it("counts skipped non-USD invoices", async () => {
    mockDbWithConnection({ id: "c1", orgId: "org-1", status: "active", encryptedKey: "enc" });
    mockDecryptStripeKey.mockReturnValue("sk_test_123");

    let callCount = 0;
    mockStripeInvoicesList.mockReturnValue({
      [Symbol.asyncIterator]: () => ({
        next: () => {
          callCount++;
          if (callCount === 1) {
            return Promise.resolve({
              done: false,
              value: {
                id: "inv_1",
                created: 1700000000,
                customer: { id: "cus_1", deleted: false, name: "Test", email: null, metadata: {} },
                currency: "eur",
                amount_paid: 1000,
              },
            });
          }
          return Promise.resolve({ done: true, value: undefined });
        },
      }),
    });

    const result = await syncOrgRevenue("org-1");
    expect(result.invoicesSkipped).toBe(1);
    expect(result.skippedCurrencies).toEqual({ eur: 1 });
  });

  it("tracks multiple non-USD currencies separately", async () => {
    mockDbWithConnection({ id: "c1", orgId: "org-1", status: "active", encryptedKey: "enc" });
    mockDecryptStripeKey.mockReturnValue("sk_test_123");

    let callCount = 0;
    mockStripeInvoicesList.mockReturnValue({
      [Symbol.asyncIterator]: () => ({
        next: () => {
          callCount++;
          const invoices = [
            { id: "inv_1", created: 1700000000, customer: { id: "cus_1", deleted: false, name: "A", email: null, metadata: {} }, currency: "eur", amount_paid: 1000 },
            { id: "inv_2", created: 1700000001, customer: { id: "cus_2", deleted: false, name: "B", email: null, metadata: {} }, currency: "gbp", amount_paid: 2000 },
            { id: "inv_3", created: 1700000002, customer: { id: "cus_3", deleted: false, name: "C", email: null, metadata: {} }, currency: "eur", amount_paid: 500 },
          ];
          if (callCount <= invoices.length) {
            return Promise.resolve({ done: false, value: invoices[callCount - 1] });
          }
          return Promise.resolve({ done: true, value: undefined });
        },
      }),
    });

    const result = await syncOrgRevenue("org-1");
    expect(result.invoicesSkipped).toBe(3);
    expect(result.skippedCurrencies).toEqual({ eur: 2, gbp: 1 });
  });

  it("returns empty skippedCurrencies when all invoices are USD", async () => {
    mockDbWithConnection({ id: "c1", orgId: "org-1", status: "active", encryptedKey: "enc" });
    mockDecryptStripeKey.mockReturnValue("sk_test_123");
    // Default empty iterator from beforeEach — no invoices at all
    const result = await syncOrgRevenue("org-1");
    expect(result.skippedCurrencies).toEqual({});
  });

  it("skips connection with error status (only revoked checked explicitly)", async () => {
    // status: "error" is NOT "revoked" so it proceeds to decryption
    mockDbWithConnection({ id: "c1", orgId: "org-1", status: "error", encryptedKey: "enc" });
    mockDecryptStripeKey.mockReturnValue("sk_test_123");

    const result = await syncOrgRevenue("org-1");
    // Should succeed (error status doesn't block sync, only "revoked" does)
    expect(result.error).toBeUndefined();
  });
});

describe("syncAllOrgs", () => {
  it("returns results for each org processed", async () => {
    // Mock DB to return 2 connections for the list query, then handle per-org sync
    const connections = [{ orgId: "org-1" }, { orgId: "org-2" }];
    mockGetDb.mockReturnValue({
      select: () => ({ from: () => ({ where: () => {
        return {
          limit: () => Promise.resolve([]),
          then: (fn: (v: unknown[]) => unknown) => Promise.resolve(fn(connections)),
        };
      } }) }),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => {
        const tx = { delete: () => ({ where: () => Promise.resolve() }), insert: () => ({ values: () => Promise.resolve() }) };
        return fn(tx);
      }),
    });

    const results = await syncAllOrgs();
    // Each org returns "No active Stripe connection" since the mock returns empty for connection lookup
    expect(results.length).toBe(2);
  });
});
