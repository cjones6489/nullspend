import { describe, it, expect, beforeAll } from "vitest";
import {
  signWebhookPayload,
  parseSignature,
  verifyWebhookSignature,
} from "../lib/webhook-signer.js";

beforeAll(() => {
  if (!crypto.subtle.timingSafeEqual) {
    (crypto.subtle as any).timingSafeEqual = (a: ArrayBuffer, b: ArrayBuffer) => {
      const viewA = new Uint8Array(a);
      const viewB = new Uint8Array(b);
      if (viewA.byteLength !== viewB.byteLength) return false;
      let result = 0;
      for (let i = 0; i < viewA.byteLength; i++) {
        result |= viewA[i] ^ viewB[i];
      }
      return result === 0;
    };
  }
});

describe("signWebhookPayload", () => {
  it("produces a signature in Stripe format", async () => {
    const sig = await signWebhookPayload('{"test":true}', "whsec_secret123", 1710612181);
    expect(sig).toMatch(/^t=1710612181,v1=[0-9a-f]{64}$/);
  });

  it("produces deterministic output for same inputs", async () => {
    const sig1 = await signWebhookPayload("hello", "secret", 1000);
    const sig2 = await signWebhookPayload("hello", "secret", 1000);
    expect(sig1).toBe(sig2);
  });

  it("produces different output for different payloads", async () => {
    const sig1 = await signWebhookPayload("hello", "secret", 1000);
    const sig2 = await signWebhookPayload("world", "secret", 1000);
    expect(sig1).not.toBe(sig2);
  });

  it("produces different output for different secrets", async () => {
    const sig1 = await signWebhookPayload("hello", "secret1", 1000);
    const sig2 = await signWebhookPayload("hello", "secret2", 1000);
    expect(sig1).not.toBe(sig2);
  });

  it("produces different output for different timestamps", async () => {
    const sig1 = await signWebhookPayload("hello", "secret", 1000);
    const sig2 = await signWebhookPayload("hello", "secret", 2000);
    expect(sig1).not.toBe(sig2);
  });
});

describe("parseSignature", () => {
  it("parses valid signature header", () => {
    const result = parseSignature("t=1710612181,v1=abcdef0123456789");
    expect(result).toEqual({
      timestamp: 1710612181,
      signatures: ["abcdef0123456789"],
    });
  });

  it("returns null for missing timestamp", () => {
    expect(parseSignature("v1=abc123")).toBeNull();
  });

  it("returns null for missing signature", () => {
    expect(parseSignature("t=1000")).toBeNull();
  });

  it("returns null for invalid timestamp", () => {
    expect(parseSignature("t=notanumber,v1=abc123")).toBeNull();
  });
});

describe("verifyWebhookSignature", () => {
  it("verifies a valid signature", async () => {
    const secret = "whsec_testsecret";
    const payload = '{"event":"test"}';
    const timestamp = Math.floor(Date.now() / 1000);
    const sig = await signWebhookPayload(payload, secret, timestamp);

    const valid = await verifyWebhookSignature(payload, sig, secret);
    expect(valid).toBe(true);
  });

  it("rejects tampered payload", async () => {
    const secret = "whsec_testsecret";
    const timestamp = Math.floor(Date.now() / 1000);
    const sig = await signWebhookPayload('{"event":"original"}', secret, timestamp);

    const valid = await verifyWebhookSignature('{"event":"tampered"}', sig, secret);
    expect(valid).toBe(false);
  });

  it("rejects expired timestamp", async () => {
    const secret = "whsec_testsecret";
    const payload = '{"event":"test"}';
    const oldTimestamp = Math.floor(Date.now() / 1000) - 600; // 10 minutes ago
    const sig = await signWebhookPayload(payload, secret, oldTimestamp);

    const valid = await verifyWebhookSignature(payload, sig, secret, 300);
    expect(valid).toBe(false);
  });

  it("accepts timestamp within tolerance", async () => {
    const secret = "whsec_testsecret";
    const payload = '{"event":"test"}';
    const recentTimestamp = Math.floor(Date.now() / 1000) - 60; // 1 minute ago
    const sig = await signWebhookPayload(payload, secret, recentTimestamp);

    const valid = await verifyWebhookSignature(payload, sig, secret, 300);
    expect(valid).toBe(true);
  });
});
