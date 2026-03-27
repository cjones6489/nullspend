import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

import { apiGet, ApiError } from "@/lib/api/client";
import type { CostEventRecord } from "@/lib/validations/cost-events";

/** Only retry on server errors (5xx), not on 4xx (not found, bad request). */
function retryOnServerError(failureCount: number, error: Error): boolean {
  if (error instanceof ApiError && error.status < 500) return false;
  return failureCount < 2;
}

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
  detail: (id: string) => [...costEventKeys.all, "detail", id] as const,
  bodies: (id: string) => [...costEventKeys.all, "bodies", id] as const,
  session: (sessionId: string) => [...costEventKeys.all, "session", sessionId] as const,
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

export function useCostEvent(id: string) {
  return useQuery<{ data: CostEventRecord }>({
    queryKey: costEventKeys.detail(id),
    queryFn: () => apiGet(`/api/cost-events/${id}`),
    enabled: !!id,
    retry: retryOnServerError,
  });
}

interface CostEventBodies {
  data: {
    requestBody: Record<string, unknown> | null;
    responseBody: Record<string, unknown> | null;
  };
}

export function useCostEventBodies(id: string, enabled = true) {
  return useQuery<CostEventBodies>({
    queryKey: costEventKeys.bodies(id),
    queryFn: () => apiGet(`/api/cost-events/${id}/bodies`),
    enabled: !!id && enabled,
    retry: retryOnServerError,
  });
}

interface SessionResponse {
  sessionId: string;
  summary: {
    eventCount: number;
    totalCostMicrodollars: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalDurationMs: number;
    startedAt: string | null;
    endedAt: string | null;
  };
  events: CostEventRecord[];
}

export function useSession(sessionId: string) {
  return useQuery<SessionResponse>({
    queryKey: costEventKeys.session(sessionId),
    queryFn: () => apiGet(`/api/cost-events/sessions/${encodeURIComponent(sessionId)}`),
    enabled: !!sessionId,
    retry: retryOnServerError,
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
