import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

import { apiGet } from "@/lib/api/client";
import type { CostEventRecord } from "@/lib/validations/cost-events";

interface CostEventsPage {
  data: CostEventRecord[];
  cursor: { createdAt: string; id: string } | null;
}

interface CostEventFilters {
  apiKeyId?: string;
  provider?: string;
  source?: "proxy" | "api" | "mcp";
}

export const costEventKeys = {
  all: ["cost-events"] as const,
  lists: () => [...costEventKeys.all, "list"] as const,
  list: (filters: CostEventFilters = {}) =>
    [...costEventKeys.lists(), filters] as const,
  actionCosts: (actionId: string) =>
    [...costEventKeys.all, "action", actionId] as const,
};

export function useActionCosts(actionId: string) {
  return useQuery<{ data: CostEventRecord[] }>({
    queryKey: costEventKeys.actionCosts(actionId),
    queryFn: () => apiGet(`/api/actions/${actionId}/costs`),
    enabled: !!actionId,
  });
}

export function useCostEvents(filters: CostEventFilters = {}) {
  return useInfiniteQuery({
    queryKey: costEventKeys.list(filters),
    queryFn: ({ pageParam }): Promise<CostEventsPage> => {
      const params = new URLSearchParams();
      params.set("limit", "25");
      if (filters.apiKeyId) params.set("apiKeyId", filters.apiKeyId);
      if (filters.provider) params.set("provider", filters.provider);
      if (filters.source) params.set("source", filters.source);
      if (pageParam) params.set("cursor", JSON.stringify(pageParam));
      return apiGet(`/api/cost-events?${params.toString()}`);
    },
    getNextPageParam: (lastPage) => lastPage.cursor ?? undefined,
    initialPageParam: undefined as
      | { createdAt: string; id: string }
      | undefined,
  });
}
