"use client";

import { useQuery } from "@tanstack/react-query";

import { apiGet } from "@/lib/api/client";
import type { OrgRole } from "@/lib/validations/orgs";

interface SessionInfo {
  userId: string;
  orgId: string;
  role: OrgRole;
}

export const sessionKeys = {
  current: ["session"] as const,
};

export function useSession() {
  return useQuery<SessionInfo>({
    queryKey: sessionKeys.current,
    queryFn: () => apiGet("/api/auth/session"),
    staleTime: 60_000,
  });
}
