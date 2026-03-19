import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getDb } from "@/lib/db/client";
import type { RawActionRecord } from "@/lib/validations/actions";

import { sendSlackNotification, sendSlackTestNotification } from "./notify";

vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(),
}));

// Override retry backoff to use zero delays for fast tests
vi.mock("@/lib/slack/retry", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/slack/retry")>();
  return {
    ...orig,
    retryWithBackoff: (fn: () => Promise<unknown>, opts?: unknown) =>
      orig.retryWithBackoff(fn, { ...(opts as object), baseDelayMs: 0, maxDelayMs: 0 }),
  };
});

const mockedGetDb = vi.mocked(getDb);

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function makeAction(overrides: Partial<RawActionRecord> = {}): RawActionRecord {
  return {
    id: "550e8400-e29b-41d4-a716-446655440000",
    agentId: "demo-agent",
    actionType: "send_email",
    status: "pending",
    payload: { to: "test@example.com" },
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

const activeConfig = {
  id: "config-1",
  userId: "user-123",
  webhookUrl: "https://hooks.slack.com/services/T00/B00/xxxx",
  channelName: "#alerts",
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function mockDbSelect(result: typeof activeConfig | undefined) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(result ? [result] : []),
  };
  mockedGetDb.mockReturnValue(chain as never);
  return chain;
}

describe("sendSlackNotification", () => {
  beforeEach(() => {
    vi.stubEnv("NULLSPEND_URL", "http://localhost:3000");
    mockFetch.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.resetAllMocks();
    vi.unstubAllEnvs();
  });

  it("sends a notification when user has an active config", async () => {
    mockDbSelect(activeConfig);

    await sendSlackNotification(makeAction(), "user-123");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("https://hooks.slack.com/services/T00/B00/xxxx");
    expect(options.method).toBe("POST");

    const body = JSON.parse(options.body);
    expect(body.text).toContain("send_email");
    expect(body.blocks).toBeDefined();
  });

  it("does nothing when user has no config", async () => {
    mockDbSelect(undefined);

    await sendSlackNotification(makeAction(), "user-123");

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("does nothing when config is inactive", async () => {
    mockDbSelect({ ...activeConfig, isActive: false });

    await sendSlackNotification(makeAction(), "user-123");

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("throws when webhook returns an error", async () => {
    mockDbSelect(activeConfig);
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      text: () => Promise.resolve("invalid_payload"),
    });

    await expect(
      sendSlackNotification(makeAction(), "user-123"),
    ).rejects.toThrow("Slack webhook error 403");
  });

  it("throws when webhook returns 404 (channel archived)", async () => {
    mockDbSelect(activeConfig);
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve("channel_not_found"),
    });

    await expect(
      sendSlackNotification(makeAction(), "user-123"),
    ).rejects.toThrow("Slack webhook error 404");
  });

  it("handles fetch network errors (retries exhausted)", async () => {
    mockDbSelect(activeConfig);
    mockFetch.mockRejectedValue(new TypeError("fetch failed"));

    await expect(
      sendSlackNotification(makeAction(), "user-123"),
    ).rejects.toThrow("fetch failed");

    // 1 initial + 3 retries = 4 total (TypeError is retryable)
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it("retries on transient webhook failure then succeeds", async () => {
    mockDbSelect(activeConfig);
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 502, text: () => Promise.resolve("Bad Gateway") })
      .mockResolvedValueOnce({ ok: true });

    await sendSlackNotification(makeAction(), "user-123");

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("falls back to NEXT_PUBLIC_SITE_URL when NULLSPEND_URL is not set", async () => {
    vi.stubEnv("NULLSPEND_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://staging.nullspend.dev");
    mockDbSelect(activeConfig);
    mockFetch.mockResolvedValue({ ok: true });

    await sendSlackNotification(makeAction(), "user-123");

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const viewButton = body.blocks[3].elements[2];
    expect(viewButton.url).toContain("https://staging.nullspend.dev");
  });

  it("falls back to localhost when neither URL env is set", async () => {
    vi.stubEnv("NULLSPEND_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    mockDbSelect(activeConfig);
    mockFetch.mockResolvedValue({ ok: true });

    await sendSlackNotification(makeAction(), "user-123");

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const viewButton = body.blocks[3].elements[2];
    expect(viewButton.url).toContain("http://localhost:3000");
  });
});

describe("sendSlackTestNotification", () => {
  beforeEach(() => {
    vi.stubEnv("NULLSPEND_URL", "http://localhost:3000");
    mockFetch.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.resetAllMocks();
    vi.unstubAllEnvs();
  });

  it("sends a test message when config exists", async () => {
    mockDbSelect(activeConfig);

    await sendSlackTestNotification("user-123");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.text).toContain("working");
  });

  it("throws when no config exists", async () => {
    mockDbSelect(undefined);

    await expect(sendSlackTestNotification("user-123")).rejects.toThrow(
      "No Slack configuration found",
    );
  });

  it("sends test even if config is inactive", async () => {
    mockDbSelect({ ...activeConfig, isActive: false });

    await sendSlackTestNotification("user-123");

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry on webhook failure (synchronous UI feedback)", async () => {
    mockDbSelect(activeConfig);
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Internal Server Error"),
    });

    await expect(sendSlackTestNotification("user-123")).rejects.toThrow(
      "Slack webhook error 500",
    );

    // Should only call once — no retry
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
