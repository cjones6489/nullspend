"use client";

import { useState } from "react";
import { Building2, ShieldAlert, User } from "lucide-react";
import { toast } from "sonner";

import { useSession } from "@/lib/queries/session";
import { useOrgs } from "@/lib/queries/orgs";
import { useMembers, useTransferOwnership } from "@/lib/queries/members";
import { apiPatch } from "@/lib/api/client";
import { toExternalId } from "@/lib/ids/prefixed-id";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

export function GeneralSection() {
  const { data: session, isLoading: sessionLoading } = useSession();
  const { data: orgsData, isLoading: orgsLoading } = useOrgs();

  const currentOrg = orgsData?.data.find((o) => o.id === session?.orgId);
  const isPersonal = currentOrg?.isPersonal ?? true;
  const isOwnerOrAdmin =
    currentOrg?.role === "owner" || currentOrg?.role === "admin";

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [saving, setSaving] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // Initialize form values once data loads
  if (currentOrg && !initialized) {
    setName(currentOrg.name);
    setSlug(currentOrg.slug);
    setInitialized(true);
  }

  async function handleSave() {
    if (!session?.orgId || isPersonal) return;
    setSaving(true);

    try {
      const orgExternalId = toExternalId("org", session.orgId);
      await apiPatch(`/api/orgs/${orgExternalId}`, {
        ...(name !== currentOrg?.name && { name: name.trim() }),
        ...(slug !== currentOrg?.slug && { slug: slug.trim() }),
      });
      toast.success("Organization updated");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update organization",
      );
    } finally {
      setSaving(false);
    }
  }

  const hasChanges =
    currentOrg &&
    (name.trim() !== currentOrg.name || slug.trim() !== currentOrg.slug);

  if (sessionLoading || orgsLoading) {
    return (
      <Card className="border-border/50 bg-card">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-foreground">
            Organization
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <Skeleton className="h-9 w-full rounded-lg bg-secondary/50" />
            <Skeleton className="h-9 w-full rounded-lg bg-secondary/50" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/50 bg-card">
      <CardHeader className="flex flex-row items-center justify-between pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            {isPersonal ? (
              <User className="h-4 w-4 text-primary" />
            ) : (
              <Building2 className="h-4 w-4 text-primary" />
            )}
          </div>
          <div>
            <CardTitle className="text-sm font-medium text-foreground">
              {currentOrg?.name ?? "Organization"}
            </CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {isPersonal ? "Personal workspace" : currentOrg?.slug}
            </p>
          </div>
        </div>
        <Badge variant="secondary" className="text-[10px]">
          {currentOrg?.role ?? "owner"}
        </Badge>
      </CardHeader>

      <CardContent className="space-y-4">
        {isPersonal ? (
          <p className="text-xs text-muted-foreground">
            Your personal organization is automatically managed. Create a team
            organization from the sidebar switcher to collaborate with others.
          </p>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={!isOwnerOrAdmin}
                className="h-9 border-border/50 bg-background text-[13px]"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Slug</Label>
              <Input
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                disabled={!isOwnerOrAdmin}
                className="h-9 border-border/50 bg-background font-mono text-[13px]"
              />
              <p className="text-[11px] text-muted-foreground">
                Lowercase letters, numbers, and hyphens only.
              </p>
            </div>
            {isOwnerOrAdmin && (
              <Button
                size="sm"
                onClick={handleSave}
                disabled={!hasChanges || saving}
              >
                {saving ? "Saving..." : "Save changes"}
              </Button>
            )}

            {currentOrg?.role === "owner" && (
              <TransferOwnershipSection orgId={session!.orgId} currentUserId={session!.userId} />
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Transfer ownership
// ---------------------------------------------------------------------------

function TransferOwnershipSection({ orgId, currentUserId }: { orgId: string; currentUserId: string }) {
  const { data: membersData } = useMembers(orgId);
  const { data: orgsData } = useOrgs();
  const transfer = useTransferOwnership(orgId);
  const [open, setOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [confirmText, setConfirmText] = useState("");

  const currentOrg = orgsData?.data.find((o) => o.id === orgId);
  const orgName = currentOrg?.name ?? "";

  // Exclude self and viewers — only admins and members are eligible transfer targets
  const eligibleMembers = (membersData?.data ?? []).filter(
    (m) => m.userId !== currentUserId && m.role !== "viewer",
  );

  const confirmWord = orgName.trim() || "TRANSFER";
  const confirmMatch = confirmText.trim().toLowerCase() === confirmWord.toLowerCase();

  function handleTransfer() {
    if (!selectedUserId || !confirmMatch) return;
    transfer.mutate(selectedUserId, {
      onSuccess: () => {
        setOpen(false);
        setSelectedUserId("");
        setConfirmText("");
        toast.success("Ownership transferred. You are now an admin.");
      },
      onError: (err) => {
        toast.error(err.message || "Failed to transfer ownership");
      },
    });
  }

  function handleOpenChange(next: boolean) {
    if (transfer.isPending) return;
    setOpen(next);
    if (!next) {
      setSelectedUserId("");
      setConfirmText("");
    }
  }

  return (
    <div className="border-t border-border/30 pt-4 mt-4">
      <div className="flex items-start gap-3">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
        <div className="flex-1">
          <p className="text-xs font-medium text-foreground">
            Transfer ownership
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Transfer this organization to another member. You will be demoted to admin.
          </p>
        </div>
        <Dialog open={open} onOpenChange={handleOpenChange}>
          <DialogTrigger
            className="inline-flex h-8 items-center justify-center rounded-md border border-border/50 bg-secondary px-3 text-xs font-medium text-foreground transition-colors hover:bg-accent"
          >
            Transfer
          </DialogTrigger>
          <DialogContent>
            <DialogTitle>Transfer ownership</DialogTitle>
            <DialogDescription>
              This will make the selected member the organization owner.
              You will be demoted to admin. This action cannot be undone from the dashboard.
            </DialogDescription>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">New owner</Label>
                {eligibleMembers.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No eligible members to transfer to. Only admins and members are eligible. Invite a member first.
                  </p>
                ) : (
                  <Select value={selectedUserId} onValueChange={(v) => setSelectedUserId(v ?? "")}>
                    <SelectTrigger className="h-9 border-border/50 bg-background text-[13px]">
                      <SelectValue placeholder="Select a member" />
                    </SelectTrigger>
                    <SelectContent>
                      {eligibleMembers.map((m) => (
                        <SelectItem key={m.userId} value={m.userId} className="text-[13px]">
                          <span className="font-mono text-[12px]">{m.userId.slice(0, 8)}...</span>
                          <span className="ml-2 text-[11px] text-muted-foreground">
                            ({m.role})
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              {selectedUserId && (
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">
                    Type <span className="font-medium text-foreground">{confirmWord}</span> to confirm
                  </Label>
                  <Input
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder={confirmWord}
                    className="h-9 border-border/50 bg-background text-[13px]"
                    autoComplete="off"
                  />
                </div>
              )}
            </div>
            <DialogFooter>
              <DialogClose
                className="inline-flex h-8 items-center justify-center rounded-md border border-border/50 bg-secondary px-3 text-xs font-medium text-foreground hover:bg-accent"
                disabled={transfer.isPending}
              >
                Cancel
              </DialogClose>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleTransfer}
                disabled={!selectedUserId || !confirmMatch || transfer.isPending}
              >
                {transfer.isPending ? "Transferring..." : "Transfer Ownership"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
