import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { apiDelete, apiGet, apiPost } from "@/lib/api/client";
import type { SlackConfigInput, SlackConfigRecord } from "@/lib/validations/slack";

interface SlackConfigResponse {
  data: SlackConfigRecord | null;
}

export const slackKeys = {
  all: ["slack"] as const,
  config: () => [...slackKeys.all, "config"] as const,
};

export function useSlackConfig() {
  return useQuery<SlackConfigResponse>({
    queryKey: slackKeys.config(),
    queryFn: () => apiGet("/api/slack/config"),
  });
}

export function useSaveSlackConfig() {
  const queryClient = useQueryClient();

  return useMutation<{ data: SlackConfigRecord }, Error, SlackConfigInput>({
    mutationFn: (input) => apiPost("/api/slack/config", input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: slackKeys.all });
    },
  });
}

export function useDeleteSlackConfig() {
  const queryClient = useQueryClient();

  return useMutation<{ success: boolean }, Error, void>({
    mutationFn: () => apiDelete("/api/slack/config"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: slackKeys.all });
    },
  });
}

export function useTestSlackNotification() {
  return useMutation<{ success: boolean }, Error, void>({
    mutationFn: () => apiPost("/api/slack/test"),
  });
}
