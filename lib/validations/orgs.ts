import { z } from "zod";

import { nsIdInput, nsIdOutput } from "@/lib/ids/prefixed-id";
import { isSafeExternalUrl } from "@/lib/validations/url-safety";

export const ORG_ROLES = ["owner", "admin", "member", "viewer"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

const slugSchema = z
  .string()
  .trim()
  .min(3, "Slug must be at least 3 characters.")
  .max(50, "Slug must be 50 characters or fewer.")
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Slug must be lowercase alphanumeric with hyphens (e.g., my-team).",
  );

export const createOrgSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required.")
    .max(50, "Name must be 50 characters or fewer."),
  slug: slugSchema,
});

export const updateOrgSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required.")
    .max(50, "Name must be 50 characters or fewer.")
    .optional(),
  slug: slugSchema.optional(),
});

export const ASSIGNABLE_ROLES = ["admin", "member", "viewer"] as const;

/** Roles that count toward the maxTeamMembers limit. Viewers are free seats. */
export const SEAT_COUNTED_ROLES: readonly OrgRole[] = ["owner", "admin", "member"];

export const inviteMemberSchema = z.object({
  email: z.string().email("A valid email is required."),
  role: z.enum(ASSIGNABLE_ROLES, { message: "Role must be admin, member, or viewer. Owner must be transferred explicitly." }),
});

export const changeRoleSchema = z.object({
  role: z.enum(ASSIGNABLE_ROLES, { message: "Role must be admin, member, or viewer. Owner must be transferred explicitly." }),
});

export const orgIdParamsSchema = z.object({
  orgId: nsIdInput("org"),
});

export const orgRecordSchema = z.object({
  id: nsIdOutput("org"),
  name: z.string(),
  slug: z.string(),
  isPersonal: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const memberRecordSchema = z.object({
  userId: z.string(),
  role: z.enum(ORG_ROLES),
  createdAt: z.string(),
});

const INVITATION_STATUSES = ["pending", "accepted", "declined", "revoked", "expired"] as const;

export const invitationRecordSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  role: z.enum(ASSIGNABLE_ROLES),
  status: z.enum(INVITATION_STATUSES),
  invitedBy: z.string(),
  tokenPrefix: z.string(),
  expiresAt: z.string(),
  createdAt: z.string(),
});

export const acceptInviteSchema = z.object({
  token: z.string().min(1, "Invitation token is required."),
});

// ── Upgrade URL ────────────────────────────────────────────────────
//
// Stored at organizations.metadata.upgradeUrl (jsonb) for org-level
// default and customer_settings.upgrade_url for per-customer overrides.
// Surfaced in budget_exceeded + customer_budget_exceeded denial bodies.
//
// `{customer_id}` placeholder support: substituted at denial time by
// the proxy. The placeholder is a literal substring; we have to
// tolerate it during URL validation. Strategy: temporarily substitute
// the placeholder with a PESSIMISTIC max-length dummy before parsing
// so we catch "looks valid at write time but explodes at runtime with
// a long customer_id" at write time. (T5 edge-case audit.)

// Maximum customer_id length enforced by both the SDK
// (packages/sdk/src/customer-id.ts MAX_CUSTOMER_ID_LENGTH) and the
// proxy (apps/proxy/src/lib/customer.ts). Kept in sync by convention.
const MAX_CUSTOMER_ID_LENGTH = 256;
const UPGRADE_URL_MAX_LENGTH = 2048;

function isValidUpgradeUrl(raw: string): boolean {
  // Pessimistic substitution: replace every {customer_id} with a MAX_CUSTOMER_ID_LENGTH-
  // long dummy to catch URLs that overflow 2048 chars at runtime when a
  // long customer_id expands multiple placeholders. Belt-and-braces vs
  // the length check above, which only sees the raw template.
  const dummy = "x".repeat(MAX_CUSTOMER_ID_LENGTH);
  const substituted = raw.replace(/\{customer_id\}/g, dummy);
  if (substituted.length > UPGRADE_URL_MAX_LENGTH) return false;
  return isSafeExternalUrl(substituted);
}

const upgradeUrlSchema = z
  .string()
  .trim()
  .max(UPGRADE_URL_MAX_LENGTH, "Upgrade URL must be 2048 characters or fewer.")
  .refine(isValidUpgradeUrl, {
    message: "Upgrade URL must be HTTPS, not point to private/reserved IPs, and must stay under 2048 characters AFTER {customer_id} substitution. Use {customer_id} as a placeholder for the customer ID.",
  });

/**
 * Schema for PATCH /api/orgs/[orgId]/upgrade-url and
 * PATCH /api/orgs/[orgId]/customers/[customerId]/upgrade-url.
 *
 * Pass `upgradeUrl: null` to clear the field. Pass a string to set it.
 */
export const setUpgradeUrlSchema = z.object({
  upgradeUrl: upgradeUrlSchema.nullable(),
});

export type SetUpgradeUrlInput = z.infer<typeof setUpgradeUrlSchema>;
