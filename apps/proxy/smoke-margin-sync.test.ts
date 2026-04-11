/**
 * ST-7: Margin sync + proxy interaction smoke test.
 *
 * End-to-end test that verifies:
 * 1. Stripe connection via dashboard API
 * 2. Revenue sync from Stripe test invoices
 * 3. Margin data appears in the dashboard
 * 4. Proxy budget enforcement isn't affected during sync
 *
 * Requires:
 *   - Local dashboard at NULLSPEND_DASHBOARD_URL (pnpm dev)
 *   - NULLSPEND_API_KEY for dashboard API auth
 *   - STRIPE_TEST_KEY (sk_test_... key with invoice+customer read perms)
 *   - DATABASE_URL for direct verification
 *   - Proxy at PROXY_URL for budget enforcement check
 *   - OPENAI_API_KEY for proxy requests
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import Stripe from "stripe";
import {
  BASE,
  OPENAI_API_KEY,
  NULLSPEND_API_KEY,
  NULLSPEND_SMOKE_USER_ID,
  authHeaders,
  smallRequest,
  isServerUp,
} from "./smoke-test-helpers.js";

const DASHBOARD_URL = process.env.NULLSPEND_DASHBOARD_URL ?? "http://127.0.0.1:3000";
const STRIPE_TEST_KEY = process.env.STRIPE_TEST_KEY ?? process.env.STRIPE_SECRET_KEY;

describe("ST-7: Margin sync + proxy interaction", () => {
  let sql: postgres.Sql;
  let orgId: string;
  let stripe: Stripe;
  let stripeCustomerId: string;
  let stripeInvoiceId: string;
  let stripeProductId: string;
  let hadExistingConnection: boolean = false;

  beforeAll(async () => {
    // Check prerequisites
    const proxyUp = await isServerUp();
    if (!proxyUp) throw new Error("Proxy not reachable at " + BASE);
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY required");
    if (!NULLSPEND_API_KEY) throw new Error("NULLSPEND_API_KEY required");
    if (!STRIPE_TEST_KEY) throw new Error("STRIPE_TEST_KEY or STRIPE_SECRET_KEY required");
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");

    // Check dashboard is reachable
    try {
      const dashRes = await fetch(`${DASHBOARD_URL}/api/health`, { signal: AbortSignal.timeout(3000) });
      if (!dashRes.ok) throw new Error(`Dashboard returned ${dashRes.status}`);
    } catch {
      throw new Error(`Dashboard not reachable at ${DASHBOARD_URL}. Run pnpm dev first.`);
    }

    sql = postgres(process.env.DATABASE_URL!, { max: 3, idle_timeout: 10 });

    // Get org ID from smoke API key
    const [key] = await sql`SELECT org_id FROM api_keys WHERE id = ${process.env.NULLSPEND_SMOKE_KEY_ID!}`;
    if (!key?.org_id) throw new Error("Smoke test API key has no org_id");
    orgId = key.org_id;

    // Check for existing Stripe connection
    const [existing] = await sql`SELECT id FROM stripe_connections WHERE org_id = ${orgId}`;
    hadExistingConnection = !!existing;

    // Set up Stripe test fixtures
    stripe = new Stripe(STRIPE_TEST_KEY, { apiVersion: "2024-12-18.acacia" as Stripe.LatestApiVersion });

    // Create test customer with nullspend_customer metadata for auto-match
    const customer = await stripe.customers.create({
      name: "ST-7 Smoke Test Customer",
      email: "st7-smoke@nullspend.dev",
      metadata: { nullspend_customer: "st7-smoke-customer" },
    });
    stripeCustomerId = customer.id;

    // Create product + price
    const product = await stripe.products.create({
      name: "ST-7 Test API Usage",
    });
    stripeProductId = product.id;

    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: 5000, // $50.00
      currency: "usd",
    });

    // Create and pay invoice
    // In test mode, we need a payment method on the customer
    const paymentMethod = await stripe.paymentMethods.create({
      type: "card",
      card: { token: "tok_visa" },
    });
    await stripe.paymentMethods.attach(paymentMethod.id, { customer: customer.id });
    await stripe.customers.update(customer.id, {
      invoice_settings: { default_payment_method: paymentMethod.id },
    });

    const invoice = await stripe.invoices.create({
      customer: customer.id,
      collection_method: "charge_automatically",
      auto_advance: false,
    });
    stripeInvoiceId = invoice.id;

    await stripe.invoiceItems.create({
      customer: customer.id,
      invoice: invoice.id,
      price: price.id,
    });

    const finalized = await stripe.invoices.finalizeInvoice(invoice.id);
    const paid = await stripe.invoices.pay(finalized.id);
    expect(paid.status).toBe("paid");

    console.log(`[ST-7] Stripe fixtures: customer=${stripeCustomerId}, invoice=${stripeInvoiceId}, amount=$50.00`);
  }, 60_000);

  afterAll(async () => {
    // Clean up Stripe fixtures
    if (stripe) {
      try {
        if (stripeCustomerId) await stripe.customers.del(stripeCustomerId);
        if (stripeProductId) await stripe.products.update(stripeProductId, { active: false });
      } catch (err) {
        console.log("[ST-7] Stripe cleanup warning:", err);
      }
    }

    // Clean up NullSpend data
    if (sql) {
      // Remove customer_revenue for our test customer
      await sql`DELETE FROM customer_revenue WHERE stripe_customer_id = ${stripeCustomerId ?? ""}`.catch(() => {});
      // Remove auto-matched mapping
      await sql`DELETE FROM customer_mappings WHERE tag_value = 'st7-smoke-customer' AND org_id = ${orgId}`.catch(() => {});
      // Remove Stripe connection only if we created it
      if (!hadExistingConnection) {
        await sql`DELETE FROM stripe_connections WHERE org_id = ${orgId}`.catch(() => {});
      }
      await sql.end();
    }
  });

  it("connects Stripe via dashboard API (or uses existing connection)", async () => {
    if (hadExistingConnection) {
      console.log("[ST-7] Existing Stripe connection found — skipping connect");
      return;
    }

    const res = await fetch(`${DASHBOARD_URL}/api/stripe/connect`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-nullspend-key": NULLSPEND_API_KEY!,
      },
      body: JSON.stringify({ stripeKey: STRIPE_TEST_KEY }),
    });

    // 201 = created, 409 = already connected (race or prior test)
    expect([201, 409]).toContain(res.status);
    const body = await res.json();
    if (res.status === 201) {
      console.log(`[ST-7] Stripe connected: ${body.data.keyPrefix}`);
    } else {
      console.log("[ST-7] Stripe already connected (409)");
    }
  }, 30_000);

  it("revenue sync retrieves the test invoice", async () => {
    // Trigger sync via dashboard API
    const res = await fetch(`${DASHBOARD_URL}/api/stripe/revenue-sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-nullspend-key": NULLSPEND_API_KEY!,
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    console.log("[ST-7] Sync result:", JSON.stringify(body).slice(0, 300));

    // Verify revenue appeared in DB
    const rows = await sql`
      SELECT stripe_customer_id, amount_microdollars::text as amount, customer_name
      FROM customer_revenue
      WHERE org_id = ${orgId} AND stripe_customer_id = ${stripeCustomerId}
    `;

    expect(rows.length).toBeGreaterThan(0);
    const amount = Number(rows[0].amount);
    // $50.00 = 5000 cents = 50,000,000 microdollars
    expect(amount).toBe(50_000_000);
    console.log(`[ST-7] Revenue synced: ${rows[0].customer_name} = ${amount}µ¢`);
  }, 60_000);

  it("margin data appears in dashboard API", async () => {
    const res = await fetch(`${DASHBOARD_URL}/api/margins`, {
      headers: {
        "x-nullspend-key": NULLSPEND_API_KEY!,
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    const data = body.data;

    console.log(`[ST-7] Margin summary: revenue=${data.summary.totalRevenueMicrodollars}µ¢, customers=${data.customers.length}`);

    // The test customer should appear with revenue
    expect(data.summary.totalRevenueMicrodollars).toBeGreaterThan(0);
  }, 30_000);

  it("proxy budget enforcement is not affected during margin sync", async () => {
    // Verify the proxy still handles requests normally
    // (margin sync touches different tables but uses the same DB connection pool)
    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders(),
      body: smallRequest(),
    });

    // Should get 200 (no budget) or 429 (budget active) — not 500/502
    expect([200, 429]).toContain(res.status);
    await res.text();
    console.log(`[ST-7] Proxy request during/after sync: ${res.status}`);
  }, 30_000);
});
