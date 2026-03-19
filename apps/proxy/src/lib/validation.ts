const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export { UUID_RE };

export function validateUUID(value: string | null): string | null {
  return value && UUID_RE.test(value) ? value : null;
}

/**
 * Strips a NullSpend prefixed ID (e.g. "ns_act_<uuid>") and returns the raw UUID.
 * Falls back to accepting a raw UUID for backward compatibility during rollout.
 * Returns null if the value is null or invalid.
 */
export function stripNsPrefix(prefix: string, value: string | null): string | null {
  if (!value) return null;

  if (value.startsWith(prefix)) {
    const uuid = value.slice(prefix.length);
    return UUID_RE.test(uuid) ? uuid : null;
  }

  return null;
}
