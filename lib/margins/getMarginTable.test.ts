import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────

const mockGetDb = vi.fn();

vi.mock("@/lib/db/client", () => ({ getDb: () => mockGetDb() }));

vi.mock("@nullspend/db", () => ({
  stripeConnections: "stripeConnections",
  customerMappings: "customerMappings",
  customerRevenue: "customerRevenue",
  costEvents: "costEvents",
}));

// Keep formatPeriod real so we exercise the same date logic as production
vi.mock("./periods", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./periods")>();
  return actual;
});

import { getMarginTable } from "./margin-query";
import { stripeConnections, customerMappings, customerRevenue, costEvents } from "@nullspend/db";

// ── Helpers ──────────────────────────────────────────────────────────

const ORG_ID = "org-test";
const PERIOD = "2026-04";

interface MockDbOptions {
  connection?: { lastSyncAt: Date | null; status: string } | null;
  mappings?: { stripeCustomerId: string; tagKey: string; tagValue: string }[];
  revenueRows?: {
    stripeCustomerId: string;
    periodStart: Date;
    amountMicrodollars: number;
    customerName: string | null;
    avatarUrl: string | null;
  }[];
  costRows?: { tagValue: string; period: string; totalCost: number }[];
}

function setupMockDb(opts: MockDbOptions = {}) {
  const connection = opts.connection !== undefined ? opts.connection : null;
  const mappings = opts.mappings ?? [];
  const revenueRows = opts.revenueRows ?? [];
  const costRows = opts.costRows ?? [];

  mockGetDb.mockReturnValue({
    select: (fields?: unknown) => ({
      from: (table: unknown) => {
        // Connection query
        if (table === stripeConnections) {
          return {
            where: () => ({
              limit: () => Promise.resolve(connection ? [connection] : []),
            }),
          };
        }
        // Mappings query
        if (table === customerMappings) {
          return { where: () => Promise.resolve(mappings) };
        }
        // Revenue query
        if (table === customerRevenue) {
          return { where: () => Promise.resolve(revenueRows) };
        }
        // Cost events query (with fields arg = aggregation select)
        if (table === costEvents) {
          return {
            where: () => ({
              groupBy: () => Promise.resolve(costRows),
            }),
          };
        }
        return { where: () => Promise.resolve([]) };
      },
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ────────────────────────────────────────────────────────────

describe("getMarginTable", () => {
  // ── Connection status ──────────────────────────────────────────────

  it("returns disconnected status when no connection exists", async () => {
    setupMockDb({ connection: null });
    const result = await getMarginTable(ORG_ID, PERIOD);
    expect(result.summary.syncStatus).toBe("disconnected");
    expect(result.summary.lastSyncAt).toBeNull();
  });

  it("returns active status with lastSyncAt", async () => {
    const syncDate = new Date("2026-04-04T10:00:00Z");
    setupMockDb({ connection: { lastSyncAt: syncDate, status: "active" } });
    const result = await getMarginTable(ORG_ID, PERIOD);
    expect(result.summary.syncStatus).toBe("active");
    expect(result.summary.lastSyncAt).toBe(syncDate.toISOString());
  });

  it("returns error/revoked status from connection", async () => {
    setupMockDb({ connection: { lastSyncAt: null, status: "revoked" } });
    const result = await getMarginTable(ORG_ID, PERIOD);
    expect(result.summary.syncStatus).toBe("revoked");
  });

  // ── Empty mappings early return ────────────────────────────────────

  it("returns empty result with zeroed summary when no mappings exist", async () => {
    setupMockDb({
      connection: { lastSyncAt: new Date(), status: "active" },
      mappings: [],
    });

    const result = await getMarginTable(ORG_ID, PERIOD);
    expect(result.customers).toHaveLength(0);
    expect(result.summary.blendedMarginPercent).toBe(0);
    expect(result.summary.totalRevenueMicrodollars).toBe(0);
    expect(result.summary.totalCostMicrodollars).toBe(0);
    expect(result.summary.criticalCount).toBe(0);
    expect(result.summary.atRiskCount).toBe(0);
    expect(result.summary.syncStatus).toBe("active");
  });

  // ── Ghost row filter ───────────────────────────────────────────────

  it("filters out ghost rows (mapped customer with $0 revenue and $0 cost)", async () => {
    setupMockDb({
      connection: { lastSyncAt: new Date(), status: "active" },
      mappings: [
        { stripeCustomerId: "cus_1", tagKey: "customer", tagValue: "acme" },
        { stripeCustomerId: "cus_2", tagKey: "customer", tagValue: "ghost" },
      ],
      revenueRows: [
        {
          stripeCustomerId: "cus_1",
          periodStart: new Date(Date.UTC(2026, 3, 1)),
          amountMicrodollars: 100_000_000,
          customerName: "Acme Corp",
          avatarUrl: null,
        },
        // cus_2 has no revenue row for this period
      ],
      costRows: [
        { tagValue: "acme", period: "2026-04", totalCost: 30_000_000 },
        // "ghost" has no cost row either
      ],
    });

    const result = await getMarginTable(ORG_ID, PERIOD);
    expect(result.customers).toHaveLength(1);
    expect(result.customers[0].tagValue).toBe("acme");
    // Ghost row must not inflate summary
    expect(result.summary.totalRevenueMicrodollars).toBe(100_000_000);
    expect(result.summary.totalCostMicrodollars).toBe(30_000_000);
    expect(result.summary.atRiskCount).toBe(0);
  });

  it("keeps customer with $0 revenue but non-zero cost (not a ghost)", async () => {
    setupMockDb({
      connection: { lastSyncAt: new Date(), status: "active" },
      mappings: [
        { stripeCustomerId: "cus_1", tagKey: "customer", tagValue: "free-tier" },
      ],
      revenueRows: [],
      costRows: [
        { tagValue: "free-tier", period: "2026-04", totalCost: 5_000_000 },
      ],
    });

    const result = await getMarginTable(ORG_ID, PERIOD);
    expect(result.customers).toHaveLength(1);
    expect(result.customers[0].marginPercent).toBe(-100);
    expect(result.customers[0].healthTier).toBe("critical");
    expect(result.summary.criticalCount).toBe(1);
  });

  it("keeps customer with non-zero revenue but $0 cost (not a ghost)", async () => {
    setupMockDb({
      connection: { lastSyncAt: new Date(), status: "active" },
      mappings: [
        { stripeCustomerId: "cus_1", tagKey: "customer", tagValue: "no-usage" },
      ],
      revenueRows: [
        {
          stripeCustomerId: "cus_1",
          periodStart: new Date(Date.UTC(2026, 3, 1)),
          amountMicrodollars: 50_000_000,
          customerName: "Paying But Idle",
          avatarUrl: null,
        },
      ],
      costRows: [],
    });

    const result = await getMarginTable(ORG_ID, PERIOD);
    expect(result.customers).toHaveLength(1);
    expect(result.customers[0].marginPercent).toBe(100);
    expect(result.customers[0].healthTier).toBe("healthy");
  });

  // ── Margin calculations ────────────────────────────────────────────

  it("calculates margin percent correctly for healthy customer", async () => {
    setupMockDb({
      connection: { lastSyncAt: new Date(), status: "active" },
      mappings: [{ stripeCustomerId: "cus_1", tagKey: "customer", tagValue: "acme" }],
      revenueRows: [{
        stripeCustomerId: "cus_1",
        periodStart: new Date(Date.UTC(2026, 3, 1)),
        amountMicrodollars: 200_000_000, // $200
        customerName: "Acme",
        avatarUrl: null,
      }],
      costRows: [{ tagValue: "acme", period: "2026-04", totalCost: 60_000_000 }], // $60
    });

    const result = await getMarginTable(ORG_ID, PERIOD);
    const customer = result.customers[0];
    // (200 - 60) / 200 * 100 = 70%
    expect(customer.marginPercent).toBe(70);
    expect(customer.marginMicrodollars).toBe(140_000_000);
    expect(customer.healthTier).toBe("healthy");
  });

  it("calculates margin for critical customer (cost > revenue)", async () => {
    setupMockDb({
      connection: { lastSyncAt: new Date(), status: "active" },
      mappings: [{ stripeCustomerId: "cus_1", tagKey: "customer", tagValue: "money-pit" }],
      revenueRows: [{
        stripeCustomerId: "cus_1",
        periodStart: new Date(Date.UTC(2026, 3, 1)),
        amountMicrodollars: 10_000_000, // $10
        customerName: "Money Pit",
        avatarUrl: null,
      }],
      costRows: [{ tagValue: "money-pit", period: "2026-04", totalCost: 50_000_000 }], // $50
    });

    const result = await getMarginTable(ORG_ID, PERIOD);
    const customer = result.customers[0];
    // (10 - 50) / 10 * 100 = -400%
    expect(customer.marginPercent).toBe(-400);
    expect(customer.healthTier).toBe("critical");
    expect(result.summary.criticalCount).toBe(1);
  });

  // ── Sorting ────────────────────────────────────────────────────────

  it("sorts customers by margin percent ascending (worst first)", async () => {
    setupMockDb({
      connection: { lastSyncAt: new Date(), status: "active" },
      mappings: [
        { stripeCustomerId: "cus_a", tagKey: "customer", tagValue: "alpha" },
        { stripeCustomerId: "cus_b", tagKey: "customer", tagValue: "beta" },
        { stripeCustomerId: "cus_c", tagKey: "customer", tagValue: "gamma" },
      ],
      revenueRows: [
        { stripeCustomerId: "cus_a", periodStart: new Date(Date.UTC(2026, 3, 1)), amountMicrodollars: 100_000_000, customerName: "Alpha", avatarUrl: null },
        { stripeCustomerId: "cus_b", periodStart: new Date(Date.UTC(2026, 3, 1)), amountMicrodollars: 100_000_000, customerName: "Beta", avatarUrl: null },
        { stripeCustomerId: "cus_c", periodStart: new Date(Date.UTC(2026, 3, 1)), amountMicrodollars: 100_000_000, customerName: "Gamma", avatarUrl: null },
      ],
      costRows: [
        { tagValue: "alpha", period: "2026-04", totalCost: 20_000_000 },  // 80%
        { tagValue: "beta", period: "2026-04", totalCost: 90_000_000 },   // 10%
        { tagValue: "gamma", period: "2026-04", totalCost: 50_000_000 },  // 50%
      ],
    });

    const result = await getMarginTable(ORG_ID, PERIOD);
    expect(result.customers.map((c) => c.tagValue)).toEqual(["beta", "gamma", "alpha"]);
    expect(result.customers[0].marginPercent).toBe(10);
    expect(result.customers[2].marginPercent).toBe(80);
  });

  // ── Blended margin ─────────────────────────────────────────────────

  it("computes blended margin across all customers", async () => {
    setupMockDb({
      connection: { lastSyncAt: new Date(), status: "active" },
      mappings: [
        { stripeCustomerId: "cus_a", tagKey: "customer", tagValue: "alpha" },
        { stripeCustomerId: "cus_b", tagKey: "customer", tagValue: "beta" },
      ],
      revenueRows: [
        { stripeCustomerId: "cus_a", periodStart: new Date(Date.UTC(2026, 3, 1)), amountMicrodollars: 100_000_000, customerName: "A", avatarUrl: null },
        { stripeCustomerId: "cus_b", periodStart: new Date(Date.UTC(2026, 3, 1)), amountMicrodollars: 100_000_000, customerName: "B", avatarUrl: null },
      ],
      costRows: [
        { tagValue: "alpha", period: "2026-04", totalCost: 30_000_000 },
        { tagValue: "beta", period: "2026-04", totalCost: 70_000_000 },
      ],
    });

    const result = await getMarginTable(ORG_ID, PERIOD);
    // total revenue = 200M, total cost = 100M → blended = 50%
    expect(result.summary.blendedMarginPercent).toBe(50);
    expect(result.summary.totalRevenueMicrodollars).toBe(200_000_000);
    expect(result.summary.totalCostMicrodollars).toBe(100_000_000);
  });

  it("returns 0% blended margin when all revenue is zero", async () => {
    setupMockDb({
      connection: { lastSyncAt: new Date(), status: "active" },
      mappings: [{ stripeCustomerId: "cus_1", tagKey: "customer", tagValue: "free" }],
      revenueRows: [],
      costRows: [{ tagValue: "free", period: "2026-04", totalCost: 10_000_000 }],
    });

    const result = await getMarginTable(ORG_ID, PERIOD);
    expect(result.summary.blendedMarginPercent).toBe(0);
  });

  // ── Budget suggestion ──────────────────────────────────────────────

  it("suggests budget for critical customers with positive revenue", async () => {
    setupMockDb({
      connection: { lastSyncAt: new Date(), status: "active" },
      mappings: [{ stripeCustomerId: "cus_1", tagKey: "customer", tagValue: "costly" }],
      revenueRows: [{
        stripeCustomerId: "cus_1",
        periodStart: new Date(Date.UTC(2026, 3, 1)),
        amountMicrodollars: 80_000_000,
        customerName: "Costly",
        avatarUrl: null,
      }],
      costRows: [{ tagValue: "costly", period: "2026-04", totalCost: 200_000_000 }],
    });

    const result = await getMarginTable(ORG_ID, PERIOD);
    const customer = result.customers[0];
    expect(customer.healthTier).toBe("critical");
    expect(customer.budgetSuggestionMicrodollars).toBe(40_000_000); // 80M * 0.5
  });

  it("returns null budget suggestion for non-critical customers", async () => {
    setupMockDb({
      connection: { lastSyncAt: new Date(), status: "active" },
      mappings: [{ stripeCustomerId: "cus_1", tagKey: "customer", tagValue: "healthy" }],
      revenueRows: [{
        stripeCustomerId: "cus_1",
        periodStart: new Date(Date.UTC(2026, 3, 1)),
        amountMicrodollars: 100_000_000,
        customerName: "Healthy",
        avatarUrl: null,
      }],
      costRows: [{ tagValue: "healthy", period: "2026-04", totalCost: 10_000_000 }],
    });

    const result = await getMarginTable(ORG_ID, PERIOD);
    expect(result.customers[0].budgetSuggestionMicrodollars).toBeNull();
  });

  it("returns null budget suggestion for critical customer with $0 revenue", async () => {
    setupMockDb({
      connection: { lastSyncAt: new Date(), status: "active" },
      mappings: [{ stripeCustomerId: "cus_1", tagKey: "customer", tagValue: "freeloader" }],
      revenueRows: [],
      costRows: [{ tagValue: "freeloader", period: "2026-04", totalCost: 50_000_000 }],
    });

    const result = await getMarginTable(ORG_ID, PERIOD);
    expect(result.customers[0].healthTier).toBe("critical");
    expect(result.customers[0].budgetSuggestionMicrodollars).toBeNull();
  });

  // ── Sparkline ──────────────────────────────────────────────────────

  it("builds 3-month sparkline with correct periods", async () => {
    setupMockDb({
      connection: { lastSyncAt: new Date(), status: "active" },
      mappings: [{ stripeCustomerId: "cus_1", tagKey: "customer", tagValue: "acme" }],
      revenueRows: [
        { stripeCustomerId: "cus_1", periodStart: new Date(Date.UTC(2026, 1, 1)), amountMicrodollars: 100_000_000, customerName: "Acme", avatarUrl: null },
        { stripeCustomerId: "cus_1", periodStart: new Date(Date.UTC(2026, 2, 1)), amountMicrodollars: 100_000_000, customerName: "Acme", avatarUrl: null },
        { stripeCustomerId: "cus_1", periodStart: new Date(Date.UTC(2026, 3, 1)), amountMicrodollars: 100_000_000, customerName: "Acme", avatarUrl: null },
      ],
      costRows: [
        { tagValue: "acme", period: "2026-02", totalCost: 50_000_000 },
        { tagValue: "acme", period: "2026-03", totalCost: 60_000_000 },
        { tagValue: "acme", period: "2026-04", totalCost: 70_000_000 },
      ],
    });

    const result = await getMarginTable(ORG_ID, PERIOD);
    const sparkline = result.customers[0].sparkline;
    expect(sparkline).toHaveLength(3);
    expect(sparkline[0].period).toBe("2026-02");
    expect(sparkline[0].marginPercent).toBe(50); // (100-50)/100*100
    expect(sparkline[1].period).toBe("2026-03");
    expect(sparkline[1].marginPercent).toBe(40); // (100-60)/100*100
    expect(sparkline[2].period).toBe("2026-04");
    expect(sparkline[2].marginPercent).toBe(30); // (100-70)/100*100
  });

  it("sparkline uses 0% for periods with no data", async () => {
    setupMockDb({
      connection: { lastSyncAt: new Date(), status: "active" },
      mappings: [{ stripeCustomerId: "cus_1", tagKey: "customer", tagValue: "new" }],
      revenueRows: [
        // Only current period has data
        { stripeCustomerId: "cus_1", periodStart: new Date(Date.UTC(2026, 3, 1)), amountMicrodollars: 100_000_000, customerName: "New", avatarUrl: null },
      ],
      costRows: [
        { tagValue: "new", period: "2026-04", totalCost: 30_000_000 },
      ],
    });

    const result = await getMarginTable(ORG_ID, PERIOD);
    const sparkline = result.customers[0].sparkline;
    expect(sparkline[0].marginPercent).toBe(0); // no data → 0%
    expect(sparkline[1].marginPercent).toBe(0);
    expect(sparkline[2].marginPercent).toBe(70); // current period
  });

  // ── Customer name/avatar fallback ──────────────────────────────────

  it("falls back to older period name when current period has no revenue", async () => {
    setupMockDb({
      connection: { lastSyncAt: new Date(), status: "active" },
      mappings: [{ stripeCustomerId: "cus_1", tagKey: "customer", tagValue: "acme" }],
      revenueRows: [
        // Only an older period has the name
        { stripeCustomerId: "cus_1", periodStart: new Date(Date.UTC(2026, 2, 1)), amountMicrodollars: 50_000_000, customerName: "Acme From March", avatarUrl: "https://img.test/acme.png" },
      ],
      costRows: [
        { tagValue: "acme", period: "2026-04", totalCost: 10_000_000 },
      ],
    });

    const result = await getMarginTable(ORG_ID, PERIOD);
    // Current period revenue = $0, cost = $10 → not a ghost, should show
    expect(result.customers).toHaveLength(1);
    expect(result.customers[0].customerName).toBe("Acme From March");
    expect(result.customers[0].avatarUrl).toBe("https://img.test/acme.png");
  });

  // ── Health tier counts ─────────────────────────────────────────────

  it("counts critical and at_risk customers correctly", async () => {
    setupMockDb({
      connection: { lastSyncAt: new Date(), status: "active" },
      mappings: [
        { stripeCustomerId: "cus_a", tagKey: "customer", tagValue: "alpha" },
        { stripeCustomerId: "cus_b", tagKey: "customer", tagValue: "beta" },
        { stripeCustomerId: "cus_c", tagKey: "customer", tagValue: "gamma" },
      ],
      revenueRows: [
        { stripeCustomerId: "cus_a", periodStart: new Date(Date.UTC(2026, 3, 1)), amountMicrodollars: 100_000_000, customerName: null, avatarUrl: null },
        { stripeCustomerId: "cus_b", periodStart: new Date(Date.UTC(2026, 3, 1)), amountMicrodollars: 100_000_000, customerName: null, avatarUrl: null },
        { stripeCustomerId: "cus_c", periodStart: new Date(Date.UTC(2026, 3, 1)), amountMicrodollars: 100_000_000, customerName: null, avatarUrl: null },
      ],
      costRows: [
        { tagValue: "alpha", period: "2026-04", totalCost: 200_000_000 }, // -100% → critical
        { tagValue: "beta", period: "2026-04", totalCost: 90_000_000 },  // 10% → at_risk
        { tagValue: "gamma", period: "2026-04", totalCost: 20_000_000 }, // 80% → healthy
      ],
    });

    const result = await getMarginTable(ORG_ID, PERIOD);
    expect(result.summary.criticalCount).toBe(1);
    expect(result.summary.atRiskCount).toBe(1);
  });
});
