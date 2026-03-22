import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveSessionUserId } from "@/lib/auth/session";
import { generateRawKey, hashKey, extractPrefix } from "@/lib/auth/api-key";
import { GET, POST } from "./route";

vi.mock("@/lib/auth/session", () => ({
  resolveSessionUserId: vi.fn(),
}));

const mockSelectList = vi.fn();
const mockSelectCount = vi.fn().mockResolvedValue([{ value: 0 }]);
const mockInsertReturning = vi.fn();

vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(() => ({
    select: () => ({
      from: () => ({
        where: () => {
          // Must be both thenable (for POST count query) and chainable (for GET list query)
          const countPromise = mockSelectCount();
          return {
            then: countPromise.then.bind(countPromise),
            catch: countPromise.catch.bind(countPromise),
            orderBy: () => ({
              limit: mockSelectList,
            }),
          };
        },
      }),
    }),
    insert: () => ({
      values: () => ({
        returning: mockInsertReturning,
      }),
    }),
  })),
}));


vi.mock("@/lib/auth/api-key", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/api-key")>();
  return {
    ...actual,
    generateRawKey: vi.fn(),
    hashKey: vi.fn(),
    extractPrefix: vi.fn(),
  };
});

const mockedResolveSessionUserId = vi.mocked(resolveSessionUserId);
const mockedGenerateRawKey = vi.mocked(generateRawKey);
const mockedHashKey = vi.mocked(hashKey);
const mockedExtractPrefix = vi.mocked(extractPrefix);

describe("GET /api/keys", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("returns keys for authenticated user with cursor=null when no more pages", async () => {
    mockedResolveSessionUserId.mockResolvedValue("user-1");
    mockSelectList.mockResolvedValue([
      {
        id: "00000000-0000-4000-a000-000000000011",
        name: "My Key",
        keyPrefix: "ns_live_sk_abcdef12",
        defaultTags: { project: "alpha" },
        lastUsedAt: null,
        createdAt: new Date("2026-01-01"),
      },
    ]);

    const req = new Request("http://localhost/api/keys");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].name).toBe("My Key");
    expect(body.data[0].defaultTags).toEqual({ project: "alpha" });
    expect(body.cursor).toBeNull();
  });

  it("returns defaultTags in key list response", async () => {
    mockedResolveSessionUserId.mockResolvedValue("user-1");
    mockSelectCount.mockResolvedValue([{ value: 0 }]);
    mockSelectList.mockResolvedValue([
      {
        id: "00000000-0000-4000-a000-000000000011",
        name: "Key 1",
        keyPrefix: "ns_live_sk_abcdef12",
        defaultTags: { team: "backend", env: "prod" },
        lastUsedAt: null,
        createdAt: new Date("2026-01-01"),
      },
      {
        id: "00000000-0000-4000-a000-000000000022",
        name: "Key 2",
        keyPrefix: "ns_live_sk_ghijkl34",
        defaultTags: {},
        lastUsedAt: null,
        createdAt: new Date("2026-01-02"),
      },
    ]);

    const req = new Request("http://localhost/api/keys");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data[0].defaultTags).toEqual({ team: "backend", env: "prod" });
    expect(body.data[1].defaultTags).toEqual({});
  });

  it("returns 401 when session is invalid", async () => {
    const { AuthenticationRequiredError } = await import("@/lib/auth/errors");
    mockedResolveSessionUserId.mockRejectedValue(new AuthenticationRequiredError());

    const req = new Request("http://localhost/api/keys");
    const res = await GET(req);

    expect(res.status).toBe(401);
  });
});

describe("POST /api/keys", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("creates a new API key and returns prefix + raw key", async () => {
    mockedResolveSessionUserId.mockResolvedValue("user-1");
    mockSelectCount.mockResolvedValue([{ value: 0 }]);
    mockedGenerateRawKey.mockReturnValue("ns_live_sk_abcdef1234567890abcdef1234567890");
    mockedHashKey.mockReturnValue("hashed_key");
    mockedExtractPrefix.mockReturnValue("ns_live_sk_abcdef12");
    mockInsertReturning.mockResolvedValue([
      {
        id: "00000000-0000-4000-a000-000000000011",
        name: "Production Key",
        keyPrefix: "ns_live_sk_abcdef12",
        defaultTags: {},
        createdAt: new Date("2026-01-01"),
      },
    ]);

    const req = new Request("http://localhost/api/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Production Key" }),
    });

    const res = await POST(req);

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.rawKey).toBe("ns_live_sk_abcdef1234567890abcdef1234567890");
    expect(body.name).toBe("Production Key");
    expect(body.defaultTags).toEqual({});
  });

  it("creates key with defaultTags and returns them", async () => {
    mockedResolveSessionUserId.mockResolvedValue("user-1");
    mockSelectCount.mockResolvedValue([{ value: 0 }]);
    mockedGenerateRawKey.mockReturnValue("ns_live_sk_abcdef1234567890abcdef1234567890");
    mockedHashKey.mockReturnValue("hashed_key");
    mockedExtractPrefix.mockReturnValue("ns_live_sk_abcdef12");
    mockInsertReturning.mockResolvedValue([
      {
        id: "00000000-0000-4000-a000-000000000011",
        name: "Tagged Key",
        keyPrefix: "ns_live_sk_abcdef12",
        defaultTags: { project: "openclaw", team: "backend" },
        createdAt: new Date("2026-01-01"),
      },
    ]);

    const req = new Request("http://localhost/api/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Tagged Key", defaultTags: { project: "openclaw", team: "backend" } }),
    });

    const res = await POST(req);

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe("Tagged Key");
    expect(body.defaultTags).toEqual({ project: "openclaw", team: "backend" });
  });

  it("returns 409 when max keys per user reached", async () => {
    mockedResolveSessionUserId.mockResolvedValue("user-1");
    mockSelectCount.mockResolvedValue([{ value: 20 }]);

    const req = new Request("http://localhost/api/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "One Too Many" }),
    });

    const res = await POST(req);

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("limit_exceeded");
    expect(body.error.message).toContain("20");
  });

  it("returns 400 for missing name", async () => {
    mockedResolveSessionUserId.mockResolvedValue("user-1");

    const req = new Request("http://localhost/api/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it("returns 400 when defaultTags has >10 keys", async () => {
    mockedResolveSessionUserId.mockResolvedValue("user-1");

    const tags: Record<string, string> = {};
    for (let i = 0; i < 11; i++) tags[`key${i}`] = `v${i}`;

    const req = new Request("http://localhost/api/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Too Many Tags", defaultTags: tags }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when defaultTags has _ns_ prefix key", async () => {
    mockedResolveSessionUserId.mockResolvedValue("user-1");

    const req = new Request("http://localhost/api/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Reserved", defaultTags: { _ns_internal: "bad" } }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when defaultTags has invalid key characters", async () => {
    mockedResolveSessionUserId.mockResolvedValue("user-1");

    const req = new Request("http://localhost/api/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Bad Chars", defaultTags: { "invalid key": "val" } }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 401 when session is invalid", async () => {
    const { AuthenticationRequiredError } = await import("@/lib/auth/errors");
    mockedResolveSessionUserId.mockRejectedValue(new AuthenticationRequiredError());

    const req = new Request("http://localhost/api/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Test" }),
    });

    const res = await POST(req);

    expect(res.status).toBe(401);
  });
});
