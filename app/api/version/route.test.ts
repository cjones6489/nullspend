/**
 * Unit tests for `/api/version`.
 *
 * This endpoint is the anchor of the post-deploy SHA verification
 * system (Slice 1k / EC-5). A regression here silently disables
 * the Vercel rollback detection logic in the workflow, so the
 * contract is tested explicitly:
 *
 *   - Returns the VERCEL_GIT_COMMIT_SHA env var verbatim
 *   - Falls back to NEXT_PUBLIC_* variant if plain isn't set
 *   - Returns null for commit_sha when no Vercel env is present
 *   - Returns env="local" when VERCEL_ENV is unset
 *   - Cache-Control: private, no-store on every response
 *   - Response is valid JSON with the expected shape
 */

import { afterEach, beforeEach, describe, it, expect } from "vitest";

import { GET } from "./route";

describe("/api/version", () => {
  const savedEnv = {
    NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA:
      process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
    VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA,
    NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF:
      process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF,
    VERCEL_GIT_COMMIT_REF: process.env.VERCEL_GIT_COMMIT_REF,
    VERCEL_ENV: process.env.VERCEL_ENV,
  };

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA;
    delete process.env.VERCEL_GIT_COMMIT_SHA;
    delete process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF;
    delete process.env.VERCEL_GIT_COMMIT_REF;
    delete process.env.VERCEL_ENV;
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v !== undefined) process.env[k] = v;
      else delete process.env[k];
    }
  });

  it("returns 200 with content-type application/json", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("sets Cache-Control: private, no-store", async () => {
    const res = await GET();
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("returns VERCEL_GIT_COMMIT_SHA verbatim when set", async () => {
    process.env.VERCEL_GIT_COMMIT_SHA = "abcdef1234567890abcdef1234567890abcdef12";
    const res = await GET();
    const body = await res.json();
    expect(body.commit_sha).toBe("abcdef1234567890abcdef1234567890abcdef12");
  });

  it("prefers NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA over plain VERCEL_GIT_COMMIT_SHA", async () => {
    // NEXT_PUBLIC_* is the canonical public form; plain is server-only.
    // If both are set, the NEXT_PUBLIC_ variant wins so server and
    // client report the same value.
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA = "public-sha";
    process.env.VERCEL_GIT_COMMIT_SHA = "server-sha";
    const res = await GET();
    const body = await res.json();
    expect(body.commit_sha).toBe("public-sha");
  });

  it("falls back to plain VERCEL_GIT_COMMIT_SHA if NEXT_PUBLIC_ is missing", async () => {
    process.env.VERCEL_GIT_COMMIT_SHA = "server-only-sha";
    const res = await GET();
    const body = await res.json();
    expect(body.commit_sha).toBe("server-only-sha");
  });

  it("returns null commit_sha when running locally (no Vercel env)", async () => {
    const res = await GET();
    const body = await res.json();
    expect(body.commit_sha).toBeNull();
  });

  it("returns env='production' when VERCEL_ENV=production", async () => {
    process.env.VERCEL_ENV = "production";
    const res = await GET();
    const body = await res.json();
    expect(body.env).toBe("production");
  });

  it("returns env='preview' when VERCEL_ENV=preview", async () => {
    process.env.VERCEL_ENV = "preview";
    const res = await GET();
    const body = await res.json();
    expect(body.env).toBe("preview");
  });

  it("returns env='local' when VERCEL_ENV is unset", async () => {
    const res = await GET();
    const body = await res.json();
    expect(body.env).toBe("local");
  });

  it("returns commit_ref from NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF", async () => {
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF = "main";
    const res = await GET();
    const body = await res.json();
    expect(body.commit_ref).toBe("main");
  });

  it("returns null commit_ref when not set", async () => {
    const res = await GET();
    const body = await res.json();
    expect(body.commit_ref).toBeNull();
  });

  it("returns deployed_at as an ISO 8601 string", async () => {
    const res = await GET();
    const body = await res.json();
    expect(body.deployed_at).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/,
    );
  });

  it("response shape includes all four documented fields", async () => {
    const res = await GET();
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual([
      "commit_ref",
      "commit_sha",
      "deployed_at",
      "env",
    ]);
  });
});
