import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/observability/sentry", () => ({
  captureExceptionWithContext: vi.fn(),
}));

vi.mock("@/lib/observability", () => {
  const mockLogger = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  };
  return {
    getLogger: vi.fn(() => mockLogger),
    __mockLogger: mockLogger,
  };
});

import { captureExceptionWithContext } from "@/lib/observability/sentry";
import { getLogger } from "@/lib/observability";
import { handleRouteError, readJsonBody } from "./http";

// Access mock logger for assertions
const mockLogger = (
  await import("@/lib/observability") as any
).__mockLogger;

describe("handleRouteError", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("logs structured error and calls Sentry for unhandled errors (500)", () => {
    const error = new Error("unexpected failure");
    const response = handleRouteError(error);

    expect(response.status).toBe(500);
    expect(getLogger).toHaveBeenCalledWith("http");
    expect(mockLogger.error).toHaveBeenCalledWith(
      { err: error },
      "Unhandled route error",
    );
    expect(captureExceptionWithContext).toHaveBeenCalledWith(error);
  });

  it("does NOT call Sentry for 400 errors (ZodError)", async () => {
    const { z } = await import("zod");
    // Create a real ZodError via parse failure
    let error: Error;
    try {
      z.object({ name: z.string() }).parse({ name: 123 });
      throw new Error("should not reach");
    } catch (e) {
      error = e as Error;
    }
    const response = handleRouteError(error!);

    expect(response.status).toBe(400);
    expect(captureExceptionWithContext).not.toHaveBeenCalled();
  });

  it("does NOT call Sentry for 401 errors (ApiKeyError)", async () => {
    const { ApiKeyError } = await import("@/lib/auth/api-key");
    const error = new ApiKeyError("Invalid API key");
    const response = handleRouteError(error);

    expect(response.status).toBe(401);
    expect(captureExceptionWithContext).not.toHaveBeenCalled();
  });

  it("does NOT call Sentry for 404 errors (ActionNotFoundError)", async () => {
    const { ActionNotFoundError } = await import("@/lib/actions/errors");
    const error = new ActionNotFoundError("not-found-id");
    const response = handleRouteError(error);

    expect(response.status).toBe(404);
    expect(captureExceptionWithContext).not.toHaveBeenCalled();
  });

  it("does NOT call Sentry for 403 errors (ForbiddenError)", async () => {
    const { ForbiddenError } = await import("@/lib/auth/errors");
    const error = new ForbiddenError();
    const response = handleRouteError(error);

    expect(response.status).toBe(403);
    expect(captureExceptionWithContext).not.toHaveBeenCalled();
  });

  it("returns 503 with Retry-After for CircuitOpenError (no Sentry)", async () => {
    const { CircuitOpenError } = await import("@/lib/resilience/circuit-breaker");
    const error = new CircuitOpenError("supabase-auth");
    const response = handleRouteError(error);

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error.code).toBe("service_unavailable");
    expect(body.error.message).toBe("Service temporarily unavailable.");
    expect(response.headers.get("Retry-After")).toBe("30");
    expect(mockLogger.warn).toHaveBeenCalledWith(
      { err: error },
      "Circuit breaker open — returning 503",
    );
    expect(captureExceptionWithContext).not.toHaveBeenCalled();
  });

  it("logs SupabaseEnvError as 500 but does NOT call Sentry", async () => {
    const { SupabaseEnvError } = await import("@/lib/auth/errors");
    const error = new SupabaseEnvError("NEXT_PUBLIC_SUPABASE_URL");
    const response = handleRouteError(error);

    expect(response.status).toBe(500);
    expect(mockLogger.error).toHaveBeenCalledWith(
      { err: error },
      "Supabase configuration error",
    );
    expect(captureExceptionWithContext).not.toHaveBeenCalled();
  });

});
// 415 coverage for UnsupportedMediaTypeError is in the readJsonBody suite below
// (handleRouteError returns 415 for content-type errors)

// ---------------------------------------------------------------------------
// 3.3 — Content-Type validation in readJsonBody
// ---------------------------------------------------------------------------

describe("readJsonBody Content-Type validation", () => {
  function makeRequest(body: string, contentType?: string): Request {
    const headers = new Headers();
    if (contentType) {
      headers.set("content-type", contentType);
    }
    return new Request("http://localhost/api/test", {
      method: "POST",
      headers,
      body,
    });
  }

  it("accepts application/json", async () => {
    const result = await readJsonBody(
      makeRequest('{"key":"value"}', "application/json"),
    );
    expect(result).toEqual({ key: "value" });
  });

  it("accepts application/json with charset", async () => {
    const result = await readJsonBody(
      makeRequest('{"key":"value"}', "application/json; charset=utf-8"),
    );
    expect(result).toEqual({ key: "value" });
  });

  it("rejects text/plain with 415", async () => {
    await expect(
      readJsonBody(makeRequest('{"key":"value"}', "text/plain")),
    ).rejects.toThrow("Content-Type must be application/json.");
  });

  it("rejects missing Content-Type with 415", async () => {
    await expect(
      readJsonBody(makeRequest('{"key":"value"}')),
    ).rejects.toThrow("Content-Type must be application/json.");
  });

  it("rejects text/html with 415", async () => {
    await expect(
      readJsonBody(makeRequest("<html></html>", "text/html")),
    ).rejects.toThrow("Content-Type must be application/json.");
  });

  it("handleRouteError returns 415 for content-type errors", async () => {
    try {
      await readJsonBody(makeRequest('{"key":"value"}', "text/plain"));
      throw new Error("should not reach");
    } catch (err) {
      const response = handleRouteError(err);
      expect(response.status).toBe(415);
      const body = await response.json();
      expect(body.error.code).toBe("unsupported_media_type");
      expect(body.error.message).toBe("Content-Type must be application/json.");
    }
  });
});
