import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveSessionContext } from "@/lib/auth/session";
import { AuthenticationRequiredError } from "@/lib/auth/errors";
import { GET } from "./route";

vi.mock("@/lib/auth/session", () => ({
  resolveSessionContext: vi.fn(),
}));

vi.mock("@/lib/observability/sentry", () => ({
  captureExceptionWithContext: vi.fn(),
  addSentryBreadcrumb: vi.fn(),
}));

const mockedResolveSessionContext = vi.mocked(resolveSessionContext);

describe("GET /api/auth/session", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 with userId, orgId, role on success", async () => {
    mockedResolveSessionContext.mockResolvedValue({
      userId: "user-1",
      orgId: "org-1",
      role: "owner",
    });

    const req = new Request("http://localhost/api/auth/session");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      userId: "user-1",
      orgId: "org-1",
      role: "owner",
    });
  });

  it("returns 401 when session is invalid", async () => {
    mockedResolveSessionContext.mockRejectedValue(
      new AuthenticationRequiredError(),
    );

    const req = new Request("http://localhost/api/auth/session");
    const res = await GET(req);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("authentication_required");
  });
});
