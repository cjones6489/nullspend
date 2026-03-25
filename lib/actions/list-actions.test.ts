import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { listActions } from "@/lib/actions/list-actions";
import { bulkExpireActions } from "@/lib/actions/expiration";
import { getDb } from "@/lib/db/client";

vi.mock("@/lib/actions/expiration", () => ({
  bulkExpireActions: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(),
}));

vi.mock("@/lib/actions/serialize-action", () => ({
  serializeAction: vi.fn((row) => ({ ...row, serialized: true })),
}));

const mockedBulkExpire = vi.mocked(bulkExpireActions);
const mockedGetDb = vi.mocked(getDb);

function makeDbRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "a0000000-0000-4000-a000-000000000001",
    orgId: "user-123",
    agentId: "agent-1",
    actionType: "http_post",
    status: "executed",
    payload: {},
    createdAt: new Date("2026-03-01T00:00:00Z"),
    ...overrides,
  };
}

describe("listActions", () => {
  let mockSelect: ReturnType<typeof vi.fn>;
  let mockFrom: ReturnType<typeof vi.fn>;
  let mockWhere: ReturnType<typeof vi.fn>;
  let mockOrderBy: ReturnType<typeof vi.fn>;
  let mockLimit: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockedBulkExpire.mockResolvedValue(undefined);

    mockLimit = vi.fn(() => []);
    mockOrderBy = vi.fn(() => ({ limit: mockLimit }));
    mockWhere = vi.fn(() => ({ orderBy: mockOrderBy }));
    mockFrom = vi.fn(() => ({ where: mockWhere }));
    mockSelect = vi.fn(() => ({ from: mockFrom }));
    mockedGetDb.mockReturnValue({
      select: mockSelect,
    } as unknown as ReturnType<typeof getDb>);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls bulkExpireActions before querying", async () => {
    mockLimit.mockReturnValue([]);

    await listActions({ orgId: "user-123", limit: 25 });

    expect(mockedBulkExpire).toHaveBeenCalledWith("user-123");
    expect(mockedBulkExpire).toHaveBeenCalledBefore(mockSelect as ReturnType<typeof vi.fn>);
  });

  it("returns empty data with null cursor when no rows exist", async () => {
    mockLimit.mockReturnValue([]);

    const result = await listActions({ orgId: "user-123", limit: 25 });

    expect(result.data).toEqual([]);
    expect(result.cursor).toBeNull();
  });

  it("returns cursor when there are more rows than limit", async () => {
    const rows = Array.from({ length: 26 }, (_, i) =>
      makeDbRow({
        id: `a0000000-0000-4000-a000-${String(i).padStart(12, "0")}`,
        createdAt: new Date(`2026-03-${String(i + 1).padStart(2, "0")}T00:00:00Z`),
      }),
    );
    mockLimit.mockReturnValue(rows);

    const result = await listActions({ orgId: "user-123", limit: 25 });

    expect(result.data).toHaveLength(25);
    expect(result.cursor).not.toBeNull();
    expect(result.cursor?.id).toBe(rows[24].id);
  });

  it("returns null cursor when rows equal or less than limit", async () => {
    const rows = [makeDbRow()];
    mockLimit.mockReturnValue(rows);

    const result = await listActions({ orgId: "user-123", limit: 25 });

    expect(result.data).toHaveLength(1);
    expect(result.cursor).toBeNull();
  });

  it("accepts statuses array parameter", async () => {
    mockLimit.mockReturnValue([]);

    await listActions({
      orgId: "user-123",
      statuses: ["approved", "executed", "failed"],
      limit: 25,
    });

    expect(mockWhere).toHaveBeenCalled();
  });

  it("accepts a single status parameter", async () => {
    mockLimit.mockReturnValue([]);

    await listActions({
      orgId: "user-123",
      status: "pending",
      limit: 25,
    });

    expect(mockWhere).toHaveBeenCalled();
  });

  it("returns cursor with correct ISO string from last row", async () => {
    const date = new Date("2026-03-15T10:30:00Z");
    const rows = Array.from({ length: 6 }, (_, i) =>
      makeDbRow({
        id: `a0000000-0000-4000-a000-${String(i).padStart(12, "0")}`,
        createdAt: new Date(date.getTime() - i * 60000),
      }),
    );
    mockLimit.mockReturnValue(rows);

    const result = await listActions({ orgId: "user-123", limit: 5 });

    expect(result.data).toHaveLength(5);
    expect(result.cursor).toEqual({
      createdAt: rows[4].createdAt.toISOString(),
      id: rows[4].id,
    });
  });

  it("returns exactly limit rows when limit+1 rows are available", async () => {
    const rows = Array.from({ length: 4 }, (_, i) =>
      makeDbRow({
        id: `a0000000-0000-4000-a000-${String(i).padStart(12, "0")}`,
        createdAt: new Date(`2026-03-${String(i + 1).padStart(2, "0")}T00:00:00Z`),
      }),
    );
    mockLimit.mockReturnValue(rows);

    const result = await listActions({ orgId: "user-123", limit: 3 });

    expect(result.data).toHaveLength(3);
    expect(result.cursor).not.toBeNull();
  });

  it("returns null cursor when rows count equals limit exactly", async () => {
    const rows = Array.from({ length: 3 }, (_, i) =>
      makeDbRow({
        id: `a0000000-0000-4000-a000-${String(i).padStart(12, "0")}`,
        createdAt: new Date(`2026-03-${String(i + 1).padStart(2, "0")}T00:00:00Z`),
      }),
    );
    mockLimit.mockReturnValue(rows);

    const result = await listActions({ orgId: "user-123", limit: 3 });

    expect(result.data).toHaveLength(3);
    expect(result.cursor).toBeNull();
  });

  it("passes cursor condition to where clause", async () => {
    mockLimit.mockReturnValue([]);

    await listActions({
      orgId: "user-123",
      cursor: {
        createdAt: "2026-03-07T12:00:00.000Z",
        id: "a0000000-0000-4000-a000-000000000001",
      },
      limit: 25,
    });

    expect(mockWhere).toHaveBeenCalled();
  });

  it("accepts both status and statuses but calls where once", async () => {
    mockLimit.mockReturnValue([]);

    await listActions({
      orgId: "user-123",
      status: "pending",
      statuses: ["approved", "executed"],
      limit: 25,
    });

    expect(mockWhere).toHaveBeenCalledTimes(1);
  });

  it("handles empty statuses array like no status filter", async () => {
    mockLimit.mockReturnValue([]);

    await listActions({
      orgId: "user-123",
      statuses: [],
      limit: 25,
    });

    expect(mockWhere).toHaveBeenCalled();
  });

  it("requests limit+1 rows from database for pagination detection", async () => {
    mockLimit.mockReturnValue([]);

    await listActions({ orgId: "user-123", limit: 10 });

    expect(mockLimit).toHaveBeenCalledWith(11);
  });
});
