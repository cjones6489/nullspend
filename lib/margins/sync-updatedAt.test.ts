import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────

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

import { syncOrgRevenue } from "./sync";

// ── Helpers ──────────────────────────────────────────────────────────

function emptyAsyncIterator() {
  return {
    [Symbol.asyncIterator]: () => ({
      next: () => Promise.resolve({ done: true as const, value: undefined }),
    }),
  };
}

function invoiceIterator(invoices: unknown[]) {
  let idx = 0;
  return {
    [Symbol.asyncIterator]: () => ({
      next: () => {
        if (idx < invoices.length) {
          return Promise.resolve({ done: false as const, value: invoices[idx++] });
        }
        return Promise.resolve({ done: true as const, value: undefined });
      },
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

// ── updatedAt tests ──────────────────────────────────────────────────

describe("syncOrgRevenue — updatedAt", () => {
  it("sets updatedAt on successful sync", async () => {
    const capturedSets: unknown[] = [];
    mockGetDb.mockReturnValue({
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([{
              id: "conn-1", orgId: "org-1", status: "active", encryptedKey: "enc",
            }]),
          }),
        }),
      }),
      update: () => ({
        set: (values: unknown) => {
          capturedSets.push(values);
          return { where: () => Promise.resolve() };
        },
      }),
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => {
        const tx = {
          delete: () => ({ where: () => Promise.resolve() }),
          insert: () => ({ values: () => Promise.resolve() }),
        };
        return fn(tx);
      }),
    });
    mockDecryptStripeKey.mockReturnValue("sk_test_123");

    await syncOrgRevenue("org-1");

    // The last update call should be the success status update
    const successUpdate = capturedSets.find(
      (s: any) => s.status === "active" && s.lastSyncAt != null,
    ) as Record<string, unknown> | undefined;
    expect(successUpdate).toBeTruthy();
    expect(successUpdate!.updatedAt).toBeInstanceOf(Date);
  });

  it("sets updatedAt on decryption failure", async () => {
    const capturedSets: unknown[] = [];
    mockGetDb.mockReturnValue({
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([{
              id: "conn-1", orgId: "org-1", status: "active", encryptedKey: "bad",
            }]),
          }),
        }),
      }),
      update: () => ({
        set: (values: unknown) => {
          capturedSets.push(values);
          return { where: () => Promise.resolve() };
        },
      }),
    });
    mockDecryptStripeKey.mockImplementation(() => { throw new Error("decrypt fail"); });

    const result = await syncOrgRevenue("org-1");

    expect(result.error).toBe("Decryption failed");
    const errorUpdate = capturedSets[0] as Record<string, unknown>;
    expect(errorUpdate.status).toBe("error");
    expect(errorUpdate.updatedAt).toBeInstanceOf(Date);
  });

  it("sets updatedAt on Stripe API error", async () => {
    const capturedSets: unknown[] = [];
    mockGetDb.mockReturnValue({
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([{
              id: "conn-1", orgId: "org-1", status: "active", encryptedKey: "enc",
            }]),
          }),
        }),
      }),
      update: () => ({
        set: (values: unknown) => {
          capturedSets.push(values);
          return { where: () => Promise.resolve() };
        },
      }),
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => {
        const tx = {
          delete: () => ({ where: () => Promise.resolve() }),
          insert: () => ({ values: () => Promise.resolve() }),
        };
        return fn(tx);
      }),
    });
    mockDecryptStripeKey.mockReturnValue("sk_test_123");
    mockStripeInvoicesList.mockImplementation(() => { throw new Error("rate limited"); });

    const result = await syncOrgRevenue("org-1");

    expect(result.error).toBe("rate limited");
    const errorUpdate = capturedSets[0] as Record<string, unknown>;
    // MRG-1: Transient errors keep status "active" so cron retries next cycle
    expect(errorUpdate.status).toBe("active");
    expect(errorUpdate.updatedAt).toBeInstanceOf(Date);
  });
});

// ── Invoice processing tests ─────────────────────────────────────────

describe("syncOrgRevenue — invoice processing", () => {
  function mockDbForProcessing(capturedTx: { deletes: unknown[]; inserts: unknown[] }) {
    mockGetDb.mockReturnValue({
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([{
              id: "conn-1", orgId: "org-1", status: "active", encryptedKey: "enc",
            }]),
          }),
        }),
      }),
      update: () => ({
        set: () => ({ where: () => Promise.resolve() }),
      }),
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => {
        const tx = {
          delete: () => ({
            where: (...args: unknown[]) => {
              capturedTx.deletes.push(args);
              return Promise.resolve();
            },
          }),
          insert: () => ({
            values: (v: unknown) => {
              capturedTx.inserts.push(v);
              return Promise.resolve();
            },
          }),
        };
        return fn(tx);
      }),
    });
    mockDecryptStripeKey.mockReturnValue("sk_test_123");
  }

  it("processes valid invoices and converts cents to microdollars", async () => {
    const captured = { deletes: [] as unknown[], inserts: [] as unknown[] };
    mockDbForProcessing(captured);

    mockStripeInvoicesList.mockReturnValue(invoiceIterator([
      {
        id: "inv_1",
        created: 1711929600, // 2024-04-01 UTC
        customer: { id: "cus_1", deleted: false, name: "Acme", email: "a@acme.com", metadata: {} },
        currency: "usd",
        amount_paid: 5000, // $50.00
      },
    ]));

    const result = await syncOrgRevenue("org-1");
    expect(result.invoicesFetched).toBe(1);
    expect(result.invoicesSkipped).toBe(0);
    expect(result.customersProcessed).toBe(1);
    expect(result.periodsUpdated).toBe(1);

    // Verify microdollar conversion: $50.00 = 5000 cents × 10,000 = 50,000,000 microdollars
    const inserted = captured.inserts[0] as Record<string, unknown>;
    expect(inserted.amountMicrodollars).toBe(50_000_000);
    expect(inserted.customerName).toBe("Acme");
    expect(inserted.customerEmail).toBe("a@acme.com");
    expect(inserted.currency).toBe("usd");
    expect(inserted.invoiceCount).toBe(1);
  });

  it("aggregates multiple invoices per customer per period", async () => {
    const captured = { deletes: [] as unknown[], inserts: [] as unknown[] };
    mockDbForProcessing(captured);

    // Two invoices for same customer in same month
    mockStripeInvoicesList.mockReturnValue(invoiceIterator([
      {
        id: "inv_1",
        created: 1711929600,
        customer: { id: "cus_1", deleted: false, name: "Acme", email: null, metadata: {} },
        currency: "usd",
        amount_paid: 3000, // $30
      },
      {
        id: "inv_2",
        created: 1712016000, // Same month
        customer: { id: "cus_1", deleted: false, name: "Acme", email: null, metadata: {} },
        currency: "usd",
        amount_paid: 2000, // $20
      },
    ]));

    const result = await syncOrgRevenue("org-1");
    expect(result.customersProcessed).toBe(1);
    expect(result.periodsUpdated).toBe(1);

    // Should be aggregated: 3000 + 2000 = 5000 cents = 50,000,000 microdollars
    const inserted = captured.inserts[0] as Record<string, unknown>;
    expect(inserted.amountMicrodollars).toBe(50_000_000);
    expect(inserted.invoiceCount).toBe(2);
  });

  it("skips deleted customers", async () => {
    const captured = { deletes: [] as unknown[], inserts: [] as unknown[] };
    mockDbForProcessing(captured);

    mockStripeInvoicesList.mockReturnValue(invoiceIterator([
      {
        id: "inv_1",
        created: 1711929600,
        customer: { id: "cus_1", deleted: true, name: "Gone", email: null, metadata: {} },
        currency: "usd",
        amount_paid: 5000,
      },
    ]));

    const result = await syncOrgRevenue("org-1");
    expect(result.invoicesSkipped).toBe(1);
    expect(result.customersProcessed).toBe(0);
    expect(captured.inserts).toHaveLength(0);
  });

  it("skips invoices with string customer (not expanded)", async () => {
    const captured = { deletes: [] as unknown[], inserts: [] as unknown[] };
    mockDbForProcessing(captured);

    mockStripeInvoicesList.mockReturnValue(invoiceIterator([
      {
        id: "inv_1",
        created: 1711929600,
        customer: "cus_1", // string, not expanded
        currency: "usd",
        amount_paid: 5000,
      },
    ]));

    const result = await syncOrgRevenue("org-1");
    expect(result.invoicesSkipped).toBe(1);
    expect(result.customersProcessed).toBe(0);
  });

  it("passes customer metadata to auto-match", async () => {
    const captured = { deletes: [] as unknown[], inserts: [] as unknown[] };
    mockDbForProcessing(captured);

    mockStripeInvoicesList.mockReturnValue(invoiceIterator([
      {
        id: "inv_1",
        created: 1711929600,
        customer: {
          id: "cus_1",
          deleted: false,
          name: "Acme",
          email: null,
          metadata: { nullspend_customer: "acme-tag" },
        },
        currency: "usd",
        amount_paid: 5000,
      },
    ]));

    await syncOrgRevenue("org-1");

    expect(mockRunAutoMatch).toHaveBeenCalledWith("org-1", [
      { id: "cus_1", metadata: { nullspend_customer: "acme-tag" } },
    ]);
  });

  it("handles invoice with amount_paid = 0", async () => {
    const captured = { deletes: [] as unknown[], inserts: [] as unknown[] };
    mockDbForProcessing(captured);

    mockStripeInvoicesList.mockReturnValue(invoiceIterator([
      {
        id: "inv_1",
        created: 1711929600,
        customer: { id: "cus_1", deleted: false, name: "Free Trial", email: null, metadata: {} },
        currency: "usd",
        amount_paid: 0,
      },
    ]));

    const result = await syncOrgRevenue("org-1");
    expect(result.invoicesFetched).toBe(1);
    expect(result.periodsUpdated).toBe(1);

    const inserted = captured.inserts[0] as Record<string, unknown>;
    expect(inserted.amountMicrodollars).toBe(0);
  });

  it("de-duplicates customers for auto-match", async () => {
    const captured = { deletes: [] as unknown[], inserts: [] as unknown[] };
    mockDbForProcessing(captured);

    // Same customer, two invoices
    mockStripeInvoicesList.mockReturnValue(invoiceIterator([
      {
        id: "inv_1",
        created: 1711929600,
        customer: { id: "cus_1", deleted: false, name: "Acme", email: null, metadata: {} },
        currency: "usd",
        amount_paid: 3000,
      },
      {
        id: "inv_2",
        created: 1712016000,
        customer: { id: "cus_1", deleted: false, name: "Acme", email: null, metadata: {} },
        currency: "usd",
        amount_paid: 2000,
      },
    ]));

    await syncOrgRevenue("org-1");

    // Auto-match should only receive one customer entry
    expect(mockRunAutoMatch).toHaveBeenCalledWith("org-1", [
      expect.objectContaining({ id: "cus_1" }),
    ]);
  });
});
