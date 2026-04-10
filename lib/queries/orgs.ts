"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiGet, apiPost } from "@/lib/api/client";
import { sessionKeys } from "@/lib/queries/session";
import type { OrgRole } from "@/lib/validations/orgs";

interface OrgRecord {
  id: string;
  name: string;
  slug: string;
  isPersonal: boolean;
  role: OrgRole;
  createdAt: string;
  updatedAt: string;
}

interface OrgsResponse {
  data: OrgRecord[];
}

export const orgKeys = {
  all: ["orgs"] as const,
  list: () => [...orgKeys.all, "list"] as const,
};

export function useOrgs() {
  return useQuery<OrgsResponse>({
    queryKey: orgKeys.list(),
    queryFn: () => apiGet("/api/orgs"),
  });
}

export function useCreateOrg() {
  const queryClient = useQueryClient();
  return useMutation<OrgRecord, Error, { name: string; slug: string }>({
    mutationFn: (input) => apiPost("/api/orgs", input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orgKeys.all });
    },
  });
}

export function useSwitchOrg() {
  const queryClient = useQueryClient();
  return useMutation<{ userId: string; orgId: string; role: OrgRole }, Error, string>({
    mutationFn: (orgId) => apiPost("/api/auth/switch-org", { orgId }),
    onSuccess: () => {
      // Invalidate ALL queries — every data hook must re-fetch for the new org context.
      // Session/org keys alone aren't enough: budgets, keys, cost events, margins, etc.
      // all serve stale data from the previous org until invalidated.
      queryClient.invalidateQueries();
    },
  });
}
