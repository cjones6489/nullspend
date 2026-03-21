import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveSessionUserId } from "@/lib/auth/session";
import { PATCH, DELETE } from "./route";

vi.mock("@/lib/auth/session", () => ({
  resolveSessionUserId: vi.fn(),
}));

const mockUpdateReturning = vi.fn();
const mockDeleteReturning = vi.fn();

vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(() => ({
    update: () => ({
      set: () => ({
        where: () => ({
          returning: mockUpdateReturning,
        }),
      }),
    }),
    delete: () => ({
      where: () => ({
        returning: mockDeleteReturning,
      }),
    }),
  })),
}));

const mockedResolveSessionUserId = vi.mocked(resolveSessionUserId);

const RAW_UUID = "00000000-0000-4000-a000-000000000001";
const VALID_ID = `ns_wh_${RAW_UUID}`;

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("PATCH /api/webhooks/:id", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("updates a webhook endpoint", async () => {
    mockedResolveSessionUserId.mockResolvedValue("user-1");
    mockUpdateReturning.mockResolvedValue([
      {
        id: RAW_UUID,
        url: "https://hooks.example.com/updated",
        description: "Updated",
        eventTypes: [],
        enabled: true,
        apiVersion: "2026-04-01",
        payloadMode: "full",
        createdAt: new Date("2026-01-01"),
        updatedAt: new Date("2026-01-02"),
      },
    ]);

    const req = new Request("http://localhost/api/webhooks/" + VALID_ID, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://hooks.example.com/updated", description: "Updated" }),
    });

    const res = await PATCH(req, makeContext(VALID_ID));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.url).toBe("https://hooks.example.com/updated");
    expect(body.data.apiVersion).toBe("2026-04-01");
    expect(body.data).not.toHaveProperty("signingSecret");
  });

  it("returns 404 for non-owned endpoint", async () => {
    mockedResolveSessionUserId.mockResolvedValue("user-1");
    mockUpdateReturning.mockResolvedValue([]);

    const req = new Request("http://localhost/api/webhooks/" + VALID_ID, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });

    const res = await PATCH(req, makeContext(VALID_ID));

    expect(res.status).toBe(404);
  });

  it("returns 400 for empty update", async () => {
    mockedResolveSessionUserId.mockResolvedValue("user-1");

    const req = new Request("http://localhost/api/webhooks/" + VALID_ID, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const res = await PATCH(req, makeContext(VALID_ID));

    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid prefixed ID param", async () => {
    mockedResolveSessionUserId.mockResolvedValue("user-1");

    const req = new Request("http://localhost/api/webhooks/not-a-uuid", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });

    const res = await PATCH(req, makeContext("not-a-uuid"));

    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/webhooks/:id", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("deletes an owned webhook endpoint", async () => {
    mockedResolveSessionUserId.mockResolvedValue("user-1");
    mockDeleteReturning.mockResolvedValue([{ id: RAW_UUID }]);

    const req = new Request("http://localhost/api/webhooks/" + VALID_ID, {
      method: "DELETE",
    });

    const res = await DELETE(req, makeContext(VALID_ID));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it("returns 404 for non-owned endpoint", async () => {
    mockedResolveSessionUserId.mockResolvedValue("user-1");
    mockDeleteReturning.mockResolvedValue([]);

    const req = new Request("http://localhost/api/webhooks/" + VALID_ID, {
      method: "DELETE",
    });

    const res = await DELETE(req, makeContext(VALID_ID));

    expect(res.status).toBe(404);
  });
});
