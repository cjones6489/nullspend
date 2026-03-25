import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveSessionContext } from "@/lib/auth/session";
import {
  sendSlackTestNotification,
  SlackConfigNotFoundError,
  SlackWebhookError,
} from "@/lib/slack/notify";

import { POST } from "./route";

vi.mock("@/lib/auth/session", () => ({
  resolveSessionContext: vi.fn(),
}));

vi.mock("@/lib/slack/notify", () => ({
  sendSlackTestNotification: vi.fn(),
  SlackConfigNotFoundError: class SlackConfigNotFoundError extends Error {
    constructor() {
      super("No Slack configuration found.");
      this.name = "SlackConfigNotFoundError";
    }
  },
  SlackWebhookError: class SlackWebhookError extends Error {
    statusCode: number;
    constructor(statusCode: number, detail: string) {
      super(`Slack webhook error ${statusCode}: ${detail}`);
      this.name = "SlackWebhookError";
      this.statusCode = statusCode;
    }
  },
}));

const mockedSession = vi.mocked(resolveSessionContext);
const mockedSendTest = vi.mocked(sendSlackTestNotification);

describe("POST /api/slack/test", () => {
  afterEach(() => vi.resetAllMocks());

  it("sends a test notification and returns success", async () => {
    mockedSession.mockResolvedValue({ userId: "user-123", orgId: "org-test-1", role: "owner" });
    mockedSendTest.mockResolvedValue(undefined);

    const res = await POST();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(mockedSendTest).toHaveBeenCalledWith("org-test-1");
  });

  it("returns 404 when no Slack config exists", async () => {
    mockedSession.mockResolvedValue({ userId: "user-123", orgId: "org-test-1", role: "owner" });
    mockedSendTest.mockRejectedValue(new SlackConfigNotFoundError());

    const res = await POST();
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error.code).toBe("not_found");
    expect(json.error.message).toBe("No Slack configuration found.");
  });

  it("returns 400 on webhook client error", async () => {
    mockedSession.mockResolvedValue({ userId: "user-123", orgId: "org-test-1", role: "owner" });
    mockedSendTest.mockRejectedValue(
      new SlackWebhookError(403, "invalid_payload"),
    );

    const res = await POST();
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error.code).toBe("slack_webhook_error");
    expect(json.error.message).toBe("Failed to send test notification.");
  });

  it("returns 502 on webhook server error", async () => {
    mockedSession.mockResolvedValue({ userId: "user-123", orgId: "org-test-1", role: "owner" });
    mockedSendTest.mockRejectedValue(
      new SlackWebhookError(500, "internal_error"),
    );

    const res = await POST();
    const json = await res.json();

    expect(res.status).toBe(502);
    expect(json.error.code).toBe("slack_webhook_error");
    expect(json.error.message).toBe("Failed to send test notification.");
  });

  it("returns 502 for unknown errors", async () => {
    mockedSession.mockResolvedValue({ userId: "user-123", orgId: "org-test-1", role: "owner" });
    mockedSendTest.mockRejectedValue(new Error("network timeout"));

    const res = await POST();
    const json = await res.json();

    expect(res.status).toBe(502);
    expect(json.error.code).toBe("slack_webhook_error");
    expect(json.error.message).toBe("Failed to send test notification.");
  });

  it("returns auth error when session is invalid", async () => {
    mockedSession.mockRejectedValue(new Error("Unauthorized"));

    const res = await POST();

    expect(res.status).toBe(500);
  });
});
