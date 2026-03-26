/**
 * In-memory sliding window rate limiter for invite acceptance.
 * Limits to 10 attempts per minute per IP address.
 * Falls back to no-op if IP can't be determined.
 */

const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 10;

const attempts = new Map<string, number[]>();

// Clean up old entries periodically to prevent memory leak
setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS;
  for (const [ip, timestamps] of attempts) {
    const filtered = timestamps.filter((t) => t > cutoff);
    if (filtered.length === 0) {
      attempts.delete(ip);
    } else {
      attempts.set(ip, filtered);
    }
  }
}, WINDOW_MS);

export function checkInviteRateLimit(ip: string | null): { allowed: boolean; retryAfterSeconds?: number } {
  if (!ip) return { allowed: true };

  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  const existing = (attempts.get(ip) ?? []).filter((t) => t > cutoff);

  if (existing.length >= MAX_ATTEMPTS) {
    const oldestInWindow = existing[0];
    const retryAfterSeconds = Math.ceil((oldestInWindow + WINDOW_MS - now) / 1000);
    return { allowed: false, retryAfterSeconds };
  }

  existing.push(now);
  attempts.set(ip, existing);
  return { allowed: true };
}

/** @internal Reset for testing only */
export function _resetInviteRateLimitForTesting() {
  attempts.clear();
}
