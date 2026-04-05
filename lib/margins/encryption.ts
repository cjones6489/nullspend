import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const key = process.env.STRIPE_ENCRYPTION_KEY;
  if (!key) {
    throw new Error("STRIPE_ENCRYPTION_KEY environment variable is required.");
  }
  const buf = Buffer.from(key, "base64");
  if (buf.length !== 32) {
    throw new Error("STRIPE_ENCRYPTION_KEY must be a 32-byte base64-encoded key.");
  }
  return buf;
}

/**
 * Encrypt a Stripe API key using AES-256-GCM.
 * Binds org_id as AAD (additional authenticated data) to prevent cross-org key theft.
 * Output format: base64(iv + ciphertext + authTag)
 */
export function encryptStripeKey(plaintext: string, orgId: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(orgId, "utf8"));

  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([iv, encrypted, tag]).toString("base64");
}

/**
 * Decrypt a Stripe API key. Validates AAD matches the org_id.
 */
export function decryptStripeKey(ciphertext: string, orgId: string): string {
  const key = getEncryptionKey();
  const data = Buffer.from(ciphertext, "base64");

  if (data.length < IV_LENGTH + TAG_LENGTH + 1) {
    throw new Error("Invalid ciphertext: too short.");
  }

  const iv = data.subarray(0, IV_LENGTH);
  const tag = data.subarray(data.length - TAG_LENGTH);
  const encrypted = data.subarray(IV_LENGTH, data.length - TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAAD(Buffer.from(orgId, "utf8"));
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
