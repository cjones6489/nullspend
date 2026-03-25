import { z } from "zod";

import { nsIdInput, nsIdOutput } from "@/lib/ids/prefixed-id";

export const ORG_ROLES = ["owner", "admin", "member"] as const;
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

export const ASSIGNABLE_ROLES = ["admin", "member"] as const;

export const inviteMemberSchema = z.object({
  email: z.string().email("A valid email is required."),
  role: z.enum(ASSIGNABLE_ROLES, { message: "Role must be admin or member. Owner must be transferred explicitly." }),
});

export const changeRoleSchema = z.object({
  role: z.enum(ASSIGNABLE_ROLES, { message: "Role must be admin or member. Owner must be transferred explicitly." }),
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
