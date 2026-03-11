import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveSessionUserId } from "@/lib/auth/session";
import { generateRawKey, hashKey, extractPrefix } from "@/lib/auth/api-key";
import { GET, POST } from "./route";

vi.mock("@/lib/auth/session", () => ({
  resolveSessionUserId: vi.fn(),
}));

const mockSelect = vi.fn();
const mockInsertReturning = vi.fn();

vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(() => ({
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: mockSelect,
        }),
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

  it("returns keys for authenticated user", async () => {
    mockedResolveSessionUserId.mockResolvedValue("user-1");
    mockSelect.mockResolvedValue([
      {
        id: "00000000-0000-4000-a000-000000000011",
        name: "My Key",
        keyPrefix: "as_live_abc",
        lastUsedAt: null,
        createdAt: new Date("2026-01-01"),
      },
    ]);

    const res = await GET();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].name).toBe("My Key");
  });

  it("returns 401 when session is invalid", async () => {
    const { AuthenticationRequiredError } = await import("@/lib/auth/errors");
    mockedResolveSessionUserId.mockRejectedValue(new AuthenticationRequiredError());

    const res = await GET();

    expect(res.status).toBe(401);
  });
});

describe("POST /api/keys", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("creates a new API key and returns prefix + raw key", async () => {
    mockedResolveSessionUserId.mockResolvedValue("user-1");
    mockedGenerateRawKey.mockReturnValue("as_live_full_raw_key");
    mockedHashKey.mockReturnValue("hashed_key");
    mockedExtractPrefix.mockReturnValue("as_live_ful");
    mockInsertReturning.mockResolvedValue([
      {
        id: "00000000-0000-4000-a000-000000000011",
        name: "Production Key",
        keyPrefix: "as_live_ful",
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
    expect(body.rawKey).toBe("as_live_full_raw_key");
    expect(body.name).toBe("Production Key");
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
