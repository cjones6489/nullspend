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
// default and customer_mappings.upgrade_url for per-customer overrides.
// Surfaced in budget_exceeded + customer_budget_exceeded denial bodies.
//
// `{customer_id}` placeholder support: substituted at denial time by
// the proxy. The placeholder is a literal substring; we have to
// tolerate it during URL validation. Strategy: temporarily substitute
// the placeholder with a dummy value before parsing as a URL, then
// validate the resulting URL with isSafeExternalUrl.

function isValidUpgradeUrl(raw: string): boolean {
  // Substitute the placeholder with a dummy value so `new URL()` parses cleanly.
  // The dummy is URL-safe and won't change the hostname or scheme.
  const substituted = raw.replace(/\{customer_id\}/g, "placeholder123");
  return isSafeExternalUrl(substituted);
}

const upgradeUrlSchema = z
  .string()
  .trim()
  .max(2048, "Upgrade URL must be 2048 characters or fewer.")
  .refine(isValidUpgradeUrl, {
    message: "Upgrade URL must be HTTPS and not point to private/reserved IP addresses. Use {customer_id} as a placeholder for the customer ID.",
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
