"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api/client";
import { toExternalId } from "@/lib/ids/prefixed-id";
import type { OrgRole } from "@/lib/validations/orgs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MemberRecord {
  userId: string;
  role: OrgRole;
  createdAt: string;
}

interface InvitationRecord {
  id: string;
  email: string;
  role: string;
  status: string;
  invitedBy: string;
  tokenPrefix: string;
  expiresAt: string;
  createdAt: string;
  token?: string;
}

interface MembersResponse {
  data: MemberRecord[];
}

interface InvitationsResponse {
  data: InvitationRecord[];
}

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const memberKeys = {
  all: (orgId: string) => ["members", orgId] as const,
  list: (orgId: string) => [...memberKeys.all(orgId), "list"] as const,
};

export const invitationKeys = {
  all: (orgId: string) => ["invitations", orgId] as const,
  list: (orgId: string) => [...invitationKeys.all(orgId), "list"] as const,
};

function orgPath(orgId: string) {
  return `/api/orgs/${toExternalId("org", orgId)}`;
}

// ---------------------------------------------------------------------------
// Read hooks
// ---------------------------------------------------------------------------

export function useMembers(orgId: string | undefined) {
  return useQuery<MembersResponse>({
    queryKey: memberKeys.list(orgId ?? ""),
    queryFn: () => apiGet(`${orgPath(orgId!)}/members`),
    enabled: !!orgId,
  });
}

export function useInvitations(orgId: string | undefined) {
  return useQuery<InvitationsResponse>({
    queryKey: invitationKeys.list(orgId ?? ""),
    queryFn: () => apiGet(`${orgPath(orgId!)}/invitations`),
    enabled: !!orgId,
  });
}

// ---------------------------------------------------------------------------
// Mutation hooks
// ---------------------------------------------------------------------------

export function useInviteMember(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation<InvitationRecord & { token: string }, Error, { email: string; role: string }>({
    mutationFn: (input) => apiPost(`${orgPath(orgId)}/invitations`, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: invitationKeys.all(orgId) });
      queryClient.invalidateQueries({ queryKey: memberKeys.all(orgId) });
    },
  });
}

export function useChangeRole(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation<{ data: MemberRecord }, Error, { userId: string; role: string }>({
    mutationFn: ({ userId, role }) =>
      apiPatch(`${orgPath(orgId)}/members/${userId}`, { role }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: memberKeys.all(orgId) });
    },
  });
}

export function useRemoveMember(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation<{ success: boolean }, Error, string>({
    mutationFn: (userId) => apiDelete(`${orgPath(orgId)}/members/${userId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: memberKeys.all(orgId) });
    },
  });
}

export function useRevokeInvitation(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation<{ success: boolean }, Error, string>({
    mutationFn: (invitationId) =>
      apiDelete(`${orgPath(orgId)}/invitations/${invitationId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: invitationKeys.all(orgId) });
    },
  });
}
