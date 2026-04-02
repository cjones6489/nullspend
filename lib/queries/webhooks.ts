import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { apiGet, apiPost, apiPatch, apiDelete, retryOnServerError } from "@/lib/api/client";
import type {
  WebhookRecord,
  CreateWebhookInput,
  UpdateWebhookInput,
} from "@/lib/validations/webhooks";

interface WebhookListResponse {
  data: WebhookRecord[];
}

interface WebhookCreateResponse {
  data: WebhookRecord & { signingSecret: string };
}

interface WebhookUpdateResponse {
  data: WebhookRecord;
}

interface WebhookTestResponse {
  success: boolean;
  statusCode: number | null;
  responsePreview: string | null;
}

interface WebhookRotateResponse {
  data: { signingSecret: string };
}

export const webhookKeys = {
  all: ["webhooks"] as const,
  list: () => [...webhookKeys.all, "list"] as const,
};

export function useWebhooks() {
  return useQuery<WebhookListResponse>({
    queryKey: webhookKeys.list(),
    queryFn: () => apiGet("/api/webhooks"),
    retry: retryOnServerError,
    staleTime: 60_000,
  });
}

export function useCreateWebhook() {
  const queryClient = useQueryClient();

  return useMutation<WebhookCreateResponse, Error, CreateWebhookInput>({
    mutationFn: (input) => apiPost("/api/webhooks", input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: webhookKeys.all });
    },
  });
}

export function useUpdateWebhook() {
  const queryClient = useQueryClient();

  return useMutation<
    WebhookUpdateResponse,
    Error,
    { id: string } & UpdateWebhookInput,
    { previous: WebhookListResponse | undefined }
  >({
    mutationFn: ({ id, ...body }) =>
      apiPatch(`/api/webhooks/${id}`, body),
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: webhookKeys.list() });
      const previous = queryClient.getQueryData<WebhookListResponse>(
        webhookKeys.list(),
      );
      if (previous) {
        queryClient.setQueryData<WebhookListResponse>(
          webhookKeys.list(),
          {
            data: previous.data.map((ep) =>
              ep.id === variables.id ? { ...ep, ...variables } : ep,
            ),
          },
        );
      }
      return { previous };
    },
    onError: (_err, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(webhookKeys.list(), context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: webhookKeys.all });
    },
  });
}

export function useDeleteWebhook() {
  const queryClient = useQueryClient();

  return useMutation<{ success: boolean }, Error, string>({
    mutationFn: (id) => apiDelete(`/api/webhooks/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: webhookKeys.all });
    },
  });
}

export function useTestWebhook() {
  return useMutation<WebhookTestResponse, Error, string>({
    mutationFn: (id) => apiPost(`/api/webhooks/${id}/test`),
  });
}

export function useRotateWebhookSecret() {
  const queryClient = useQueryClient();

  return useMutation<WebhookRotateResponse, Error, string>({
    mutationFn: (id) => apiPost(`/api/webhooks/${id}/rotate-secret`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: webhookKeys.all });
    },
  });
}
