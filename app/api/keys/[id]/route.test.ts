import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveSessionUserId } from "@/lib/auth/session";
import { DELETE } from "./route";

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


const mockedResolveSessionUserId = vi.mocked(resolveSessionUserId);

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
      { id: "00000000-0000-4000-a000-000000000011", revokedAt: now },
    ]);

    const req = new Request("http://localhost/api/keys/ns_key_00000000-0000-4000-a000-000000000011", { method: "DELETE" });
    const res = await DELETE(req, makeContext("ns_key_00000000-0000-4000-a000-000000000011"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("ns_key_00000000-0000-4000-a000-000000000011");
    expect(body.revokedAt).toBe(now.toISOString());
  });

  it("returns 404 when key is not found or already revoked", async () => {
    mockedResolveSessionUserId.mockResolvedValue("user-1");
    mockUpdateReturning.mockResolvedValue([]);

    const req = new Request("http://localhost/api/keys/ns_key_00000000-0000-4000-a000-000000000012", { method: "DELETE" });
    const res = await DELETE(req, makeContext("ns_key_00000000-0000-4000-a000-000000000012"));

    expect(res.status).toBe(404);
  });

  it("returns 401 when session is invalid", async () => {
    const { AuthenticationRequiredError } = await import("@/lib/auth/errors");
    mockedResolveSessionUserId.mockRejectedValue(new AuthenticationRequiredError());

    const req = new Request("http://localhost/api/keys/ns_key_00000000-0000-4000-a000-000000000011", { method: "DELETE" });
    const res = await DELETE(req, makeContext("ns_key_00000000-0000-4000-a000-000000000011"));

    expect(res.status).toBe(401);
  });
});
