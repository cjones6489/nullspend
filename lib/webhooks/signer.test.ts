import { describe, it, expect } from "vitest";
import { signPayload, dualSignPayload, SECRET_ROTATION_WINDOW_SECONDS } from "./signer";

describe("signPayload", () => {
  it("produces a signature in Stripe format", () => {
    const sig = signPayload('{"test":true}', "whsec_secret123", 1710612181);
    expect(sig).toMatch(/^t=1710612181,v1=[0-9a-f]{64}$/);
  });

  it("produces deterministic output for same inputs", () => {
    const sig1 = signPayload("hello", "secret", 1000);
    const sig2 = signPayload("hello", "secret", 1000);
    expect(sig1).toBe(sig2);
  });

  it("produces different output for different payloads", () => {
    const sig1 = signPayload("hello", "secret", 1000);
    const sig2 = signPayload("world", "secret", 1000);
    expect(sig1).not.toBe(sig2);
  });

  it("produces different output for different secrets", () => {
    const sig1 = signPayload("hello", "secret1", 1000);
    const sig2 = signPayload("hello", "secret2", 1000);
    expect(sig1).not.toBe(sig2);
  });
});

describe("dualSignPayload", () => {
  it("produces single v1 when previousSecret is null", () => {
    const sig = dualSignPayload("hello", "secret", null, 1000);
    expect(sig).toMatch(/^t=1000,v1=[0-9a-f]{64}$/);
  });

  it("produces same output as signPayload when previousSecret is null", () => {
    const single = signPayload("hello", "secret", 1000);
    const dual = dualSignPayload("hello", "secret", null, 1000);
    expect(dual).toBe(single);
  });

  it("produces two v1 values when previousSecret is provided", () => {
    const sig = dualSignPayload("hello", "current", "previous", 1000);
    expect(sig).toMatch(/^t=1000,v1=[0-9a-f]{64},v1=[0-9a-f]{64}$/);
  });

  it("first v1 is current secret, second is previous", () => {
    const currentOnly = signPayload("hello", "current", 1000);
    const previousOnly = signPayload("hello", "previous", 1000);
    const dual = dualSignPayload("hello", "current", "previous", 1000);

    // Extract v1 values
    const parts = dual.split(",");
    const v1Current = parts[1]; // v1=<currentHex>
    const v1Previous = parts[2]; // v1=<previousHex>

    // Match against single-signed outputs
    expect(currentOnly).toContain(v1Current);
    expect(previousOnly).toContain(v1Previous);
  });
});

describe("SECRET_ROTATION_WINDOW_SECONDS", () => {
  it("is 24 hours", () => {
    expect(SECRET_ROTATION_WINDOW_SECONDS).toBe(86_400);
  });
});

describe("cross-signer equivalence (dashboard vs proxy)", () => {
  // The proxy signer uses Web Crypto API (async), the dashboard signer uses Node.js crypto (sync).
  // Both must produce identical output for the same inputs.
  // Node.js 20+ supports Web Crypto API via globalThis.crypto, so we can call both here.
  async function proxyComputeHmacHex(payload: string, secret: string, timestamp: number): Promise<string> {
    const signedContent = `${timestamp}.${payload}`;
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(signedContent));
    return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  it("signPayload (Node crypto) matches proxy signWebhookPayload (Web Crypto) for same inputs", async () => {
    const payload = '{"event":"cross_test","data":123}';
    const secret = "whsec_crosscheck_secret_abc123";
    const timestamp = 1710612181;

    const dashboardSig = signPayload(payload, secret, timestamp);
    const proxyHex = await proxyComputeHmacHex(payload, secret, timestamp);
    const proxySig = `t=${timestamp},v1=${proxyHex}`;

    expect(dashboardSig).toBe(proxySig);
  });

  it("dualSignPayload (Node crypto) matches proxy dualSignWebhookPayload (Web Crypto) for same inputs", async () => {
    const payload = '{"rotation":"test"}';
    const currentSecret = "whsec_current_xyz";
    const previousSecret = "whsec_previous_abc";
    const timestamp = 1710612181;

    const dashboardDual = dualSignPayload(payload, currentSecret, previousSecret, timestamp);

    const currentHex = await proxyComputeHmacHex(payload, currentSecret, timestamp);
    const previousHex = await proxyComputeHmacHex(payload, previousSecret, timestamp);
    const proxyDual = `t=${timestamp},v1=${currentHex},v1=${previousHex}`;

    expect(dashboardDual).toBe(proxyDual);
  });

  it("null previousSecret produces identical output across signers", async () => {
    const payload = "simple_payload";
    const secret = "whsec_solo";
    const timestamp = 999999;

    const dashboardSig = dualSignPayload(payload, secret, null, timestamp);
    const hex = await proxyComputeHmacHex(payload, secret, timestamp);
    const proxySig = `t=${timestamp},v1=${hex}`;

    expect(dashboardSig).toBe(proxySig);
  });
});
