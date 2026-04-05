import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiDelete, apiGet, apiPost } from "@/lib/api/client";

export const marginKeys = {
  all: ["margins"] as const,
  table: (period: string) => [...marginKeys.all, "table", period] as const,
  detail: (customer: string, period: string) => [...marginKeys.all, "detail", customer, period] as const,
  connection: () => [...marginKeys.all, "connection"] as const,
  mappings: () => [...marginKeys.all, "mappings"] as const,
};

export function useMarginTable(period: string) {
  return useQuery({
    queryKey: marginKeys.table(period),
    queryFn: () => apiGet<{ data: MarginTableResponse }>(`/api/margins?period=${period}`).then((r) => r.data),
    staleTime: 120_000,
  });
}

export function useCustomerDetail(customer: string, period: string) {
  return useQuery({
    queryKey: marginKeys.detail(customer, period),
    queryFn: () =>
      apiGet<{ data: CustomerDetailResponse }>(
        `/api/margins/${encodeURIComponent(customer)}?period=${period}`,
      ).then((r) => r.data),
    staleTime: 120_000,
  });
}

export function useStripeConnection() {
  return useQuery({
    queryKey: marginKeys.connection(),
    queryFn: () => apiGet<{ data: StripeConnectionResponse | null }>("/api/stripe/connect").then((r) => r.data),
    staleTime: 300_000,
    retry: false,
  });
}

export function useCustomerMappings() {
  return useQuery({
    queryKey: marginKeys.mappings(),
    queryFn: () => apiGet<{ data: CustomerMappingResponse[] }>("/api/customer-mappings").then((r) => r.data),
    staleTime: 120_000,
  });
}

export function useConnectStripe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (stripeKey: string) => apiPost("/api/stripe/connect", { stripeKey }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: marginKeys.connection() });
    },
  });
}

export function useDisconnectStripe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiDelete("/api/stripe/disconnect"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: marginKeys.all });
    },
  });
}

export function useSyncNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiGet("/api/stripe/revenue-sync"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: marginKeys.all });
    },
  });
}

export function useCreateMapping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { stripeCustomerId: string; tagValue: string }) =>
      apiPost("/api/customer-mappings", { ...data, matchType: "manual" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: marginKeys.all });
    },
  });
}

export function useDeleteMapping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/api/customer-mappings?id=${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: marginKeys.all });
    },
  });
}

// ── Response types ───────────────────────────────────────────────────

export type HealthTier = "healthy" | "moderate" | "at_risk" | "critical";

export interface CustomerMarginResponse {
  stripeCustomerId: string;
  customerName: string | null;
  avatarUrl: string | null;
  tagValue: string;
  revenueMicrodollars: number;
  costMicrodollars: number;
  marginMicrodollars: number;
  marginPercent: number;
  healthTier: HealthTier;
  sparkline: { period: string; marginPercent: number }[];
  budgetSuggestionMicrodollars: number | null;
}

export interface MarginSummaryResponse {
  blendedMarginPercent: number;
  totalRevenueMicrodollars: number;
  totalCostMicrodollars: number;
  criticalCount: number;
  atRiskCount: number;
  lastSyncAt: string | null;
  syncStatus: string;
}

export interface MarginTableResponse {
  summary: MarginSummaryResponse;
  customers: CustomerMarginResponse[];
}

export interface CustomerDetailResponse {
  stripeCustomerId: string;
  customerName: string | null;
  avatarUrl: string | null;
  tagValue: string;
  healthTier: HealthTier;
  marginPercent: number;
  revenueMicrodollars: number;
  costMicrodollars: number;
  revenueOverTime: { period: string; revenue: number; cost: number }[];
  modelBreakdown: { model: string; cost: number; requestCount: number }[];
}

export interface StripeConnectionResponse {
  id: string;
  keyPrefix: string;
  status: string;
  createdAt: string;
}

export interface CustomerMappingResponse {
  id: string;
  orgId: string;
  stripeCustomerId: string;
  tagKey: string;
  tagValue: string;
  matchType: string;
  confidence: number | null;
  createdAt: string;
}
