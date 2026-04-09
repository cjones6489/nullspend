import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getOrigin } from "./client";

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost:3000/api/stripe/checkout", {
    headers,
  });
}

describe("getOrigin", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    delete process.env.NEXT_PUBLIC_APP_URL;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses NEXT_PUBLIC_APP_URL when set", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.nullspend.dev");
    expect(getOrigin(makeRequest())).toBe("https://app.nullspend.dev");
  });

  it("strips trailing slashes from NEXT_PUBLIC_APP_URL", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.nullspend.dev///");
    expect(getOrigin(makeRequest())).toBe("https://app.nullspend.dev");
  });

  it("falls back to x-forwarded-host + x-forwarded-proto", () => {
    expect(
      getOrigin(
        makeRequest({
          "x-forwarded-host": "app.nullspend.dev",
          "x-forwarded-proto": "https",
        }),
      ),
    ).toBe("https://app.nullspend.dev");
  });

  it("picks first proto when x-forwarded-proto has multiple values", () => {
    expect(
      getOrigin(
        makeRequest({
          "x-forwarded-host": "app.nullspend.dev",
          "x-forwarded-proto": "https,http",
        }),
      ),
    ).toBe("https://app.nullspend.dev");
  });

  it("falls back to host header", () => {
    expect(getOrigin(makeRequest({ host: "example.com" }))).toBe(
      "https://example.com",
    );
  });

  it("uses http for localhost", () => {
    expect(getOrigin(makeRequest({ host: "localhost:3000" }))).toBe(
      "http://localhost:3000",
    );
  });

  it("defaults to localhost:3000 when no headers are present", () => {
    expect(getOrigin(makeRequest())).toBe("http://localhost:3000");
  });
});
