import { describe, expect, it } from "vitest";

import type { BudgetSpendEntity } from "./update-spend";
import { detectThresholdCrossings } from "./threshold-detection";

function makeEntity(overrides: Partial<BudgetSpendEntity> = {}): BudgetSpendEntity {
  return {
    id: "budget-1",
    entityType: "api_key",
    entityId: "key-1",
    previousSpend: 0,
    newSpend: 0,
    maxBudget: 10_000_000,
    thresholdPercentages: [],
    ...overrides,
  };
}

const REQUEST_ID = "req-test-001";

describe("detectThresholdCrossings", () => {
  it("crossing 50% threshold emits a warning event", () => {
    const entity = makeEntity({
      previousSpend: 4_900_000,   // 49%
      newSpend: 5_100_000,        // 51%
    });

    const events = detectThresholdCrossings([entity], REQUEST_ID);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("budget.threshold.warning");
    expect(events[0].data.object.threshold_percent).toBe(50);
    expect(events[0].data.object.budget_entity_type).toBe("api_key");
    expect(events[0].data.object.triggered_by_request_id).toBe(REQUEST_ID);
  });

  it("crossing 90% threshold emits a critical event", () => {
    const entity = makeEntity({
      previousSpend: 8_900_000,   // 89%
      newSpend: 9_100_000,        // 91%
    });

    const events = detectThresholdCrossings([entity], REQUEST_ID);

    // Crosses both 90% (critical) threshold from defaults [50, 80, 90, 95]
    const critical = events.filter((e) => e.type === "budget.threshold.critical");
    expect(critical.length).toBeGreaterThanOrEqual(1);
    expect(critical[0].data.object.threshold_percent).toBe(90);
  });

  it("crossing last threshold (95%) emits a critical event", () => {
    const entity = makeEntity({
      previousSpend: 9_400_000,   // 94%
      newSpend: 9_600_000,        // 96%
    });

    const events = detectThresholdCrossings([entity], REQUEST_ID);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("budget.threshold.critical");
    expect(events[0].data.object.threshold_percent).toBe(95);
  });

  it("crossing 100% emits budget.exceeded event", () => {
    const entity = makeEntity({
      previousSpend: 9_900_000,   // 99%
      newSpend: 10_100_000,       // 101%
    });

    const events = detectThresholdCrossings([entity], REQUEST_ID);

    const exceeded = events.filter((e) => e.type === "budget.exceeded");
    expect(exceeded).toHaveLength(1);
    expect(exceeded[0].data.object.budget_limit_microdollars).toBe(10_000_000);
    expect(exceeded[0].data.object.budget_spend_microdollars).toBe(10_100_000);
  });

  it("no crossing when previous spend was already above threshold", () => {
    const entity = makeEntity({
      previousSpend: 9_500_000,   // 95% — already past all default thresholds
      newSpend: 9_600_000,        // 96%
    });

    const events = detectThresholdCrossings([entity], REQUEST_ID);

    expect(events).toHaveLength(0);
  });

  it("multiple thresholds crossed at once emits multiple events", () => {
    // Jump from 0% to 92% — crosses 50%, 80%, 90% defaults
    const entity = makeEntity({
      previousSpend: 0,
      newSpend: 9_200_000,        // 92%
    });

    const events = detectThresholdCrossings([entity], REQUEST_ID);

    const types = events.map((e) => e.data.object.threshold_percent);
    expect(types).toContain(50);
    expect(types).toContain(80);
    expect(types).toContain(90);
    expect(events.length).toBe(3);
  });

  it("uses custom thresholds from entity instead of defaults", () => {
    const entity = makeEntity({
      previousSpend: 0,
      newSpend: 7_500_000,        // 75%
      thresholdPercentages: [25, 50, 75],
    });

    const events = detectThresholdCrossings([entity], REQUEST_ID);

    const thresholds = events.map((e) => e.data.object.threshold_percent);
    expect(thresholds).toEqual([25, 50, 75]);
    // 75 is the last threshold -> critical
    const at75 = events.find((e) => e.data.object.threshold_percent === 75);
    expect(at75!.type).toBe("budget.threshold.critical");
    // 25 is not last and < 90 -> warning
    const at25 = events.find((e) => e.data.object.threshold_percent === 25);
    expect(at25!.type).toBe("budget.threshold.warning");
  });

  it("empty threshold array falls back to defaults", () => {
    const entity = makeEntity({
      previousSpend: 0,
      newSpend: 5_100_000,        // 51%
      thresholdPercentages: [],
    });

    const events = detectThresholdCrossings([entity], REQUEST_ID);

    expect(events).toHaveLength(1);
    expect(events[0].data.object.threshold_percent).toBe(50);
  });

  it("skips entity when maxBudget is zero", () => {
    const entity = makeEntity({
      maxBudget: 0,
      previousSpend: 0,
      newSpend: 1_000_000,
    });

    const events = detectThresholdCrossings([entity], REQUEST_ID);
    expect(events).toHaveLength(0);
  });

  it("skips entity when maxBudget is negative", () => {
    const entity = makeEntity({
      maxBudget: -1_000_000,
      previousSpend: 0,
      newSpend: 500_000,
    });

    const events = detectThresholdCrossings([entity], REQUEST_ID);
    expect(events).toHaveLength(0);
  });

  it("emits events for each entity independently", () => {
    const entityA = makeEntity({
      id: "budget-a",
      entityId: "key-a",
      previousSpend: 4_900_000,   // 49%
      newSpend: 5_100_000,        // 51% — crosses 50%
    });
    const entityB = makeEntity({
      id: "budget-b",
      entityType: "tag",
      entityId: "env=prod",
      previousSpend: 8_900_000,   // 89%
      newSpend: 9_100_000,        // 91% — crosses 90%
    });

    const events = detectThresholdCrossings([entityA, entityB], REQUEST_ID);

    const entityAEvents = events.filter((e) => e.data.object.budget_entity_id === "key-a");
    const entityBEvents = events.filter((e) => e.data.object.budget_entity_id === "env=prod");

    expect(entityAEvents).toHaveLength(1);
    expect(entityAEvents[0].data.object.threshold_percent).toBe(50);

    expect(entityBEvents).toHaveLength(1);
    expect(entityBEvents[0].data.object.threshold_percent).toBe(90);
  });

  it("event ids are unique across all emitted events", () => {
    const entity = makeEntity({
      previousSpend: 0,
      newSpend: 10_100_000,  // 101% — crosses everything + exceeded
    });

    const events = detectThresholdCrossings([entity], REQUEST_ID);

    const ids = events.map((e) => e.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  // -------------------------------------------------------------------------
  // Boundary precision — the math that matters most
  // -------------------------------------------------------------------------

  it("exactly 50.0000% triggers the 50% threshold (not 49.9999%)", () => {
    // 5,000,000 / 10,000,000 = exactly 50% → Math.floor(50) = 50 → triggers
    const entity = makeEntity({
      previousSpend: 4_999_999,  // Math.floor(49.99999) = 49
      newSpend: 5_000_000,       // Math.floor(50.0) = 50
    });

    const events = detectThresholdCrossings([entity], REQUEST_ID);
    expect(events).toHaveLength(1);
    expect(events[0].data.object.threshold_percent).toBe(50);
  });

  it("49.99999% does NOT trigger 50% threshold", () => {
    // 4,999,999 / 10,000,000 = 49.99999% → Math.floor = 49 → NO trigger
    const entity = makeEntity({
      previousSpend: 4_999_998,
      newSpend: 4_999_999,
    });

    const events = detectThresholdCrossings([entity], REQUEST_ID);
    expect(events).toHaveLength(0);
  });

  it("exactly 100% triggers budget.exceeded", () => {
    const entity = makeEntity({
      previousSpend: 9_999_999,  // 99.99999% → floor = 99
      newSpend: 10_000_000,       // 100% → floor = 100
    });

    const events = detectThresholdCrossings([entity], REQUEST_ID);
    const exceeded = events.filter((e) => e.type === "budget.exceeded");
    expect(exceeded).toHaveLength(1);
  });

  it("99.99999% does NOT trigger budget.exceeded", () => {
    const entity = makeEntity({
      previousSpend: 9_999_998,
      newSpend: 9_999_999,  // 99.99999% → floor = 99
    });

    const events = detectThresholdCrossings([entity], REQUEST_ID);
    const exceeded = events.filter((e) => e.type === "budget.exceeded");
    expect(exceeded).toHaveLength(0);
  });

  it("1 microdollar spend on $0.01 budget (max=10000): 0→0.01% floors to 0", () => {
    const entity = makeEntity({
      maxBudget: 10_000,
      previousSpend: 0,
      newSpend: 1,  // 0.01% → floor = 0
    });

    const events = detectThresholdCrossings([entity], REQUEST_ID);
    expect(events).toHaveLength(0);
  });

  it("incremental 1-microdollar crossing at exact boundary", () => {
    // Budget: $10 (10,000,000 microdollars)
    // Spend goes from 4,999,999 to 5,000,001 (crosses 50% exactly)
    const entity = makeEntity({
      previousSpend: 4_999_999,  // 49.99999% → 49
      newSpend: 5_000_001,       // 50.00001% → 50
    });

    const events = detectThresholdCrossings([entity], REQUEST_ID);
    expect(events).toHaveLength(1);
    expect(events[0].data.object.threshold_percent).toBe(50);
  });

  it("very large budget ($1M = 1_000_000_000_000 microdollars) precision", () => {
    const oneMillion = 1_000_000_000_000;
    const entity = makeEntity({
      maxBudget: oneMillion,
      previousSpend: oneMillion / 2 - 1,    // just under 50%
      newSpend: oneMillion / 2,              // exactly 50%
    });

    const events = detectThresholdCrossings([entity], REQUEST_ID);
    expect(events).toHaveLength(1);
    expect(events[0].data.object.threshold_percent).toBe(50);
  });

  it("overspent budget: 150% doesn't re-trigger already-crossed thresholds", () => {
    const entity = makeEntity({
      previousSpend: 14_000_000,  // 140%
      newSpend: 15_000_000,       // 150%
    });

    const events = detectThresholdCrossings([entity], REQUEST_ID);
    expect(events).toHaveLength(0); // all thresholds + exceeded already passed
  });
});
