import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SlackSignatureError, verifySlackSignature } from "./verify";

const TEST_SECRET = "8f742231b10e8888abcd99yyyzzz85a5";

function makeSignature(
  secret: string,
  timestamp: string,
  body: string,
): string {
  const basestring = `v0:${timestamp}:${body}`;
  return (
    "v0=" + createHmac("sha256", secret).update(basestring).digest("hex")
  );
}

function makeHeaders(timestamp: string, signature: string): Headers {
  return new Headers({
    "x-slack-request-timestamp": timestamp,
    "x-slack-signature": signature,
  });
}

describe("verifySlackSignature", () => {
  beforeEach(() => {
    vi.stubEnv("SLACK_SIGNING_SECRET", TEST_SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts a valid signature", () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = "payload=%7B%22type%22%3A%22block_actions%22%7D";
    const sig = makeSignature(TEST_SECRET, timestamp, body);

    expect(() =>
      verifySlackSignature(body, makeHeaders(timestamp, sig)),
    ).not.toThrow();
  });

  it("rejects an invalid signature", () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = "payload=test";
    const badSig = "v0=0000000000000000000000000000000000000000000000000000000000000000";

    expect(() =>
      verifySlackSignature(body, makeHeaders(timestamp, badSig)),
    ).toThrow(SlackSignatureError);
  });

  it("rejects a signature computed with a different secret", () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = "payload=test";
    const wrongSig = makeSignature("wrong-secret", timestamp, body);

    expect(() =>
      verifySlackSignature(body, makeHeaders(timestamp, wrongSig)),
    ).toThrow("Invalid Slack signature.");
  });

  it("rejects if body was tampered after signing", () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const originalBody = "payload=original";
    const sig = makeSignature(TEST_SECRET, timestamp, originalBody);

    expect(() =>
      verifySlackSignature("payload=tampered", makeHeaders(timestamp, sig)),
    ).toThrow("Invalid Slack signature.");
  });

  it("rejects a timestamp older than 5 minutes", () => {
    const oldTimestamp = String(Math.floor(Date.now() / 1000) - 301);
    const body = "payload=test";
    const sig = makeSignature(TEST_SECRET, oldTimestamp, body);

    expect(() =>
      verifySlackSignature(body, makeHeaders(oldTimestamp, sig)),
    ).toThrow("Request timestamp is too old.");
  });

  it("accepts a timestamp within the 5-minute window", () => {
    const recentTimestamp = String(Math.floor(Date.now() / 1000) - 299);
    const body = "payload=test";
    const sig = makeSignature(TEST_SECRET, recentTimestamp, body);

    expect(() =>
      verifySlackSignature(body, makeHeaders(recentTimestamp, sig)),
    ).not.toThrow();
  });

  it("rejects a future timestamp beyond 5 minutes", () => {
    const futureTimestamp = String(Math.floor(Date.now() / 1000) + 301);
    const body = "payload=test";
    const sig = makeSignature(TEST_SECRET, futureTimestamp, body);

    expect(() =>
      verifySlackSignature(body, makeHeaders(futureTimestamp, sig)),
    ).toThrow("Request timestamp is too old.");
  });

  it("throws if SLACK_SIGNING_SECRET is not set", () => {
    vi.stubEnv("SLACK_SIGNING_SECRET", "");
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = "payload=test";

    expect(() =>
      verifySlackSignature(body, new Headers({
        "x-slack-request-timestamp": timestamp,
        "x-slack-signature": "v0=abc",
      })),
    ).toThrow("SLACK_SIGNING_SECRET is not configured.");
  });

  it("throws if x-slack-signature header is missing", () => {
    const timestamp = String(Math.floor(Date.now() / 1000));

    expect(() =>
      verifySlackSignature("payload=test", new Headers({
        "x-slack-request-timestamp": timestamp,
      })),
    ).toThrow("Missing Slack signature headers.");
  });

  it("throws if x-slack-request-timestamp header is missing", () => {
    expect(() =>
      verifySlackSignature("payload=test", new Headers({
        "x-slack-signature": "v0=abc",
      })),
    ).toThrow("Missing Slack signature headers.");
  });

  it("throws if both headers are missing", () => {
    expect(() =>
      verifySlackSignature("payload=test", new Headers()),
    ).toThrow("Missing Slack signature headers.");
  });

  it("throws if timestamp is not a number", () => {
    expect(() =>
      verifySlackSignature("payload=test", new Headers({
        "x-slack-request-timestamp": "not-a-number",
        "x-slack-signature": "v0=abc",
      })),
    ).toThrow("Invalid timestamp header.");
  });

  it("handles empty body with valid signature", () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = "";
    const sig = makeSignature(TEST_SECRET, timestamp, body);

    expect(() =>
      verifySlackSignature(body, makeHeaders(timestamp, sig)),
    ).not.toThrow();
  });

  it("handles unicode body correctly", () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = "payload=%E4%BD%A0%E5%A5%BD";
    const sig = makeSignature(TEST_SECRET, timestamp, body);

    expect(() =>
      verifySlackSignature(body, makeHeaders(timestamp, sig)),
    ).not.toThrow();
  });
});
