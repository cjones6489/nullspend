import { afterEach, describe, expect, it, vi } from "vitest";

// Capture the scope object passed to the withScope callback
let capturedScope: { setTag: ReturnType<typeof vi.fn>; setUser: ReturnType<typeof vi.fn> };

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  withScope: vi.fn((cb: (scope: unknown) => void) => {
    capturedScope = {
      setTag: vi.fn(),
      setUser: vi.fn(),
    };
    cb(capturedScope);
  }),
  addBreadcrumb: vi.fn(),
}));

vi.mock("./request-context", () => ({
  getRequestStore: vi.fn(),
}));

import * as Sentry from "@sentry/nextjs";
import { getRequestStore } from "./request-context";
import { captureExceptionWithContext, addSentryBreadcrumb } from "./sentry";

const mockGetRequestStore = vi.mocked(getRequestStore);

describe("captureExceptionWithContext", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("calls Sentry.withScope and sets tags from store", () => {
    mockGetRequestStore.mockReturnValue({
      requestId: "req-123",
      method: "POST",
      path: "/api/actions",
      startTime: Date.now(),
      userId: "user-abc",
    });

    const error = new Error("test error");
    captureExceptionWithContext(error);

    expect(Sentry.withScope).toHaveBeenCalledOnce();
    expect(Sentry.captureException).toHaveBeenCalledWith(error);

    // Assert against the scope captured during the actual withScope callback
    expect(capturedScope.setTag).toHaveBeenCalledWith("requestId", "req-123");
    expect(capturedScope.setTag).toHaveBeenCalledWith("route", "/api/actions");
    expect(capturedScope.setTag).toHaveBeenCalledWith("method", "POST");
    expect(capturedScope.setUser).toHaveBeenCalledWith({ id: "user-abc" });
  });

  it("sets Sentry.setUser only when userId is present", () => {
    mockGetRequestStore.mockReturnValue({
      requestId: "req-456",
      method: "GET",
      path: "/api/budgets",
      startTime: Date.now(),
      // no userId
    });

    captureExceptionWithContext(new Error("no user"));

    expect(Sentry.withScope).toHaveBeenCalledOnce();
    expect(capturedScope.setTag).toHaveBeenCalledWith("requestId", "req-456");
    expect(capturedScope.setUser).not.toHaveBeenCalled();
  });

  it("falls back to bare captureException when store is undefined", () => {
    mockGetRequestStore.mockReturnValue(undefined);

    const error = new Error("no store");
    captureExceptionWithContext(error);

    expect(Sentry.captureException).toHaveBeenCalledWith(error);
    expect(Sentry.withScope).not.toHaveBeenCalled();
  });
});

describe("addSentryBreadcrumb", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("passes through to Sentry.addBreadcrumb", () => {
    addSentryBreadcrumb("auth", "API key authenticated", { keyId: "k1" });

    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith({
      category: "auth",
      message: "API key authenticated",
      data: { keyId: "k1" },
      level: "info",
    });
  });

  it("passes undefined data when not provided", () => {
    addSentryBreadcrumb("nav", "Page loaded");

    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith({
      category: "nav",
      message: "Page loaded",
      data: undefined,
      level: "info",
    });
  });
});
