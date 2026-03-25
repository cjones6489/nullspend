"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Check, ChevronsUpDown, Plus, User } from "lucide-react";
import { toast } from "sonner";

import { useSession } from "@/lib/queries/session";
import { useOrgs, useCreateOrg, useSwitchOrg } from "@/lib/queries/orgs";
import { fromExternalIdOfType } from "@/lib/ids/prefixed-id";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

export function OrgSwitcher() {
  const router = useRouter();
  const { data: session, isLoading: sessionLoading } = useSession();
  const { data: orgsData, isLoading: orgsLoading } = useOrgs();
  const switchOrg = useSwitchOrg();
  const createOrg = useCreateOrg();

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);

  const currentOrg = orgsData?.data.find((o) => o.id === session?.orgId);
  const otherOrgs = orgsData?.data.filter((o) => o.id !== session?.orgId) ?? [];

  function handleSwitch(orgId: string) {
    // Strip prefix — the raw UUID from orgsData.id is already prefixed by orgRecordSchema
    const rawId = fromExternalIdOfType("org", orgId);
    switchOrg.mutate(rawId, {
      onSuccess: () => {
        router.refresh();
      },
      onError: (err) => {
        toast.error(err.message || "Failed to switch organization");
      },
    });
  }

  function handleCreate() {
    if (!newName.trim()) return;
    const slug = newSlug.trim() || slugify(newName);
    createOrg.mutate(
      { name: newName.trim(), slug },
      {
        onSuccess: (org) => {
          setCreateOpen(false);
          setNewName("");
          setNewSlug("");
          setSlugEdited(false);
          toast.success(`Created ${org.name}`);
          // Switch to the new org
          const rawId = org.id.startsWith("ns_org_") ? org.id.slice(7) : org.id;
          switchOrg.mutate(rawId, {
            onSuccess: () => router.refresh(),
          });
        },
        onError: (err) => {
          toast.error(err.message || "Failed to create organization");
        },
      },
    );
  }

  if (sessionLoading || orgsLoading) {
    return (
      <div className="px-3 py-2">
        <Skeleton className="h-8 w-full rounded-md bg-secondary/50" />
      </div>
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left transition-colors hover:bg-accent/60">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10">
            {currentOrg?.isPersonal ? (
              <User className="h-3 w-3 text-primary" />
            ) : (
              <Building2 className="h-3 w-3 text-primary" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-mono text-[12px] font-medium text-foreground">
              {currentOrg?.name ?? "Personal"}
            </p>
          </div>
          <ChevronsUpDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="w-56">
          {/* Current org */}
          {currentOrg && (
            <DropdownMenuItem disabled className="opacity-100">
              <div className="flex w-full items-center gap-2">
                <div className="flex h-5 w-5 items-center justify-center rounded bg-primary/10">
                  {currentOrg.isPersonal ? (
                    <User className="h-2.5 w-2.5 text-primary" />
                  ) : (
                    <Building2 className="h-2.5 w-2.5 text-primary" />
                  )}
                </div>
                <span className="flex-1 truncate text-[13px]">{currentOrg.name}</span>
                <Check className="h-3.5 w-3.5 text-primary" />
              </div>
            </DropdownMenuItem>
          )}

          {/* Other orgs */}
          {otherOrgs.length > 0 && <DropdownMenuSeparator />}
          {otherOrgs.map((org) => (
            <DropdownMenuItem
              key={org.id}
              onClick={() => handleSwitch(org.id)}
              className="text-[13px]"
            >
              <div className="flex w-full items-center gap-2">
                <div className="flex h-5 w-5 items-center justify-center rounded bg-secondary/50">
                  {org.isPersonal ? (
                    <User className="h-2.5 w-2.5 text-muted-foreground" />
                  ) : (
                    <Building2 className="h-2.5 w-2.5 text-muted-foreground" />
                  )}
                </div>
                <span className="flex-1 truncate">{org.name}</span>
                <Badge variant="outline" className="text-[9px]">{org.role}</Badge>
              </div>
            </DropdownMenuItem>
          ))}

          {/* Create org */}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setCreateOpen(true)} className="text-[13px]">
            <Plus className="mr-2 h-3.5 w-3.5" />
            Create organization
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Create org dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogTitle>Create organization</DialogTitle>
          <DialogDescription>
            Create a team organization to collaborate with others.
          </DialogDescription>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Name</Label>
              <Input
                placeholder="Acme Corp"
                value={newName}
                onChange={(e) => {
                  setNewName(e.target.value);
                  if (!slugEdited) setNewSlug(slugify(e.target.value));
                }}
                className="h-9 text-[13px]"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Slug</Label>
              <Input
                placeholder="acme-corp"
                value={newSlug}
                onChange={(e) => {
                  setNewSlug(e.target.value);
                  setSlugEdited(true);
                }}
                className="h-9 font-mono text-[13px]"
              />
              <p className="text-[11px] text-muted-foreground">
                Lowercase letters, numbers, and hyphens only.
              </p>
            </div>
          </div>
          <DialogFooter>
            <DialogClose>Cancel</DialogClose>
            <Button
              size="sm"
              onClick={handleCreate}
              disabled={!newName.trim() || createOrg.isPending}
            >
              {createOrg.isPending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
