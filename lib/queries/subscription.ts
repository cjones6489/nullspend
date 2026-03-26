"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiGet, apiPost } from "@/lib/api/client";
import type { SubscriptionResponse } from "@/lib/validations/subscription";

export function useSubscription() {
  return useQuery({
    queryKey: ["subscription"],
    queryFn: async () => {
      const res = await apiGet<{ data: SubscriptionResponse | null }>("/api/stripe/subscription");
      return res.data;
    },
  });
}

export function useCheckout() {
  return useMutation({
    mutationFn: (priceId: string) =>
      apiPost<{ url: string }>("/api/stripe/checkout", { priceId }),
    onSuccess: (data) => {
      window.location.href = data.url;
    },
  });
}

export function usePortalSession() {
  return useMutation({
    mutationFn: () => apiPost<{ url: string }>("/api/stripe/portal"),
    onSuccess: (data) => {
      window.location.href = data.url;
    },
  });
}

export function useSyncCheckout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (sessionId: string) => {
      const res = await apiPost<{ data: SubscriptionResponse }>(
        "/api/stripe/subscription/sync",
        { sessionId },
      );
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["subscription"] });
    },
  });
}
