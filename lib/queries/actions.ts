import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { apiGet, apiPost, retryOnServerError } from "@/lib/api/client";
import type { ActionRecord } from "@/lib/validations/actions";
import type { ActionStatus } from "@/lib/utils/status";

interface ActionCursor {
  createdAt: string;
  id: string;
}

interface ListActionsResponse {
  data: ActionRecord[];
  cursor: ActionCursor | null;
}

interface MutateActionResponse {
  id: string;
  status: ActionStatus;
  approvedAt?: string | null;
  rejectedAt?: string | null;
  executedAt?: string | null;
  budgetIncrease?: {
    previousLimit: number;
    newLimit: number;
    amount: number;
    requestedAmount: number;
  };
}

export const actionKeys = {
  all: ["actions"] as const,
  lists: () => [...actionKeys.all, "list"] as const,
  list: (status?: ActionStatus, limit = 50) =>
    [...actionKeys.lists(), status ?? "all", limit] as const,
  listInfinite: (status?: string, statuses?: string[]) =>
    [
      ...actionKeys.all,
      "list-infinite",
      status ?? "all",
      statuses?.join(",") ?? "none",
    ] as const,
  detail: (id: string) => [...actionKeys.all, "detail", id] as const,
};

export function useActions(status?: ActionStatus, limit = 50) {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  params.set("limit", String(limit));
  const qs = params.toString();

  return useQuery<ListActionsResponse>({
    queryKey: actionKeys.list(status, limit),
    queryFn: () => apiGet(`/api/actions?${qs}`),
    retry: retryOnServerError,
  });
}

export function useActionsInfinite(options: {
  status?: ActionStatus;
  statuses?: ActionStatus[];
  limit?: number;
}) {
  return useInfiniteQuery({
    queryKey: actionKeys.listInfinite(options.status, options.statuses),
    queryFn: ({ pageParam }): Promise<ListActionsResponse> => {
      const params = new URLSearchParams();
      if (options.status) params.set("status", options.status);
      if (options.statuses) params.set("statuses", options.statuses.join(","));
      params.set("limit", String(options.limit ?? 25));
      if (pageParam) params.set("cursor", JSON.stringify(pageParam));
      return apiGet(`/api/actions?${params.toString()}`);
    },
    getNextPageParam: (lastPage) => lastPage.cursor ?? undefined,
    initialPageParam: undefined as ActionCursor | undefined,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  });
}

export function useAction(id: string) {
  return useQuery<ActionRecord>({
    queryKey: actionKeys.detail(id),
    queryFn: async () => {
      const res = await apiGet<{ data: ActionRecord }>(`/api/actions/${id}`);
      return res.data;
    },
    enabled: !!id,
    retry: retryOnServerError,
  });
}

export interface ApproveActionInput {
  id: string;
  approvedAmountMicrodollars?: number;
}

export function useApproveAction() {
  const queryClient = useQueryClient();

  return useMutation<MutateActionResponse, Error, ApproveActionInput>({
    mutationFn: async ({ id, approvedAmountMicrodollars }) => {
      const body = approvedAmountMicrodollars != null
        ? { approvedAmountMicrodollars }
        : undefined;
      const res = await apiPost<{ data: MutateActionResponse }>(`/api/actions/${id}/approve`, body);
      return res.data;
    },
    onSuccess: (updatedAction, { id }) => {
      queryClient.setQueryData<ActionRecord | undefined>(
        actionKeys.detail(id),
        (existing) =>
          existing
            ? {
                ...existing,
                status: updatedAction.status,
                approvedAt: updatedAction.approvedAt ?? existing.approvedAt,
              }
            : existing,
      );
      queryClient.invalidateQueries({ queryKey: actionKeys.all });
    },
  });
}

export function useRejectAction() {
  const queryClient = useQueryClient();

  return useMutation<MutateActionResponse, Error, string>({
    mutationFn: async (id: string) => {
      const res = await apiPost<{ data: MutateActionResponse }>(`/api/actions/${id}/reject`);
      return res.data;
    },
    onSuccess: (updatedAction, id) => {
      queryClient.setQueryData<ActionRecord | undefined>(
        actionKeys.detail(id),
        (existing) =>
          existing
            ? {
                ...existing,
                status: updatedAction.status,
                rejectedAt: updatedAction.rejectedAt ?? existing.rejectedAt,
              }
            : existing,
      );
      queryClient.invalidateQueries({ queryKey: actionKeys.all });
    },
  });
}
