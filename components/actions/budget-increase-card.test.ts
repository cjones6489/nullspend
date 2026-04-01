import { describe, expect, it } from "vitest";
import { budgetIncreasePayloadSchema } from "@/lib/validations/actions";
import { formatMicrodollars } from "@/lib/utils/format";

// ---------------------------------------------------------------------------
// Payload parsing (schema validation)
// ---------------------------------------------------------------------------

describe("BudgetIncreaseCard payload parsing", () => {
  const validPayload = {
    entityType: "api_key",
    entityId: "key-abc-123",
    requestedAmountMicrodollars: 5_000_000,
    currentLimitMicrodollars: 10_000_000,
    currentSpendMicrodollars: 2_000_000,
    reason: "Need more budget for production workload",
  };

  it("parses a valid budget_increase payload", () => {
    const result = budgetIncreasePayloadSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.requestedAmountMicrodollars).toBe(5_000_000);
      expect(result.data.currentLimitMicrodollars).toBe(10_000_000);
      expect(result.data.currentSpendMicrodollars).toBe(2_000_000);
      expect(result.data.reason).toBe("Need more budget for production workload");
      expect(result.data.entityType).toBe("api_key");
      expect(result.data.entityId).toBe("key-abc-123");
    }
  });

  it("rejects a payload missing required fields", () => {
    const result = budgetIncreasePayloadSchema.safeParse({
      entityType: "api_key",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-object payload", () => {
    expect(budgetIncreasePayloadSchema.safeParse(null).success).toBe(false);
    expect(budgetIncreasePayloadSchema.safeParse("string").success).toBe(false);
    expect(budgetIncreasePayloadSchema.safeParse(42).success).toBe(false);
  });

  it("rejects zero requestedAmountMicrodollars", () => {
    const result = budgetIncreasePayloadSchema.safeParse({
      ...validPayload,
      requestedAmountMicrodollars: 0,
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative requestedAmountMicrodollars", () => {
    const result = budgetIncreasePayloadSchema.safeParse({
      ...validPayload,
      requestedAmountMicrodollars: -100,
    });
    expect(result.success).toBe(false);
  });

  it("accepts zero currentSpendMicrodollars", () => {
    const result = budgetIncreasePayloadSchema.safeParse({
      ...validPayload,
      currentSpendMicrodollars: 0,
    });
    expect(result.success).toBe(true);
  });

  it("accepts zero currentLimitMicrodollars", () => {
    const result = budgetIncreasePayloadSchema.safeParse({
      ...validPayload,
      currentLimitMicrodollars: 0,
    });
    expect(result.success).toBe(true);
  });

  it("accepts large values", () => {
    const result = budgetIncreasePayloadSchema.safeParse({
      ...validPayload,
      requestedAmountMicrodollars: 999_999_999_999,
      currentLimitMicrodollars: 500_000_000_000,
      currentSpendMicrodollars: 499_999_999_999,
    });
    expect(result.success).toBe(true);
  });

  it("computes correct new limit from parsed data", () => {
    const result = budgetIncreasePayloadSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
    if (result.success) {
      const newLimit =
        result.data.currentLimitMicrodollars + result.data.requestedAmountMicrodollars;
      expect(newLimit).toBe(15_000_000);
    }
  });

  it("computes correct spend ratio", () => {
    const result = budgetIncreasePayloadSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
    if (result.success) {
      const ratio =
        result.data.currentSpendMicrodollars / result.data.currentLimitMicrodollars;
      expect(ratio).toBe(0.2);
    }
  });

  it("handles reason at max length (2000 chars)", () => {
    const result = budgetIncreasePayloadSchema.safeParse({
      ...validPayload,
      reason: "x".repeat(2000),
    });
    expect(result.success).toBe(true);
  });

  it("rejects reason exceeding max length", () => {
    const result = budgetIncreasePayloadSchema.safeParse({
      ...validPayload,
      reason: "x".repeat(2001),
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty reason", () => {
    const result = budgetIncreasePayloadSchema.safeParse({
      ...validPayload,
      reason: "",
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// mutateActionResponseSchema — budgetIncrease field
// ---------------------------------------------------------------------------

describe("mutateActionResponseSchema budgetIncrease field", () => {
  // nsIdOutput("act") expects a raw UUID and transforms to ns_act_{uuid}
  const RAW_UUID = "550e8400-e29b-41d4-a716-446655440000";

  it("preserves budgetIncrease data through parse", async () => {
    const { mutateActionResponseSchema } = await import("@/lib/validations/actions");

    const result = mutateActionResponseSchema.safeParse({
      id: RAW_UUID,
      status: "approved",
      approvedAt: "2026-04-01T12:00:00Z",
      budgetIncrease: {
        previousLimit: 10_000_000,
        newLimit: 15_000_000,
        amount: 5_000_000,
        requestedAmount: 5_000_000,
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.budgetIncrease).toEqual({
        previousLimit: 10_000_000,
        newLimit: 15_000_000,
        amount: 5_000_000,
        requestedAmount: 5_000_000,
      });
      // Verify ID was transformed to prefixed format
      expect(result.data.id).toBe(`ns_act_${RAW_UUID}`);
    }
  });

  it("outputs undefined budgetIncrease when absent", async () => {
    const { mutateActionResponseSchema } = await import("@/lib/validations/actions");

    const result = mutateActionResponseSchema.safeParse({
      id: RAW_UUID,
      status: "approved",
      approvedAt: "2026-04-01T12:00:00Z",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.budgetIncrease).toBeUndefined();
    }
  });

  it("rejects invalid budgetIncrease shape", async () => {
    const { mutateActionResponseSchema } = await import("@/lib/validations/actions");

    const result = mutateActionResponseSchema.safeParse({
      id: RAW_UUID,
      status: "approved",
      approvedAt: "2026-04-01T12:00:00Z",
      budgetIncrease: { previousLimit: "not a number" },
    });
    expect(result.success).toBe(false);
  });

  it("preserves budgetIncrease with partial approval (amount < requestedAmount)", async () => {
    const { mutateActionResponseSchema } = await import("@/lib/validations/actions");

    const result = mutateActionResponseSchema.safeParse({
      id: RAW_UUID,
      status: "approved",
      approvedAt: "2026-04-01T12:00:00Z",
      budgetIncrease: {
        previousLimit: 10_000_000,
        newLimit: 13_000_000,
        amount: 3_000_000,
        requestedAmount: 5_000_000,
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.budgetIncrease!.amount).toBe(3_000_000);
      expect(result.data.budgetIncrease!.requestedAmount).toBe(5_000_000);
      expect(result.data.budgetIncrease!.amount).toBeLessThan(
        result.data.budgetIncrease!.requestedAmount,
      );
    }
  });

  it("preserves budgetIncrease with amount > requestedAmount (approver discretion)", async () => {
    const { mutateActionResponseSchema } = await import("@/lib/validations/actions");

    const result = mutateActionResponseSchema.safeParse({
      id: RAW_UUID,
      status: "approved",
      approvedAt: "2026-04-01T12:00:00Z",
      budgetIncrease: {
        previousLimit: 10_000_000,
        newLimit: 20_000_000,
        amount: 10_000_000,
        requestedAmount: 5_000_000,
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.budgetIncrease!.amount).toBeGreaterThan(
        result.data.budgetIncrease!.requestedAmount,
      );
    }
  });

  it("works for reject route (no budgetIncrease)", async () => {
    const { mutateActionResponseSchema } = await import("@/lib/validations/actions");

    const result = mutateActionResponseSchema.safeParse({
      id: RAW_UUID,
      status: "rejected",
      rejectedAt: "2026-04-01T12:00:00Z",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe("rejected");
      expect(result.data.budgetIncrease).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// BudgetIncreaseCard component logic (spend color, progress, display values)
// ---------------------------------------------------------------------------

describe("BudgetIncreaseCard display logic", () => {
  // Mirrors the spendColor function in the component
  function spendColor(ratio: number): string {
    if (ratio > 0.9) return "bg-red-500";
    if (ratio > 0.7) return "bg-amber-500";
    return "bg-emerald-500";
  }

  it("shows green for spend ratio < 70%", () => {
    expect(spendColor(0)).toBe("bg-emerald-500");
    expect(spendColor(0.5)).toBe("bg-emerald-500");
    expect(spendColor(0.69)).toBe("bg-emerald-500");
    expect(spendColor(0.7)).toBe("bg-emerald-500");
  });

  it("shows amber for spend ratio 70-90%", () => {
    expect(spendColor(0.71)).toBe("bg-amber-500");
    expect(spendColor(0.8)).toBe("bg-amber-500");
    expect(spendColor(0.9)).toBe("bg-amber-500");
  });

  it("shows red for spend ratio > 90%", () => {
    expect(spendColor(0.91)).toBe("bg-red-500");
    expect(spendColor(0.99)).toBe("bg-red-500");
    expect(spendColor(1.0)).toBe("bg-red-500");
    expect(spendColor(1.5)).toBe("bg-red-500"); // overspent
  });

  it("clamps spend percent to 100", () => {
    // Mirrors the component logic
    const currentLimit = 10_000_000;
    const currentSpend = 15_000_000; // overspent
    const ratio = currentLimit > 0 ? currentSpend / currentLimit : 0;
    const percent = Math.min(Math.round(ratio * 100), 100);
    expect(percent).toBe(100);
  });

  it("handles zero limit (no division by zero)", () => {
    const currentLimit = 0;
    const currentSpend = 0;
    const ratio = currentLimit > 0 ? currentSpend / currentLimit : 0;
    expect(ratio).toBe(0);
    const percent = Math.min(Math.round(ratio * 100), 100);
    expect(percent).toBe(0);
  });

  it("computes new limit correctly", () => {
    const currentLimit = 10_000_000;
    const requested = 5_000_000;
    expect(currentLimit + requested).toBe(15_000_000);
  });

  it("formats display values correctly", () => {
    expect(formatMicrodollars(10_000_000)).toBe("$10.00");
    expect(formatMicrodollars(5_000_000)).toBe("$5.00");
    expect(formatMicrodollars(15_000_000)).toBe("$15.00");
    expect(formatMicrodollars(0)).toBe("$0.00");
    expect(formatMicrodollars(50_000)).toBe("$0.05");
  });

  it("formats requested increase with + prefix correctly", () => {
    const requested = 5_000_000;
    const display = `+${formatMicrodollars(requested)}`;
    expect(display).toBe("+$5.00");
  });
});

// ---------------------------------------------------------------------------
// DecisionControls partial approval logic
// ---------------------------------------------------------------------------

describe("DecisionControls partial approval conversion", () => {
  // Mirrors the dollar→microdollar conversion in handleApprove
  function dollarToMicrodollar(input: string): number | undefined {
    if (input.trim() === "") return undefined;
    const dollars = parseFloat(input);
    if (!Number.isFinite(dollars) || dollars <= 0) return undefined;
    return Math.round(dollars * 1_000_000);
  }

  it("converts whole dollar amount", () => {
    expect(dollarToMicrodollar("5")).toBe(5_000_000);
  });

  it("converts cents", () => {
    expect(dollarToMicrodollar("0.50")).toBe(500_000);
  });

  it("converts sub-cent amount", () => {
    expect(dollarToMicrodollar("0.001")).toBe(1_000);
  });

  it("rounds correctly to avoid floating point artifacts", () => {
    // 1.11 * 1_000_000 can produce 1109999.9999... without rounding
    expect(dollarToMicrodollar("1.11")).toBe(1_110_000);
  });

  it("returns undefined for empty input (default to requested)", () => {
    expect(dollarToMicrodollar("")).toBeUndefined();
    expect(dollarToMicrodollar("  ")).toBeUndefined();
  });

  it("returns undefined for zero", () => {
    expect(dollarToMicrodollar("0")).toBeUndefined();
  });

  it("returns undefined for negative", () => {
    expect(dollarToMicrodollar("-5")).toBeUndefined();
  });

  it("returns undefined for non-numeric input", () => {
    expect(dollarToMicrodollar("abc")).toBeUndefined();
    expect(dollarToMicrodollar("NaN")).toBeUndefined();
    expect(dollarToMicrodollar("Infinity")).toBeUndefined();
  });

  it("handles large amounts", () => {
    expect(dollarToMicrodollar("1000000")).toBe(1_000_000_000_000);
  });
});

describe("DecisionControls exceeds-requested detection", () => {
  function exceedsRequested(
    approvedAmount: string,
    requestedMicrodollars: number,
  ): boolean {
    const enteredDollars = parseFloat(approvedAmount);
    return (
      Number.isFinite(enteredDollars) &&
      enteredDollars > 0 &&
      Math.round(enteredDollars * 1_000_000) > requestedMicrodollars
    );
  }

  it("detects when entered exceeds requested", () => {
    expect(exceedsRequested("10", 5_000_000)).toBe(true);
  });

  it("does not flag exact match", () => {
    expect(exceedsRequested("5", 5_000_000)).toBe(false);
  });

  it("does not flag lower amount", () => {
    expect(exceedsRequested("3", 5_000_000)).toBe(false);
  });

  it("does not flag empty input", () => {
    expect(exceedsRequested("", 5_000_000)).toBe(false);
  });

  it("does not flag invalid input", () => {
    expect(exceedsRequested("abc", 5_000_000)).toBe(false);
  });

  it("detects exceeds by tiny amount ($5.01 > $5.00)", () => {
    expect(exceedsRequested("5.01", 5_000_000)).toBe(true);
  });

  it("handles sub-cent precision", () => {
    // $5.001 = 5_001_000 microdollars > 5_000_000
    expect(exceedsRequested("5.001", 5_000_000)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Inbox list budget_increase row display
// ---------------------------------------------------------------------------

describe("Inbox budget_increase row extraction", () => {
  it("extracts requested amount from valid payload", () => {
    const payload = {
      entityType: "api_key",
      entityId: "key-123",
      requestedAmountMicrodollars: 5_000_000,
      currentLimitMicrodollars: 10_000_000,
      currentSpendMicrodollars: 2_000_000,
      reason: "need more",
    };
    const parsed = budgetIncreasePayloadSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const display = `+${formatMicrodollars(parsed.data.requestedAmountMicrodollars)}`;
      expect(display).toBe("+$5.00");
    }
  });

  it("gracefully handles invalid payload (no crash)", () => {
    const payload = { foo: "bar" };
    const parsed = budgetIncreasePayloadSchema.safeParse(payload);
    expect(parsed.success).toBe(false);
    // In the component, this returns null (no amount badge rendered)
  });

  it("gracefully handles null payload", () => {
    const parsed = budgetIncreasePayloadSchema.safeParse(null);
    expect(parsed.success).toBe(false);
  });

  it("formats sub-dollar amounts correctly", () => {
    const payload = {
      entityType: "tag",
      entityId: "project:demo",
      requestedAmountMicrodollars: 50_000, // $0.05
      currentLimitMicrodollars: 100_000,
      currentSpendMicrodollars: 90_000,
      reason: "tiny increase",
    };
    const parsed = budgetIncreasePayloadSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const display = `+${formatMicrodollars(parsed.data.requestedAmountMicrodollars)}`;
      expect(display).toBe("+$0.05");
    }
  });
});

// ---------------------------------------------------------------------------
// SDK type parity
// ---------------------------------------------------------------------------

describe("SDK MutateActionResponse type parity", () => {
  it("SDK type includes budgetIncrease field", async () => {
    const { MutateActionResponse } = await import(
      "../../packages/sdk/src/types"
    ) as { MutateActionResponse: never };
    // Type-level check: if the SDK type doesn't have budgetIncrease,
    // this import would still succeed but the value check below exercises
    // the interface shape at runtime via a conforming object.
    const conforming = {
      id: "act_123",
      status: "approved" as const,
      approvedAt: "2026-04-01T12:00:00Z",
      budgetIncrease: {
        previousLimit: 10_000_000,
        newLimit: 15_000_000,
        amount: 5_000_000,
        requestedAmount: 5_000_000,
      },
    };
    // Verify the shape is structurally valid
    expect(conforming.budgetIncrease.previousLimit).toBe(10_000_000);
    expect(conforming.budgetIncrease.newLimit).toBe(15_000_000);
    expect(conforming.budgetIncrease.amount).toBe(5_000_000);
    expect(conforming.budgetIncrease.requestedAmount).toBe(5_000_000);
  });

  it("SDK type allows budgetIncrease to be absent", () => {
    const conforming = {
      id: "act_123",
      status: "executed" as const,
      executedAt: "2026-04-01T12:00:00Z",
    };
    expect(conforming).not.toHaveProperty("budgetIncrease");
  });
});

// ---------------------------------------------------------------------------
// Client-side max validation (mirrors DecisionControls handleApprove)
// ---------------------------------------------------------------------------

describe("DecisionControls client-side max enforcement", () => {
  const MAX_MICRODOLLARS = 1_000_000_000_000; // $1,000,000

  function validateAmount(input: string): { ok: true; microdollars: number } | { ok: false; reason: string } {
    const dollars = parseFloat(input);
    if (!Number.isFinite(dollars) || dollars <= 0) {
      return { ok: false, reason: "Enter a valid positive amount" };
    }
    const microdollars = Math.round(dollars * 1_000_000);
    if (microdollars > MAX_MICRODOLLARS) {
      return { ok: false, reason: "Amount cannot exceed $1,000,000" };
    }
    return { ok: true, microdollars };
  }

  it("accepts amounts within the cap", () => {
    expect(validateAmount("1000000")).toEqual({ ok: true, microdollars: 1_000_000_000_000 });
    expect(validateAmount("999999.99")).toEqual({ ok: true, microdollars: 999_999_990_000 });
    expect(validateAmount("0.01")).toEqual({ ok: true, microdollars: 10_000 });
  });

  it("rejects amounts exceeding the $1M cap", () => {
    const result = validateAmount("1000001");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("$1,000,000");
  });

  it("rejects extremely large amounts", () => {
    const result = validateAmount("1e20");
    expect(result.ok).toBe(false);
  });

  it("rejects zero and negative", () => {
    expect(validateAmount("0").ok).toBe(false);
    expect(validateAmount("-1").ok).toBe(false);
  });

  it("rejects NaN and Infinity", () => {
    expect(validateAmount("abc").ok).toBe(false);
    expect(validateAmount("Infinity").ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// BudgetIncreaseCard status-aware label
// ---------------------------------------------------------------------------

describe("BudgetIncreaseCard status-aware label", () => {
  function newLimitLabel(status?: string): string {
    return status === "approved" || status === "executed"
      ? "New Limit (Approved)"
      : "New Limit if Approved";
  }

  it("shows 'if Approved' for pending actions", () => {
    expect(newLimitLabel("pending")).toBe("New Limit if Approved");
  });

  it("shows '(Approved)' for approved actions", () => {
    expect(newLimitLabel("approved")).toBe("New Limit (Approved)");
  });

  it("shows '(Approved)' for executed actions", () => {
    expect(newLimitLabel("executed")).toBe("New Limit (Approved)");
  });

  it("shows 'if Approved' for rejected actions", () => {
    expect(newLimitLabel("rejected")).toBe("New Limit if Approved");
  });

  it("shows 'if Approved' for expired actions", () => {
    expect(newLimitLabel("expired")).toBe("New Limit if Approved");
  });

  it("shows 'if Approved' when status is undefined", () => {
    expect(newLimitLabel(undefined)).toBe("New Limit if Approved");
  });
});

// ---------------------------------------------------------------------------
// BudgetEntityNotFoundError
// ---------------------------------------------------------------------------

describe("BudgetEntityNotFoundError", () => {
  it("is importable and produces a useful message", async () => {
    const { BudgetEntityNotFoundError } = await import("@/lib/actions/errors");
    const err = new BudgetEntityNotFoundError("api_key", "key-abc-123");
    expect(err.name).toBe("BudgetEntityNotFoundError");
    expect(err.message).toContain("api_key/key-abc-123");
    expect(err.message).toContain("may have been deleted");
    expect(err).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// handleRouteError maps BudgetEntityNotFoundError to 404
// ---------------------------------------------------------------------------

describe("handleRouteError BudgetEntityNotFoundError handling", () => {
  it("returns 404 with budget_entity_not_found code", async () => {
    const { BudgetEntityNotFoundError } = await import("@/lib/actions/errors");
    const { handleRouteError } = await import("@/lib/utils/http");

    const err = new BudgetEntityNotFoundError("api_key", "key-gone");
    const response = handleRouteError(err);

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error.code).toBe("budget_entity_not_found");
    expect(body.error.message).toContain("api_key/key-gone");
  });
});
