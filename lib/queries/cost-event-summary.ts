import { useQuery } from "@tanstack/react-query";

import { apiGet } from "@/lib/api/client";
import { costEventKeys } from "@/lib/queries/cost-events";
import { fillDateGaps } from "@/lib/utils/format";
import type { CostSummaryResponse } from "@/lib/validations/cost-event-summary";

export const costSummaryKeys = {
  all: [...costEventKeys.all, "summary"] as const,
  byPeriod: (period: string) => [...costSummaryKeys.all, period] as const,
};

const PERIOD_DAYS: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90 };

export function useCostSummary(period: "7d" | "30d" | "90d") {
  return useQuery({
    queryKey: costSummaryKeys.byPeriod(period),
    queryFn: () =>
      apiGet<CostSummaryResponse>(
        `/api/cost-events/summary?period=${period}`,
      ),
    staleTime: 60_000,
    select: (data) => ({
      ...data,
      daily: fillDateGaps(data.daily, PERIOD_DAYS[period]),
    }),
  });
}
