"use client";

import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { toast } from "sonner";

import { useSession } from "@/lib/queries/session";
import { useOrgs } from "@/lib/queries/orgs";
import { apiGet, apiPatch } from "@/lib/api/client";
import { toExternalId } from "@/lib/ids/prefixed-id";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

interface UpgradeUrlResponse {
  data: { upgradeUrl: string | null };
}

/**
 * Org-level upgrade URL editor. Surfaced in budget_exceeded and
 * customer_budget_exceeded denial response bodies as `error.upgrade_url`
 * so client agents can route end-users to the correct upgrade flow.
 *
 * Use `{customer_id}` as a placeholder — the proxy substitutes the
 * customer's ID at denial time. Per-customer overrides are configured
 * on the customer detail page.
 */
export function UpgradeUrlSection() {
  const { data: session, isLoading: sessionLoading } = useSession();
  const { data: orgsData, isLoading: orgsLoading } = useOrgs();

  const currentOrg = orgsData?.data.find((o) => o.id === session?.orgId);
  const isPersonal = currentOrg?.isPersonal ?? true;
  const isOwner = currentOrg?.role === "owner";

  const [upgradeUrl, setUpgradeUrl] = useState("");
  const [initialUrl, setInitialUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  // Fetch the current upgrade URL via the shared API client (handles
  // auth / 401 / error shaping consistently with the rest of the dashboard).
  useEffect(() => {
    if (!session?.orgId) return;
    let cancelled = false;
    const orgExternalId = toExternalId("org", session.orgId);
    apiGet<UpgradeUrlResponse>(`/api/orgs/${orgExternalId}/upgrade-url`)
      .then((json) => {
        if (cancelled) return;
        const url = json?.data?.upgradeUrl ?? null;
        setUpgradeUrl(url ?? "");
        setInitialUrl(url);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[upgrade-url-section] failed to fetch current URL:", err);
        setInitialUrl(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session?.orgId]);

  async function handleSave() {
    if (!session?.orgId) return;
    const trimmed = upgradeUrl.trim();
    setSaving(true);
    try {
      const orgExternalId = toExternalId("org", session.orgId);
      await apiPatch(`/api/orgs/${orgExternalId}/upgrade-url`, {
        upgradeUrl: trimmed === "" ? null : trimmed,
      });
      setInitialUrl(trimmed === "" ? null : trimmed);
      toast.success(trimmed === "" ? "Upgrade URL cleared" : "Upgrade URL saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save upgrade URL");
    } finally {
      setSaving(false);
    }
  }

  const hasChanges = (upgradeUrl.trim() || null) !== initialUrl;

  if (sessionLoading || orgsLoading || loading) {
    return (
      <Card className="border-border/50 bg-card">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-foreground">Upgrade URL</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-9 w-full rounded-lg bg-secondary/50" />
        </CardContent>
      </Card>
    );
  }

  if (isPersonal) {
    // Personal orgs don't expose this — feature only makes sense for team orgs
    return null;
  }

  return (
    <Card className="border-border/50 bg-card">
      <CardHeader className="pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <ExternalLink className="h-4 w-4 text-primary" />
          </div>
          <div>
            <CardTitle className="text-sm font-medium text-foreground">Upgrade URL</CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Surfaced in 429 denial responses so end-users can self-serve upgrade
            </p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">URL</Label>
          <Input
            value={upgradeUrl}
            onChange={(e) => setUpgradeUrl(e.target.value)}
            placeholder="https://example.com/upgrade?customer={customer_id}"
            disabled={!isOwner}
            className="h-9 border-border/50 bg-background font-mono text-[13px]"
          />
          <p className="text-[11px] text-muted-foreground">
            HTTPS only. Use <code className="rounded bg-secondary px-1 py-0.5 text-[10px]">{`{customer_id}`}</code> as a placeholder for the customer ID — the proxy substitutes it at denial time. Per-customer overrides can be set via the <code className="rounded bg-secondary px-1 py-0.5 text-[10px]">PATCH /api/orgs/&#123;orgId&#125;/customers/&#123;customerId&#125;/upgrade-url</code> endpoint (dashboard UI coming soon).
          </p>
        </div>
        {isOwner && (
          <Button size="sm" onClick={handleSave} disabled={!hasChanges || saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
        )}
        {!isOwner && (
          <p className="text-[11px] text-muted-foreground">
            Only the org owner can change the upgrade URL.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
