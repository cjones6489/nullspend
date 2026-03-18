const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export { UUID_RE };

export function validateUUID(value: string | null): string | null {
  return value && UUID_RE.test(value) ? value : null;
}
