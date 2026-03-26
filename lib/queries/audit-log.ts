"use client";

import { useInfiniteQuery } from "@tanstack/react-query";

import { apiGet } from "@/lib/api/client";

export interface AuditEventRecord {
  id: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

interface AuditCursor {
  createdAt: string;
  id: string;
}

interface AuditLogPage {
  data: AuditEventRecord[];
  cursor: AuditCursor | null;
}

interface AuditLogFilters {
  action?: string;
}

export const auditLogKeys = {
  all: ["audit-log"] as const,
  list: (filters: AuditLogFilters = {}) =>
    [...auditLogKeys.all, "list", filters] as const,
};

export function useAuditLog(filters: AuditLogFilters = {}) {
  return useInfiniteQuery({
    queryKey: auditLogKeys.list(filters),
    queryFn: ({ pageParam }): Promise<AuditLogPage> => {
      const params = new URLSearchParams();
      params.set("limit", "50");
      if (filters.action) params.set("action", filters.action);
      if (pageParam) params.set("cursor", JSON.stringify(pageParam));
      return apiGet(`/api/audit-log?${params.toString()}`);
    },
    getNextPageParam: (lastPage) => lastPage.cursor ?? undefined,
    initialPageParam: undefined as AuditCursor | undefined,
  });
}
