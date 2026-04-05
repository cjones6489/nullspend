import { describe, it, expect, vi, beforeEach } from "vitest";

const mockResolveSessionContext = vi.fn();
const mockAssertOrgRole = vi.fn();
const mockGetMarginTable = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  resolveSessionContext: () => mockResolveSessionContext(),
}));
vi.mock("@/lib/auth/org-authorization", () => ({
  assertOrgRole: (...args: unknown[]) => mockAssertOrgRole(...args),
}));
vi.mock("@/lib/margins/margin-query", () => ({
  getMarginTable: (...args: unknown[]) => mockGetMarginTable(...args),
}));
vi.mock("@/lib/margins/periods", () => ({
  formatPeriod: () => "2026-04",
  currentMonthStart: () => new Date(Date.UTC(2026, 3, 1)),
}));

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveSessionContext.mockResolvedValue({ userId: "user-1", orgId: "org-1", role: "viewer" });
  mockAssertOrgRole.mockResolvedValue(undefined);
});

describe("GET /api/margins — period validation edge cases", () => {
  it("rejects month 00", async () => {
    const req = new Request("http://localhost/api/margins?period=2026-00");
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it("rejects month 13", async () => {
    const req = new Request("http://localhost/api/margins?period=2026-13");
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it("rejects month 99", async () => {
    const req = new Request("http://localhost/api/margins?period=2026-99");
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it("accepts month 01", async () => {
    mockGetMarginTable.mockResolvedValue({ summary: {}, customers: [] });
    const req = new Request("http://localhost/api/margins?period=2026-01");
    const res = await GET(req);
    expect(res.status).toBe(200);
  });

  it("accepts month 12", async () => {
    mockGetMarginTable.mockResolvedValue({ summary: {}, customers: [] });
    const req = new Request("http://localhost/api/margins?period=2026-12");
    const res = await GET(req);
    expect(res.status).toBe(200);
  });

  it("rejects SQL injection in period", async () => {
    const req = new Request("http://localhost/api/margins?period=2026-01'; DROP TABLE--");
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it("rejects empty period", async () => {
    const req = new Request("http://localhost/api/margins?period=");
    const res = await GET(req);
    expect(res.status).toBe(400);
  });
});
