import { describe, expect, it } from "vitest";

import type { ActionRecord } from "@/lib/validations/actions";

import {
  buildDecisionMessage,
  buildPendingMessage,
  buildTestMessage,
} from "./message";

function makeAction(overrides: Partial<ActionRecord> = {}): ActionRecord {
  return {
    id: "550e8400-e29b-41d4-a716-446655440000",
    agentId: "demo-agent",
    actionType: "send_email",
    status: "pending",
    payload: {
      to: "sarah@example.com",
      subject: "Follow up",
      body: "Hi Sarah",
    },
    metadata: null,
    createdAt: "2026-03-07T12:00:00.000Z",
    approvedAt: null,
    rejectedAt: null,
    executedAt: null,
    expiresAt: "2026-03-07T13:00:00.000Z",
    expiredAt: null,
    approvedBy: null,
    rejectedBy: null,
    result: null,
    errorMessage: null,
    environment: null,
    sourceFramework: null,
    ...overrides,
  };
}

const DASHBOARD = "http://localhost:3000";

describe("buildPendingMessage", () => {
  it("returns text and blocks", () => {
    const msg = buildPendingMessage(makeAction(), DASHBOARD);

    expect(msg.text).toBe("New pending action: send_email from demo-agent");
    expect(msg.blocks).toHaveLength(4);
  });

  it("includes the correct text fallback for notifications", () => {
    const msg = buildPendingMessage(
      makeAction({ actionType: "shell_command", agentId: "ci-agent" }),
      DASHBOARD,
    );
    expect(msg.text).toBe("New pending action: shell_command from ci-agent");
  });

  it("has a header block", () => {
    const msg = buildPendingMessage(makeAction(), DASHBOARD);
    const header = msg.blocks[0] as { type: string; text: { text: string } };

    expect(header.type).toBe("header");
    expect(header.text.text).toBe("New Action Pending Approval");
  });

  it("shows type and agent in section fields", () => {
    const msg = buildPendingMessage(makeAction(), DASHBOARD);
    const section = msg.blocks[1] as { fields: { text: string }[] };

    expect(section.fields[0].text).toContain("send_email");
    expect(section.fields[1].text).toContain("demo-agent");
  });

  it("shows at most 3 payload keys", () => {
    const action = makeAction({
      payload: { a: "1", b: "2", c: "3", d: "4", e: "5" },
    });
    const msg = buildPendingMessage(action, DASHBOARD);
    const payloadSection = msg.blocks[2] as { text: { text: string } };

    expect(payloadSection.text.text).toContain("*a:*");
    expect(payloadSection.text.text).toContain("*b:*");
    expect(payloadSection.text.text).toContain("*c:*");
    expect(payloadSection.text.text).not.toContain("*d:*");
    expect(payloadSection.text.text).not.toContain("*e:*");
  });

  it("truncates long values at 100 chars", () => {
    const longValue = "x".repeat(200);
    const action = makeAction({ payload: { description: longValue } });
    const msg = buildPendingMessage(action, DASHBOARD);
    const payloadSection = msg.blocks[2] as { text: { text: string } };

    expect(payloadSection.text.text).toContain("\u2026");
    expect(payloadSection.text.text.length).toBeLessThan(250);
  });

  it("handles empty payload gracefully", () => {
    const action = makeAction({ payload: {} });
    const msg = buildPendingMessage(action, DASHBOARD);
    const payloadSection = msg.blocks[2] as { text: { text: string } };

    expect(payloadSection.text.text).toBe("_No payload_");
  });

  it("serializes non-string payload values as JSON", () => {
    const action = makeAction({
      payload: { count: 42, active: true, tags: ["a", "b"] },
    });
    const msg = buildPendingMessage(action, DASHBOARD);
    const payloadSection = msg.blocks[2] as { text: { text: string } };

    expect(payloadSection.text.text).toContain("42");
    expect(payloadSection.text.text).toContain("true");
    expect(payloadSection.text.text).toContain('["a","b"]');
  });

  it("has approve, reject, and view buttons", () => {
    const msg = buildPendingMessage(makeAction(), DASHBOARD);
    const actionsBlock = msg.blocks[3] as {
      elements: { action_id: string; value?: string; url?: string; style?: string }[];
    };

    expect(actionsBlock.elements).toHaveLength(3);
    expect(actionsBlock.elements[0].action_id).toBe("approve_action");
    expect(actionsBlock.elements[0].style).toBe("primary");
    expect(actionsBlock.elements[0].value).toBe("550e8400-e29b-41d4-a716-446655440000");
    expect(actionsBlock.elements[1].action_id).toBe("reject_action");
    expect(actionsBlock.elements[1].style).toBe("danger");
    expect(actionsBlock.elements[2].action_id).toBe("view_dashboard");
    expect(actionsBlock.elements[2].url).toBe(
      "http://localhost:3000/app/actions/550e8400-e29b-41d4-a716-446655440000",
    );
  });

  it("uses the provided dashboard URL for links", () => {
    const msg = buildPendingMessage(makeAction(), "https://agentseam.dev");
    const actionsBlock = msg.blocks[3] as {
      elements: { url?: string }[];
    };

    expect(actionsBlock.elements[2].url).toContain("https://agentseam.dev");
  });
});

describe("buildDecisionMessage", () => {
  it("returns approved message with check emoji", () => {
    const msg = buildDecisionMessage(
      "send_email", "demo-agent", "approved", "jtorrance", DASHBOARD, "abc-123",
    );

    expect(msg.text).toBe("Action approved by jtorrance");
    const header = msg.blocks[0] as { text: { text: string } };
    expect(header.text.text).toContain("\u2705");
    expect(header.text.text).toContain("Approved");
  });

  it("returns rejected message with X emoji", () => {
    const msg = buildDecisionMessage(
      "http_post", "ci-bot", "rejected", "admin", DASHBOARD, "def-456",
    );

    expect(msg.text).toBe("Action rejected by admin");
    const header = msg.blocks[0] as { text: { text: string } };
    expect(header.text.text).toContain("\u274c");
    expect(header.text.text).toContain("Rejected");
  });

  it("returns expired message with clock emoji", () => {
    const msg = buildDecisionMessage(
      "shell_command", "agent-x", "expired", "system", DASHBOARD, "ghi-789",
    );

    expect(msg.text).toBe("Action expired by system");
    const header = msg.blocks[0] as { text: { text: string } };
    expect(header.text.text).toContain("\u23f0");
    expect(header.text.text).toContain("Expired");
  });

  it("includes type and agent fields", () => {
    const msg = buildDecisionMessage(
      "db_write", "data-agent", "approved", "user1", DASHBOARD, "id-1",
    );
    const section = msg.blocks[1] as { fields: { text: string }[] };

    expect(section.fields[0].text).toContain("db_write");
    expect(section.fields[1].text).toContain("data-agent");
  });

  it("shows decided-by", () => {
    const msg = buildDecisionMessage(
      "send_email", "agent", "approved", "jtorrance", DASHBOARD, "id-1",
    );
    const section = msg.blocks[2] as { text: { text: string } };

    expect(section.text.text).toContain("jtorrance");
  });

  it("has a view-in-dashboard link button", () => {
    const msg = buildDecisionMessage(
      "send_email", "agent", "rejected", "admin",
      "https://prod.example.com", "uuid-123",
    );
    const actionsBlock = msg.blocks[3] as {
      elements: { url: string; action_id: string }[];
    };

    expect(actionsBlock.elements).toHaveLength(1);
    expect(actionsBlock.elements[0].url).toBe(
      "https://prod.example.com/app/actions/uuid-123",
    );
  });

  it("has no approve/reject buttons (only view)", () => {
    const msg = buildDecisionMessage(
      "send_email", "agent", "approved", "admin", DASHBOARD, "id-1",
    );
    const actionsBlock = msg.blocks[3] as {
      elements: { action_id: string }[];
    };

    const actionIds = actionsBlock.elements.map((e) => e.action_id);
    expect(actionIds).not.toContain("approve_action");
    expect(actionIds).not.toContain("reject_action");
  });
});

describe("buildTestMessage", () => {
  it("returns text and blocks", () => {
    const msg = buildTestMessage(DASHBOARD);

    expect(msg.text).toBe("AgentSeam Slack integration is working!");
    expect(msg.blocks).toHaveLength(1);
  });

  it("includes dashboard link", () => {
    const msg = buildTestMessage("https://app.example.com");
    const section = msg.blocks[0] as { text: { text: string } };

    expect(section.text.text).toContain("https://app.example.com/app/inbox");
  });
});
