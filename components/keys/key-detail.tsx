"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CopyButton } from "@/components/ui/copy-button";
import { useUpdateApiKey, useRevokeApiKey } from "@/lib/queries/api-keys";
import { formatRelativeTime } from "@/lib/utils/format";
import { PolicyEditor } from "@/components/keys/policy-editor";
import { KeyBudgetSection } from "@/components/keys/key-budget-section";
import { KeyTagBudgets } from "@/components/keys/key-tag-budgets";
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

  const handleUpdateTags = async (tags: Record<string, string>) => {
    try {
      await updateKey.mutateAsync({
        id: apiKey.id,
        input: { defaultTags: tags },
      });
      toast.success("Tags updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update tags");
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

        {/* Policy (providers + models) */}
        <Card className="border-border/50 bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Policy
            </CardTitle>
          </CardHeader>
          <CardContent>
            <PolicyEditor
              key={apiKey.id}
              allowedProviders={apiKey.allowedProviders}
              allowedModels={apiKey.allowedModels}
              onSave={handleUpdatePolicy}
              disabled={!canManage}
              saving={updateKey.isPending}
            />
          </CardContent>
        </Card>

        {/* Budget + Velocity + Session */}
        <KeyBudgetSection keyId={apiKey.id} canManage={canManage} />

        {/* Default Tags */}
        <Card className="border-border/50 bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Default Tags
            </CardTitle>
          </CardHeader>
          <CardContent>
            <TagEditor
              key={apiKey.id}
              tags={apiKey.defaultTags}
              onSave={handleUpdateTags}
              disabled={!canManage}
              saving={updateKey.isPending}
            />
          </CardContent>
        </Card>

        {/* Tag Budgets (matched from default tags) */}
        <KeyTagBudgets defaultTags={apiKey.defaultTags} />

        {/* Actions */}
        {canManage && (
          <div className="flex gap-3 border-t border-border/30 pt-4">
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

// ---------------------------------------------------------------------------
// Tag Editor (inline)
// ---------------------------------------------------------------------------

function TagEditor({
  tags,
  onSave,
  disabled,
  saving,
}: {
  tags: Record<string, string>;
  onSave: (tags: Record<string, string>) => Promise<void>;
  disabled?: boolean;
  saving?: boolean;
}) {
  // State is initialized from props. Parent uses key={apiKey.id} to
  // remount this component when the selected key changes.
  const [editing, setEditing] = useState(false);
  const [localTags, setLocalTags] = useState<Record<string, string>>(tags);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");

  const entries = Object.entries(editing ? localTags : tags);

  const addTag = () => {
    const k = newKey.trim();
    const v = newValue.trim();
    if (!k) return;
    if (k.startsWith("_ns_")) {
      toast.error("Tags starting with _ns_ are reserved");
      return;
    }
    setLocalTags((prev) => ({ ...prev, [k]: v }));
    setNewKey("");
    setNewValue("");
  };

  const removeTag = (key: string) => {
    setLocalTags((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  if (!editing) {
    return (
      <div>
        {entries.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            No default tags. Tags are merged into every request from this key.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {entries.map(([k, v]) => (
              <Badge key={k} variant="secondary" className="font-mono text-[11px]">
                {k}={v}
              </Badge>
            ))}
          </div>
        )}
        {!disabled && (
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => setEditing(true)}
          >
            {entries.length === 0 ? "Add Tags" : "Edit Tags"}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {entries.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {entries.map(([k, v]) => (
            <Badge key={k} variant="secondary" className="gap-1 font-mono text-[11px]">
              {k}={v}
              <button
                type="button"
                onClick={() => removeTag(k)}
                className="ml-0.5 rounded-full p-0.5 hover:bg-foreground/10"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <Input
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          placeholder="key"
          className="h-8 w-32 font-mono text-xs"
        />
        <Input
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addTag();
            }
          }}
          placeholder="value"
          className="h-8 flex-1 font-mono text-xs"
        />
        <Button type="button" variant="outline" size="sm" className="h-8 gap-1" onClick={addTag}>
          <Plus className="h-3 w-3" />
        </Button>
      </div>

      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={async () => {
            await onSave(localTags);
            setEditing(false);
          }}
          disabled={saving}
          className="gap-1.5"
        >
          {saving && <Loader2 className="h-3 w-3 animate-spin" />}
          Save Tags
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setLocalTags(tags);
            setEditing(false);
          }}
          disabled={saving}
        >
          Cancel
        </Button>
      </div>

      <p className="text-[10px] text-muted-foreground">
        Max 10 tags. Keys must be alphanumeric/underscore/hyphen. Tags starting with _ns_ are reserved.
      </p>
    </div>
  );
}
