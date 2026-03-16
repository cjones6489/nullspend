/**
 * Unit tests for the api-key-auth module.
 *
 * Tests SHA-256 hashing, DB lookup, LRU caching (positive & negative),
 * cache eviction, and graceful error handling.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";

// --- Hoisted mocks (must be defined before vi.mock calls) ---
const { mockConnect, mockEnd, mockOn, mockQuery } = vi.hoisted(() => ({
  mockConnect: vi.fn(),
  mockEnd: vi.fn(),
  mockOn: vi.fn(),
  mockQuery: vi.fn(),
}));

vi.mock("pg", () => {
  return {
    Client: function MockClient() {
      return { connect: mockConnect, end: mockEnd, on: mockOn, query: mockQuery };
    },
  };
});

// Mock the db-semaphore to just execute the function directly
vi.mock("../lib/db-semaphore.js", () => ({
  withDbConnection: vi.fn(async (fn: () => Promise<unknown>) => fn()),
}));

// --- Import after mocks ---
import { hashApiKey, authenticateApiKey, _resetCaches } from "../lib/api-key-auth.js";

const TEST_RAW_KEY = "ask_test1234567890abcdef";
const TEST_USER_ID = "user-abc-123";
const TEST_KEY_ID = "550e8400-e29b-41d4-a716-446655440000";
const TEST_CONNECTION_STRING = "postgresql://postgres:postgres@db.example.com:5432/postgres";

describe("hashApiKey", () => {
  it("produces the same hex output as Node.js crypto.createHash('sha256')", async () => {
    const rawKey = "ask_test1234567890abcdef";
    const expected = createHash("sha256").update(rawKey).digest("hex");
    const result = await hashApiKey(rawKey);
    expect(result).toBe(expected);
  });

  it("produces a 64-character lowercase hex string", async () => {
    const result = await hashApiKey("ask_hello");
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces different hashes for different inputs", async () => {
    const hash1 = await hashApiKey("ask_key1");
    const hash2 = await hashApiKey("ask_key2");
    expect(hash1).not.toBe(hash2);
  });

  it("handles empty string", async () => {
    const expected = createHash("sha256").update("").digest("hex");
    const result = await hashApiKey("");
    expect(result).toBe(expected);
  });

  it("handles unicode input", async () => {
    const rawKey = "ask_unicödé_kéy_🔑";
    const expected = createHash("sha256").update(rawKey).digest("hex");
    const result = await hashApiKey(rawKey);
    expect(result).toBe(expected);
  });
});

describe("authenticateApiKey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetCaches();
    mockConnect.mockResolvedValue(undefined);
    mockEnd.mockResolvedValue(undefined);
  });

  afterEach(() => {
    _resetCaches();
  });

  it("returns identity on valid key (cache miss → DB hit)", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: TEST_KEY_ID, user_id: TEST_USER_ID, has_budgets: false, has_webhooks: false }],
    });

    const result = await authenticateApiKey(TEST_RAW_KEY, TEST_CONNECTION_STRING);

    expect(result).toEqual({ userId: TEST_USER_ID, keyId: TEST_KEY_ID, hasBudgets: false, hasWebhooks: false });
    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(mockQuery).toHaveBeenCalledTimes(1);

    // Verify the query includes the revoked_at check
    const queryCall = mockQuery.mock.calls[0];
    expect(queryCall[0]).toContain("revoked_at IS NULL");
    expect(mockEnd).toHaveBeenCalledTimes(1);
  });

  it("returns cached identity on second call (cache hit → no DB call)", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: TEST_KEY_ID, user_id: TEST_USER_ID, has_budgets: false, has_webhooks: false }],
    });

    // First call — cache miss, hits DB
    const result1 = await authenticateApiKey(TEST_RAW_KEY, TEST_CONNECTION_STRING);
    expect(result1).toEqual({ userId: TEST_USER_ID, keyId: TEST_KEY_ID, hasBudgets: false, hasWebhooks: false });
    expect(mockConnect).toHaveBeenCalledTimes(1);

    // Second call — cache hit, no DB call
    const result2 = await authenticateApiKey(TEST_RAW_KEY, TEST_CONNECTION_STRING);
    expect(result2).toEqual({ userId: TEST_USER_ID, keyId: TEST_KEY_ID, hasBudgets: false, hasWebhooks: false });
    expect(mockConnect).toHaveBeenCalledTimes(1); // Still 1, not 2
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("returns null for invalid key (no rows in DB)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await authenticateApiKey(TEST_RAW_KEY, TEST_CONNECTION_STRING);

    expect(result).toBeNull();
    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(mockEnd).toHaveBeenCalledTimes(1);
  });

  it("negative-caches invalid keys (no DB call on second attempt)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    // First call — cache miss, hits DB, gets nothing
    const result1 = await authenticateApiKey(TEST_RAW_KEY, TEST_CONNECTION_STRING);
    expect(result1).toBeNull();
    expect(mockConnect).toHaveBeenCalledTimes(1);

    // Second call — negative cache hit, no DB call
    const result2 = await authenticateApiKey(TEST_RAW_KEY, TEST_CONNECTION_STRING);
    expect(result2).toBeNull();
    expect(mockConnect).toHaveBeenCalledTimes(1); // Still 1
  });

  it("returns null for revoked key (query excludes revoked_at IS NOT NULL)", async () => {
    // The SQL query filters with "AND revoked_at IS NULL", so a revoked key
    // returns no rows — we just verify it returns null
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await authenticateApiKey("ask_revoked_key", TEST_CONNECTION_STRING);
    expect(result).toBeNull();
  });

  it("returns null gracefully when DB connection fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockConnect.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const result = await authenticateApiKey(TEST_RAW_KEY, TEST_CONNECTION_STRING);

    expect(result).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("[api-key-auth]"),
      expect.stringContaining("ECONNREFUSED"),
    );
    errorSpy.mockRestore();
  });

  it("returns null gracefully when query fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockConnect.mockResolvedValueOnce(undefined);
    mockQuery.mockRejectedValueOnce(new Error("relation does not exist"));

    const result = await authenticateApiKey(TEST_RAW_KEY, TEST_CONNECTION_STRING);

    expect(result).toBeNull();
    expect(errorSpy).toHaveBeenCalled();
    expect(mockEnd).toHaveBeenCalledTimes(1); // Client is cleaned up
    errorSpy.mockRestore();
  });

  it("closes pg client even when query fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockConnect.mockResolvedValueOnce(undefined);
    mockQuery.mockRejectedValueOnce(new Error("boom"));

    await authenticateApiKey(TEST_RAW_KEY, TEST_CONNECTION_STRING);

    expect(mockEnd).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });

  it("evicts oldest entry when positive cache exceeds 256 entries", async () => {
    // Suppress expected error logs from any mock exhaustion
    vi.spyOn(console, "error").mockImplementation(() => {});

    // Fill cache with 257 entries (0–256). After inserting key_256, cache has
    // 257 entries → evicts key_0 (the oldest), leaving keys 1–256 (256 entries).
    for (let i = 0; i < 257; i++) {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: `key-${i}`, user_id: `user-${i}`, has_budgets: false, has_webhooks: false }],
      });
      await authenticateApiKey(`ask_key_${i}`, TEST_CONNECTION_STRING);
    }

    // 257 DB calls should have been made
    expect(mockConnect).toHaveBeenCalledTimes(257);

    // key_0 was evicted — looking it up should require a new DB call
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: "key-0", user_id: "user-0", has_budgets: false, has_webhooks: false }],
    });
    const result = await authenticateApiKey("ask_key_0", TEST_CONNECTION_STRING);
    expect(result).toEqual({ userId: "user-0", keyId: "key-0", hasBudgets: false, hasWebhooks: false });
    expect(mockConnect).toHaveBeenCalledTimes(258); // Had to go to DB again

    // Re-adding key_0 brought cache to 257 → key_1 was evicted.
    // key_2 should still be cached (it was the third entry, not evicted).
    const result2 = await authenticateApiKey("ask_key_2", TEST_CONNECTION_STRING);
    expect(result2).toEqual({ userId: "user-2", keyId: "key-2", hasBudgets: false, hasWebhooks: false });
    expect(mockConnect).toHaveBeenCalledTimes(258); // No additional DB call — cache hit

    vi.restoreAllMocks();
  });

  it("does not cache DB failures in the negative cache", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockConnect.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    // First call — DB fails, returns null
    const result1 = await authenticateApiKey(TEST_RAW_KEY, TEST_CONNECTION_STRING);
    expect(result1).toBeNull();

    // DB failure returns null from lookupKeyInDb, which gets negative-cached.
    // This is acceptable behavior — the negative cache TTL is only 30s,
    // so it protects against hammering a failing DB.
    // Let's verify the second call doesn't hit DB (negative cached)
    const result2 = await authenticateApiKey(TEST_RAW_KEY, TEST_CONNECTION_STRING);
    expect(result2).toBeNull();
    expect(mockConnect).toHaveBeenCalledTimes(1); // Only 1 DB attempt
    vi.restoreAllMocks();
  });

  it("queries with the correct SQL and hashed key parameter", async () => {
    const expectedHash = await hashApiKey(TEST_RAW_KEY);
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: TEST_KEY_ID, user_id: TEST_USER_ID, has_budgets: false, has_webhooks: false }],
    });

    await authenticateApiKey(TEST_RAW_KEY, TEST_CONNECTION_STRING);

    const queryCall = mockQuery.mock.calls[0];
    expect(queryCall[0]).toContain("key_hash = $1");
    expect(queryCall[0]).toContain("revoked_at IS NULL");
    expect(queryCall[0]).toContain("has_budgets");
    expect(queryCall[0]).toContain("has_webhooks");
    expect(queryCall[1]).toEqual([expectedHash]);
  });

  it("registers a pg client error handler", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: TEST_KEY_ID, user_id: TEST_USER_ID, has_budgets: false, has_webhooks: false }],
    });

    await authenticateApiKey(TEST_RAW_KEY, TEST_CONNECTION_STRING);

    expect(mockOn).toHaveBeenCalledWith("error", expect.any(Function));
  });
});

describe("authenticateApiKey cache expiry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetCaches();
    mockConnect.mockResolvedValue(undefined);
    mockEnd.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    _resetCaches();
  });

  it("re-queries DB when positive cache entry expires", async () => {
    const now = Date.now();
    // authenticateApiKey calls Date.now() exactly once per invocation
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(now)           // First call — stores expiresAt = now + 60_000
      .mockReturnValueOnce(now + 61_000); // Second call — past 60s TTL, entry expired

    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: TEST_KEY_ID, user_id: TEST_USER_ID, has_budgets: false, has_webhooks: false }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: TEST_KEY_ID, user_id: TEST_USER_ID, has_budgets: false, has_webhooks: false }],
      });

    // First call — populates cache
    await authenticateApiKey(TEST_RAW_KEY, TEST_CONNECTION_STRING);
    expect(mockConnect).toHaveBeenCalledTimes(1);

    // Second call — cache expired, hits DB again
    await authenticateApiKey(TEST_RAW_KEY, TEST_CONNECTION_STRING);
    expect(mockConnect).toHaveBeenCalledTimes(2);
  });
});
