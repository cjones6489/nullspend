import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveSessionUserId } from "@/lib/auth/session";
import { DELETE, POST } from "./route";

vi.mock("@/lib/auth/session", () => ({
  resolveSessionUserId: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(() => ({
    transaction: vi.fn(),
  })),
}));

vi.mock("@/lib/proxy-invalidate", () => ({
  invalidateProxyCache: vi.fn().mockResolvedValue(undefined),
}));

const mockedResolveSessionUserId = vi.mocked(resolveSessionUserId);

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("DELETE /api/budgets/[id]", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("returns 400 for raw UUID (not prefixed)", async () => {
    mockedResolveSessionUserId.mockResolvedValue("user-1");

    const req = new Request("http://localhost/api/budgets/00000000-0000-4000-a000-000000000001", {
      method: "DELETE",
    });

    const res = await DELETE(req, makeContext("00000000-0000-4000-a000-000000000001"));
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid prefixed ID", async () => {
    mockedResolveSessionUserId.mockResolvedValue("user-1");

    const req = new Request("http://localhost/api/budgets/not-valid", {
      method: "DELETE",
    });

    const res = await DELETE(req, makeContext("not-valid"));
    expect(res.status).toBe(400);
  });

  it("returns 400 for wrong prefix type", async () => {
    mockedResolveSessionUserId.mockResolvedValue("user-1");

    const req = new Request("http://localhost/api/budgets/ns_act_00000000-0000-4000-a000-000000000001", {
      method: "DELETE",
    });

    const res = await DELETE(req, makeContext("ns_act_00000000-0000-4000-a000-000000000001"));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/budgets/[id] (reset)", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("returns 400 for raw UUID (not prefixed)", async () => {
    mockedResolveSessionUserId.mockResolvedValue("user-1");

    const req = new Request("http://localhost/api/budgets/00000000-0000-4000-a000-000000000001", {
      method: "POST",
    });

    const res = await POST(req, makeContext("00000000-0000-4000-a000-000000000001"));
    expect(res.status).toBe(400);
  });

  it("returns 400 for wrong prefix type", async () => {
    mockedResolveSessionUserId.mockResolvedValue("user-1");

    const req = new Request("http://localhost/api/budgets/ns_key_00000000-0000-4000-a000-000000000001", {
      method: "POST",
    });

    const res = await POST(req, makeContext("ns_key_00000000-0000-4000-a000-000000000001"));
    expect(res.status).toBe(400);
  });
});
