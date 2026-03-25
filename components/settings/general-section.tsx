"use client";

import { useState } from "react";
import { Building2, User } from "lucide-react";
import { toast } from "sonner";

import { useSession } from "@/lib/queries/session";
import { useOrgs } from "@/lib/queries/orgs";
import { apiPatch } from "@/lib/api/client";
import { toExternalId } from "@/lib/ids/prefixed-id";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
          </>
        )}
      </CardContent>
    </Card>
  );
}
