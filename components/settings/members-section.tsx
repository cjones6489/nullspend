"use client";

import { useState } from "react";
import { Users, UserMinus, Shield, Clock } from "lucide-react";
import { toast } from "sonner";

import { useSession } from "@/lib/queries/session";
import {
  useMembers,
  useInvitations,
  useInviteMember,
  useChangeRole,
  useRemoveMember,
  useRevokeInvitation,
} from "@/lib/queries/members";
import { ASSIGNABLE_ROLES, type OrgRole } from "@/lib/validations/orgs";
import { formatRelativeTime, formatExpiresAt } from "@/lib/utils/format";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// ---------------------------------------------------------------------------
// Role badge
// ---------------------------------------------------------------------------

const ROLE_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  owner: "default",
  admin: "secondary",
  member: "outline",
  viewer: "outline",
};

function RoleBadge({ role }: { role: string }) {
  return (
    <Badge variant={ROLE_VARIANT[role] ?? "outline"} className="text-[10px]">
      {role}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Invite form
// ---------------------------------------------------------------------------

function InviteForm({ orgId }: { orgId: string }) {
  const invite = useInviteMember(orgId);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("member");

  function handleInvite() {
    if (!email.trim()) return;
    invite.mutate(
      { email: email.trim(), role },
      {
        onSuccess: () => {
          toast.success(`Invitation sent to ${email}`);
          setEmail("");
          setRole("member");
        },
        onError: (err) => {
          toast.error(err.message || "Failed to send invitation");
        },
      },
    );
  }

  return (
    <div className="flex items-end gap-3">
      <div className="flex-1 space-y-1.5">
        <Label className="text-xs text-muted-foreground">Email</Label>
        <Input
          type="email"
          placeholder="colleague@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="h-9 border-border/50 bg-background text-[13px] placeholder:text-muted-foreground/50"
          onKeyDown={(e) => e.key === "Enter" && handleInvite()}
        />
      </div>
      <div className="w-32 space-y-1.5">
        <Label className="text-xs text-muted-foreground">Role</Label>
        <Select value={role} onValueChange={(v) => v && setRole(v)}>
          <SelectTrigger className="h-9 border-border/50 bg-background text-[13px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ASSIGNABLE_ROLES.map((r) => (
              <SelectItem key={r} value={r} className="text-[13px]">
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button
        size="sm"
        onClick={handleInvite}
        disabled={!email.trim() || invite.isPending}
        className="h-9"
      >
        {invite.isPending ? "Sending..." : "Invite"}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Member table
// ---------------------------------------------------------------------------

function MemberRow({
  member,
  orgId,
  sessionUserId,
  sessionRole,
}: {
  member: { userId: string; email?: string | null; role: string; createdAt: string };
  orgId: string;
  sessionUserId: string;
  sessionRole: OrgRole;
}) {
  const changeRole = useChangeRole(orgId);
  const removeMember = useRemoveMember(orgId);
  const [removeOpen, setRemoveOpen] = useState(false);

  const isOwner = member.role === "owner";
  const isSelf = member.userId === sessionUserId;
  const canManage =
    (sessionRole === "owner" || sessionRole === "admin") && !isOwner && !isSelf;
  // Admins can't manage other admins
  const canChangeRole = canManage && !(sessionRole === "admin" && member.role === "admin");

  function handleRoleChange(newRole: string) {
    changeRole.mutate(
      { userId: member.userId, role: newRole },
      {
        onSuccess: () => toast.success("Role updated"),
        onError: (err) => toast.error(err.message || "Failed to update role"),
      },
    );
  }

  function handleRemove() {
    removeMember.mutate(member.userId, {
      onSuccess: () => {
        setRemoveOpen(false);
        toast.success("Member removed");
      },
      onError: (err) => toast.error(err.message || "Failed to remove member"),
    });
  }

  return (
    <TableRow className="border-border/30 transition-colors hover:bg-accent/40">
      <TableCell className="text-[13px] font-medium text-foreground">
        {member.email || member.userId}
        {isSelf && (
          <span className="ml-2 text-[10px] text-muted-foreground">(you)</span>
        )}
      </TableCell>
      <TableCell>
        {canChangeRole ? (
          <DropdownMenu>
            <DropdownMenuTrigger>
              <RoleBadge role={member.role} />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {ASSIGNABLE_ROLES.filter((r) => r !== member.role).map((r) => (
                <DropdownMenuItem
                  key={r}
                  onClick={() => handleRoleChange(r)}
                  className="text-[13px]"
                >
                  Change to {r}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <RoleBadge role={member.role} />
        )}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {formatRelativeTime(member.createdAt)}
      </TableCell>
      <TableCell className="w-10">
        {canManage && (
          <Dialog open={removeOpen} onOpenChange={setRemoveOpen}>
            <DialogTrigger
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-400"
              aria-label="Remove member"
            >
              <UserMinus className="h-3.5 w-3.5" />
            </DialogTrigger>
            <DialogContent>
              <DialogTitle>Remove member?</DialogTitle>
              <DialogDescription>
                This will remove {member.userId} from the organization.
                They can be re-invited later.
              </DialogDescription>
              <DialogFooter>
                <DialogClose>Cancel</DialogClose>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleRemove}
                  disabled={removeMember.isPending}
                >
                  {removeMember.isPending ? "Removing..." : "Remove"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </TableCell>
    </TableRow>
  );
}

function MemberTable({
  members,
  orgId,
  sessionUserId,
  sessionRole,
}: {
  members: Array<{ userId: string; role: string; createdAt: string }>;
  orgId: string;
  sessionUserId: string;
  sessionRole: OrgRole;
}) {
  return (
    <div className="border-t border-border/30">
      <Table>
        <TableHeader>
          <TableRow className="border-border/30 hover:bg-transparent">
            <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              User
            </TableHead>
            <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Role
            </TableHead>
            <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Joined
            </TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((m) => (
            <MemberRow
              key={m.userId}
              member={m}
              orgId={orgId}
              sessionUserId={sessionUserId}
              sessionRole={sessionRole}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pending invitations table
// ---------------------------------------------------------------------------

function InvitationRow({
  invitation,
  orgId,
}: {
  invitation: {
    id: string;
    email: string;
    role: string;
    expiresAt: string;
    createdAt: string;
  };
  orgId: string;
}) {
  const revoke = useRevokeInvitation(orgId);
  const [revokeOpen, setRevokeOpen] = useState(false);

  function handleRevoke() {
    revoke.mutate(invitation.id, {
      onSuccess: () => {
        setRevokeOpen(false);
        toast.success("Invitation revoked");
      },
      onError: (err) => toast.error(err.message || "Failed to revoke"),
    });
  }

  return (
    <TableRow className="border-border/30 transition-colors hover:bg-accent/40">
      <TableCell className="text-[13px] font-medium text-foreground">
        {invitation.email}
      </TableCell>
      <TableCell>
        <RoleBadge role={invitation.role} />
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        <Clock className="mr-1 inline h-3 w-3" />
        {formatExpiresAt(invitation.expiresAt) ?? "No expiry"}
      </TableCell>
      <TableCell className="w-10">
        <Dialog open={revokeOpen} onOpenChange={setRevokeOpen}>
          <DialogTrigger
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-400"
            aria-label="Revoke invitation"
          >
            <UserMinus className="h-3.5 w-3.5" />
          </DialogTrigger>
          <DialogContent>
            <DialogTitle>Revoke invitation?</DialogTitle>
            <DialogDescription>
              This will revoke the invitation sent to {invitation.email}.
            </DialogDescription>
            <DialogFooter>
              <DialogClose>Cancel</DialogClose>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleRevoke}
                disabled={revoke.isPending}
              >
                {revoke.isPending ? "Revoking..." : "Revoke"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </TableCell>
    </TableRow>
  );
}

function PendingInvitesTable({
  invitations,
  orgId,
}: {
  invitations: Array<{
    id: string;
    email: string;
    role: string;
    expiresAt: string;
    createdAt: string;
  }>;
  orgId: string;
}) {
  if (invitations.length === 0) return null;

  return (
    <div className="mt-6">
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Pending Invitations
      </h3>
      <div className="rounded-lg border border-border/30">
        <Table>
          <TableBody>
            {invitations.map((inv) => (
              <InvitationRow key={inv.id} invitation={inv} orgId={orgId} />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty + loading states
// ---------------------------------------------------------------------------

function EmptyMembers() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 border-t border-border/30 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary/50">
        <Users className="h-5 w-5 text-muted-foreground" />
      </div>
      <div>
        <p className="text-sm font-medium text-foreground">No team members yet</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Invite colleagues to collaborate on budgets and cost tracking.
        </p>
      </div>
    </div>
  );
}

function MembersSkeleton() {
  return (
    <div className="space-y-2 border-t border-border/30 p-4">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full rounded-lg bg-secondary/50" />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main section
// ---------------------------------------------------------------------------

export function MembersSection() {
  const { data: session, isLoading: sessionLoading } = useSession();
  const orgId = session?.orgId;
  const sessionRole = session?.role ?? "viewer";

  const { data: membersData, isLoading: membersLoading, error: membersError } = useMembers(orgId);
  const { data: invitationsData } = useInvitations(
    sessionRole === "admin" || sessionRole === "owner" ? orgId : undefined,
  );

  const isAdmin = sessionRole === "owner" || sessionRole === "admin";

  if (sessionLoading) {
    return (
      <Card className="border-border/50 bg-card">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-foreground">Members</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <MembersSkeleton />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="border-border/50 bg-card">
        <CardHeader className="flex flex-row items-center justify-between pb-4">
          <div>
            <CardTitle className="text-sm font-medium text-foreground">Members</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Manage who has access to this organization.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              {membersData?.data.length ?? 0} {(membersData?.data.length ?? 0) === 1 ? "member" : "members"}
            </span>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {isAdmin && orgId && (
            <div className="border-t border-border/30 px-4 py-4">
              <InviteForm orgId={orgId} />
            </div>
          )}

          {membersLoading && <MembersSkeleton />}

          {membersError && (
            <div className="m-4 rounded-lg border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-400">
              Failed to load members.
            </div>
          )}

          {membersData && membersData.data.length === 0 && <EmptyMembers />}

          {membersData && membersData.data.length > 0 && orgId && session && (
            <MemberTable
              members={membersData.data}
              orgId={orgId}
              sessionUserId={session.userId}
              sessionRole={sessionRole as OrgRole}
            />
          )}
        </CardContent>
      </Card>

      {isAdmin && orgId && invitationsData && invitationsData.data.length > 0 && (
        <PendingInvitesTable invitations={invitationsData.data} orgId={orgId} />
      )}
    </div>
  );
}
