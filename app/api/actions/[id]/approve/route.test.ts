import { afterEach, describe, expect, it, vi } from "vitest";

import { approveAction } from "@/lib/actions/approve-action";
import {
  ActionExpiredError,
  ActionNotFoundError,
  InvalidActionTransitionError,
} from "@/lib/actions/errors";
import { resolveSessionContext } from "@/lib/auth/session";
import { POST } from "./route";

vi.mock("@/lib/actions/approve-action", () => ({
  approveAction: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  resolveSessionContext: vi.fn(),
}));

const mockedApproveAction = vi.mocked(approveAction);
const mockedResolveSessionContext = vi.mocked(resolveSessionContext);

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/actions/[id]/approve", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("approves a pending action", async () => {
    mockedResolveSessionContext.mockResolvedValue({ userId: "user-1", orgId: "00000000-0000-4000-b000-000000000001", role: "owner" as const });
    mockedApproveAction.mockResolvedValue({
      id: "00000000-0000-4000-a000-000000000001",
      status: "approved",
      approvedAt: "2026-01-01T00:00:00.000Z",
    });

    const req = new Request("http://localhost/api/actions/ns_act_00000000-0000-4000-a000-000000000001/approve", { method: "POST" });
    const res = await POST(req, makeContext("ns_act_00000000-0000-4000-a000-000000000001"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("ns_act_00000000-0000-4000-a000-000000000001");
    expect(body.status).toBe("approved");
    expect(mockedApproveAction).toHaveBeenCalledWith(
      "00000000-0000-4000-a000-000000000001",
      { approvedBy: "user-1" },
      "00000000-0000-4000-b000-000000000001",
    );
  });

  it("returns 404 when action is not found", async () => {
    mockedResolveSessionContext.mockResolvedValue({ userId: "user-1", orgId: "00000000-0000-4000-b000-000000000001", role: "owner" as const });
    mockedApproveAction.mockRejectedValue(new ActionNotFoundError("missing"));

    const req = new Request("http://localhost/api/actions/ns_act_00000000-0000-4000-a000-000000000002/approve", { method: "POST" });
    const res = await POST(req, makeContext("ns_act_00000000-0000-4000-a000-000000000002"));

    expect(res.status).toBe(404);
  });

  it("returns 409 when action has expired", async () => {
    mockedResolveSessionContext.mockResolvedValue({ userId: "user-1", orgId: "00000000-0000-4000-b000-000000000001", role: "owner" as const });
    mockedApproveAction.mockRejectedValue(new ActionExpiredError("00000000-0000-4000-a000-000000000001"));

    const req = new Request("http://localhost/api/actions/ns_act_00000000-0000-4000-a000-000000000001/approve", { method: "POST" });
    const res = await POST(req, makeContext("ns_act_00000000-0000-4000-a000-000000000001"));

    expect(res.status).toBe(409);
  });

  it("returns 409 when action is not in pending state", async () => {
    mockedResolveSessionContext.mockResolvedValue({ userId: "user-1", orgId: "00000000-0000-4000-b000-000000000001", role: "owner" as const });
    mockedApproveAction.mockRejectedValue(
      new InvalidActionTransitionError("rejected", "approved"),
    );

    const req = new Request("http://localhost/api/actions/ns_act_00000000-0000-4000-a000-000000000001/approve", { method: "POST" });
    const res = await POST(req, makeContext("ns_act_00000000-0000-4000-a000-000000000001"));

    expect(res.status).toBe(409);
  });

  it("returns 401 when session is invalid", async () => {
    const { AuthenticationRequiredError } = await import("@/lib/auth/errors");
    mockedResolveSessionContext.mockRejectedValue(new AuthenticationRequiredError());

    const req = new Request("http://localhost/api/actions/ns_act_00000000-0000-4000-a000-000000000001/approve", { method: "POST" });
    const res = await POST(req, makeContext("ns_act_00000000-0000-4000-a000-000000000001"));

    expect(res.status).toBe(401);
  });
});
