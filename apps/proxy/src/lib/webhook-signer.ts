const SIGNATURE_VERSION = "v1";

/**
 * Sign a webhook payload using HMAC-SHA256.
 * Returns a Stripe-format signature: `t={timestamp},v1={hex}`
 */
export async function signWebhookPayload(
  payload: string,
  secret: string,
  timestamp: number,
): Promise<string> {
  const signedContent = `${timestamp}.${payload}`;
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(signedContent),
  );

  const hex = [...new Uint8Array(signature)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return `t=${timestamp},${SIGNATURE_VERSION}=${hex}`;
}

/**
 * Parse a signature header into its components.
 * Expected format: `t={timestamp},v1={hex}`
 */
export function parseSignature(
  header: string,
): { timestamp: number; signatures: string[] } | null {
  const parts = header.split(",");
  let timestamp: number | null = null;
  const signatures: string[] = [];

  for (const part of parts) {
    const [key, value] = part.split("=", 2);
    if (key === "t") {
      timestamp = parseInt(value, 10);
      if (isNaN(timestamp)) return null;
    } else if (key === SIGNATURE_VERSION) {
      signatures.push(value);
    }
  }

  if (timestamp === null || signatures.length === 0) return null;
  return { timestamp, signatures };
}

/**
 * Verify a webhook signature against the payload.
 * Rejects events older than `toleranceSeconds` (default 300 = 5 minutes).
 */
export async function verifyWebhookSignature(
  payload: string,
  signatureHeader: string,
  secret: string,
  toleranceSeconds = 300,
): Promise<boolean> {
  const parsed = parseSignature(signatureHeader);
  if (!parsed) return false;

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parsed.timestamp) > toleranceSeconds) {
    return false;
  }

  const expected = await signWebhookPayload(payload, secret, parsed.timestamp);
  const expectedParsed = parseSignature(expected);
  if (!expectedParsed) return false;

  return parsed.signatures.some((sig) =>
    timingSafeStringEqual(sig, expectedParsed.signatures[0]),
  );
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);
  const lengthsMatch = bufA.byteLength === bufB.byteLength;
  return lengthsMatch
    ? crypto.subtle.timingSafeEqual(bufA, bufB)
    : !crypto.subtle.timingSafeEqual(bufA, bufA);
}
