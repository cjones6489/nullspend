import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetDb = vi.fn();

vi.mock("@/lib/db/client", () => ({ getDb: () => mockGetDb() }));
vi.mock("@nullspend/db", () => ({
  customerMappings: { id: "id", orgId: "org_id", tagKey: "tag_key", stripeCustomerId: "stripe_customer_id", tagValue: "tag_value" },
  costEvents: { orgId: "org_id", tags: "tags", createdAt: "created_at" },
}));

import { runAutoMatch } from "./auto-match";

beforeEach(() => vi.clearAllMocks());

describe("runAutoMatch edge cases", () => {
  it("does not double-map when two Stripe customers match the same tag value via metadata", async () => {
    let callCount = 0;
    mockGetDb.mockReturnValue({
      select: () => ({
        from: () => ({
          where: () => {
            callCount++;
            if (callCount === 1) return { limit: () => Promise.resolve([{ tagValue: "shared-tag" }]) };
            return Promise.resolve([]); // no existing mappings
          },
        }),
      }),
      insert: () => ({
        values: () => ({
          onConflictDoNothing: () => ({
            returning: (_arg: unknown) => {
              // First insert succeeds, second would conflict
              return Promise.resolve([{ id: "m-1" }]);
            },
          }),
        }),
      }),
    });

    // Two customers both have metadata pointing to "shared-tag"
    const result = await runAutoMatch("org-1", [
      { id: "cus_1", metadata: { nullspend_customer: "shared-tag" } },
      { id: "cus_2", metadata: { nullspend_customer: "shared-tag" } },
    ]);

    // Only the first should match (existingTagValues.add prevents double-mapping)
    expect(result).toBe(1);
  });

  it("correctly counts inserted when onConflictDoNothing skips", async () => {
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
      insert: () => ({
        values: () => ({
          onConflictDoNothing: () => ({
            // Empty returning = conflict occurred, nothing inserted
            returning: () => Promise.resolve([]),
          }),
        }),
      }),
    });

    const result = await runAutoMatch("org-1", [
      { id: "cus_1", metadata: { nullspend_customer: "acme" } },
    ]);

    // Should report 0 because the returning was empty (conflict)
    expect(result).toBe(0);
  });

  it("handles customer with empty metadata object", async () => {
    let callCount = 0;
    mockGetDb.mockReturnValue({
      select: () => ({
        from: () => ({
          where: () => {
            callCount++;
            if (callCount === 1) return { limit: () => Promise.resolve([{ tagValue: "cus_empty" }]) };
            return Promise.resolve([]);
          },
        }),
      }),
      insert: () => ({
        values: () => ({
          onConflictDoNothing: () => ({
            returning: () => Promise.resolve([{ id: "m-1" }]),
          }),
        }),
      }),
    });

    // Customer has metadata but no nullspend_customer key
    const result = await runAutoMatch("org-1", [
      { id: "cus_empty", metadata: {} },
    ]);

    // Should match via customer ID (matcher 2), not metadata
    expect(result).toBe(1);
  });

  it("handles customer with undefined metadata", async () => {
    let callCount = 0;
    mockGetDb.mockReturnValue({
      select: () => ({
        from: () => ({
          where: () => {
            callCount++;
            if (callCount === 1) return { limit: () => Promise.resolve([{ tagValue: "cus_undef" }]) };
            return Promise.resolve([]);
          },
        }),
      }),
      insert: () => ({
        values: () => ({
          onConflictDoNothing: () => ({
            returning: () => Promise.resolve([{ id: "m-1" }]),
          }),
        }),
      }),
    });

    const result = await runAutoMatch("org-1", [
      { id: "cus_undef", metadata: undefined },
    ]);
    expect(result).toBe(1); // matched via customer ID
  });
});
