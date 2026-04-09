/**
 * Bootstrap the dedicated E2E test organization.
 *
 * Creates (or resets) an org + owner membership + API key used exclusively
 * by the E2E framework. Outputs the provisioned credentials to stdout in
 * key=value format so they can be piped to `gh secret set`.
 *
 * Uses the real drizzle + api-key helpers (`generateRawKey`, `hashKey`,
 * `extractPrefix`) from `lib/auth/api-key.ts` — the same code path the
 * dashboard uses when a real user creates a key. No shortcuts, no mocked
 * hashing, no parallel implementation.
 *
 * # Design principles
 *
 * - **Dedicated, not founder-reused.** The E2E org has its own user_id
 *   and org_id that never touches the founder's Personal or Test orgs.
 *   Per memory/project_founder_dogfood_upgrade.md the founder orgs have
 *   IDs in PROTECTED_ORG_IDS — this script asserts it never touches them.
 *
 * - **Rotatable.** Re-running the script deletes the prior bootstrap org
 *   (matched by the stable slug `e2e-bootstrap-org`) and creates a fresh
 *   one. The new API key's plaintext is the only way to access it — the
 *   previous key's plaintext is unrecoverable.
 *
 * - **Human-readable output.** Prints a summary banner + key=value lines
 *   separated by a `---` marker so downstream shell can `tail -4` or
 *   `grep '^E2E_'` without parsing the banner.
 *
 * - **No tier upgrade.** Slice 1 E2E tests are read-only and don't hit
 *   tier limits. Slice 4 (dashboard E2E with mutations) will need to
 *   extend this script with a subscriptions row insert to avoid hitting
 *   the 3-budget / 10-key / 2-webhook Free tier caps.
 *
 * # Usage
 *
 *   pnpm tsx scripts/bootstrap-e2e-org.ts
 *
 * Requires:
 *   - DATABASE_URL in the environment (loaded from .env.local automatically)
 *
 * # Security
 *
 * The plaintext API key appears exactly ONCE on stdout. Do not log it,
 * paste it, screenshot it, or commit it. Pipe directly to `gh secret set`:
 *
 *   pnpm tsx scripts/bootstrap-e2e-org.ts | tee /dev/null | \
 *     while IFS='=' read -r name value; do
 *       case "$name" in E2E_*) printf '%s' "$value" | gh secret set "$name" ;; esac
 *     done
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// Load .env.local into process.env before importing lib/db (which reads DATABASE_URL)
function loadEnvLocal() {
  const envPath = resolve(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnvLocal();

import { eq, inArray } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import {
  generateRawKey,
  hashKey,
  extractPrefix,
} from "@/lib/auth/api-key";
import {
  apiKeys,
  organizations,
  orgMemberships,
} from "@nullspend/db";

// Stable identifiers that make the bootstrap org easy to find + reset.
// The slug is the anchor — `e2e-bootstrap-org` is never used by a real
// user org, so matching on it is safe.
const BOOTSTRAP_ORG_SLUG = "e2e-bootstrap-org";
const BOOTSTRAP_ORG_NAME = "E2E Bootstrap";
const BOOTSTRAP_USER_ID = "e2e-bootstrap-user";
const BOOTSTRAP_KEY_NAME = "e2e-test-suite";

// Founder orgs that must never be touched by this script. Mirrors the
// PROTECTED_ORG_IDS set in tests/e2e/lib/test-org.ts.
const PROTECTED_ORG_IDS = new Set<string>([
  "052f5cc2-63e6-41db-ace7-ea20364851ab", // founder Personal (Pro dogfood)
  "55c30156-1d15-46f7-bdb4-ca2a15a69d77", // founder Test
]);

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("ERROR: DATABASE_URL is not set. Add it to .env.local.");
    process.exit(1);
  }

  console.error(""); // Use stderr for human banner so stdout is parseable
  console.error("=== E2E Org Bootstrap ===");
  console.error("");

  const db = getDb();

  // Step 1: find any existing bootstrap org so we can reset cleanly.
  const existing = await db
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .where(eq(organizations.slug, BOOTSTRAP_ORG_SLUG))
    .limit(1);

  if (existing.length > 0) {
    const orgId = existing[0].id;
    if (PROTECTED_ORG_IDS.has(orgId)) {
      throw new Error(
        `SAFETY: bootstrap slug resolved to protected org ${orgId}. ` +
          `Refusing to reset. Check PROTECTED_ORG_IDS vs BOOTSTRAP_ORG_SLUG.`,
      );
    }
    console.error(`Found existing bootstrap org ${orgId} — resetting...`);

    // Delete api_keys + memberships first (FK dependency order)
    await db.delete(apiKeys).where(eq(apiKeys.orgId, orgId));
    await db.delete(orgMemberships).where(eq(orgMemberships.orgId, orgId));
    await db.delete(organizations).where(eq(organizations.id, orgId));
    console.error(`Deleted prior bootstrap org ${orgId}`);
  } else {
    console.error("No existing bootstrap org found — creating fresh.");
  }

  // Step 2: create the org.
  const [newOrg] = await db
    .insert(organizations)
    .values({
      name: BOOTSTRAP_ORG_NAME,
      slug: BOOTSTRAP_ORG_SLUG,
      isPersonal: false,
      createdBy: BOOTSTRAP_USER_ID,
      metadata: {
        purpose: "e2e-bootstrap",
        owner: "nullspend e2e framework",
        rotatable: "true",
      },
    })
    .returning({ id: organizations.id });

  if (PROTECTED_ORG_IDS.has(newOrg.id)) {
    // Extraordinarily unlikely (UUIDv4 collision) but defense in depth
    throw new Error(
      `SAFETY: newly created bootstrap org ID ${newOrg.id} collides with ` +
        `a protected founder org. Delete + retry.`,
    );
  }
  console.error(`Created org: ${newOrg.id}`);

  // Step 3: create the owner membership.
  await db.insert(orgMemberships).values({
    orgId: newOrg.id,
    userId: BOOTSTRAP_USER_ID,
    role: "owner",
  });
  console.error(`Created membership: ${BOOTSTRAP_USER_ID} -> ${newOrg.id}`);

  // Step 4: generate + insert the API key using the REAL helpers.
  const rawKey = generateRawKey();
  const keyHash = hashKey(rawKey);
  const keyPrefix = extractPrefix(rawKey);

  const [newKey] = await db
    .insert(apiKeys)
    .values({
      userId: BOOTSTRAP_USER_ID,
      orgId: newOrg.id,
      name: BOOTSTRAP_KEY_NAME,
      keyHash,
      keyPrefix,
      apiVersion: "2026-04-01",
      environment: "live",
      defaultTags: { e2e_tier: "L3", e2e_purpose: "bootstrap" },
    })
    .returning({ id: apiKeys.id });

  console.error(`Created API key: ${newKey.id} (prefix ${keyPrefix})`);
  console.error("");
  console.error("=== Credentials (plaintext, one-time output) ===");
  console.error("The plaintext API key below is the ONLY time it can be");
  console.error("retrieved. Pipe to gh secret set immediately.");
  console.error("");

  // Step 5: emit to stdout in key=value format for `gh secret set`
  // Each line is a single secret name + value, parseable by shell.
  process.stdout.write(`E2E_API_KEY=${rawKey}\n`);
  process.stdout.write(`E2E_DEV_ACTOR=${BOOTSTRAP_USER_ID}\n`);
  process.stdout.write(`E2E_BOOTSTRAP_ORG_ID=${newOrg.id}\n`);
  process.stdout.write(`E2E_BOOTSTRAP_KEY_ID=${newKey.id}\n`);

  // Step 6: close the pool cleanly so tsx exits
  const sql = (globalThis as { __nullspendSql?: { end: () => Promise<void> } })
    .__nullspendSql;
  if (sql) await sql.end();
}

main().catch((err) => {
  console.error("\nBootstrap failed:", err instanceof Error ? err.stack : err);
  const sql = (globalThis as { __nullspendSql?: { end: () => Promise<void> } })
    .__nullspendSql;
  if (sql) {
    sql.end().finally(() => process.exit(1));
  } else {
    process.exit(1);
  }
});
