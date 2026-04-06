import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetDb = vi.fn();

vi.mock("@/lib/db/client", () => ({ getDb: () => mockGetDb() }));
vi.mock("@nullspend/db", () => ({
  customerMappings: { id: "id", orgId: "org_id", tagKey: "tag_key", stripeCustomerId: "stripe_customer_id", tagValue: "tag_value" },
  costEvents: { orgId: "org_id", tags: "tags", createdAt: "created_at" },
}));

import { runAutoMatch } from "./auto-match";

const ORG_ID = "org-test";

beforeEach(() => {
  vi.clearAllMocks();
});

function mockInsertSuccess() {
  return {
    values: (_v: unknown) => ({
      onConflictDoNothing: () => ({
        returning: () => Promise.resolve([{ id: "m-1" }]),
      }),
    }),
  };
}

describe("runAutoMatch", () => {
  it("returns 0 if no customer tag values exist in cost_events", async () => {
    mockGetDb.mockReturnValue({
      select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }),
    });

    const result = await runAutoMatch(ORG_ID, [
      { id: "cus_1", metadata: { nullspend_customer: "acme" } },
    ]);
    expect(result).toBe(0);
  });

  it("returns 0 with no customers to match", async () => {
    let callCount = 0;
    mockGetDb.mockReturnValue({
      select: () => ({
        from: () => ({
          where: () => {
            callCount++;
            if (callCount === 1) return { limit: () => Promise.resolve([{ tagValue: "acme" }]) };
            return Promise.resolve([]);
          },
        }),
      }),
    });

    const result = await runAutoMatch(ORG_ID, []);
    expect(result).toBe(0);
  });

  it("matches via metadata.nullspend_customer with confidence 1.0", async () => {
    let callCount = 0;
    mockGetDb.mockReturnValue({
      select: () => ({
        from: () => ({
          where: () => {
            callCount++;
            if (callCount === 1) return { limit: () => Promise.resolve([{ tagValue: "acme" }]) };
            return Promise.resolve([]);
          },
        }),
      }),
      insert: mockInsertSuccess,
    });

    const result = await runAutoMatch(ORG_ID, [
      { id: "cus_1", metadata: { nullspend_customer: "acme" } },
    ]);
    expect(result).toBe(1);
  });

  it("matches via Stripe customer ID with confidence 0.9", async () => {
    let callCount = 0;
    mockGetDb.mockReturnValue({
      select: () => ({
        from: () => ({
          where: () => {
            callCount++;
            if (callCount === 1) return { limit: () => Promise.resolve([{ tagValue: "cus_abc" }]) };
            return Promise.resolve([]);
          },
        }),
      }),
      insert: mockInsertSuccess,
    });

    const result = await runAutoMatch(ORG_ID, [
      { id: "cus_abc", metadata: null },
    ]);
    expect(result).toBe(1);
  });

  it("skips customers already mapped", async () => {
    let callCount = 0;
    mockGetDb.mockReturnValue({
      select: () => ({
        from: () => ({
          where: () => {
            callCount++;
            if (callCount === 1) return { limit: () => Promise.resolve([{ tagValue: "acme" }]) };
            return Promise.resolve([{ stripeCustomerId: "cus_1", tagValue: "acme" }]);
          },
        }),
      }),
    });

    const result = await runAutoMatch(ORG_ID, [
      { id: "cus_1", metadata: { nullspend_customer: "acme" } },
    ]);
    expect(result).toBe(0);
  });

  it("prefers metadata match over customer ID match", async () => {
    let callCount = 0;
    const insertedValues: unknown[] = [];
    mockGetDb.mockReturnValue({
      select: () => ({
        from: () => ({
          where: () => {
            callCount++;
            if (callCount === 1) return { limit: () => Promise.resolve([{ tagValue: "acme" }, { tagValue: "cus_1" }]) };
            return Promise.resolve([]);
          },
        }),
      }),
      insert: () => ({
        values: (v: unknown) => {
          insertedValues.push(v);
          return {
            onConflictDoNothing: () => ({
              returning: () => Promise.resolve([{ id: "m-1" }]),
            }),
          };
        },
      }),
    });

    const result = await runAutoMatch(ORG_ID, [
      { id: "cus_1", metadata: { nullspend_customer: "acme" } },
    ]);
    expect(result).toBe(1);
    expect(insertedValues[0]).toMatchObject({ tagValue: "acme", confidence: 1.0 });
  });
});
