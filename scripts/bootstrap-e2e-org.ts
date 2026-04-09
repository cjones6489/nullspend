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
 *   `PROTECTED_ORG_IDS` is imported from the single source of truth at
 *   `tests/e2e/lib/protected-orgs.ts`.
 *
 * - **Transactional.** The entire delete-then-insert sequence runs inside
 *   a single `db.transaction()` so partial failures roll back. Without
 *   this, a network blip between the delete and insert steps could leave
 *   orphaned state that breaks subsequent runs.
 *
 * - **Idempotent.** Re-running deletes the prior bootstrap org (matched
 *   by the stable slug `e2e-bootstrap-org`) and creates a fresh one.
 *   Orphan-table cleanup catches non-FK-linked rows (cost_events,
 *   actions, budgets, audit_events, sessions, slack_configs,
 *   subscriptions, tool_costs, webhook_endpoints) that the schema's
 *   CASCADE rules don't touch automatically.
 *
 * - **Verified.** After creating the key, the script issues a real HTTP
 *   request through the proxy to confirm the key authenticates. If the
 *   proxy rejects the key (hash format drift, schema mismatch), the
 *   script fails loudly BEFORE printing credentials.
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
 *   pnpm e2e:bootstrap
 *   # or
 *   pnpm tsx scripts/bootstrap-e2e-org.ts
 *
 * Requires:
 *   - DATABASE_URL in the environment (loaded from .env.local automatically)
 *   - NULLSPEND_PROXY_URL in the environment (optional; defaults to
 *     https://proxy.nullspend.dev for the verification step). Set to "skip"
 *     to disable the verification step entirely (useful for offline runs).
 *
 * # Security
 *
 * The plaintext API key appears exactly ONCE on stdout. Do not log it,
 * paste it, screenshot it, or commit it. Pipe directly to `gh secret set`:
 *
 *   pnpm e2e:bootstrap 2>/dev/null | while IFS='=' read -r name value; do
 *     case "$name" in E2E_*) printf '%s' "$value" | gh secret set "$name" ;; esac
 *   done
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

import { eq, sql as dsql } from "drizzle-orm";

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
import { assertNotProtected } from "@/tests/e2e/lib/protected-orgs";

// Stable identifiers that make the bootstrap org easy to find + reset.
// The slug is the anchor — `e2e-bootstrap-org` is never used by a real
// user org, so matching on it is safe.
const BOOTSTRAP_ORG_SLUG = "e2e-bootstrap-org";
const BOOTSTRAP_ORG_NAME = "E2E Bootstrap";
const BOOTSTRAP_USER_ID = "e2e-bootstrap-user";
const BOOTSTRAP_KEY_NAME = "e2e-test-suite";

// Tables that have an `org_id` column but NO foreign-key constraint to
// organizations. The schema's CASCADE rules only clean up tables with
// explicit FKs (customer_mappings, customer_revenue, customer_settings,
// org_invitations, org_memberships, stripe_connections). These 9 tables
// would leave orphan rows pointing at a deleted org_id if we didn't
// explicitly clean them up on bootstrap rotation.
//
// Verified against information_schema.columns on 2026-04-09. If new
// org_id-scoped tables are added to the schema, add them here too.
const ORPHAN_CLEANUP_TABLES = [
  "actions",
  "api_keys",
  "audit_events",
  "budgets",
  "cost_events",
  "sessions",
  "slack_configs",
  "subscriptions",
  "tool_costs",
  "webhook_endpoints",
] as const;

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("ERROR: DATABASE_URL is not set. Add it to .env.local.");
    process.exit(1);
  }

  console.error(""); // Use stderr for human banner so stdout is parseable
  console.error("=== E2E Org Bootstrap ===");
  console.error("");

  const db = getDb();

  // Step 1: find any existing bootstrap org so we can assert it's safe
  // to reset OUTSIDE the transaction (a single SELECT doesn't need to
  // be in the tx).
  const existing = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.slug, BOOTSTRAP_ORG_SLUG))
    .limit(1);

  const existingOrgId = existing[0]?.id ?? null;
  if (existingOrgId) {
    assertNotProtected(existingOrgId, "bootstrap script reset of existing org");
    console.error(`Found existing bootstrap org ${existingOrgId} — will reset.`);
  } else {
    console.error("No existing bootstrap org found — will create fresh.");
  }

  // Step 2: run the full delete-then-insert sequence inside a single
  // transaction. Any failure rolls back ALL changes — no orphaned org,
  // no orphaned membership, no orphaned api_key.
  const rawKey = generateRawKey();
  const keyHash = hashKey(rawKey);
  const keyPrefix = extractPrefix(rawKey);

  const txResult = await db.transaction(async (tx) => {
    // 2a. Clean up prior bootstrap org + all orphan rows.
    if (existingOrgId) {
      // Clean up orphan rows in tables without FK CASCADE.
      // Uses raw sql() because we iterate over table names — drizzle
      // query builder doesn't have a clean dynamic-table API here, and
      // sql.identifier() would add its own quoting. The table names are
      // compile-time constants from ORPHAN_CLEANUP_TABLES, so there's no
      // injection surface.
      for (const table of ORPHAN_CLEANUP_TABLES) {
        await tx.execute(
          dsql.raw(`DELETE FROM "${table}" WHERE org_id = '${existingOrgId}'`),
        );
      }

      // Deleting the organization triggers CASCADE on FK-linked tables
      // (customer_mappings, customer_revenue, customer_settings,
      // org_invitations, org_memberships, stripe_connections).
      await tx
        .delete(organizations)
        .where(eq(organizations.id, existingOrgId));

      console.error(
        `Deleted prior bootstrap org ${existingOrgId} + orphan cleanup across ${ORPHAN_CLEANUP_TABLES.length} tables`,
      );
    }

    // 2b. Create the new org.
    const [newOrg] = await tx
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

    // Defense-in-depth: refuse to continue if UUIDv4 collides with a
    // protected org (extraordinarily unlikely but free to check).
    assertNotProtected(newOrg.id, "bootstrap script new org creation");

    // 2c. Create the owner membership.
    await tx.insert(orgMemberships).values({
      orgId: newOrg.id,
      userId: BOOTSTRAP_USER_ID,
      role: "owner",
    });

    // 2d. Insert the API key using the REAL helpers.
    const [newKey] = await tx
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

    return { orgId: newOrg.id, keyId: newKey.id };
  });

  console.error(`Created org: ${txResult.orgId}`);
  console.error(`Created membership: ${BOOTSTRAP_USER_ID} -> ${txResult.orgId}`);
  console.error(`Created API key: ${txResult.keyId} (prefix ${keyPrefix})`);

  // Step 3: verify the new key actually authenticates against the proxy.
  // This catches hash format drift, schema mismatches, or other silent
  // breakage before we hand out (possibly dead) credentials.
  const proxyUrl = process.env.NULLSPEND_PROXY_URL ?? "https://proxy.nullspend.dev";
  if (proxyUrl === "skip") {
    console.error("Skipping proxy key verification (NULLSPEND_PROXY_URL=skip)");
  } else {
    console.error(`Verifying new key against ${proxyUrl}...`);
    try {
      // Issue a request with an OBVIOUSLY invalid OpenAI key so the
      // proxy authenticates our key, then fails upstream. We only care
      // that the NullSpend auth path accepts the key — the OpenAI
      // response doesn't matter.
      const res = await fetch(`${proxyUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-NullSpend-Key": rawKey,
          Authorization: "Bearer sk-invalid-proxy-verify-stub",
          "X-NullSpend-Tags": "e2e_tier=bootstrap,e2e_purpose=key-verify",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: "x" }],
          max_completion_tokens: 1,
        }),
        signal: AbortSignal.timeout(15_000),
      });

      // Expected outcomes:
      //   200 — unlikely (OpenAI somehow accepted the stub key)
      //   401/403 — FROM OPENAI (upstream), means our proxy key worked
      //              and passed the request to OpenAI
      //   401/403 — FROM PROXY (nullspend), means our key was REJECTED
      //              by the proxy — this is the failure we want to catch
      //   502/504 — proxy worker is down, can't verify
      //
      // We differentiate by reading the response body. NullSpend's auth
      // errors have shape `{ error: { code: "invalid_api_key", ... } }`.
      // Any other 401/403 shape means the proxy accepted our key and
      // forwarded to upstream.
      if (res.status === 401 || res.status === 403) {
        const body = await res.json().catch(() => null) as {
          error?: { code?: string; message?: string };
        } | null;
        const code = body?.error?.code;
        // NullSpend proxy auth error codes we need to catch:
        if (code === "invalid_api_key" || code === "missing_api_key") {
          throw new Error(
            `Proxy rejected the newly created key (status ${res.status}, ` +
              `code ${code}). Hash format may have drifted — check ` +
              `lib/auth/api-key.ts hashKey() implementation vs. the proxy's ` +
              `key lookup.`,
          );
        }
        // Upstream (OpenAI) 401/403 is the expected success path.
      } else if (res.status >= 500) {
        console.error(
          `  WARNING: proxy verification got ${res.status} — proxy may be ` +
            `down. Bootstrap succeeded but key validity is unverified.`,
        );
      }
      console.error(`  OK (proxy responded ${res.status})`);
    } catch (err) {
      // Re-throw our own Error (for key rejection), but tolerate network
      // errors (proxy down) with a warning rather than a failure.
      if (err instanceof Error && err.message.startsWith("Proxy rejected")) {
        throw err;
      }
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `  WARNING: could not verify key (${msg}). Bootstrap succeeded ` +
          `but key validity is unverified.`,
      );
    }
  }

  console.error("");
  console.error("=== Credentials (plaintext, one-time output) ===");
  console.error("The plaintext API key below is the ONLY time it can be");
  console.error("retrieved. Pipe to gh secret set immediately.");
  console.error("");

  // Step 4: emit to stdout in key=value format for `gh secret set`
  process.stdout.write(`E2E_API_KEY=${rawKey}\n`);
  process.stdout.write(`E2E_DEV_ACTOR=${BOOTSTRAP_USER_ID}\n`);
  process.stdout.write(`E2E_BOOTSTRAP_ORG_ID=${txResult.orgId}\n`);
  process.stdout.write(`E2E_BOOTSTRAP_KEY_ID=${txResult.keyId}\n`);

  // Step 5: close the pool cleanly so tsx exits
  const pool = (globalThis as { __nullspendSql?: { end: () => Promise<void> } })
    .__nullspendSql;
  if (pool) await pool.end();
}

main().catch(async (err) => {
  console.error("\nBootstrap failed:", err instanceof Error ? err.stack : err);
  const pool = (globalThis as { __nullspendSql?: { end: () => Promise<void> } })
    .__nullspendSql;
  if (pool) {
    await pool.end().catch(() => undefined);
  }
  process.exit(1);
});
