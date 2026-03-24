import { z } from "zod";

const PREFIX_MAP = {
  act: "ns_act_",
  key: "ns_key_",
  evt: "ns_evt_",
  bgt: "ns_bgt_",
  wh: "ns_wh_",
  del: "ns_del_",
  usr: "ns_usr_",
  tc: "ns_tc_",
  org: "ns_org_",
} as const;

type IdType = keyof typeof PREFIX_MAP;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function toExternalId(type: IdType, uuid: string): string {
  return `${PREFIX_MAP[type]}${uuid}`;
}

export function fromExternalIdOfType(type: IdType, prefixed: string): string {
  const prefix = PREFIX_MAP[type];
  if (!prefixed.startsWith(prefix)) {
    throw new Error(
      `Expected ID with prefix "${prefix}" but got "${prefixed.length > 60 ? prefixed.slice(0, 60) + "…" : prefixed}"`,
    );
  }
  const uuid = prefixed.slice(prefix.length);
  if (!UUID_RE.test(uuid)) {
    throw new Error(`Invalid UUID after stripping prefix: "${uuid}"`);
  }
  return uuid;
}

/**
 * Zod helper for outbound (response) IDs: UUID → prefixed string.
 */
export function nsIdOutput(type: IdType) {
  return z
    .string()
    .uuid()
    .transform((uuid) => toExternalId(type, uuid));
}

/**
 * Zod helper for inbound (request) IDs: prefixed string → UUID.
 * Uses ctx.addIssue() for proper Zod validation errors instead of throwing
 * plain Errors (which Zod v4 propagates as-is, causing 500s instead of 400s).
 */
export function nsIdInput(type: IdType) {
  const prefix = PREFIX_MAP[type];
  return z
    .string()
    .transform((s, ctx) => {
      if (!s.startsWith(prefix)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Expected ID with prefix "${prefix}"`,
        });
        return z.NEVER;
      }
      return s.slice(prefix.length);
    })
    .pipe(z.string().uuid());
}

/**
 * Nullable variant of nsIdOutput for optional foreign keys.
 */
export function nsIdOutputNullable(type: IdType) {
  return z
    .string()
    .uuid()
    .nullable()
    .transform((uuid) => (uuid ? toExternalId(type, uuid) : null));
}

export { PREFIX_MAP, UUID_RE };
export type { IdType };
