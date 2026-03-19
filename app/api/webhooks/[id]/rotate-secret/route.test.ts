import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveSessionUserId } from "@/lib/auth/session";
import { POST } from "./route";

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

const RAW_UUID = "00000000-0000-4000-a000-000000000001";
const VALID_ID = `ns_wh_${RAW_UUID}`;

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/webhooks/:id/rotate-secret", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("rotates the signing secret and returns new secret", async () => {
    mockedResolveSessionUserId.mockResolvedValue("user-1");
    mockUpdateReturning.mockResolvedValue([{ id: RAW_UUID }]);

    const req = new Request("http://localhost/api/webhooks/" + VALID_ID + "/rotate-secret", {
      method: "POST",
    });

    const res = await POST(req, makeContext(VALID_ID));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.signingSecret).toMatch(/^whsec_[0-9a-f]{64}$/);
  });

  it("returns 404 for non-owned endpoint", async () => {
    mockedResolveSessionUserId.mockResolvedValue("user-1");
    mockUpdateReturning.mockResolvedValue([]);

    const req = new Request("http://localhost/api/webhooks/" + VALID_ID + "/rotate-secret", {
      method: "POST",
    });

    const res = await POST(req, makeContext(VALID_ID));

    expect(res.status).toBe(404);
  });

  it("returns 400 for invalid prefixed ID param", async () => {
    mockedResolveSessionUserId.mockResolvedValue("user-1");

    const req = new Request("http://localhost/api/webhooks/not-a-uuid/rotate-secret", {
      method: "POST",
    });

    const res = await POST(req, makeContext("not-a-uuid"));

    expect(res.status).toBe(400);
  });
});
