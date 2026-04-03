import { describe, expect, it } from "vitest";

import {
  buildBudgetIncreaseCompletionMessage,
  buildBudgetIncreaseDecisionMessage,
  buildBudgetIncreasePendingMessage,
} from "@/lib/slack/message";

// SlackBlock uses an index signature ([key: string]: unknown), so direct
// narrowing casts fail TS2352. This helper routes through `unknown`.
function narrowBlock<T>(block: unknown): T {
  return block as T;
}

const DASHBOARD = "http://localhost:3000";

const mockAction = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  agentId: "doc-processor",
  actionType: "budget_increase",
  status: "pending",
  payload: {
    entityType: "api_key",
    entityId: "key-123",
    requestedAmountMicrodollars: 5_000_000,
    currentLimitMicrodollars: 2_000_000,
    currentSpendMicrodollars: 1_950_000,
    reason: "Processing 50 remaining documents",
  },
  metadata: null,
  createdAt: "2026-03-31T12:00:00.000Z",
  approvedAt: null,
  rejectedAt: null,
  executedAt: null,
  expiresAt: "2026-03-31T13:00:00.000Z",
  expiredAt: null,
  approvedBy: null,
  rejectedBy: null,
  result: null,
  errorMessage: null,
  environment: null,
  sourceFramework: null,
} as any;

describe("buildBudgetIncreasePendingMessage", () => {
  it("contains budget details and approve/reject buttons", () => {
    const msg = buildBudgetIncreasePendingMessage(mockAction, DASHBOARD);

    // Text fallback for notifications
    expect(msg.text).toContain("Budget increase requested by doc-processor");
    expect(msg.text).toContain("+$5.00");

    // Header
    const header = narrowBlock<{ type: string; text: { text: string } }>(
      msg.blocks[0],
    );
    expect(header.type).toBe("header");
    expect(header.text.text).toBe("Budget Increase Requested");

    // Current budget & requested increase (first section)
    const budgetSection = narrowBlock<{ fields: { text: string }[] }>(
      msg.blocks[1],
    );
    // currentLimitMicrodollars = 2_000_000 -> $2.00
    expect(budgetSection.fields[0].text).toContain("$2.00");
    // currentSpendMicrodollars = 1_950_000 -> $1.95
    expect(budgetSection.fields[0].text).toContain("$1.95");
    // requestedAmountMicrodollars = 5_000_000 -> +$5.00
    expect(budgetSection.fields[1].text).toContain("+$5.00");

    // New limit if approved & agent (second section)
    const limitsSection = narrowBlock<{ fields: { text: string }[] }>(
      msg.blocks[2],
    );
    // newLimit = 2_000_000 + 5_000_000 = 7_000_000 -> $7.00
    expect(limitsSection.fields[0].text).toContain("$7.00");
    expect(limitsSection.fields[1].text).toContain("doc-processor");

    // Reason section
    const reasonSection = narrowBlock<{ text: { text: string } }>(
      msg.blocks[3],
    );
    expect(reasonSection.text.text).toContain(
      "Processing 50 remaining documents",
    );

    // Approve, Reject, View buttons
    const actionsBlock = narrowBlock<{
      elements: {
        action_id: string;
        value?: string;
        url?: string;
        style?: string;
      }[];
    }>(msg.blocks[4]);
    expect(actionsBlock.elements).toHaveLength(3);
    expect(actionsBlock.elements[0].action_id).toBe("approve_action");
    expect(actionsBlock.elements[0].style).toBe("primary");
    expect(actionsBlock.elements[0].value).toBe(
      "550e8400-e29b-41d4-a716-446655440000",
    );
    expect(actionsBlock.elements[1].action_id).toBe("reject_action");
    expect(actionsBlock.elements[1].style).toBe("danger");
    expect(actionsBlock.elements[2].action_id).toBe("view_dashboard");
    expect(actionsBlock.elements[2].url).toBe(
      "http://localhost:3000/app/actions/ns_act_550e8400-e29b-41d4-a716-446655440000",
    );
  });

  it("truncates long reason strings", () => {
    const longReason = "A".repeat(600);
    const action = {
      ...mockAction,
      payload: {
        ...mockAction.payload,
        reason: longReason,
      },
    };

    const msg = buildBudgetIncreasePendingMessage(action, DASHBOARD);

    const reasonSection = narrowBlock<{ text: { text: string } }>(
      msg.blocks[3],
    );
    // truncate(reason, 500) -> 499 chars + ellipsis
    expect(reasonSection.text.text).toContain("\u2026");
    expect(reasonSection.text.text).not.toContain("A".repeat(600));
    // The full reason block text is "*Reason:* " (10 chars) + 499 chars + ellipsis
    const reasonValue = reasonSection.text.text.replace("*Reason:* ", "");
    expect(reasonValue.length).toBe(500);
  });
});

describe("buildBudgetIncreaseDecisionMessage", () => {
  it("approved: shows old to new limit", () => {
    const msg = buildBudgetIncreaseDecisionMessage(
      "approved",
      2_000_000, // previousLimit
      7_000_000, // newLimit
      "admin@example.com",
    );

    // Text fallback includes check emoji and dollar amounts
    expect(msg.text).toContain("\u2705");
    expect(msg.text).toContain("Budget increased from $2.00 to $7.00");

    // Block content
    const section = narrowBlock<{ text: { text: string } }>(msg.blocks[0]);
    expect(section.text.text).toContain("Budget increased from $2.00 to $7.00");
    expect(section.text.text).toContain("admin@example.com");
  });

  it("rejected: shows rejection text", () => {
    const msg = buildBudgetIncreaseDecisionMessage(
      "rejected",
      2_000_000,
      7_000_000,
      "cfo@example.com",
    );

    // Text fallback includes X emoji and rejection label
    expect(msg.text).toContain("\u274c");
    expect(msg.text).toContain("Budget increase rejected");
    // Should NOT contain dollar amounts in the rejected case
    expect(msg.text).not.toContain("$2.00");

    // Block content
    const section = narrowBlock<{ text: { text: string } }>(msg.blocks[0]);
    expect(section.text.text).toContain("Budget increase rejected");
    expect(section.text.text).toContain("cfo@example.com");
  });
});

describe("buildBudgetIncreaseCompletionMessage", () => {
  it("shows remaining budget", () => {
    const msg = buildBudgetIncreaseCompletionMessage(3_750_000);

    expect(msg.text).toBe("Task completed. Budget remaining: $3.75.");
    expect(msg.blocks).toHaveLength(1);

    const section = narrowBlock<{ text: { text: string } }>(msg.blocks[0]);
    expect(section.text.text).toBe(msg.text);
  });

  it("handles zero remaining", () => {
    const msg = buildBudgetIncreaseCompletionMessage(0);
    expect(msg.text).toContain("remaining: $0.00");
  });
});

describe("formatDollars (tested indirectly)", () => {
  it("handles zero, large numbers, and fractional cents", () => {
    const zeroMsg = buildBudgetIncreaseCompletionMessage(0);
    expect(zeroMsg.text).toContain("remaining: $0.00");

    const largeMsg = buildBudgetIncreaseCompletionMessage(500_000_000);
    expect(largeMsg.text).toContain("remaining: $500.00");

    // 999_999 / 1_000_000 = 0.999999 -> $1.00 (toFixed(2) rounds)
    const fractionalMsg = buildBudgetIncreaseCompletionMessage(999_999);
    expect(fractionalMsg.text).toContain("remaining: $1.00");
  });
});
