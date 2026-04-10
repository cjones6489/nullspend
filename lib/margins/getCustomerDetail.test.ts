import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────

const mockGetDb = vi.fn();

vi.mock("@/lib/db/client", () => ({ getDb: () => mockGetDb() }));

vi.mock("@nullspend/db", () => ({
  customerMappings: "customerMappings",
  customerRevenue: "customerRevenue",
  costEvents: "costEvents",
}));

vi.mock("./periods", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./periods")>();
  return actual;
});

import { getCustomerDetail } from "./margin-query";
import { customerMappings, customerRevenue, costEvents } from "@nullspend/db";

// ── Helpers ──────────────────────────────────────────────────────────

const ORG_ID = "org-test";
const PERIOD = "2026-04";
const TAG_VALUE = "acme";

interface MockDetailOptions {
  mapping?: { stripeCustomerId: string; tagKey: string; tagValue: string } | null;
  revenueRows?: {
    stripeCustomerId: string;
    periodStart: Date;
    amountMicrodollars: number;
    customerName: string | null;
    avatarUrl: string | null;
  }[];
  costRows?: { period: string; totalCost: number }[];
  modelRows?: { model: string; cost: number; requestCount: number }[];
}

function setupMockDb(opts: MockDetailOptions = {}) {
  const mapping = opts.mapping !== undefined ? opts.mapping : {
    stripeCustomerId: "cus_1",
    tagKey: "customer",
    tagValue: TAG_VALUE,
  };
  const revenueRows = opts.revenueRows ?? [];
  const costRows = opts.costRows ?? [];
  const modelRows = opts.modelRows ?? [];

  // Track which query we're on for the cost_events table (cost over time vs model breakdown)
  let costQueryCount = 0;

  mockGetDb.mockReturnValue({
    select: (_fields?: unknown) => ({
      from: (table: unknown) => {
        // Mapping lookup
        if (table === customerMappings) {
          return {
            where: () => ({
              limit: () => Promise.resolve(mapping ? [mapping] : []),
            }),
          };
        }
        // Revenue over time
        if (table === customerRevenue) {
          return { where: () => Promise.resolve(revenueRows) };
        }
        // Cost events — two queries: cost over time, then model breakdown
        if (table === costEvents) {
          costQueryCount++;
          if (costQueryCount === 1) {
            // Cost over time query (groupBy)
            return {
              where: () => ({
                groupBy: () => Promise.resolve(costRows),
              }),
            };
          }
          // Model breakdown query (groupBy + orderBy)
          return {
            where: () => ({
              groupBy: () => ({
                orderBy: () => Promise.resolve(modelRows),
              }),
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

describe("getCustomerDetail", () => {
  it("returns null when mapping not found", async () => {
    setupMockDb({ mapping: null });
    const result = await getCustomerDetail(ORG_ID, "unknown-tag", PERIOD);
    expect(result).toBeNull();
  });

  it("returns full detail for a healthy customer", async () => {
    setupMockDb({
      revenueRows: [
        {
          stripeCustomerId: "cus_1",
          periodStart: new Date(Date.UTC(2026, 3, 1)),
          amountMicrodollars: 100_000_000,
          customerName: "Acme Corp",
          avatarUrl: "https://img.test/acme.png",
        },
      ],
      costRows: [
        { period: "2026-04", totalCost: 30_000_000 },
      ],
      modelRows: [
        { model: "gpt-4o", cost: 20_000_000, requestCount: 100 },
        { model: "claude-3-opus", cost: 10_000_000, requestCount: 50 },
      ],
    });

    const result = await getCustomerDetail(ORG_ID, TAG_VALUE, PERIOD);
    expect(result).not.toBeNull();
    expect(result!.stripeCustomerId).toBe("cus_1");
    expect(result!.customerName).toBe("Acme Corp");
    expect(result!.avatarUrl).toBe("https://img.test/acme.png");
    expect(result!.tagValue).toBe(TAG_VALUE);
    expect(result!.revenueMicrodollars).toBe(100_000_000);
    expect(result!.costMicrodollars).toBe(30_000_000);
    // (100 - 30) / 100 * 100 = 70%
    expect(result!.marginPercent).toBe(70);
    expect(result!.healthTier).toBe("healthy");
  });

  it("returns model breakdown sorted by cost", async () => {
    setupMockDb({
      revenueRows: [{
        stripeCustomerId: "cus_1",
        periodStart: new Date(Date.UTC(2026, 3, 1)),
        amountMicrodollars: 100_000_000,
        customerName: "Acme",
        avatarUrl: null,
      }],
      costRows: [{ period: "2026-04", totalCost: 50_000_000 }],
      modelRows: [
        { model: "gpt-4o", cost: 30_000_000, requestCount: 200 },
        { model: "claude-3.5-sonnet", cost: 15_000_000, requestCount: 80 },
        { model: "gpt-4o-mini", cost: 5_000_000, requestCount: 500 },
      ],
    });

    const result = await getCustomerDetail(ORG_ID, TAG_VALUE, PERIOD);
    expect(result!.modelBreakdown).toHaveLength(3);
    expect(result!.modelBreakdown[0].model).toBe("gpt-4o");
    expect(result!.modelBreakdown[0].cost).toBe(30_000_000);
    expect(result!.modelBreakdown[2].model).toBe("gpt-4o-mini");
  });

  it("builds 3-month revenueOverTime", async () => {
    setupMockDb({
      revenueRows: [
        { stripeCustomerId: "cus_1", periodStart: new Date(Date.UTC(2026, 1, 1)), amountMicrodollars: 80_000_000, customerName: "Acme", avatarUrl: null },
        { stripeCustomerId: "cus_1", periodStart: new Date(Date.UTC(2026, 2, 1)), amountMicrodollars: 90_000_000, customerName: "Acme", avatarUrl: null },
        { stripeCustomerId: "cus_1", periodStart: new Date(Date.UTC(2026, 3, 1)), amountMicrodollars: 100_000_000, customerName: "Acme", avatarUrl: null },
      ],
      costRows: [
        { period: "2026-02", totalCost: 20_000_000 },
        { period: "2026-03", totalCost: 30_000_000 },
        { period: "2026-04", totalCost: 40_000_000 },
      ],
      modelRows: [],
    });

    const result = await getCustomerDetail(ORG_ID, TAG_VALUE, PERIOD);
    expect(result!.revenueOverTime).toHaveLength(3);

    expect(result!.revenueOverTime[0]).toEqual({ period: "2026-02", revenue: 80_000_000, cost: 20_000_000 });
    expect(result!.revenueOverTime[1]).toEqual({ period: "2026-03", revenue: 90_000_000, cost: 30_000_000 });
    expect(result!.revenueOverTime[2]).toEqual({ period: "2026-04", revenue: 100_000_000, cost: 40_000_000 });
  });

  it("fills $0 for periods with no revenue or cost data", async () => {
    setupMockDb({
      // Only current period has data
      revenueRows: [{
        stripeCustomerId: "cus_1",
        periodStart: new Date(Date.UTC(2026, 3, 1)),
        amountMicrodollars: 50_000_000,
        customerName: "New",
        avatarUrl: null,
      }],
      costRows: [{ period: "2026-04", totalCost: 10_000_000 }],
      modelRows: [],
    });

    const result = await getCustomerDetail(ORG_ID, TAG_VALUE, PERIOD);
    // Feb and Mar should be $0/$0
    expect(result!.revenueOverTime[0]).toEqual({ period: "2026-02", revenue: 0, cost: 0 });
    expect(result!.revenueOverTime[1]).toEqual({ period: "2026-03", revenue: 0, cost: 0 });
    expect(result!.revenueOverTime[2]).toEqual({ period: "2026-04", revenue: 50_000_000, cost: 10_000_000 });
  });

  it("returns 0% margin (critical) when revenue is $0 but cost exists", async () => {
    setupMockDb({
      revenueRows: [],
      costRows: [{ period: "2026-04", totalCost: 20_000_000 }],
      modelRows: [],
    });

    const result = await getCustomerDetail(ORG_ID, TAG_VALUE, PERIOD);
    expect(result!.marginPercent).toBe(0);
    expect(result!.healthTier).toBe("critical");
    expect(result!.revenueMicrodollars).toBe(0);
    expect(result!.costMicrodollars).toBe(20_000_000);
  });

  it("returns 0% margin when both revenue and cost are $0", async () => {
    setupMockDb({
      revenueRows: [],
      costRows: [],
      modelRows: [],
    });

    const result = await getCustomerDetail(ORG_ID, TAG_VALUE, PERIOD);
    expect(result!.marginPercent).toBe(0);
    expect(result!.healthTier).toBe("at_risk");
  });

  it("returns customerName from current period revenue row", async () => {
    setupMockDb({
      revenueRows: [
        // Older period has different name
        { stripeCustomerId: "cus_1", periodStart: new Date(Date.UTC(2026, 2, 1)), amountMicrodollars: 50_000_000, customerName: "Old Name", avatarUrl: null },
        // Current period has updated name
        { stripeCustomerId: "cus_1", periodStart: new Date(Date.UTC(2026, 3, 1)), amountMicrodollars: 60_000_000, customerName: "New Name", avatarUrl: "https://img.test/new.png" },
      ],
      costRows: [{ period: "2026-04", totalCost: 10_000_000 }],
      modelRows: [],
    });

    const result = await getCustomerDetail(ORG_ID, TAG_VALUE, PERIOD);
    expect(result!.customerName).toBe("New Name");
    expect(result!.avatarUrl).toBe("https://img.test/new.png");
  });

  it("returns empty model breakdown when no cost events in period", async () => {
    setupMockDb({
      revenueRows: [{
        stripeCustomerId: "cus_1",
        periodStart: new Date(Date.UTC(2026, 3, 1)),
        amountMicrodollars: 100_000_000,
        customerName: "Idle",
        avatarUrl: null,
      }],
      costRows: [],
      modelRows: [],
    });

    const result = await getCustomerDetail(ORG_ID, TAG_VALUE, PERIOD);
    expect(result!.modelBreakdown).toEqual([]);
    expect(result!.marginPercent).toBe(100);
    expect(result!.healthTier).toBe("healthy");
  });
});
