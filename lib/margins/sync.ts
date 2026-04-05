import Stripe from "stripe";
import { and, eq } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { stripeConnections, customerRevenue } from "@nullspend/db";
import { decryptStripeKey } from "./encryption";
import { runAutoMatch } from "./auto-match";
import { getMarginTable } from "./margin-query";
import { detectWorseningCrossings, buildMarginThresholdPayload } from "./webhook";
import { dispatchWebhookEvent } from "@/lib/webhooks/dispatch";
import { formatPeriod } from "./periods";
import { getLogger } from "@/lib/observability";

const log = getLogger("margin-sync");

interface SyncResult {
  orgId: string;
  customersProcessed: number;
  periodsUpdated: number;
  autoMatchesCreated: number;
  invoicesFetched: number;
  invoicesSkipped: number;
  durationMs: number;
  error?: string;
}

/**
 * Sync revenue data from Stripe for a single org.
 * Replace strategy: DELETE + re-INSERT per customer per period.
 */
export async function syncOrgRevenue(orgId: string): Promise<SyncResult> {
  const startTime = Date.now();
  const db = getDb();
  const result: SyncResult = {
    orgId,
    customersProcessed: 0,
    periodsUpdated: 0,
    autoMatchesCreated: 0,
    invoicesFetched: 0,
    invoicesSkipped: 0,
    durationMs: 0,
  };

  // Load connection
  const [connection] = await db
    .select()
    .from(stripeConnections)
    .where(eq(stripeConnections.orgId, orgId))
    .limit(1);

  if (!connection || connection.status === "revoked") {
    return { ...result, error: "No active Stripe connection" };
  }

  let stripeKey: string;
  try {
    stripeKey = decryptStripeKey(connection.encryptedKey, orgId);
  } catch {
    await db
      .update(stripeConnections)
      .set({ status: "error", lastError: "Decryption failed — re-connect Stripe." })
      .where(eq(stripeConnections.id, connection.id));
    return { ...result, error: "Decryption failed" };
  }

  const stripe = new Stripe(stripeKey, { apiVersion: "2026-02-25.clover" });

  // Get all paid invoices for the last 3 calendar months + current month
  const now = new Date();
  const threeMonthsAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1));
  const afterTimestamp = Math.floor(threeMonthsAgo.getTime() / 1000);

  try {
    // Collect invoices per customer per period
    const customerPeriods = new Map<string, {
      stripeCustomerId: string;
      customerName: string | null;
      customerEmail: string | null;
      avatarUrl: string | null;
      periodStart: Date;
      amountMicrodollars: number;
      invoiceCount: number;
    }>();

    const stripeCustomers: { id: string; metadata?: Record<string, string> | null }[] = [];
    const seenCustomers = new Set<string>();

    for await (const invoice of stripe.invoices.list({
      status: "paid",
      created: { gte: afterTimestamp },
      limit: 100,
      expand: ["data.customer"],
    })) {
      result.invoicesFetched++;
      if (!invoice.created) { result.invoicesSkipped++; continue; }
      if (!invoice.customer || typeof invoice.customer === "string") { result.invoicesSkipped++; continue; }
      const customer = invoice.customer;
      if (customer.deleted) { result.invoicesSkipped++; continue; }

      // Skip non-USD
      if (invoice.currency !== "usd") {
        log.warn({ orgId, invoiceId: invoice.id, currency: invoice.currency }, "Skipping non-USD invoice");
        result.invoicesSkipped++;
        continue;
      }

      // Track unique customers for auto-match
      if (!seenCustomers.has(customer.id)) {
        seenCustomers.add(customer.id);
        stripeCustomers.push({
          id: customer.id,
          metadata: (customer as Stripe.Customer).metadata as Record<string, string> | null,
        });
      }

      const cust = customer as Stripe.Customer;

      // Determine calendar month period
      const invoiceDate = new Date((invoice.created ?? 0) * 1000);
      const periodStart = new Date(Date.UTC(invoiceDate.getUTCFullYear(), invoiceDate.getUTCMonth(), 1));
      const key = `${cust.id}:${periodStart.toISOString()}`;

      // Convert cents to microdollars: $1.00 = 100 cents = 1,000,000 microdollars
      const amountMicrodollars = (invoice.amount_paid ?? 0) * 10_000;

      const existing = customerPeriods.get(key);
      if (existing) {
        existing.amountMicrodollars += amountMicrodollars;
        existing.invoiceCount++;
      } else {
        customerPeriods.set(key, {
          stripeCustomerId: cust.id,
          customerName: cust.name ?? null,
          customerEmail: cust.email ?? null,
          avatarUrl: null,
          periodStart,
          amountMicrodollars,
          invoiceCount: 1,
        });
      }
    }

    result.customersProcessed = seenCustomers.size;

    // Replace strategy: DELETE + re-INSERT per customer per period
    for (const entry of customerPeriods.values()) {
      await db.transaction(async (tx) => {
        await tx
          .delete(customerRevenue)
          .where(
            and(
              eq(customerRevenue.orgId, orgId),
              eq(customerRevenue.stripeCustomerId, entry.stripeCustomerId),
              eq(customerRevenue.periodStart, entry.periodStart),
            ),
          );

        await tx
          .insert(customerRevenue)
          .values({
            orgId,
            stripeCustomerId: entry.stripeCustomerId,
            customerName: entry.customerName,
            customerEmail: entry.customerEmail,
            avatarUrl: entry.avatarUrl,
            periodStart: entry.periodStart,
            amountMicrodollars: entry.amountMicrodollars,
            invoiceCount: entry.invoiceCount,
            currency: "usd",
          });
      });
      result.periodsUpdated++;
    }

    // Run auto-match
    result.autoMatchesCreated = await runAutoMatch(orgId, stripeCustomers);

    // Detect margin threshold crossings and fire webhooks
    try {
      const currentPeriod = formatPeriod(new Date());
      const marginData = await getMarginTable(orgId, currentPeriod);
      const currentMargins = marginData.customers.map((c) => ({
        tagValue: c.tagValue,
        marginPercent: c.marginPercent,
      }));

      // Compare against previous period to detect worsening
      const prevMonth = new Date();
      prevMonth.setUTCMonth(prevMonth.getUTCMonth() - 1);
      const prevPeriod = formatPeriod(prevMonth);
      const prevData = await getMarginTable(orgId, prevPeriod);
      const prevMargins = prevData.customers.map((c) => ({
        tagValue: c.tagValue,
        marginPercent: c.marginPercent,
      }));

      const crossings = detectWorseningCrossings(prevMargins, currentMargins);
      for (const crossing of crossings) {
        const customer = marginData.customers.find((c) => c.tagValue === crossing.tagValue);
        if (!customer) continue;
        const event = buildMarginThresholdPayload({
          stripeCustomerId: customer.stripeCustomerId,
          customerName: customer.customerName,
          tagValue: crossing.tagValue,
          previousMarginPercent: crossing.previousMarginPercent,
          currentMarginPercent: crossing.currentMarginPercent,
          revenueMicrodollars: customer.revenueMicrodollars,
          costMicrodollars: customer.costMicrodollars,
          period: currentPeriod,
        });
        await dispatchWebhookEvent(orgId, event);
      }
    } catch (err) {
      log.warn({ err, orgId }, "Margin threshold detection failed (non-fatal)");
    }

    // Update connection status
    await db
      .update(stripeConnections)
      .set({
        status: "active",
        lastSyncAt: new Date(),
        lastError: null,
      })
      .where(eq(stripeConnections.id, connection.id));

    result.durationMs = Date.now() - startTime;
    log.info(result, "Revenue sync complete");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    log.error({ err, orgId }, "Revenue sync failed");

    // Check for Stripe auth errors
    const isAuthError = err instanceof Stripe.errors.StripeAuthenticationError;
    await db
      .update(stripeConnections)
      .set({
        status: isAuthError ? "revoked" : "error",
        lastError: message,
      })
      .where(eq(stripeConnections.id, connection.id));

    result.error = message;
    result.durationMs = Date.now() - startTime;
  }

  return result;
}

/**
 * Sync all orgs with active Stripe connections.
 * Called by Vercel Cron (sequential per-org).
 * Stops early if approaching the function timeout to avoid partial syncs.
 */
const MAX_CRON_DURATION_MS = 50_000; // 50s — leave 10s buffer for Vercel's 60s limit

export async function syncAllOrgs(): Promise<SyncResult[]> {
  const cronStart = Date.now();
  const db = getDb();
  const connections = await db
    .select({ orgId: stripeConnections.orgId })
    .from(stripeConnections)
    .where(eq(stripeConnections.status, "active"));

  const results: SyncResult[] = [];
  for (const conn of connections) {
    // Timeout guard: stop before Vercel kills the function
    if (Date.now() - cronStart > MAX_CRON_DURATION_MS) {
      log.warn(
        { synced: results.length, remaining: connections.length - results.length },
        "Cron timeout approaching — stopping early. Remaining orgs will sync next cycle.",
      );
      break;
    }
    const result = await syncOrgRevenue(conn.orgId);
    results.push(result);
  }
  return results;
}
