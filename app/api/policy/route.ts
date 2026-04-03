import { NextResponse } from "next/server";

import { authenticateApiKey } from "@/lib/auth/with-api-key-auth";
import { getDb } from "@/lib/db/client";
import { budgets } from "@nullspend/db";
import { eq } from "drizzle-orm";
import { getAllPricing } from "@nullspend/cost-engine";
import { getLogger, withRequestContext } from "@/lib/observability";

const log = getLogger("policy");

interface PolicyBudget {
  remaining_microdollars: number;
  max_microdollars: number;
  spend_microdollars: number;
  period_end: string | null;
  entity_type: string;
  entity_id: string;
}

interface CheapestModel {
  model: string;
  provider?: string;
  input_per_mtok: number;
  output_per_mtok: number;
}

interface PolicyResponse {
  budget: PolicyBudget | null;
  allowed_models: string[] | null;
  allowed_providers: string[] | null;
  cheapest_per_provider: Record<string, CheapestModel> | null;
  cheapest_overall: CheapestModel | null;
  restrictions_active: boolean;
  session_limit_microdollars: number | null;
}

function computePeriodEnd(
  resetInterval: string | null,
  currentPeriodStart: Date | null,
): string | null {
  if (!resetInterval || !currentPeriodStart) return null;
  const start = new Date(currentPeriodStart);
  switch (resetInterval) {
    case "daily":
      start.setUTCDate(start.getUTCDate() + 1);
      break;
    case "weekly":
      start.setUTCDate(start.getUTCDate() + 7);
      break;
    case "monthly":
      start.setUTCMonth(start.getUTCMonth() + 1);
      break;
    case "yearly":
      start.setUTCFullYear(start.getUTCFullYear() + 1);
      break;
    default:
      return null;
  }
  return start.toISOString();
}

/**
 * Check if a budget's period has expired. SDK-only users don't have the proxy's
 * DO to reset periods, so the policy endpoint treats expired periods as if
 * spend is zero (budget fully available).
 */
function isPeriodExpired(
  resetInterval: string | null,
  currentPeriodStart: Date | null,
): boolean {
  if (!resetInterval || !currentPeriodStart) return false;
  const periodEnd = computePeriodEnd(resetInterval, currentPeriodStart);
  if (!periodEnd) return false;
  return new Date(periodEnd).getTime() <= Date.now();
}

function findCheapestModels(
  allowedModels: string[] | null,
  allowedProviders: string[] | null,
): { perProvider: Record<string, CheapestModel>; overall: CheapestModel | null } {
  const catalog = getAllPricing();
  const perProvider: Record<string, CheapestModel> = {};
  let overall: CheapestModel | null = null;

  for (const [key, pricing] of Object.entries(catalog)) {
    const slashIdx = key.indexOf("/");
    if (slashIdx === -1) continue;
    const provider = key.slice(0, slashIdx);
    const model = key.slice(slashIdx + 1);

    if (allowedProviders && !allowedProviders.includes(provider)) continue;
    if (allowedModels && !allowedModels.includes(model)) continue;

    const combinedCost = pricing.inputPerMTok + pricing.outputPerMTok;
    const entry: CheapestModel = {
      model,
      input_per_mtok: pricing.inputPerMTok,
      output_per_mtok: pricing.outputPerMTok,
    };

    const existing = perProvider[provider];
    if (!existing || combinedCost < existing.input_per_mtok + existing.output_per_mtok) {
      perProvider[provider] = entry;
    }

    if (!overall || combinedCost < overall.input_per_mtok + overall.output_per_mtok) {
      overall = { ...entry, provider };
    }
  }

  return { perProvider, overall };
}

export const GET = withRequestContext(async (request: Request) => {
  const authResult = await authenticateApiKey(request);
  if (authResult instanceof Response) return authResult;
  if (!authResult.orgId) {
    return NextResponse.json(
      { error: { code: "configuration_error", message: "API key is not associated with an organization.", details: null } },
      { status: 403 },
    );
  }

  try {
    const db = getDb();
    const orgId = authResult.orgId;

    // Query all budgets for this org
    let policyBudget: PolicyBudget | null = null;
    const budgetRows = await db
      .select({
        entityType: budgets.entityType,
        entityId: budgets.entityId,
        maxBudgetMicrodollars: budgets.maxBudgetMicrodollars,
        spendMicrodollars: budgets.spendMicrodollars,
        resetInterval: budgets.resetInterval,
        currentPeriodStart: budgets.currentPeriodStart,
        sessionLimitMicrodollars: budgets.sessionLimitMicrodollars,
      })
      .from(budgets)
      .where(eq(budgets.orgId, orgId));

    if (budgetRows.length > 0) {
      // Find most restrictive (lowest remaining).
      // If a budget's period has expired, treat spend as 0 (period should reset).
      // SDK-only users don't have the proxy's DO to reset periods automatically.
      let mostRestrictive: (typeof budgetRows)[number] | null = null;
      let lowestRemaining = Infinity;
      let mostRestrictiveExpired = false;

      for (const row of budgetRows) {
        const expired = isPeriodExpired(
          row.resetInterval ?? null,
          row.currentPeriodStart,
        );
        const effectiveSpend = expired ? 0 : row.spendMicrodollars;
        const remaining = row.maxBudgetMicrodollars - effectiveSpend;
        if (remaining < lowestRemaining) {
          lowestRemaining = remaining;
          mostRestrictive = row;
          mostRestrictiveExpired = expired;
        }
      }

      if (mostRestrictive) {
        const effectiveSpend = mostRestrictiveExpired ? 0 : mostRestrictive.spendMicrodollars;
        policyBudget = {
          remaining_microdollars: Math.max(
            0,
            mostRestrictive.maxBudgetMicrodollars - effectiveSpend,
          ),
          max_microdollars: mostRestrictive.maxBudgetMicrodollars,
          spend_microdollars: effectiveSpend,
          period_end: computePeriodEnd(
            mostRestrictive.resetInterval ?? null,
            mostRestrictiveExpired
              ? new Date()  // expired → next period starts now
              : mostRestrictive.currentPeriodStart,
          ),
          entity_type: mostRestrictive.entityType,
          entity_id: mostRestrictive.entityId,
        };
      }
    }

    // Session limit: minimum non-null across all budget rows
    let sessionLimitMicrodollars: number | null = null;
    for (const row of budgetRows) {
      if (row.sessionLimitMicrodollars != null) {
        if (sessionLimitMicrodollars === null || row.sessionLimitMicrodollars < sessionLimitMicrodollars) {
          sessionLimitMicrodollars = row.sessionLimitMicrodollars;
        }
      }
    }

    // Restrictions from key
    const allowedModels = authResult.allowedModels ?? null;
    const allowedProviders = authResult.allowedProviders ?? null;
    const restrictionsActive = allowedModels !== null || allowedProviders !== null;

    // Cheapest models
    const { perProvider, overall } = findCheapestModels(allowedModels, allowedProviders);

    const response: PolicyResponse = {
      budget: policyBudget,
      allowed_models: allowedModels,
      allowed_providers: allowedProviders,
      cheapest_per_provider: Object.keys(perProvider).length > 0 ? perProvider : null,
      cheapest_overall: overall,
      restrictions_active: restrictionsActive,
      session_limit_microdollars: sessionLimitMicrodollars,
    };

    return NextResponse.json(response, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    log.error({ err }, "Policy endpoint error");
    return NextResponse.json(
      { error: { code: "internal_error", message: "Failed to retrieve policy", details: null } },
      { status: 500 },
    );
  }
});
