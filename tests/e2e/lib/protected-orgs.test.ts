/**
 * Unit tests for `protected-orgs.ts` — the founder-org safety allowlist.
 *
 * This is a tiny module but the invariant is safety-critical: any
 * regression that lets E2E tooling touch a founder org could destroy
 * real data. The tests here enforce:
 *
 *   1. PROTECTED_ORG_IDS contains the known founder org IDs
 *   2. assertNotProtected() throws ProtectedOrgError on a member
 *   3. assertNotProtected() does NOT throw on a non-member
 *   4. ProtectedOrgError carries the orgId + context for triage
 *   5. The error message identifies the module so triagers know
 *      where to update the allowlist
 *
 * If this file is ever deleted or these assertions relaxed, code review
 * should flag it immediately — the allowlist is the last line of
 * defense before destructive operations.
 */

import { describe, it, expect } from "vitest";

import {
  PROTECTED_ORG_IDS,
  ProtectedOrgError,
  assertNotProtected,
} from "./protected-orgs";

// Canonical founder IDs (copy-pasted from protected-orgs.ts — the point
// is that this test catches accidental REMOVAL from the allowlist).
const FOUNDER_PERSONAL = "052f5cc2-63e6-41db-ace7-ea20364851ab";
const FOUNDER_TEST = "55c30156-1d15-46f7-bdb4-ca2a15a69d77";

describe("PROTECTED_ORG_IDS", () => {
  it("contains the founder Personal org ID", () => {
    expect(PROTECTED_ORG_IDS.has(FOUNDER_PERSONAL)).toBe(true);
  });

  it("contains the founder Test org ID", () => {
    expect(PROTECTED_ORG_IDS.has(FOUNDER_TEST)).toBe(true);
  });

  it("has exactly the expected number of protected orgs (catches silent drift)", () => {
    // If this count changes, someone added or removed a protected org.
    // That's a safety-critical change — force a test update so it's
    // explicit in code review.
    expect(PROTECTED_ORG_IDS.size).toBe(2);
  });

  it("does not contain a random non-protected UUID", () => {
    expect(PROTECTED_ORG_IDS.has("00000000-0000-0000-0000-000000000000")).toBe(false);
  });

  it("type signature is ReadonlySet<string> (compile-time immutability)", () => {
    // Runtime check: .has works but TypeScript should reject .add on
    // the typed export. This is a smoke test that the type is exported
    // correctly — the actual compile-time check is enforced by `tsc`.
    expect(typeof PROTECTED_ORG_IDS.has).toBe("function");
  });
});

describe("assertNotProtected", () => {
  it("throws ProtectedOrgError on the founder Personal org", () => {
    expect(() => assertNotProtected(FOUNDER_PERSONAL, "unit test")).toThrow(
      ProtectedOrgError,
    );
  });

  it("throws ProtectedOrgError on the founder Test org", () => {
    expect(() => assertNotProtected(FOUNDER_TEST, "unit test")).toThrow(
      ProtectedOrgError,
    );
  });

  it("does NOT throw on a non-protected org ID", () => {
    expect(() =>
      assertNotProtected("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "unit test"),
    ).not.toThrow();
  });

  it("does NOT throw on an empty string (not a match for any UUID)", () => {
    // Empty-string behavior is well-defined: `Set.has("")` returns
    // false, so the assertion passes. This documents the current
    // semantics — if it ever changes, the test will fail first.
    expect(() => assertNotProtected("", "unit test")).not.toThrow();
  });

  it("the thrown error includes the orgId in its structured field", () => {
    try {
      assertNotProtected(FOUNDER_PERSONAL, "unit test");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ProtectedOrgError);
      expect((err as ProtectedOrgError).orgId).toBe(FOUNDER_PERSONAL);
    }
  });

  it("the thrown error includes the context string in its structured field", () => {
    try {
      assertNotProtected(FOUNDER_PERSONAL, "bootstrap script reset");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ProtectedOrgError);
      expect((err as ProtectedOrgError).context).toBe("bootstrap script reset");
    }
  });

  it("the error message identifies the allowlist source file", () => {
    try {
      assertNotProtected(FOUNDER_PERSONAL, "unit test");
      expect.unreachable("should have thrown");
    } catch (err) {
      // Triagers reading the error should know WHERE to update the
      // allowlist without spelunking. The module path must appear in
      // the message.
      expect((err as Error).message).toContain("tests/e2e/lib/protected-orgs.ts");
    }
  });

  it("the error name is ProtectedOrgError (for catch-filter pattern matching)", () => {
    try {
      assertNotProtected(FOUNDER_PERSONAL, "unit test");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as Error).name).toBe("ProtectedOrgError");
    }
  });

  // --- Input normalization (EC-4 regression) ---

  it("throws on UPPERCASE variant of a protected UUID", () => {
    // Supabase returns lowercase UUIDs via drizzle, but other sources
    // (JWT claims, env vars, external APIs) may return uppercase. The
    // safety check must catch all case variants.
    expect(() =>
      assertNotProtected(FOUNDER_PERSONAL.toUpperCase(), "unit test"),
    ).toThrow(ProtectedOrgError);
  });

  it("throws on mixed-case variant of a protected UUID", () => {
    // "052F5cc2-261f-450D-83a1-ce191950373d" — deliberate mangled case
    const mixed = FOUNDER_PERSONAL
      .split("")
      .map((c, i) => (i % 2 === 0 ? c.toUpperCase() : c))
      .join("");
    expect(() => assertNotProtected(mixed, "unit test")).toThrow(
      ProtectedOrgError,
    );
  });

  it("throws on whitespace-padded protected UUID", () => {
    expect(() =>
      assertNotProtected(`  ${FOUNDER_PERSONAL}  `, "unit test"),
    ).toThrow(ProtectedOrgError);
  });

  it("throws on tab-padded protected UUID", () => {
    expect(() =>
      assertNotProtected(`\t${FOUNDER_PERSONAL}\t`, "unit test"),
    ).toThrow(ProtectedOrgError);
  });

  it("throws on newline-padded protected UUID", () => {
    // Common case: env var value with trailing newline from a shell pipe
    expect(() =>
      assertNotProtected(`${FOUNDER_PERSONAL}\n`, "unit test"),
    ).toThrow(ProtectedOrgError);
  });

  it("preserves the ORIGINAL (non-normalized) input in the error for debugging", () => {
    // Operators investigating a safety violation need to see the EXACT
    // string the caller passed, not a normalized version — so they can
    // trace how the mangled input got generated.
    const padded = `  ${FOUNDER_PERSONAL.toUpperCase()}  `;
    try {
      assertNotProtected(padded, "unit test");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as ProtectedOrgError).orgId).toBe(padded);
    }
  });
});
