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
 * Environment variables (read from .env.local automatically):
 *   - DATABASE_URL              — required. Supabase pooler connection.
 *   - NULLSPEND_PROXY_URL       — optional. Defaults to
 *                                 https://proxy.nullspend.dev. Used
 *                                 only for the key verification step.
 *   - NULLSPEND_SKIP_KEY_VERIFY — optional. Set to "1" to bypass the
 *                                 key verification step entirely
 *                                 (useful for offline runs when the
 *                                 proxy is unreachable).
 *
 * # Exit codes
 *
 *   0 — success: transaction committed AND key verification passed
 *       (or was intentionally skipped via NULLSPEND_SKIP_KEY_VERIFY=1)
 *   1 — hard failure: transaction rolled back, OR proxy explicitly
 *       rejected the new key (hash format drift)
 *   2 — partial success: transaction committed, but key verification
 *       was INCONCLUSIVE (proxy returned non-JSON, 5xx, or network
 *       error). The key is almost certainly valid but unverified.
 *       Strict shell pipelines can treat this differently from 1.
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

import { eq, sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import {
  generateRawKey,
  hashKey,
  extractPrefix,
} from "@/lib/auth/api-key";
import {
  actions,
  apiKeys,
  auditEvents,
  budgets,
  costEvents,
  organizations,
  orgMemberships,
  sessions,
  slackConfigs,
  subscriptions,
  toolCosts,
  webhookEndpoints,
} from "@nullspend/db";
import { assertNotProtected } from "@/tests/e2e/lib/protected-orgs";

// Stable identifiers that make the bootstrap org easy to find + reset.
// The slug is the anchor — `e2e-bootstrap-org` is never used by a real
// user org, so matching on it is safe.
const BOOTSTRAP_ORG_SLUG = "e2e-bootstrap-org";
const BOOTSTRAP_ORG_NAME = "E2E Bootstrap";
const BOOTSTRAP_USER_ID = "e2e-bootstrap-user";
const BOOTSTRAP_KEY_NAME = "e2e-test-suite";

/**
 * Tables with an `orgId` column but no foreign-key constraint to
 * organizations. The schema's CASCADE rules only handle FK-linked tables
 * (customer_mappings, customer_revenue, customer_settings,
 * org_invitations, org_memberships, stripe_connections). The 10 tables
 * cleaned up by `cleanupOrphanRows()` below would otherwise leave orphan
 * rows pointing at a deleted org_id.
 *
 * Verified against information_schema.columns on 2026-04-09. If a new
 * orgId-scoped table is added to the schema, add a delete call inside
 * `cleanupOrphanRows()` too — the explicit-per-table shape is
 * intentional because drizzle's typed query builder requires each
 * `eq(table.orgId, ...)` to be type-checked against the specific table,
 * which generic iteration over a union can't do without `any` casts.
 */

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("ERROR: DATABASE_URL is not set. Add it to .env.local.");
    process.exit(1);
  }

  console.error(""); // Use stderr for human banner so stdout is parseable
  console.error("=== E2E Org Bootstrap ===");
  console.error("");

  const db = getDb();

  // Step 1: early status message for the operator. The authoritative
  // read happens INSIDE the transaction after acquiring the advisory
  // lock (see Step 2) to avoid races with concurrent bootstrap runs.
  const earlyPeek = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.slug, BOOTSTRAP_ORG_SLUG))
    .limit(1);
  if (earlyPeek[0]?.id) {
    assertNotProtected(
      earlyPeek[0].id,
      "bootstrap script early peek",
    );
    console.error(`Found existing bootstrap org ${earlyPeek[0].id} — will reset.`);
  } else {
    console.error("No existing bootstrap org found — will create fresh.");
  }

  // Step 2: run the full delete-then-insert sequence inside a single
  // transaction. Any failure rolls back ALL changes — no orphaned org,
  // no orphaned membership, no orphaned api_key.
  const rawKey = generateRawKey();
  const keyHash = hashKey(rawKey);
  const keyPrefix = extractPrefix(rawKey);

  // EC-9: serialize concurrent bootstrap runs via a Postgres advisory
  // lock. Without this, two developers running `pnpm e2e:bootstrap`
  // within seconds of each other would both SELECT the existing org,
  // both DELETE it (race-benign), and both try to INSERT a new org
  // with slug `e2e-bootstrap-org` — the second one failing with a
  // UNIQUE constraint violation that looks like a bug but is actually
  // a race.
  //
  // Advisory locks are transaction-scoped (pg_advisory_xact_lock)
  // so they release automatically on transaction commit or rollback.
  // The key is a single-int64 derived from hashing the slug — any
  // two processes bootstrapping the same slug will serialize on
  // the same lock. Other operations against the DB are unaffected.
  //
  // Lock key: hashtext('e2e-bootstrap-org') — Postgres-native hash
  // function. Using a stable value so different runs always resolve
  // to the same lock.
  const txResult = await db.transaction(async (tx) => {
    // Acquire the advisory lock FIRST. If another process holds it,
    // this call blocks until they commit/rollback. The lock is
    // released automatically when this transaction ends.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${BOOTSTRAP_ORG_SLUG}))`,
    );

    // Authoritative re-read of the existing org INSIDE the lock.
    // Another process may have committed a new org between our
    // early-peek SELECT above and our lock acquisition. Without this
    // re-read, we'd try to delete a stale org ID (no-op) and then
    // insert a second org with the same slug (UNIQUE violation).
    const inLock = await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.slug, BOOTSTRAP_ORG_SLUG))
      .limit(1);
    const existingOrgId = inLock[0]?.id ?? null;
    if (existingOrgId) {
      assertNotProtected(
        existingOrgId,
        "bootstrap script reset of existing org (in-lock)",
      );
    }

    // 2a. Clean up prior bootstrap org + all orphan rows.
    if (existingOrgId) {
      // Clean up orphan rows using the typed drizzle query builder.
      // Each delete is fully parameterized — drizzle generates
      // `DELETE FROM "<table>" WHERE "org_id" = $1` with existingOrgId
      // bound as a parameter. Zero SQL string interpolation, zero
      // injection surface.
      //
      // Explicit per-table calls (not a loop over an array) because
      // drizzle's typed eq() requires each table reference to narrow
      // correctly — iterating over a union loses the narrowing.
      await tx.delete(actions).where(eq(actions.orgId, existingOrgId));
      await tx.delete(apiKeys).where(eq(apiKeys.orgId, existingOrgId));
      await tx.delete(auditEvents).where(eq(auditEvents.orgId, existingOrgId));
      await tx.delete(budgets).where(eq(budgets.orgId, existingOrgId));
      await tx.delete(costEvents).where(eq(costEvents.orgId, existingOrgId));
      await tx.delete(sessions).where(eq(sessions.orgId, existingOrgId));
      await tx.delete(slackConfigs).where(eq(slackConfigs.orgId, existingOrgId));
      await tx.delete(subscriptions).where(eq(subscriptions.orgId, existingOrgId));
      await tx.delete(toolCosts).where(eq(toolCosts.orgId, existingOrgId));
      await tx.delete(webhookEndpoints).where(eq(webhookEndpoints.orgId, existingOrgId));
      const ORPHAN_TABLE_COUNT = 10;

      // Deleting the organization triggers CASCADE on FK-linked tables
      // (customer_mappings, customer_revenue, customer_settings,
      // org_invitations, org_memberships, stripe_connections).
      await tx
        .delete(organizations)
        .where(eq(organizations.id, existingOrgId));

      console.error(
        `Deleted prior bootstrap org ${existingOrgId} + orphan cleanup across ${ORPHAN_TABLE_COUNT} tables`,
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
  //
  // Exit codes from this script:
  //   0  — success (transaction committed, key verified OR verification
  //        intentionally skipped)
  //   1  — transaction or key-rejection failure (hard fail)
  //   2  — transaction committed but key verification was inconclusive
  //        (network error, proxy down, unexpected response shape).
  //        The key is almost certainly valid but unverified. Shell
  //        pipelines can distinguish 2 from 1 for strict-mode handling.
  let verificationInconclusive = false;

  const proxyUrl =
    process.env.NULLSPEND_PROXY_URL ?? "https://proxy.nullspend.dev";
  const skipVerify = process.env.NULLSPEND_SKIP_KEY_VERIFY === "1";

  if (skipVerify) {
    console.error("Skipping proxy key verification (NULLSPEND_SKIP_KEY_VERIFY=1)");
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
          // X-NullSpend-Tags must be a JSON object — not key=value.
          // See apps/proxy/src/lib/tags.ts:13.
          "X-NullSpend-Tags": JSON.stringify({
            e2e_tier: "bootstrap",
            e2e_purpose: "key-verify",
          }),
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: "x" }],
          max_completion_tokens: 1,
        }),
        signal: AbortSignal.timeout(15_000),
      });

      // Expected outcomes:
      //   200 — unlikely (OpenAI somehow accepted the stub key); SUCCESS
      //   401/403 FROM OPENAI (upstream)   — proxy key worked, forwarded; SUCCESS
      //   401/403 FROM PROXY (nullspend)   — proxy REJECTED our key; HARD FAIL
      //   502/504 — proxy worker down / gateway; INCONCLUSIVE (exit 2)
      //   any other non-JSON response — INCONCLUSIVE (exit 2)
      //
      // We differentiate a NullSpend 401 from an OpenAI 401 by reading
      // the response body. NullSpend auth errors have shape
      // `{ error: { code: "invalid_api_key", ... } }` and are ALWAYS
      // returned with `Content-Type: application/json`. An HTML error
      // page (from a gateway or CDN intercept) is inconclusive.
      if (res.status === 401 || res.status === 403) {
        const contentType = res.headers.get("content-type") ?? "";
        if (!contentType.includes("application/json")) {
          console.error(
            `  WARNING: proxy returned ${res.status} with non-JSON content-type ` +
              `"${contentType}" — can't distinguish NullSpend rejection from ` +
              `upstream. Key validity is inconclusive.`,
          );
          verificationInconclusive = true;
        } else {
          const body = (await res.json().catch(() => null)) as {
            error?: { code?: string; message?: string };
          } | null;
          const code = body?.error?.code;
          // NullSpend proxy auth error codes we need to catch:
          if (code === "invalid_api_key" || code === "missing_api_key") {
            throw new Error(
              `Proxy rejected the newly created key (status ${res.status}, ` +
                `code ${code}). Hash format may have drifted — check ` +
                `lib/auth/api-key.ts hashKey() implementation vs. the ` +
                `proxy's key lookup.`,
            );
          }
          // Upstream (OpenAI) 401/403 is the expected success path.
        }
      } else if (res.status === 429) {
        // EC-7: Rate limit from upstream (OpenAI). The NullSpend auth
        // layer worked — the request reached upstream — but we can't
        // conclusively say the key is valid because the upstream
        // response didn't reach us. Treat as inconclusive.
        console.error(
          `  WARNING: proxy verification got 429 — upstream (OpenAI) rate ` +
            `limited us. NullSpend auth path accepted the key but the full ` +
            `round-trip couldn't complete. Key validity is inconclusive.`,
        );
        verificationInconclusive = true;
      } else if (res.status >= 500) {
        console.error(
          `  WARNING: proxy verification got ${res.status} — proxy may be ` +
            `down. Bootstrap succeeded but key validity is inconclusive.`,
        );
        verificationInconclusive = true;
      }
      if (!verificationInconclusive) {
        console.error(`  OK (proxy responded ${res.status})`);
      }
    } catch (err) {
      // Re-throw our own Error (for key rejection — exit 1), but tolerate
      // network errors (proxy down — exit 2) with a warning flag.
      if (err instanceof Error && err.message.startsWith("Proxy rejected")) {
        throw err;
      }
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `  WARNING: could not verify key (${msg}). Bootstrap succeeded ` +
          `but key validity is inconclusive.`,
      );
      verificationInconclusive = true;
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

  // Exit code 2 signals "committed but unverified" so strict shell
  // pipelines can distinguish from hard failures (exit 1) and clean
  // success (exit 0).
  if (verificationInconclusive) {
    process.exit(2);
  }
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
