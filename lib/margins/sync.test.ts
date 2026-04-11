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
  computeHealthTier: (marginPercent: number) => {
    if (marginPercent >= 50) return "healthy";
    if (marginPercent >= 20) return "moderate";
    if (marginPercent >= 0) return "at_risk";
    return "critical";
  },
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
vi.mock("./margin-slack-message", () => ({
  buildMarginAlertMessage: vi.fn().mockReturnValue({ text: "test", blocks: [] }),
  dispatchMarginSlackAlert: vi.fn().mockResolvedValue(undefined),
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
    execute: vi.fn().mockResolvedValue([{ acquired: true }]),
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

  it("MRG-6: returns early when advisory lock is not acquired (sync already in progress)", async () => {
    mockGetDb.mockReturnValue({
      execute: vi.fn().mockResolvedValue([{ acquired: false }]),
    });

    const result = await syncOrgRevenue(ORG_ID);

    expect(result.error).toBe("Sync already in progress");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe("syncOrgRevenue — MRG-5 alert dedup", () => {
  function mockDbWithAlertDedup(opts: {
    connection: Record<string, unknown>;
    alertInsertReturns: unknown[];
  }) {
    const { connection, alertInsertReturns } = opts;
    const mockOnConflictDoNothing = vi.fn(() => ({
      returning: vi.fn().mockResolvedValue(alertInsertReturns),
    }));
    const mockInsertValues = vi.fn(() => ({
      onConflictDoNothing: mockOnConflictDoNothing,
    }));
    const mockInsert = vi.fn(() => ({ values: mockInsertValues }));

    mockGetDb.mockReturnValue({
      execute: vi.fn().mockResolvedValue([{ acquired: true }]),
      select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([connection]) }) }) }),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => {
        const tx = {
          delete: () => ({ where: () => Promise.resolve() }),
          insert: () => ({ values: () => Promise.resolve() }),
        };
        return fn(tx);
      }),
      insert: mockInsert,
    });

    return { mockInsert, mockOnConflictDoNothing };
  }

  it("dispatches alert when dedup insert succeeds (new crossing)", async () => {
    const { mockInsert } = mockDbWithAlertDedup({
      connection: { id: "c1", orgId: ORG_ID, status: "active", encryptedKey: "enc" },
      alertInsertReturns: [{ id: "alert-1" }], // Insert succeeded
    });
    mockDecryptStripeKey.mockReturnValue("sk_test_123");
    mockGetMarginTable.mockResolvedValue({
      customers: [{ tagValue: "acme", stripeCustomerId: "cus_1", customerName: "Acme", healthTier: "critical", revenueMicrodollars: 100, costMicrodollars: 200 }],
    });
    mockDetectWorseningCrossings.mockReturnValue([
      { tagValue: "acme", previousMarginPercent: 25, currentMarginPercent: -5 },
    ]);
    mockBuildMarginThresholdPayload.mockReturnValue({ id: "evt_1", type: "margin.threshold_crossed" });

    const result = await syncOrgRevenue(ORG_ID);

    expect(result.error).toBeUndefined();
    expect(mockInsert).toHaveBeenCalled(); // Dedup insert attempted
    expect(mockDispatchWebhookEvent).toHaveBeenCalled(); // Alert dispatched
  });

  it("skips alert when dedup insert returns empty (already sent)", async () => {
    const { mockInsert } = mockDbWithAlertDedup({
      connection: { id: "c1", orgId: ORG_ID, status: "active", encryptedKey: "enc" },
      alertInsertReturns: [], // Conflict — already sent
    });
    mockDecryptStripeKey.mockReturnValue("sk_test_123");
    mockGetMarginTable.mockResolvedValue({
      customers: [{ tagValue: "acme", stripeCustomerId: "cus_1", customerName: "Acme", healthTier: "critical", revenueMicrodollars: 100, costMicrodollars: 200 }],
    });
    mockDetectWorseningCrossings.mockReturnValue([
      { tagValue: "acme", previousMarginPercent: 25, currentMarginPercent: -5 },
    ]);

    const result = await syncOrgRevenue(ORG_ID);

    expect(result.error).toBeUndefined();
    expect(mockInsert).toHaveBeenCalled(); // Dedup insert attempted
    expect(mockDispatchWebhookEvent).not.toHaveBeenCalled(); // Alert NOT dispatched
  });

  it("dispatches alert even when dedup DB insert throws (fail-open)", async () => {
    const connection = { id: "c1", orgId: ORG_ID, status: "active", encryptedKey: "enc" };
    const mockInsert = vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoNothing: vi.fn(() => ({
          returning: vi.fn().mockRejectedValue(new Error("DB connection lost")),
        })),
      })),
    }));

    mockGetDb.mockReturnValue({
      execute: vi.fn().mockResolvedValue([{ acquired: true }]),
      select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([connection]) }) }) }),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => {
        const tx = {
          delete: () => ({ where: () => Promise.resolve() }),
          insert: () => ({ values: () => Promise.resolve() }),
        };
        return fn(tx);
      }),
      insert: mockInsert,
    });
    mockDecryptStripeKey.mockReturnValue("sk_test_123");
    mockGetMarginTable.mockResolvedValue({
      customers: [{ tagValue: "acme", stripeCustomerId: "cus_1", customerName: "Acme", healthTier: "critical", revenueMicrodollars: 100, costMicrodollars: 200 }],
    });
    mockDetectWorseningCrossings.mockReturnValue([
      { tagValue: "acme", previousMarginPercent: 25, currentMarginPercent: -5 },
    ]);
    mockBuildMarginThresholdPayload.mockReturnValue({ id: "evt_1", type: "margin.threshold_crossed" });

    const result = await syncOrgRevenue(ORG_ID);

    expect(result.error).toBeUndefined();
    // Alert dispatched despite dedup DB error (fail-open)
    expect(mockDispatchWebhookEvent).toHaveBeenCalled();
  });

  it("handles mixed crossings — one new, one already sent", async () => {
    let insertCallCount = 0;
    const mockInsert = vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoNothing: vi.fn(() => ({
          returning: vi.fn().mockImplementation(() => {
            insertCallCount++;
            // First crossing: new (insert succeeds)
            // Second crossing: already sent (returns empty)
            return Promise.resolve(insertCallCount === 1 ? [{ id: "alert-1" }] : []);
          }),
        })),
      })),
    }));

    const connection = { id: "c1", orgId: ORG_ID, status: "active", encryptedKey: "enc" };
    mockGetDb.mockReturnValue({
      execute: vi.fn().mockResolvedValue([{ acquired: true }]),
      select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([connection]) }) }) }),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => {
        const tx = {
          delete: () => ({ where: () => Promise.resolve() }),
          insert: () => ({ values: () => Promise.resolve() }),
        };
        return fn(tx);
      }),
      insert: mockInsert,
    });
    mockDecryptStripeKey.mockReturnValue("sk_test_123");
    mockGetMarginTable.mockResolvedValue({
      customers: [
        { tagValue: "acme", stripeCustomerId: "cus_1", customerName: "Acme", healthTier: "critical", revenueMicrodollars: 100, costMicrodollars: 200 },
        { tagValue: "beta", stripeCustomerId: "cus_2", customerName: "Beta", healthTier: "at_risk", revenueMicrodollars: 500, costMicrodollars: 450 },
      ],
    });
    mockDetectWorseningCrossings.mockReturnValue([
      { tagValue: "acme", previousMarginPercent: 25, currentMarginPercent: -5 },
      { tagValue: "beta", previousMarginPercent: 55, currentMarginPercent: 10 },
    ]);
    mockBuildMarginThresholdPayload.mockReturnValue({ id: "evt_1", type: "margin.threshold_crossed" });

    const result = await syncOrgRevenue(ORG_ID);

    expect(result.error).toBeUndefined();
    // Only 1 webhook dispatched (acme is new, beta is deduped)
    expect(mockDispatchWebhookEvent).toHaveBeenCalledTimes(1);
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
