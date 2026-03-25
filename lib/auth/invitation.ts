import { createHash, randomBytes } from "node:crypto";

const INVITE_TOKEN_PREFIX = "ns_inv_";

export function generateInviteToken(): string {
  return INVITE_TOKEN_PREFIX + randomBytes(24).toString("hex");
}

export function hashInviteToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export function extractTokenPrefix(rawToken: string): string {
  return rawToken.slice(0, 15);
}
