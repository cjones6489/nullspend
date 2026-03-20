import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { apiGet, apiPost, apiDelete } from "@/lib/api/client";
import { createBrowserSupabaseClient } from "@/lib/auth/supabase-browser";
import type { CreateBudgetInput } from "@/lib/validations/budgets";

interface BudgetRecord {
  id: string;
  entityType: string;
  entityId: string;
  maxBudgetMicrodollars: number;
  spendMicrodollars: number;
  policy: string;
  resetInterval: string | null;
  currentPeriodStart: string | null;
  createdAt: string;
  updatedAt: string;
  thresholdPercentages: number[];
  velocityLimitMicrodollars: number | null;
  velocityWindowSeconds: number | null;
  velocityCooldownSeconds: number | null;
  sessionLimitMicrodollars: number | null;
}

interface ListBudgetsResponse {
  data: BudgetRecord[];
}

interface DeleteBudgetResponse {
  deleted: boolean;
}

export const budgetKeys = {
  all: ["budgets"] as const,
  list: () => [...budgetKeys.all, "list"] as const,
};

export function useCurrentUserId() {
  return useQuery<string | null>({
    queryKey: ["currentUserId"],
    queryFn: async () => {
      const supabase = createBrowserSupabaseClient();
      const { data } = await supabase.auth.getUser();
      return data.user?.id ?? null;
    },
    staleTime: Infinity,
  });
}

export function useBudgets() {
  return useQuery<ListBudgetsResponse>({
    queryKey: budgetKeys.list(),
    queryFn: () => apiGet("/api/budgets"),
  });
}

export function useCreateBudget() {
  const queryClient = useQueryClient();

  return useMutation<BudgetRecord, Error, CreateBudgetInput>({
    mutationFn: (input) => apiPost("/api/budgets", input),
    onSuccess: (created) => {
      queryClient.setQueryData<ListBudgetsResponse | undefined>(
        budgetKeys.list(),
        (existing) => ({
          data: [
            {
              ...created,
              currentPeriodStart: created.currentPeriodStart ?? null,
            },
            ...(existing?.data ?? []).filter((b) => b.id !== created.id),
          ],
        }),
      );
      queryClient.invalidateQueries({ queryKey: budgetKeys.all });
    },
  });
}

export function useResetBudget() {
  const queryClient = useQueryClient();

  return useMutation<BudgetRecord, Error, string>({
    mutationFn: (id) => apiPost(`/api/budgets/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: budgetKeys.all });
    },
  });
}

// SYNC: VelocityState interface in apps/proxy/src/durable-objects/user-budget.ts
export interface VelocityStateEntry {
  entity_key: string;
  window_size_ms: number;
  window_start_ms: number;
  current_count: number;
  current_spend: number;
  prev_count: number;
  prev_spend: number;
  tripped_at: number | null;
}

interface VelocityStatusResponse {
  velocityState: VelocityStateEntry[];
}

export const velocityStatusKeys = {
  all: ["velocityStatus"] as const,
};

export function useVelocityStatus(enabled: boolean = true) {
  return useQuery<VelocityStatusResponse>({
    queryKey: velocityStatusKeys.all,
    queryFn: () => apiGet("/api/budgets/velocity-status"),
    enabled,
    refetchInterval: enabled ? 10_000 : false,
    refetchIntervalInBackground: false,
    staleTime: 5_000,
  });
}

export function useDeleteBudget() {
  const queryClient = useQueryClient();

  return useMutation<DeleteBudgetResponse, Error, string>({
    mutationFn: (id) => apiDelete(`/api/budgets/${id}`),
    onSuccess: (_, deletedId) => {
      queryClient.setQueryData<ListBudgetsResponse | undefined>(
        budgetKeys.list(),
        (existing) =>
          existing
            ? { data: existing.data.filter((b) => b.id !== deletedId) }
            : existing,
      );
      queryClient.invalidateQueries({ queryKey: budgetKeys.all });
    },
  });
}
