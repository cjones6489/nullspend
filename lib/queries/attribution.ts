import { useQuery } from "@tanstack/react-query";

import { apiGet } from "@/lib/api/client";
import { costEventKeys } from "@/lib/queries/cost-events";
import type { AttributionResponse, AttributionDetailResponse } from "@/lib/validations/attribution";

export const attributionKeys = {
  all: [...costEventKeys.all, "attribution"] as const,
  list: (groupBy: string, period: string) => [...attributionKeys.all, "list", groupBy, period] as const,
  detail: (groupBy: string, key: string, period: string) => [...attributionKeys.all, "detail", groupBy, key, period] as const,
  tagKeys: () => [...attributionKeys.all, "tag-keys"] as const,
};

export function useAttribution(groupBy: string, period: "7d" | "30d" | "90d") {
  return useQuery({
    queryKey: attributionKeys.list(groupBy, period),
    queryFn: async () => {
      const res = await apiGet<{ data: AttributionResponse }>(
        `/api/cost-events/attribution?groupBy=${encodeURIComponent(groupBy)}&period=${period}`,
      );
      return res.data;
    },
    staleTime: 60_000,
  });
}

export function useAttributionDetail(groupBy: string, key: string, period: "7d" | "30d" | "90d") {
  return useQuery({
    queryKey: attributionKeys.detail(groupBy, key, period),
    queryFn: async () => {
      const res = await apiGet<{ data: AttributionDetailResponse }>(
        `/api/cost-events/attribution/${encodeURIComponent(key)}?groupBy=${encodeURIComponent(groupBy)}&period=${period}`,
      );
      return res.data;
    },
    staleTime: 60_000,
  });
}

export function useTagKeys() {
  return useQuery({
    queryKey: attributionKeys.tagKeys(),
    queryFn: async () => {
      const res = await apiGet<{ data: string[] }>("/api/cost-events/tag-keys");
      return res.data;
    },
    staleTime: 300_000,
  });
}
