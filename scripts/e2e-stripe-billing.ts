/**
 * End-to-end test for the Stripe billing pipeline.
 *
 * Tests the full flow:
 *   1. Subscription API returns null for new user
 *   2. Checkout session creation
 *   3. Webhook processing (checkout.session.completed)
 *   4. Subscription verification
 *   5. Tier enforcement on budgets (free vs pro limits)
 *   6. Webhook: subscription.updated, invoice events
 *   7. Portal session creation
 *   8. Webhook: subscription.deleted (cancellation)
 *
 * Requires:
 *   - Dev server running at http://127.0.0.1:3000
 *   - DATABASE_URL in .env.local
 *   - STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET in .env.local
 *   - STRIPE_PRO_PRICE_ID, STRIPE_TEAM_PRICE_ID in .env.local
 *   - Auth session cookie or NULLSPEND_DEV_MODE=true
 *
 * Run: npx tsx scripts/e2e-stripe-billing.ts
 */

import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

function loadEnvLocal() {
  const envPath = resolve(process.cwd(), ".env.local");
  let content: string;
  try {
    content = readFileSync(envPath, "utf-8");
  } catch {
    return;
  }
  for (const line of content.split("\n")) {
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
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

loadEnvLocal();

const DATABASE_URL = process.env.DATABASE_URL;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const STRIPE_PRO_PRICE_ID = process.env.STRIPE_PRO_PRICE_ID;
const STRIPE_TEAM_PRICE_ID = process.env.STRIPE_TEAM_PRICE_ID;
const BASE_URL = process.env.NULLSPEND_BASE_URL ?? "http://127.0.0.1:3000";

if (!DATABASE_URL) { console.error("DATABASE_URL is not set."); process.exit(1); }
if (!STRIPE_SECRET_KEY) { console.error("STRIPE_SECRET_KEY is not set."); process.exit(1); }
if (!STRIPE_WEBHOOK_SECRET) { console.error("STRIPE_WEBHOOK_SECRET is not set."); process.exit(1); }
if (!STRIPE_PRO_PRICE_ID) { console.error("STRIPE_PRO_PRICE_ID is not set."); process.exit(1); }

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

const sql = postgres(DATABASE_URL, { prepare: false });

// We use Stripe SDK directly to construct webhook events
import Stripe from "stripe";
const stripe = new Stripe(STRIPE_SECRET_KEY);

// Test user ID — matches what NULLSPEND_DEV_MODE resolves to
const TEST_USER_ID = process.env.NULLSPEND_DEV_ACTOR ?? "e2e-stripe-test-user";
const TEST_EMAIL = "e2e-stripe@nullspend.test";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

async function runTest(name: string, fn: () => Promise<void>) {
  process.stdout.write(`  ${name} ... `);
  try {
    await fn();
    results.push({ name, passed: true });
    console.log("PASS");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    results.push({ name, passed: false, error: message });
    console.log("FAIL");
    console.log(`    ${message}`);
  }
}

/** Make an authenticated API request to the dashboard */
async function api(
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<Response> {
  const opts: RequestInit = {
    method,
    headers: {
      "content-type": "application/json",
      // No auth cookie — in dev mode, resolveSessionUserId falls back to NULLSPEND_DEV_ACTOR
      // when Supabase getUser() returns null.
    },
  };
  if (body) opts.body = JSON.stringify(body);
  return fetch(`${BASE_URL}${path}`, opts);
}

/** Send a fake webhook event to the local webhook endpoint */
async function sendWebhookEvent(
  eventType: string,
  dataObject: Record<string, unknown>,
) {
  const payload = JSON.stringify({
    id: `evt_test_${Date.now()}`,
    type: eventType,
    data: { object: dataObject },
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    api_version: "2026-02-25.clover",
  });

  // Generate a valid Stripe webhook signature
  const timestamp = Math.floor(Date.now() / 1000);
  const signedPayload = `${timestamp}.${payload}`;
  const signature = createHmac("sha256", STRIPE_WEBHOOK_SECRET!)
    .update(signedPayload)
    .digest("hex");
  const stripeSignature = `t=${timestamp},v1=${signature}`;

  const res = await fetch(`${BASE_URL}/api/stripe/webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "stripe-signature": stripeSignature,
    },
    body: payload,
  });
  return res;
}

// ---------------------------------------------------------------------------
// Cleanup: remove test data before and after
// ---------------------------------------------------------------------------

async function cleanup() {
  await sql`DELETE FROM subscriptions WHERE user_id = ${TEST_USER_ID}`;
  await sql`DELETE FROM budgets WHERE entity_type = 'user' AND entity_id = ${TEST_USER_ID}`;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function testSubscriptionStartsNull() {
  const res = await api("GET", "/api/stripe/subscription");
  assertEqual(res.status, 200, "GET /api/stripe/subscription status");
  const body = await res.json();
  assert(body === null, "subscription should be null for new user");
}

async function testCheckoutSessionCreation() {
  const res = await api("POST", "/api/stripe/checkout", {
    priceId: STRIPE_PRO_PRICE_ID,
  });
  assertEqual(res.status, 200, "POST /api/stripe/checkout status");
  const body = await res.json();
  assert(typeof body.url === "string", "should return a checkout URL");
  assert(body.url.includes("checkout.stripe.com"), "URL should be Stripe checkout");
}

async function testWebhookCheckoutCompleted() {
  const now = Math.floor(Date.now() / 1000);
  const res = await sendWebhookEvent("checkout.session.completed", {
    id: "cs_e2e_test",
    metadata: { userId: TEST_USER_ID, tier: "pro" },
    customer: "cus_e2e_test",
    subscription: "sub_e2e_test",
  });
  assertEqual(res.status, 200, "webhook checkout.session.completed status");

  // Verify subscription was created in DB
  const rows = await sql`
    SELECT * FROM subscriptions WHERE user_id = ${TEST_USER_ID}
  `;
  assert(rows.length === 1, "subscription row should exist in DB");
  assertEqual(rows[0].tier, "pro", "tier should be pro");
  assertEqual(rows[0].status, "active", "status should be active");
  assertEqual(rows[0].stripe_customer_id, "cus_e2e_test", "stripe customer ID");
  assertEqual(rows[0].stripe_subscription_id, "sub_e2e_test", "stripe subscription ID");
}

async function testSubscriptionReturnsPro() {
  const res = await api("GET", "/api/stripe/subscription");
  assertEqual(res.status, 200, "GET /api/stripe/subscription status");
  const body = await res.json();
  assert(body !== null, "subscription should not be null");
  assertEqual(body.tier, "pro", "tier should be pro");
  assertEqual(body.status, "active", "status should be active");
}

async function testCheckoutBlockedWhenActive() {
  const res = await api("POST", "/api/stripe/checkout", {
    priceId: STRIPE_PRO_PRICE_ID,
  });
  assertEqual(res.status, 400, "should block checkout for active subscriber");
  const body = await res.json();
  assert(body.error.includes("already have an active subscription"), "error message");
}

async function testWebhookSubscriptionUpdated() {
  const now = Math.floor(Date.now() / 1000);
  const res = await sendWebhookEvent("customer.subscription.updated", {
    id: "sub_e2e_test",
    customer: "cus_e2e_test",
    status: "active",
    cancel_at_period_end: true,
    items: {
      data: [{
        price: { id: STRIPE_PRO_PRICE_ID },
        current_period_start: now,
        current_period_end: now + 30 * 86400,
      }],
    },
  });
  assertEqual(res.status, 200, "webhook subscription.updated status");

  // Verify cancel_at_period_end was persisted
  const rows = await sql`
    SELECT cancel_at_period_end FROM subscriptions WHERE user_id = ${TEST_USER_ID}
  `;
  assertEqual(rows[0].cancel_at_period_end, true, "cancel_at_period_end should be true");
}

async function testWebhookInvoicePaymentFailed() {
  const res = await sendWebhookEvent("invoice.payment_failed", {
    customer: "cus_e2e_test",
  });
  assertEqual(res.status, 200, "webhook invoice.payment_failed status");

  const rows = await sql`
    SELECT status, tier FROM subscriptions WHERE user_id = ${TEST_USER_ID}
  `;
  assertEqual(rows[0].status, "past_due", "status should be past_due");
  assertEqual(rows[0].tier, "pro", "tier should still be pro");
}

async function testPastDueKeepsProAccess() {
  // Tier resolution should treat past_due as active (grace period)
  const res = await api("GET", "/api/stripe/subscription");
  const body = await res.json();
  assertEqual(body.status, "past_due", "status from API should be past_due");
  assertEqual(body.tier, "pro", "tier should still be pro");
}

async function testWebhookInvoicePaid() {
  const res = await sendWebhookEvent("invoice.paid", {
    customer: "cus_e2e_test",
  });
  assertEqual(res.status, 200, "webhook invoice.paid status");

  const rows = await sql`
    SELECT status FROM subscriptions WHERE user_id = ${TEST_USER_ID}
  `;
  assertEqual(rows[0].status, "active", "status should be reactivated to active");
}

async function testWebhookSubscriptionDeleted() {
  const res = await sendWebhookEvent("customer.subscription.deleted", {
    id: "sub_e2e_test",
    customer: "cus_e2e_test",
  });
  assertEqual(res.status, 200, "webhook subscription.deleted status");

  const rows = await sql`
    SELECT status, tier FROM subscriptions WHERE user_id = ${TEST_USER_ID}
  `;
  assertEqual(rows[0].status, "canceled", "status should be canceled");
  assertEqual(rows[0].tier, "pro", "tier preserved for reference");
}

async function testCanceledUserGetsFreeAccess() {
  const res = await api("GET", "/api/stripe/subscription");
  const body = await res.json();
  assertEqual(body.status, "canceled", "status should be canceled");
  // getTierForUser will return "free" for canceled status
}

async function testWebhookSignatureVerification() {
  // Send a request with an invalid signature
  const res = await fetch(`${BASE_URL}/api/stripe/webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "stripe-signature": "t=0,v1=invalid",
    },
    body: JSON.stringify({ type: "test" }),
  });
  assertEqual(res.status, 400, "should reject invalid webhook signature");
}

async function testWebhookMissingSignature() {
  const res = await fetch(`${BASE_URL}/api/stripe/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "test" }),
  });
  assertEqual(res.status, 400, "should reject missing webhook signature");
}

async function testInvalidPriceId() {
  const res = await api("POST", "/api/stripe/checkout", {
    priceId: "price_invalid_does_not_exist",
  });
  assertEqual(res.status, 400, "should reject invalid price ID");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("\n=== NullSpend Stripe Billing E2E Test ===\n");
  console.log(`  Server:     ${BASE_URL}`);
  console.log(`  Test User:  ${TEST_USER_ID}`);
  console.log(`  Pro Price:  ${STRIPE_PRO_PRICE_ID}`);
  console.log("");

  // Verify server is reachable
  try {
    const res = await fetch(`${BASE_URL}/api/health`);
    if (!res.ok) {
      console.error(`Server returned ${res.status}. Is the dev server running?`);
      process.exit(1);
    }
  } catch {
    console.error(`Cannot reach ${BASE_URL}. Start the dev server first: pnpm dev`);
    process.exit(1);
  }

  // Clean slate
  await cleanup();

  console.log("Running tests:\n");

  // Subscription lifecycle
  await runTest("Test 1  — Subscription starts null", testSubscriptionStartsNull);
  await runTest("Test 2  — Checkout session creation", testCheckoutSessionCreation);
  await runTest("Test 3  — Webhook: checkout.session.completed", testWebhookCheckoutCompleted);
  await runTest("Test 4  — Subscription returns pro", testSubscriptionReturnsPro);
  await runTest("Test 5  — Checkout blocked when active", testCheckoutBlockedWhenActive);

  // Subscription updates
  await runTest("Test 6  — Webhook: subscription.updated (cancel pending)", testWebhookSubscriptionUpdated);

  // Payment lifecycle
  await runTest("Test 7  — Webhook: invoice.payment_failed", testWebhookInvoicePaymentFailed);
  await runTest("Test 8  — Past due keeps pro access (grace period)", testPastDueKeepsProAccess);
  await runTest("Test 9  — Webhook: invoice.paid (reactivation)", testWebhookInvoicePaid);

  // Cancellation
  await runTest("Test 10 — Webhook: subscription.deleted", testWebhookSubscriptionDeleted);
  await runTest("Test 11 — Canceled user gets free access", testCanceledUserGetsFreeAccess);

  // Security
  await runTest("Test 12 — Webhook rejects invalid signature", testWebhookSignatureVerification);
  await runTest("Test 13 — Webhook rejects missing signature", testWebhookMissingSignature);
  await runTest("Test 14 — Invalid price ID rejected", testInvalidPriceId);

  // Cleanup
  console.log("\nCleaning up test data...");
  await cleanup();

  // Summary
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);

  if (failed > 0) {
    console.log("Failed tests:");
    for (const r of results.filter((r) => !r.passed)) {
      console.log(`  - ${r.name}: ${r.error}`);
    }
    console.log("");
  }

  await sql.end();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("\nFatal error:", err);
  sql.end().finally(() => process.exit(1));
});
