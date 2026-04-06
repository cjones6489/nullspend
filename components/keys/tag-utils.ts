const MAX_TAGS = 10;
const MAX_KEY_LENGTH = 64;
const MAX_VALUE_LENGTH = 256;
const TAG_KEY_REGEX = /^[a-zA-Z0-9_-]+$/;

/**
 * Validate a tag key. Returns an error message or null if valid.
 * Mirrors server-side tagKeySchema from lib/validations/api-keys.ts.
 */
export function validateTagKey(key: string): string | null {
  const trimmed = key.trim();
  if (!trimmed) return "Key is required";
  if (trimmed.startsWith("_ns_")) return "Tags starting with _ns_ are reserved";
  if (!TAG_KEY_REGEX.test(trimmed)) return "Keys must be alphanumeric, underscore, or hyphen";
  if (trimmed.length > MAX_KEY_LENGTH) return `Keys must be ${MAX_KEY_LENGTH} characters or fewer`;
  return null;
}

/**
 * Validate a tag value. Returns an error message or null if valid.
 * Mirrors server-side tagValueSchema from lib/validations/api-keys.ts.
 */
export function validateTagValue(value: string): string | null {
  if (value.length > MAX_VALUE_LENGTH) return `Values must be ${MAX_VALUE_LENGTH} characters or fewer`;
  if (value.includes("\0")) return "Values must not contain null bytes";
  return null;
}

/**
 * Validate whether a tag can be added to the existing set.
 * Returns an error message or null if allowed.
 */
export function validateTagAdd(
  key: string,
  existing: Record<string, string>,
  value?: string,
): string | null {
  const keyError = validateTagKey(key);
  if (keyError) return keyError;

  if (value !== undefined) {
    const valueError = validateTagValue(value);
    if (valueError) return valueError;
  }

  const trimmed = key.trim();
  if (Object.keys(existing).length >= MAX_TAGS && !(trimmed in existing)) {
    return "Maximum 10 tags";
  }

  return null;
}
