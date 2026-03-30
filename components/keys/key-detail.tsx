"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { useUpdateApiKey, useRevokeApiKey } from "@/lib/queries/api-keys";
import { formatRelativeTime } from "@/lib/utils/format";
import { PolicyEditor } from "@/components/keys/policy-editor";
import { RevokeKeyDialog } from "@/components/keys/revoke-key-dialog";
import type { ApiKeyRecord } from "@/lib/validations/api-keys";

interface KeyDetailProps {
  apiKey: ApiKeyRecord;
  canManage: boolean;
}

export function KeyDetail({ apiKey, canManage }: KeyDetailProps) {
  const updateKey = useUpdateApiKey();
  const revokeKey = useRevokeApiKey();
  const [revokeOpen, setRevokeOpen] = useState(false);

  const handleUpdatePolicy = async (
    allowedProviders: string[] | null,
    allowedModels: string[] | null,
  ) => {
    try {
      await updateKey.mutateAsync({
        id: apiKey.id,
        input: {
          allowedProviders: allowedProviders as ("openai" | "anthropic")[] | null | undefined,
          allowedModels,
        },
      });
      toast.success("Policy updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update policy");
    }
  };

  const handleRevoke = async () => {
    try {
      await revokeKey.mutateAsync(apiKey.id);
      toast.success("Key revoked");
      setRevokeOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to revoke key");
    }
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h2 className="text-lg font-semibold text-foreground">{apiKey.name}</h2>
          <div className="mt-1 flex items-center gap-2">
            <code className="rounded bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
              {apiKey.keyPrefix}...
            </code>
            <CopyButton value={apiKey.keyPrefix} />
          </div>
        </div>

        {/* Metadata */}
        <div className="flex gap-6 text-[13px] text-muted-foreground">
          <div>
            <span className="text-muted-foreground/70">Created </span>
            {formatRelativeTime(apiKey.createdAt)}
          </div>
          <div>
            <span className="text-muted-foreground/70">Last used </span>
            {apiKey.lastUsedAt ? formatRelativeTime(apiKey.lastUsedAt) : "Never"}
          </div>
        </div>

        {/* Default Tags */}
        {Object.keys(apiKey.defaultTags).length > 0 && (
          <Card className="border-border/50 bg-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Default Tags
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(apiKey.defaultTags).map(([k, v]) => (
                  <Badge key={k} variant="secondary" className="font-mono text-[11px]">
                    {k}={v}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Policy */}
        <Card className="border-border/50 bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Policy
            </CardTitle>
          </CardHeader>
          <CardContent>
            <PolicyEditor
              allowedProviders={apiKey.allowedProviders}
              allowedModels={apiKey.allowedModels}
              onSave={handleUpdatePolicy}
              disabled={!canManage}
              saving={updateKey.isPending}
            />
          </CardContent>
        </Card>

        {/* Actions */}
        {canManage && (
          <div className="flex gap-3">
            <RevokeKeyDialog
              open={revokeOpen}
              onOpenChange={setRevokeOpen}
              onConfirm={handleRevoke}
              keyName={apiKey.name}
              isPending={revokeKey.isPending}
            />
          </div>
        )}
      </div>
    </div>
  );
}
