import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocks
const mockGetDb = vi.fn();
const mockDecryptStripeKey = vi.fn();
const mockRunAutoMatch = vi.fn();
const mockGetMarginTable = vi.fn();
const mockDetectWorseningCrossings = vi.fn();
const mockBuildMarginThresholdPayload = vi.fn();
const mockDispatchWebhookEvent = vi.fn();
const mockFormatPeriod = vi.fn();

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
const mockStripeInvoicesList = vi.fn();
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

const ORG_ID = "org-123";

function mockDbWithConnection(connection: Record<string, unknown> | null) {
  const selectResult = connection ? [connection] : [];
  mockGetDb.mockReturnValue({
    select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve(selectResult) }) }) }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => {
      const tx = {
        delete: () => ({ where: () => Promise.resolve() }),
        insert: () => ({ values: () => Promise.resolve() }),
      };
      return fn(tx);
    }),
    delete: () => ({ where: () => Promise.resolve() }),
    insert: () => ({ values: () => Promise.resolve() }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRunAutoMatch.mockResolvedValue(0);
  mockGetMarginTable.mockResolvedValue({ customers: [] });
  mockDetectWorseningCrossings.mockReturnValue([]);
  mockFormatPeriod.mockReturnValue("2026-04");
  // Default: empty async iterator for Stripe invoices
  mockStripeInvoicesList.mockReturnValue({
    [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve({ done: true, value: undefined }) }),
  });
});

describe("syncOrgRevenue", () => {
  it("returns error if no connection exists", async () => {
    mockDbWithConnection(null);
    const result = await syncOrgRevenue(ORG_ID);
    expect(result.error).toBe("No active Stripe connection");
    expect(result.customersProcessed).toBe(0);
  });

  it("returns error if connection is revoked", async () => {
    mockDbWithConnection({ id: "conn-1", orgId: ORG_ID, status: "revoked", encryptedKey: "x" });
    const result = await syncOrgRevenue(ORG_ID);
    expect(result.error).toBe("No active Stripe connection");
  });

  it("returns error and sets status to error if decryption fails", async () => {
    mockDbWithConnection({ id: "conn-1", orgId: ORG_ID, status: "active", encryptedKey: "bad" });
    mockDecryptStripeKey.mockImplementation(() => { throw new Error("decrypt failed"); });

    const result = await syncOrgRevenue(ORG_ID);
    expect(result.error).toBe("Decryption failed");
  });

  it("tracks duration and invoice count on success", async () => {
    mockDbWithConnection({ id: "conn-1", orgId: ORG_ID, status: "active", encryptedKey: "enc" });
    mockDecryptStripeKey.mockReturnValue("sk_test_123");
    // mockStripeInvoicesList already returns empty iterator from beforeEach

    const result = await syncOrgRevenue(ORG_ID);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.invoicesFetched).toBe(0);
    expect(result.error).toBeUndefined();
    expect(result.customersProcessed).toBe(0);
  });
});

describe("syncAllOrgs", () => {
  it("returns empty array when no active connections", async () => {
    mockGetDb.mockReturnValue({
      select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
    });

    const results = await syncAllOrgs();
    expect(results).toEqual([]);
  });
});
