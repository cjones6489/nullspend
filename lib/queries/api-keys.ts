import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { apiGet, apiPost, apiDelete } from "@/lib/api/client";
import type {
  ApiKeyRecord,
  CreateApiKeyResponse,
} from "@/lib/validations/api-keys";

interface ListApiKeysResponse {
  data: ApiKeyRecord[];
}

interface DeleteApiKeyResponse {
  id: string;
  revokedAt: string;
}

export const apiKeyKeys = {
  all: ["apiKeys"] as const,
  list: () => [...apiKeyKeys.all, "list"] as const,
};

export function useApiKeys() {
  return useQuery<ListApiKeysResponse>({
    queryKey: apiKeyKeys.list(),
    queryFn: () => apiGet("/api/keys"),
  });
}

export function useCreateApiKey() {
  const queryClient = useQueryClient();

  return useMutation<CreateApiKeyResponse, Error, { name: string; defaultTags?: Record<string, string>; allowedModels?: string[]; allowedProviders?: string[] }>({
    mutationFn: async (input) => {
      const res = await apiPost<{ data: CreateApiKeyResponse }>("/api/keys", input);
      return res.data;
    },
    onSuccess: (createdKey) => {
      queryClient.setQueryData<ListApiKeysResponse | undefined>(
        apiKeyKeys.list(),
        (existing) => ({
          data: [
            {
              id: createdKey.id,
              name: createdKey.name,
              keyPrefix: createdKey.keyPrefix,
              defaultTags: createdKey.defaultTags,
              allowedModels: createdKey.allowedModels,
              allowedProviders: createdKey.allowedProviders,
              lastUsedAt: null,
              createdAt: createdKey.createdAt,
            },
            ...(existing?.data ?? []),
          ],
        }),
      );
      queryClient.invalidateQueries({ queryKey: apiKeyKeys.all });
    },
  });
}

export function useRevokeApiKey() {
  const queryClient = useQueryClient();

  return useMutation<DeleteApiKeyResponse, Error, string>({
    mutationFn: (id) => apiDelete(`/api/keys/${id}`),
    onSuccess: (_, revokedId) => {
      queryClient.setQueryData<ListApiKeysResponse | undefined>(
        apiKeyKeys.list(),
        (existing) =>
          existing
            ? {
                data: existing.data.filter((key) => key.id !== revokedId),
              }
            : existing,
      );
      queryClient.invalidateQueries({ queryKey: apiKeyKeys.all });
    },
  });
}
