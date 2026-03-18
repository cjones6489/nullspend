import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/utils/http", () => ({
  handleRouteError: vi.fn(
    () => new Response(JSON.stringify({ error: { code: "internal_error", message: "Internal server error.", details: null } }), { status: 500 }),
  ),
}));

import { handleRouteError } from "@/lib/utils/http";
import { withRequestContext } from "./with-request-context";
import { getRequestId } from "./request-context";

function makeRequest(
  url = "https://example.com/api/test",
  init?: RequestInit,
): Request {
  return new Request(url, init);
}

describe("withRequestContext", () => {
  it("sets requestId from x-request-id header", async () => {
    let capturedId: string | undefined;
    const handler = withRequestContext(async (_req: Request) => {
      capturedId = getRequestId();
      return new Response("ok");
    });

    await handler(
      makeRequest("https://example.com/api/test", {
        headers: { "x-request-id": "provided-id" },
      }),
    );

    expect(capturedId).toBe("provided-id");
  });

  it("generates UUID when x-request-id header is absent", async () => {
    let capturedId: string | undefined;
    const handler = withRequestContext(async (_req: Request) => {
      capturedId = getRequestId();
      return new Response("ok");
    });

    await handler(makeRequest());

    expect(capturedId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it("catches errors via handleRouteError", async () => {
    const handler = withRequestContext(async (_req: Request): Promise<Response> => {
      throw new Error("boom");
    });

    const res = await handler(makeRequest());

    expect(res.status).toBe(500);
    expect(handleRouteError).toHaveBeenCalledWith(expect.any(Error));
  });

  it("passes through dynamic route params", async () => {
    let receivedParams: unknown;
    const handler = withRequestContext(
      async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
        receivedParams = await ctx.params;
        return new Response("ok");
      },
    );

    await handler(makeRequest(), {
      params: Promise.resolve({ id: "action-42" }),
    });

    expect(receivedParams).toEqual({ id: "action-42" });
  });

  it("returns the handler's response on success", async () => {
    const handler = withRequestContext(async (_req: Request) => {
      return new Response(JSON.stringify({ data: 42 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const res = await handler(makeRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: 42 });
  });
});
