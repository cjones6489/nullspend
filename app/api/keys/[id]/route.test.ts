import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveSessionUserId } from "@/lib/auth/session";
import { DELETE, PATCH } from "./route";

vi.mock("@/lib/auth/session", () => ({
  resolveSessionUserId: vi.fn(),
}));

const mockUpdateReturning = vi.fn();

vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(() => ({
    update: () => ({
      set: () => ({
        where: () => ({
          returning: mockUpdateReturning,
        }),
      }),
    }),
  })),
}));

const mockInvalidateProxyCache = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/proxy-invalidate", () => ({
  invalidateProxyCache: (...args: unknown[]) => mockInvalidateProxyCache(...args),
}));

const mockedResolveSessionUserId = vi.mocked(resolveSessionUserId);

const TEST_KEY_UUID = "00000000-0000-4000-a000-000000000011";
const TEST_KEY_PREFIXED = `ns_key_${TEST_KEY_UUID}`;

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("DELETE /api/keys/[id]", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("revokes an API key", async () => {
    const now = new Date("2026-01-01");
    mockedResolveSessionUserId.mockResolvedValue("user-1");
    mockUpdateReturning.mockResolvedValue([
      { id: TEST_KEY_UUID, revokedAt: now },
    ]);

    const req = new Request("http://localhost/api/keys/" + TEST_KEY_PREFIXED, { method: "DELETE" });
    const res = await DELETE(req, makeContext(TEST_KEY_PREFIXED));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(TEST_KEY_PREFIXED);
    expect(body.revokedAt).toBe(now.toISOString());
  });

  it("returns 404 when key is not found or already revoked", async () => {
    mockedResolveSessionUserId.mockResolvedValue("user-1");
    mockUpdateReturning.mockResolvedValue([]);

    const req = new Request("http://localhost/api/keys/" + TEST_KEY_PREFIXED, { method: "DELETE" });
    const res = await DELETE(req, makeContext(TEST_KEY_PREFIXED));

    expect(res.status).toBe(404);
  });

  it("returns 401 when session is invalid", async () => {
    const { AuthenticationRequiredError } = await import("@/lib/auth/errors");
    mockedResolveSessionUserId.mockRejectedValue(new AuthenticationRequiredError());

    const req = new Request("http://localhost/api/keys/" + TEST_KEY_PREFIXED, { method: "DELETE" });
    const res = await DELETE(req, makeContext(TEST_KEY_PREFIXED));

    expect(res.status).toBe(401);
  });
});

describe("PATCH /api/keys/[id]", () => {
  beforeEach(() => {
    // Re-establish mock after DELETE's afterEach resetAllMocks clears implementations
    mockInvalidateProxyCache.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("updates defaultTags", async () => {
    mockedResolveSessionUserId.mockResolvedValue("user-1");
    mockUpdateReturning.mockResolvedValue([{
      id: TEST_KEY_UUID,
      name: "My Key",
      keyPrefix: "ns_live_sk_abcdef12",
      defaultTags: { project: "openclaw" },
      lastUsedAt: null,
      createdAt: new Date("2026-01-01"),
    }]);

    const req = new Request("http://localhost/api/keys/" + TEST_KEY_PREFIXED, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ defaultTags: { project: "openclaw" } }),
    });

    const res = await PATCH(req, makeContext(TEST_KEY_PREFIXED));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.defaultTags).toEqual({ project: "openclaw" });
  });

  it("updates name", async () => {
    mockedResolveSessionUserId.mockResolvedValue("user-1");
    mockUpdateReturning.mockResolvedValue([{
      id: TEST_KEY_UUID,
      name: "New Name",
      keyPrefix: "ns_live_sk_abcdef12",
      defaultTags: {},
      lastUsedAt: null,
      createdAt: new Date("2026-01-01"),
    }]);

    const req = new Request("http://localhost/api/keys/" + TEST_KEY_PREFIXED, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "New Name" }),
    });

    const res = await PATCH(req, makeContext(TEST_KEY_PREFIXED));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("New Name");
  });

  it("returns 400 with empty body (no fields to update)", async () => {
    mockedResolveSessionUserId.mockResolvedValue("user-1");

    const req = new Request("http://localhost/api/keys/" + TEST_KEY_PREFIXED, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const res = await PATCH(req, makeContext(TEST_KEY_PREFIXED));
    expect(res.status).toBe(400);
  });

  it("clears all defaults with defaultTags: {}", async () => {
    mockedResolveSessionUserId.mockResolvedValue("user-1");
    mockUpdateReturning.mockResolvedValue([{
      id: TEST_KEY_UUID,
      name: "My Key",
      keyPrefix: "ns_live_sk_abcdef12",
      defaultTags: {},
      lastUsedAt: null,
      createdAt: new Date("2026-01-01"),
    }]);

    const req = new Request("http://localhost/api/keys/" + TEST_KEY_PREFIXED, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ defaultTags: {} }),
    });

    const res = await PATCH(req, makeContext(TEST_KEY_PREFIXED));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.defaultTags).toEqual({});
  });

  it("returns 404 for revoked key", async () => {
    mockedResolveSessionUserId.mockResolvedValue("user-1");
    mockUpdateReturning.mockResolvedValue([]);

    const req = new Request("http://localhost/api/keys/" + TEST_KEY_PREFIXED, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Wont Work" }),
    });

    const res = await PATCH(req, makeContext(TEST_KEY_PREFIXED));
    expect(res.status).toBe(404);
  });

  it("triggers proxy cache invalidation", async () => {
    mockedResolveSessionUserId.mockResolvedValue("user-1");
    mockUpdateReturning.mockResolvedValue([{
      id: TEST_KEY_UUID,
      name: "Updated",
      keyPrefix: "ns_live_sk_abcdef12",
      defaultTags: { env: "staging" },
      lastUsedAt: null,
      createdAt: new Date("2026-01-01"),
    }]);

    const req = new Request("http://localhost/api/keys/" + TEST_KEY_PREFIXED, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ defaultTags: { env: "staging" } }),
    });

    await PATCH(req, makeContext(TEST_KEY_PREFIXED));

    expect(mockInvalidateProxyCache).toHaveBeenCalledWith({
      action: "sync",
      userId: "user-1",
      entityType: "api_key",
      entityId: TEST_KEY_UUID,
    });
  });

  it("returns 400 when defaultTags exceeds 10 keys", async () => {
    mockedResolveSessionUserId.mockResolvedValue("user-1");

    const tags: Record<string, string> = {};
    for (let i = 0; i < 11; i++) tags[`key${i}`] = `v${i}`;

    const req = new Request("http://localhost/api/keys/" + TEST_KEY_PREFIXED, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ defaultTags: tags }),
    });

    const res = await PATCH(req, makeContext(TEST_KEY_PREFIXED));
    expect(res.status).toBe(400);
  });

  it("returns 400 when defaultTags has _ns_ prefix", async () => {
    mockedResolveSessionUserId.mockResolvedValue("user-1");

    const req = new Request("http://localhost/api/keys/" + TEST_KEY_PREFIXED, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ defaultTags: { _ns_reserved: "bad" } }),
    });

    const res = await PATCH(req, makeContext(TEST_KEY_PREFIXED));
    expect(res.status).toBe(400);
  });
});
