import { afterEach, describe, expect, it, vi } from "vitest";

import { rejectAction } from "@/lib/actions/reject-action";
import {
  ActionExpiredError,
  ActionNotFoundError,
  InvalidActionTransitionError,
} from "@/lib/actions/errors";
import { resolveSessionContext } from "@/lib/auth/session";
import { POST } from "./route";

vi.mock("@/lib/actions/reject-action", () => ({
  rejectAction: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  resolveSessionContext: vi.fn(),
}));

const mockedRejectAction = vi.mocked(rejectAction);
const mockedResolveSessionContext = vi.mocked(resolveSessionContext);

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/actions/[id]/reject", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("rejects a pending action", async () => {
    mockedResolveSessionContext.mockResolvedValue({ userId: "user-1" });
    mockedRejectAction.mockResolvedValue({
      id: "00000000-0000-4000-a000-000000000001",
      status: "rejected",
      rejectedAt: "2026-01-01T00:00:00.000Z",
    });

    const req = new Request("http://localhost/api/actions/ns_act_00000000-0000-4000-a000-000000000001/reject", { method: "POST" });
    const res = await POST(req, makeContext("ns_act_00000000-0000-4000-a000-000000000001"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("ns_act_00000000-0000-4000-a000-000000000001");
    expect(body.status).toBe("rejected");
    expect(mockedRejectAction).toHaveBeenCalledWith(
      "00000000-0000-4000-a000-000000000001",
      { rejectedBy: "user-1" },
      "user-1",
    );
  });

  it("returns 404 when action is not found", async () => {
    mockedResolveSessionContext.mockResolvedValue({ userId: "user-1" });
    mockedRejectAction.mockRejectedValue(new ActionNotFoundError("00000000-0000-4000-a000-000000000002"));

    const req = new Request("http://localhost/api/actions/ns_act_00000000-0000-4000-a000-000000000002/reject", { method: "POST" });
    const res = await POST(req, makeContext("ns_act_00000000-0000-4000-a000-000000000002"));

    expect(res.status).toBe(404);
  });

  it("returns 409 when action has expired", async () => {
    mockedResolveSessionContext.mockResolvedValue({ userId: "user-1" });
    mockedRejectAction.mockRejectedValue(new ActionExpiredError("00000000-0000-4000-a000-000000000001"));

    const req = new Request("http://localhost/api/actions/ns_act_00000000-0000-4000-a000-000000000001/reject", { method: "POST" });
    const res = await POST(req, makeContext("ns_act_00000000-0000-4000-a000-000000000001"));

    expect(res.status).toBe(409);
  });

  it("returns 409 when action is not in pending state", async () => {
    mockedResolveSessionContext.mockResolvedValue({ userId: "user-1" });
    mockedRejectAction.mockRejectedValue(
      new InvalidActionTransitionError("executed", "rejected"),
    );

    const req = new Request("http://localhost/api/actions/ns_act_00000000-0000-4000-a000-000000000001/reject", { method: "POST" });
    const res = await POST(req, makeContext("ns_act_00000000-0000-4000-a000-000000000001"));

    expect(res.status).toBe(409);
  });

  it("returns 401 when session is invalid", async () => {
    const { AuthenticationRequiredError } = await import("@/lib/auth/errors");
    mockedResolveSessionContext.mockRejectedValue(new AuthenticationRequiredError());

    const req = new Request("http://localhost/api/actions/ns_act_00000000-0000-4000-a000-000000000001/reject", { method: "POST" });
    const res = await POST(req, makeContext("ns_act_00000000-0000-4000-a000-000000000001"));

    expect(res.status).toBe(401);
  });
});
