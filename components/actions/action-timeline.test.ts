import { describe, expect, it } from "vitest";

import { formatActor } from "@/components/actions/action-timeline";

describe("formatActor", () => {
  it("returns null for null input", () => {
    expect(formatActor(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(formatActor(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(formatActor("")).toBeNull();
  });

  it('returns "Dashboard" for a standard UUID', () => {
    expect(formatActor("550e8400-e29b-41d4-a716-446655440000")).toBe("Dashboard");
  });

  it('returns "Dashboard" for an uppercase UUID', () => {
    expect(formatActor("550E8400-E29B-41D4-A716-446655440000")).toBe("Dashboard");
  });

  it("returns the Slack username for a non-UUID string", () => {
    expect(formatActor("jtorrance")).toBe("jtorrance");
  });

  it("returns the Slack display name for a non-UUID string", () => {
    expect(formatActor("Jack Torrance")).toBe("Jack Torrance");
  });

  it("returns a Slack user ID as-is (not a UUID format)", () => {
    expect(formatActor("U1234ABCD")).toBe("U1234ABCD");
  });

  it("does not match partial UUIDs", () => {
    expect(formatActor("550e8400-e29b")).toBe("550e8400-e29b");
  });

  it("does not match UUIDs with extra characters", () => {
    expect(formatActor("550e8400-e29b-41d4-a716-446655440000x")).toBe(
      "550e8400-e29b-41d4-a716-446655440000x",
    );
  });

  it("does not match UUIDs without dashes", () => {
    expect(formatActor("550e8400e29b41d4a716446655440000")).toBe(
      "550e8400e29b41d4a716446655440000",
    );
  });

  it("returns whitespace-only strings as-is", () => {
    expect(formatActor("   ")).toBe("   ");
  });

  it("handles Slack bot user IDs (B prefix)", () => {
    expect(formatActor("B01ABCDEFGH")).toBe("B01ABCDEFGH");
  });

  it("handles Slack webhook names with special chars", () => {
    expect(formatActor("slack-bot-v2")).toBe("slack-bot-v2");
  });
});
