import Stripe from "stripe";
import { and, eq } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { STRIPE_API_VERSION } from "@/lib/stripe/client";
import { stripeConnections, customerRevenue } from "@nullspend/db";
import { decryptStripeKey } from "./encryption";
import { runAutoMatch } from "./auto-match";
import { getMarginTable } from "./margin-query";
import { computeHealthTier } from "./margin-query";
import { detectWorseningCrossings, buildMarginThresholdPayload } from "./webhook";
import { buildMarginAlertMessage, dispatchMarginSlackAlert } from "./margin-slack-message";
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
  skippedCurrencies: Record<string, number>;
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
    skippedCurrencies: {},
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
      .set({ status: "error", lastError: "Decryption failed — re-connect Stripe.", updatedAt: new Date() })
      .where(eq(stripeConnections.id, connection.id));
    return { ...result, error: "Decryption failed" };
  }

  const stripe = new Stripe(stripeKey, { apiVersion: STRIPE_API_VERSION });

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

      // Skip non-USD (track skipped currencies for banner)
      if (invoice.currency !== "usd") {
        const curr = invoice.currency ?? "unknown";
        result.skippedCurrencies[curr] = (result.skippedCurrencies[curr] ?? 0) + 1;
        log.warn({ orgId, invoiceId: invoice.id, currency: curr }, "Skipping non-USD invoice");
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

    // Detect margin threshold crossings (compute once, dispatch to webhook + Slack independently)
    let crossings: { tagValue: string; previousMarginPercent: number; currentMarginPercent: number }[] = [];
    let marginData: Awaited<ReturnType<typeof getMarginTable>> | null = null;
    let currentPeriod = "";

    try {
      currentPeriod = formatPeriod(new Date());
      marginData = await getMarginTable(orgId, currentPeriod);
      const currentMargins = marginData.customers.map((c) => ({
        tagValue: c.tagValue,
        marginPercent: c.marginPercent,
      }));

      const prevMonth = new Date();
      prevMonth.setUTCMonth(prevMonth.getUTCMonth() - 1);
      const prevData = await getMarginTable(orgId, formatPeriod(prevMonth));
      const prevMargins = prevData.customers.map((c) => ({
        tagValue: c.tagValue,
        marginPercent: c.marginPercent,
      }));

      crossings = detectWorseningCrossings(prevMargins, currentMargins);
    } catch (err) {
      log.warn({ err, orgId }, "Margin threshold detection failed (non-fatal)");
    }

    // Dispatch webhook events (independent of Slack)
    if (crossings.length > 0 && marginData) {
      try {
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
        log.info({ orgId, count: crossings.length }, "Margin webhook events dispatched");
      } catch (err) {
        log.warn({ err, orgId }, "Margin webhook dispatch failed (non-fatal)");
      }
    }

    // Dispatch Slack alerts (independent of webhooks)
    if (crossings.length > 0 && marginData) {
      try {
        for (const crossing of crossings) {
          const customer = marginData.customers.find((c) => c.tagValue === crossing.tagValue);
          if (!customer) continue;
          const message = buildMarginAlertMessage({
            customerName: customer.customerName,
            tagValue: crossing.tagValue,
            previousMarginPercent: crossing.previousMarginPercent,
            currentMarginPercent: crossing.currentMarginPercent,
            previousTier: computeHealthTier(crossing.previousMarginPercent),
            currentTier: computeHealthTier(crossing.currentMarginPercent),
            revenueMicrodollars: customer.revenueMicrodollars,
            costMicrodollars: customer.costMicrodollars,
            period: currentPeriod,
          });
          await dispatchMarginSlackAlert(orgId, message);
        }
        if (crossings.length > 0) {
          log.info({ orgId, count: crossings.length }, "Margin Slack alerts dispatched");
        }
      } catch (err) {
        log.warn({ err, orgId }, "Margin Slack alert dispatch failed (non-fatal)");
      }
    }

    // Update connection status
    await db
      .update(stripeConnections)
      .set({
        status: "active",
        lastSyncAt: new Date(),
        lastError: null,
        lastSyncMeta: {
          skippedCurrencies: Object.keys(result.skippedCurrencies).length > 0
            ? result.skippedCurrencies
            : undefined,
        },
        updatedAt: new Date(),
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
        updatedAt: new Date(),
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
const PER_ORG_TIMEOUT_MS = 15_000; // 15s — prevent one slow org from starving others

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

    // Per-org timeout: abort if a single sync takes too long
    try {
      const result = await Promise.race([
        syncOrgRevenue(conn.orgId),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Per-org sync timeout")), PER_ORG_TIMEOUT_MS),
        ),
      ]);
      results.push(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      log.error({ err, orgId: conn.orgId }, "Org sync failed or timed out");
      results.push({
        orgId: conn.orgId,
        customersProcessed: 0,
        periodsUpdated: 0,
        autoMatchesCreated: 0,
        invoicesFetched: 0,
        invoicesSkipped: 0,
        skippedCurrencies: {},
        durationMs: PER_ORG_TIMEOUT_MS,
        error: message,
      });
    }
  }
  return results;
}
