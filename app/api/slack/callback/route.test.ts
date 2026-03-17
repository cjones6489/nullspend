import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { approveAction } from "@/lib/actions/approve-action";
import {
  ActionExpiredError,
  ActionNotFoundError,
  InvalidActionTransitionError,
  StaleActionError,
} from "@/lib/actions/errors";
import { rejectAction } from "@/lib/actions/reject-action";
import { getDb } from "@/lib/db/client";

import { POST } from "./route";

vi.mock("@/lib/actions/approve-action", () => ({
  approveAction: vi.fn(),
}));

vi.mock("@/lib/actions/reject-action", () => ({
  rejectAction: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(),
}));

const mockedApproveAction = vi.mocked(approveAction);
const mockedRejectAction = vi.mocked(rejectAction);
const mockedGetDb = vi.mocked(getDb);

const TEST_SECRET = "test-slack-signing-secret-abc123";
const ACTION_ID = "550e8400-e29b-41d4-a716-446655440000";

const dbAction = {
  id: ACTION_ID,
  ownerUserId: "user-123",
  actionType: "send_email",
  agentId: "demo-agent",
};

function sign(body: string, timestamp: string): string {
  const basestring = `v0:${timestamp}:${body}`;
  return "v0=" + createHmac("sha256", TEST_SECRET).update(basestring).digest("hex");
}

function makePayload(overrides: Record<string, unknown> = {}): string {
  const payload = {
    type: "block_actions",
    user: { id: "U1234", username: "jtorrance" },
    actions: [{ action_id: "approve_action", value: ACTION_ID }],
    ...overrides,
  };
  return `payload=${encodeURIComponent(JSON.stringify(payload))}`;
}

function makeSignedRequest(body: string): Request {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = sign(body, timestamp);
  return new Request("http://localhost/api/slack/callback", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature": signature,
    },
    body,
  });
}

function mockDbSelect(
  result: typeof dbAction | undefined,
  slackConfig?: { slackUserId: string | null } | undefined,
) {
  const actionChain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(result ? [result] : []),
  };
  const configChain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(slackConfig ? [slackConfig] : []),
  };
  mockedGetDb
    .mockReturnValueOnce(actionChain as never)
    .mockReturnValueOnce(configChain as never);
  return actionChain;
}

describe("POST /api/slack/callback", () => {
  beforeEach(() => {
    vi.stubEnv("SLACK_SIGNING_SECRET", TEST_SECRET);
    vi.stubEnv("NULLSPEND_URL", "http://localhost:3000");
  });

  afterEach(() => {
    vi.resetAllMocks();
    vi.unstubAllEnvs();
  });

  // ── Signature verification ────────────────────────────────────

  it("rejects request with missing signature headers", async () => {
    const res = await POST(
      new Request("http://localhost/api/slack/callback", {
        method: "POST",
        body: "payload=test",
      }),
    );
    const json = await res.json();
    expect(json.text).toContain("Could not verify");
  });

  it("rejects request with invalid signature", async () => {
    const body = makePayload();
    const timestamp = String(Math.floor(Date.now() / 1000));
    const res = await POST(
      new Request("http://localhost/api/slack/callback", {
        method: "POST",
        headers: {
          "x-slack-request-timestamp": timestamp,
          "x-slack-signature": "v0=000000000000000000000000000000000000000000000000000000000000bad0",
        },
        body,
      }),
    );
    const json = await res.json();
    expect(json.text).toContain("Could not verify");
  });

  it("rejects request with expired timestamp", async () => {
    const body = makePayload();
    const oldTimestamp = String(Math.floor(Date.now() / 1000) - 400);
    const signature = sign(body, oldTimestamp);
    const res = await POST(
      new Request("http://localhost/api/slack/callback", {
        method: "POST",
        headers: {
          "x-slack-request-timestamp": oldTimestamp,
          "x-slack-signature": signature,
        },
        body,
      }),
    );
    const json = await res.json();
    expect(json.text).toContain("Could not verify");
  });

  // ── Payload parsing ───────────────────────────────────────────

  it("returns error for invalid JSON payload", async () => {
    const body = `payload=${encodeURIComponent("{broken json")}`;
    const res = await POST(makeSignedRequest(body));
    const json = await res.json();
    expect(json.text).toContain("Could not parse");
  });

  it("returns error for missing payload field", async () => {
    const body = "no_payload_here=true";
    const res = await POST(makeSignedRequest(body));
    const json = await res.json();
    expect(json.text).toBeDefined();
  });

  it("returns error for unsupported interaction type", async () => {
    const body = makePayload({ type: "shortcut", actions: [{ action_id: "something", value: "x" }] });
    const res = await POST(makeSignedRequest(body));
    const json = await res.json();
    expect(json.text).toContain("Unsupported interaction type");
  });

  it("returns error when actions array is empty", async () => {
    const body = makePayload({ actions: [] });
    const res = await POST(makeSignedRequest(body));
    const json = await res.json();
    expect(json.text).toContain("Unsupported interaction type");
  });

  // ── Non-decision button clicks ────────────────────────────────

  it("returns ok for view_dashboard button (no-op)", async () => {
    const body = makePayload({
      actions: [{ action_id: "view_dashboard", value: ACTION_ID }],
    });
    const res = await POST(makeSignedRequest(body));
    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  it("returns ok for unknown action_id (no-op)", async () => {
    const body = makePayload({
      actions: [{ action_id: "some_other_button", value: "xyz" }],
    });
    const res = await POST(makeSignedRequest(body));
    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  // ── Approve flow ──────────────────────────────────────────────

  it("approves an action and returns success message", async () => {
    mockDbSelect(dbAction);
    mockedApproveAction.mockResolvedValue(undefined as never);

    const body = makePayload();
    const res = await POST(makeSignedRequest(body));
    const json = await res.json();

    expect(mockedApproveAction).toHaveBeenCalledWith(
      ACTION_ID,
      { approvedBy: "jtorrance" },
      "user-123",
    );
    expect(json.replace_original).toBe(true);
    expect(json.text).toContain("approved");
  });

  it("falls back to user.name when username is absent", async () => {
    mockDbSelect(dbAction);
    mockedApproveAction.mockResolvedValue(undefined as never);

    const body = makePayload({
      user: { id: "U1234", name: "Jack Torrance" },
      actions: [{ action_id: "approve_action", value: ACTION_ID }],
    });
    const res = await POST(makeSignedRequest(body));

    expect(mockedApproveAction).toHaveBeenCalledWith(
      ACTION_ID,
      { approvedBy: "Jack Torrance" },
      "user-123",
    );
    const json = await res.json();
    expect(json.text).toContain("approved");
  });

  it("falls back to user.id when username and name are absent", async () => {
    mockDbSelect(dbAction);
    mockedApproveAction.mockResolvedValue(undefined as never);

    const body = makePayload({
      user: { id: "U1234" },
      actions: [{ action_id: "approve_action", value: ACTION_ID }],
    });
    const _res = await POST(makeSignedRequest(body));

    expect(mockedApproveAction).toHaveBeenCalledWith(
      ACTION_ID,
      { approvedBy: "U1234" },
      "user-123",
    );
  });

  // ── Reject flow ───────────────────────────────────────────────

  it("rejects an action and returns success message", async () => {
    mockDbSelect(dbAction);
    mockedRejectAction.mockResolvedValue(undefined as never);

    const body = makePayload({
      actions: [{ action_id: "reject_action", value: ACTION_ID }],
    });
    const res = await POST(makeSignedRequest(body));
    const json = await res.json();

    expect(mockedRejectAction).toHaveBeenCalledWith(
      ACTION_ID,
      { rejectedBy: "jtorrance" },
      "user-123",
    );
    expect(json.replace_original).toBe(true);
    expect(json.text).toContain("rejected");
  });

  // ── Action not found ──────────────────────────────────────────

  it("returns error when action is not found in DB", async () => {
    mockDbSelect(undefined);

    const body = makePayload();
    const res = await POST(makeSignedRequest(body));
    const json = await res.json();

    expect(json.text).toContain("not found");
    expect(mockedApproveAction).not.toHaveBeenCalled();
  });

  it("returns error when action has no ownerUserId", async () => {
    mockDbSelect({ ...dbAction, ownerUserId: "" });

    const body = makePayload();
    const res = await POST(makeSignedRequest(body));
    const json = await res.json();

    expect(json.text).toContain("not found");
  });

  // ── Error handling in approve/reject ──────────────────────────

  it("handles ActionExpiredError with expired message", async () => {
    mockDbSelect(dbAction);
    mockedApproveAction.mockRejectedValue(new ActionExpiredError(ACTION_ID));

    const body = makePayload();
    const res = await POST(makeSignedRequest(body));
    const json = await res.json();

    expect(json.replace_original).toBe(true);
    expect(json.text).toContain("expired");
  });

  it("handles ActionNotFoundError during approve", async () => {
    mockDbSelect(dbAction);
    mockedApproveAction.mockRejectedValue(new ActionNotFoundError(ACTION_ID));

    const body = makePayload();
    const res = await POST(makeSignedRequest(body));
    const json = await res.json();

    expect(json.text).toContain("not found");
  });

  it("handles InvalidActionTransitionError (already decided)", async () => {
    mockDbSelect(dbAction);
    mockedApproveAction.mockRejectedValue(
      new InvalidActionTransitionError("approved", "approved"),
    );

    const body = makePayload();
    const res = await POST(makeSignedRequest(body));
    const json = await res.json();

    expect(json.text).toContain("already been decided");
  });

  it("handles StaleActionError (concurrent modification)", async () => {
    mockDbSelect(dbAction);
    mockedRejectAction.mockRejectedValue(new StaleActionError(ACTION_ID));

    const body = makePayload({
      actions: [{ action_id: "reject_action", value: ACTION_ID }],
    });
    const res = await POST(makeSignedRequest(body));
    const json = await res.json();

    expect(json.text).toContain("already been decided");
  });

  it("handles unexpected errors gracefully", async () => {
    mockDbSelect(dbAction);
    mockedApproveAction.mockRejectedValue(new Error("DB connection lost"));

    const body = makePayload();
    const res = await POST(makeSignedRequest(body));
    const json = await res.json();

    expect(json.text).toContain("Something went wrong");
  });

  // ── Slack user authorization ─────────────────────────────────

  it("allows action when Slack user matches configured slackUserId", async () => {
    mockDbSelect(dbAction, { slackUserId: "U1234" });
    mockedApproveAction.mockResolvedValue(undefined as never);

    const body = makePayload();
    const res = await POST(makeSignedRequest(body));
    const json = await res.json();

    expect(mockedApproveAction).toHaveBeenCalledTimes(1);
    expect(json.replace_original).toBe(true);
    expect(json.text).toContain("approved");
  });

  it("denies action with ephemeral message when Slack user does not match", async () => {
    mockDbSelect(dbAction, { slackUserId: "U9999" });

    const body = makePayload();
    const res = await POST(makeSignedRequest(body));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.response_type).toBe("ephemeral");
    expect(json.replace_original).toBe(false);
    expect(json.text).toContain("not authorized");
    expect(mockedApproveAction).not.toHaveBeenCalled();
  });

  it("allows action when no slack config exists (graceful degradation)", async () => {
    mockDbSelect(dbAction);
    mockedApproveAction.mockResolvedValue(undefined as never);

    const body = makePayload();
    const res = await POST(makeSignedRequest(body));
    const json = await res.json();

    expect(mockedApproveAction).toHaveBeenCalledTimes(1);
    expect(json.text).toContain("approved");
  });

  it("allows action when slackUserId is null (not configured)", async () => {
    mockDbSelect(dbAction, { slackUserId: null });
    mockedApproveAction.mockResolvedValue(undefined as never);

    const body = makePayload();
    const res = await POST(makeSignedRequest(body));
    const json = await res.json();

    expect(mockedApproveAction).toHaveBeenCalledTimes(1);
    expect(json.text).toContain("approved");
  });

  it("denies unauthorized user on reject action too", async () => {
    mockDbSelect(dbAction, { slackUserId: "U9999" });

    const body = makePayload({
      actions: [{ action_id: "reject_action", value: ACTION_ID }],
    });
    const res = await POST(makeSignedRequest(body));
    const json = await res.json();

    expect(json.response_type).toBe("ephemeral");
    expect(json.replace_original).toBe(false);
    expect(json.text).toContain("not authorized");
    expect(mockedRejectAction).not.toHaveBeenCalled();
  });

  it("denies action when authorization lookup fails (fail-closed for security)", async () => {
    const actionChain = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([dbAction]),
    };
    const configChain = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockRejectedValue(new Error("DB down")),
    };
    mockedGetDb
      .mockReturnValueOnce(actionChain as never)
      .mockReturnValueOnce(configChain as never);

    const body = makePayload();
    const res = await POST(makeSignedRequest(body));
    const json = await res.json();

    expect(mockedApproveAction).not.toHaveBeenCalled();
    expect(json.response_type).toBe("ephemeral");
    expect(json.replace_original).toBe(false);
    expect(json.text).toContain("Could not verify your authorization");
  });

  // ── All responses return 200 ──────────────────────────────────

  it("returns HTTP 200 even for errors (Slack requirement)", async () => {
    mockDbSelect(dbAction);
    mockedApproveAction.mockRejectedValue(new Error("kaboom"));

    const body = makePayload();
    const res = await POST(makeSignedRequest(body));

    expect(res.status).toBe(200);
  });

  it("returns HTTP 200 for signature verification failure", async () => {
    const body = makePayload();
    const res = await POST(
      new Request("http://localhost/api/slack/callback", {
        method: "POST",
        headers: {
          "x-slack-request-timestamp": String(Math.floor(Date.now() / 1000)),
          "x-slack-signature": "v0=badbadbadbad",
        },
        body,
      }),
    );
    expect(res.status).toBe(200);
  });

  // ── Edge cases ────────────────────────────────────────────────

  it("processes only the first action in the actions array", async () => {
    mockDbSelect(dbAction);
    mockedApproveAction.mockResolvedValue(undefined as never);
    mockedRejectAction.mockResolvedValue(undefined as never);

    const body = makePayload({
      actions: [
        { action_id: "approve_action", value: ACTION_ID },
        { action_id: "reject_action", value: ACTION_ID },
      ],
    });
    const _res = await POST(makeSignedRequest(body));

    expect(mockedApproveAction).toHaveBeenCalledTimes(1);
    expect(mockedRejectAction).not.toHaveBeenCalled();
  });

  it("handles payload with extra unknown fields gracefully", async () => {
    mockDbSelect(dbAction);
    mockedApproveAction.mockResolvedValue(undefined as never);

    const body = makePayload({
      trigger_id: "12345.67890",
      token: "verification_token",
      enterprise: null,
      team: { id: "T123", domain: "myteam" },
      channel: { id: "C123", name: "general" },
    });
    const res = await POST(makeSignedRequest(body));
    const json = await res.json();

    expect(json.replace_original).toBe(true);
    expect(json.text).toContain("approved");
  });

  // ── Guard clauses ─────────────────────────────────────────────

  it("returns error when payload.user is missing", async () => {
    const body = makePayload({
      user: undefined,
      actions: [{ action_id: "approve_action", value: ACTION_ID }],
    });
    const res = await POST(makeSignedRequest(body));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.text).toContain("Could not identify");
    expect(mockedApproveAction).not.toHaveBeenCalled();
  });

  it("returns error when payload.user has no id", async () => {
    const payload = {
      type: "block_actions",
      user: { username: "jtorrance" },
      actions: [{ action_id: "approve_action", value: ACTION_ID }],
    };
    const body = `payload=${encodeURIComponent(JSON.stringify(payload))}`;
    const res = await POST(makeSignedRequest(body));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.text).toContain("Could not identify");
  });

  it("returns error when action value is not a valid UUID", async () => {
    const body = makePayload({
      actions: [{ action_id: "approve_action", value: "not-a-uuid" }],
    });
    const res = await POST(makeSignedRequest(body));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.text).toContain("not found");
    expect(mockedGetDb).not.toHaveBeenCalled();
  });

  it("returns error when action value is empty string", async () => {
    const body = makePayload({
      actions: [{ action_id: "approve_action", value: "" }],
    });
    const res = await POST(makeSignedRequest(body));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.text).toContain("not found");
  });

  it("returns HTTP 200 when DB lookup throws", async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockRejectedValue(new Error("connection refused")),
    };
    mockedGetDb.mockReturnValue(chain as never);

    const body = makePayload();
    const res = await POST(makeSignedRequest(body));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.text).toContain("Something went wrong");
  });
});
