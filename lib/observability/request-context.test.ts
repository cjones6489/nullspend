import { describe, expect, it } from "vitest";

import {
  getRequestId,
  getRequestStore,
  runWithRequestContext,
} from "./request-context";

describe("request-context", () => {
  it("provides requestId inside context", () => {
    runWithRequestContext(
      { requestId: "req-1", method: "GET", path: "/api/test" },
      () => {
        expect(getRequestId()).toBe("req-1");
      },
    );
  });

  it("provides full store inside context", () => {
    runWithRequestContext(
      { requestId: "req-2", method: "POST", path: "/api/actions" },
      () => {
        const store = getRequestStore();
        expect(store).toMatchObject({
          requestId: "req-2",
          method: "POST",
          path: "/api/actions",
        });
        expect(store?.startTime).toBeGreaterThan(0);
      },
    );
  });

  it("returns undefined outside context", () => {
    expect(getRequestId()).toBeUndefined();
    expect(getRequestStore()).toBeUndefined();
  });

  it("scopes requestId per-call (no leaking between contexts)", async () => {
    const ids: string[] = [];

    await Promise.all([
      new Promise<void>((resolve) => {
        runWithRequestContext(
          { requestId: "req-a", method: "GET", path: "/" },
          () => {
            ids.push(getRequestId()!);
            resolve();
          },
        );
      }),
      new Promise<void>((resolve) => {
        runWithRequestContext(
          { requestId: "req-b", method: "GET", path: "/" },
          () => {
            ids.push(getRequestId()!);
            resolve();
          },
        );
      }),
    ]);

    expect(ids).toContain("req-a");
    expect(ids).toContain("req-b");
  });

  it("nested calls see the innermost context", () => {
    runWithRequestContext(
      { requestId: "outer", method: "GET", path: "/" },
      () => {
        expect(getRequestId()).toBe("outer");
        runWithRequestContext(
          { requestId: "inner", method: "POST", path: "/nested" },
          () => {
            expect(getRequestId()).toBe("inner");
          },
        );
        expect(getRequestId()).toBe("outer");
      },
    );
  });
});
