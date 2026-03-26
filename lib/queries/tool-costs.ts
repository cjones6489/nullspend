import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { apiGet, apiPost, apiDelete } from "@/lib/api/client";
import type { UpsertToolCostInput, ToolCostResponse } from "@/lib/validations/tool-costs";

interface ListToolCostsResponse {
  data: ToolCostResponse[];
}

interface DeleteToolCostResponse {
  deleted: boolean;
}

export const toolCostKeys = {
  all: ["tool-costs"] as const,
  list: () => [...toolCostKeys.all, "list"] as const,
};

export function useToolCosts() {
  return useQuery<ListToolCostsResponse>({
    queryKey: toolCostKeys.list(),
    queryFn: () => apiGet("/api/tool-costs"),
  });
}

export function useUpsertToolCost() {
  const queryClient = useQueryClient();

  return useMutation<ToolCostResponse, Error, UpsertToolCostInput>({
    mutationFn: async (input) => {
      const res = await apiPost<{ data: ToolCostResponse }>("/api/tool-costs", input);
      return res.data;
    },
    onSuccess: (created) => {
      queryClient.setQueryData<ListToolCostsResponse | undefined>(
        toolCostKeys.list(),
        (existing) => ({
          data: [
            created,
            ...(existing?.data ?? []).filter((tc) => tc.id !== created.id),
          ],
        }),
      );
      queryClient.invalidateQueries({ queryKey: toolCostKeys.all });
    },
  });
}

export function useDeleteToolCost() {
  const queryClient = useQueryClient();

  return useMutation<DeleteToolCostResponse, Error, string>({
    mutationFn: (id) => apiDelete(`/api/tool-costs/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: toolCostKeys.all });
    },
  });
}
