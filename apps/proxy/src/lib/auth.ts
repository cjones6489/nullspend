/**
 * Platform key authentication using timing-safe comparison.
 * Length-safe pattern from Cloudflare docs to avoid leaking secret length.
 */
export async function validatePlatformKey(
  provided: string | null,
  secret: string | undefined,
): Promise<boolean> {
  if (!provided || !secret) return false;

  const encoder = new TextEncoder();
  const a = encoder.encode(provided);
  const b = encoder.encode(secret);
  const lengthsMatch = a.byteLength === b.byteLength;

  return lengthsMatch
    ? crypto.subtle.timingSafeEqual(a, b)
    : !crypto.subtle.timingSafeEqual(a, a);
}

export function unauthorizedResponse(): Response {
  return Response.json(
    { error: "unauthorized", message: "Invalid or missing X-NullSpend-Auth header" },
    { status: 401 },
  );
}
