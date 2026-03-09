import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveSessionUserId } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";

import { DELETE, GET, POST } from "./route";

vi.mock("@/lib/auth/session", () => ({
  resolveSessionUserId: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(),
}));

const mockedSession = vi.mocked(resolveSessionUserId);
const mockedGetDb = vi.mocked(getDb);

const now = new Date("2026-03-07T12:00:00.000Z");

const storedConfig = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  userId: "user-123",
  webhookUrl: "https://hooks.slack.com/services/T00/B00/xxxx",
  channelName: "#alerts",
  isActive: true,
  createdAt: now,
  updatedAt: now,
};

function mockDbSelect(result: typeof storedConfig | undefined) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(result ? [result] : []),
  };
  mockedGetDb.mockReturnValue(chain as never);
  return chain;
}

function mockDbInsert(result: typeof storedConfig) {
  const chain = {
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    onConflictDoUpdate: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([result]),
  };
  mockedGetDb.mockReturnValue(chain as never);
  return chain;
}

function mockDbDelete(result: { id: string } | undefined) {
  const chain = {
    delete: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(result ? [result] : []),
  };
  mockedGetDb.mockReturnValue(chain as never);
  return chain;
}

describe("GET /api/slack/config", () => {
  afterEach(() => vi.resetAllMocks());

  it("returns config when it exists", async () => {
    mockedSession.mockResolvedValue("user-123");
    mockDbSelect(storedConfig);

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toMatchObject({
      id: storedConfig.id,
      webhookUrl: storedConfig.webhookUrl,
      channelName: "#alerts",
      isActive: true,
    });
  });

  it("returns null data when no config exists", async () => {
    mockedSession.mockResolvedValue("user-123");
    mockDbSelect(undefined);

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toBeNull();
  });

  it("returns 401 when session is invalid", async () => {
    mockedSession.mockRejectedValue(new Error("Unauthorized"));

    const res = await GET();
    expect(res.status).toBe(500);
  });
});

describe("POST /api/slack/config", () => {
  afterEach(() => vi.resetAllMocks());

  it("upserts a valid config", async () => {
    mockedSession.mockResolvedValue("user-123");
    mockDbInsert(storedConfig);

    const res = await POST(
      new Request("http://localhost/api/slack/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          webhookUrl: "https://hooks.slack.com/services/T00/B00/xxxx",
          channelName: "#alerts",
        }),
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.webhookUrl).toBe("https://hooks.slack.com/services/T00/B00/xxxx");
  });

  it("rejects an invalid webhook URL", async () => {
    mockedSession.mockResolvedValue("user-123");

    const res = await POST(
      new Request("http://localhost/api/slack/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          webhookUrl: "https://example.com/webhook",
        }),
      }),
    );

    expect(res.status).toBe(400);
  });

  it("rejects a non-URL string", async () => {
    mockedSession.mockResolvedValue("user-123");

    const res = await POST(
      new Request("http://localhost/api/slack/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          webhookUrl: "not-a-url",
        }),
      }),
    );

    expect(res.status).toBe(400);
  });

  it("rejects empty body", async () => {
    mockedSession.mockResolvedValue("user-123");

    const res = await POST(
      new Request("http://localhost/api/slack/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );

    expect(res.status).toBe(400);
  });

  it("accepts isActive=false to disable notifications", async () => {
    mockedSession.mockResolvedValue("user-123");
    const disabledConfig = { ...storedConfig, isActive: false };
    mockDbInsert(disabledConfig);

    const res = await POST(
      new Request("http://localhost/api/slack/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          webhookUrl: "https://hooks.slack.com/services/T00/B00/xxxx",
          isActive: false,
        }),
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.isActive).toBe(false);
  });

  it("defaults isActive to true when not provided", async () => {
    mockedSession.mockResolvedValue("user-123");
    mockDbInsert(storedConfig);

    const res = await POST(
      new Request("http://localhost/api/slack/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          webhookUrl: "https://hooks.slack.com/services/T00/B00/xxxx",
        }),
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.isActive).toBe(true);
  });
});

describe("DELETE /api/slack/config", () => {
  afterEach(() => vi.resetAllMocks());

  it("deletes an existing config", async () => {
    mockedSession.mockResolvedValue("user-123");
    mockDbDelete({ id: storedConfig.id });

    const res = await DELETE();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
  });

  it("returns 404 when no config to delete", async () => {
    mockedSession.mockResolvedValue("user-123");
    mockDbDelete(undefined);

    const res = await DELETE();
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain("No Slack configuration found");
  });
});
