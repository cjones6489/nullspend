import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveSessionUserId } from "@/lib/auth/session";
import { sendSlackTestNotification } from "@/lib/slack/notify";

import { POST } from "./route";

vi.mock("@/lib/auth/session", () => ({
  resolveSessionUserId: vi.fn(),
}));

vi.mock("@/lib/slack/notify", () => ({
  sendSlackTestNotification: vi.fn(),
}));

const mockedSession = vi.mocked(resolveSessionUserId);
const mockedSendTest = vi.mocked(sendSlackTestNotification);

describe("POST /api/slack/test", () => {
  afterEach(() => vi.resetAllMocks());

  it("sends a test notification and returns success", async () => {
    mockedSession.mockResolvedValue("user-123");
    mockedSendTest.mockResolvedValue(undefined);

    const res = await POST();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(mockedSendTest).toHaveBeenCalledWith("user-123");
  });

  it("returns 400 with specific message when no config exists", async () => {
    mockedSession.mockResolvedValue("user-123");
    mockedSendTest.mockRejectedValue(new Error("No Slack configuration found."));

    const res = await POST();
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe("No Slack configuration found.");
  });

  it("returns 400 with webhook error details", async () => {
    mockedSession.mockResolvedValue("user-123");
    mockedSendTest.mockRejectedValue(
      new Error("Slack webhook error 403: invalid_payload"),
    );

    const res = await POST();
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain("Slack webhook error 403");
  });

  it("returns 400 with fallback message for non-Error throws", async () => {
    mockedSession.mockResolvedValue("user-123");
    mockedSendTest.mockRejectedValue("something weird");

    const res = await POST();
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe("Failed to send test notification.");
  });

  it("returns auth error when session is invalid", async () => {
    mockedSession.mockRejectedValue(new Error("Unauthorized"));

    const res = await POST();

    expect(res.status).toBe(500);
  });
});
