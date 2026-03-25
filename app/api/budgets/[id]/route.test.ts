import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveSessionContext } from "@/lib/auth/session";
import { DELETE, POST } from "./route";

vi.mock("@/lib/auth/session", () => ({
  resolveSessionContext: vi.fn(),
}));

vi.mock("@/lib/auth/org-authorization", () => ({
  assertOrgRole: vi.fn().mockResolvedValue({ userId: "user-1", orgId: "org-test-1", role: "owner" }),
  assertOrgMember: vi.fn().mockResolvedValue({ userId: "user-1", orgId: "org-test-1", role: "owner" }),
}));

vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(() => ({
    transaction: vi.fn(),
  })),
}));

vi.mock("@/lib/proxy-invalidate", () => ({
  invalidateProxyCache: vi.fn().mockResolvedValue(undefined),
}));

const mockedResolveSessionContext = vi.mocked(resolveSessionContext);

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("DELETE /api/budgets/[id]", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("returns 400 for raw UUID (not prefixed)", async () => {
    mockedResolveSessionContext.mockResolvedValue({ userId: "user-1", orgId: "org-test-1", role: "owner" as const });

    const req = new Request("http://localhost/api/budgets/00000000-0000-4000-a000-000000000001", {
      method: "DELETE",
    });

    const res = await DELETE(req, makeContext("00000000-0000-4000-a000-000000000001"));
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid prefixed ID", async () => {
    mockedResolveSessionContext.mockResolvedValue({ userId: "user-1", orgId: "org-test-1", role: "owner" as const });

    const req = new Request("http://localhost/api/budgets/not-valid", {
      method: "DELETE",
    });

    const res = await DELETE(req, makeContext("not-valid"));
    expect(res.status).toBe(400);
  });

  it("returns 400 for wrong prefix type", async () => {
    mockedResolveSessionContext.mockResolvedValue({ userId: "user-1", orgId: "org-test-1", role: "owner" as const });

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
    mockedResolveSessionContext.mockResolvedValue({ userId: "user-1", orgId: "org-test-1", role: "owner" as const });

    const req = new Request("http://localhost/api/budgets/00000000-0000-4000-a000-000000000001", {
      method: "POST",
    });

    const res = await POST(req, makeContext("00000000-0000-4000-a000-000000000001"));
    expect(res.status).toBe(400);
  });

  it("returns 400 for wrong prefix type", async () => {
    mockedResolveSessionContext.mockResolvedValue({ userId: "user-1", orgId: "org-test-1", role: "owner" as const });

    const req = new Request("http://localhost/api/budgets/ns_key_00000000-0000-4000-a000-000000000001", {
      method: "POST",
    });

    const res = await POST(req, makeContext("ns_key_00000000-0000-4000-a000-000000000001"));
    expect(res.status).toBe(400);
  });
});
