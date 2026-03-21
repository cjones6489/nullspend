const MAX_KEYS = 10;
const MAX_KEY_LENGTH = 64;
const MAX_VALUE_LENGTH = 256;
const KEY_PATTERN = /^[a-zA-Z0-9_-]+$/;
const RESERVED_PREFIX = "_ns_";

/**
 * Parse and validate tags from the X-NullSpend-Tags header.
 * Returns `{}` on any failure — tags are supplementary metadata,
 * never a reason to reject a request.
 */
export function parseTags(header: string | null): Record<string, string> {
  if (!header) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(header);
  } catch {
    console.warn("[tags] Malformed X-NullSpend-Tags header — ignoring");
    return {};
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    console.warn("[tags] X-NullSpend-Tags header is not a JSON object — ignoring");
    return {};
  }

  // Object.create(null) avoids __proto__ setter swallowing keys
  const result = Object.create(null) as Record<string, string>;
  let count = 0;
  let dropped = 0;

  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (count >= MAX_KEYS) {
      dropped++;
      continue;
    }

    if (
      typeof key !== "string" ||
      key.length < 1 ||
      key.length > MAX_KEY_LENGTH ||
      !KEY_PATTERN.test(key) ||
      key.startsWith(RESERVED_PREFIX)
    ) {
      dropped++;
      continue;
    }

    if (typeof value !== "string" || value.length > MAX_VALUE_LENGTH || value.includes("\0")) {
      dropped++;
      continue;
    }

    result[key] = value;
    count++;
  }

  if (dropped > 0) {
    console.warn(`[tags] Dropped ${dropped} invalid tag entries`);
  }

  return result;
}
