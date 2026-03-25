import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveSessionContext } from "@/lib/auth/session";
import { POST } from "./route";

vi.mock("@/lib/auth/session", () => ({
  resolveSessionContext: vi.fn(),
}));

const mockUpdateReturning = vi.fn();
const mockSetArg = vi.fn();

vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(() => ({
    update: () => ({
      set: (arg: unknown) => {
        mockSetArg(arg);
        return {
          where: () => ({
            returning: mockUpdateReturning,
          }),
        };
      },
    }),
  })),
}));

const mockedResolveSessionContext = vi.mocked(resolveSessionContext);

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
    mockedResolveSessionContext.mockResolvedValue({ userId: "user-1", orgId: "org-test-1", role: "owner" as const });
    mockUpdateReturning.mockResolvedValue([{ id: RAW_UUID }]);

    const req = new Request("http://localhost/api/webhooks/" + VALID_ID + "/rotate-secret", {
      method: "POST",
    });

    const res = await POST(req, makeContext(VALID_ID));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.signingSecret).toMatch(/^whsec_[0-9a-f]{64}$/);
    expect(body.data.secretRotatedAt).toBeDefined();
    expect(typeof body.data.secretRotatedAt).toBe("string");
  });

  it("passes SQL column reference for previousSigningSecret (atomic copy)", async () => {
    mockedResolveSessionContext.mockResolvedValue({ userId: "user-1", orgId: "org-test-1", role: "owner" as const });
    mockUpdateReturning.mockResolvedValue([{ id: RAW_UUID }]);

    const req = new Request("http://localhost/api/webhooks/" + VALID_ID + "/rotate-secret", {
      method: "POST",
    });

    await POST(req, makeContext(VALID_ID));

    expect(mockSetArg).toHaveBeenCalledTimes(1);
    const setArg = mockSetArg.mock.calls[0][0];

    // previousSigningSecret must be a Drizzle SQL object (column reference), not a plain string
    expect(setArg.previousSigningSecret).toBeDefined();
    expect(typeof setArg.previousSigningSecret).not.toBe("string");
    // Drizzle SQL objects have a queryChunks array
    expect(setArg.previousSigningSecret.queryChunks).toBeDefined();

    // signingSecret must be a plain string (the new secret)
    expect(typeof setArg.signingSecret).toBe("string");
    expect(setArg.signingSecret).toMatch(/^whsec_/);

    // secretRotatedAt must be a Date
    expect(setArg.secretRotatedAt).toBeInstanceOf(Date);
  });

  it("returns 404 for non-owned endpoint", async () => {
    mockedResolveSessionContext.mockResolvedValue({ userId: "user-1", orgId: "org-test-1", role: "owner" as const });
    mockUpdateReturning.mockResolvedValue([]);

    const req = new Request("http://localhost/api/webhooks/" + VALID_ID + "/rotate-secret", {
      method: "POST",
    });

    const res = await POST(req, makeContext(VALID_ID));

    expect(res.status).toBe(404);
  });

  it("returns 400 for invalid prefixed ID param", async () => {
    mockedResolveSessionContext.mockResolvedValue({ userId: "user-1", orgId: "org-test-1", role: "owner" as const });

    const req = new Request("http://localhost/api/webhooks/not-a-uuid/rotate-secret", {
      method: "POST",
    });

    const res = await POST(req, makeContext("not-a-uuid"));

    expect(res.status).toBe(400);
  });
});
