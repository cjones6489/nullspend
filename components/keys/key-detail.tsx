"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Pencil, Plus, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { CopyButton } from "@/components/ui/copy-button";
import { useUpdateApiKey, useRevokeApiKey } from "@/lib/queries/api-keys";
import { formatRelativeTime } from "@/lib/utils/format";
import { RevokeKeyDialog } from "@/components/keys/revoke-key-dialog";
import { validateTagAdd } from "@/components/keys/tag-utils";
import type { ApiKeyRecord } from "@/lib/validations/api-keys";

interface KeyDetailProps {
  apiKey: ApiKeyRecord;
  canManage: boolean;
}

export function KeyDetail({ apiKey, canManage }: KeyDetailProps) {
  const updateKey = useUpdateApiKey();
  const revokeKey = useRevokeApiKey();
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);

  const tagEntries = Object.entries(apiKey.defaultTags);

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
      <div className="space-y-4">
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

        {/* Tags (read-only badges + edit icon) */}
        <div className="flex items-center gap-2">
          {tagEntries.length > 0 ? (
            <>
              <div className="flex flex-wrap gap-1.5">
                {tagEntries.map(([k, v]) => (
                  <Badge key={k} variant="secondary" className="font-mono text-[11px]">
                    {k}={v}
                  </Badge>
                ))}
              </div>
              {canManage && (
                <button
                  type="button"
                  onClick={() => setTagsOpen(true)}
                  className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <Pencil className="h-3 w-3" />
                </button>
              )}
            </>
          ) : canManage ? (
            <button
              type="button"
              onClick={() => setTagsOpen(true)}
              className="text-[13px] text-muted-foreground transition-colors hover:text-foreground"
            >
              + Add tags
            </button>
          ) : (
            <span className="text-[13px] text-muted-foreground">No tags</span>
          )}
        </div>

        {/* Revoke */}
        {canManage && (
          <div className="border-t border-border/30 pt-4">
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

      {/* Edit Tags Dialog */}
      <EditTagsDialog
        key={apiKey.id}
        open={tagsOpen}
        onOpenChange={setTagsOpen}
        tags={apiKey.defaultTags}
        saving={updateKey.isPending}
        onSave={async (tags) => {
          await updateKey.mutateAsync({
            id: apiKey.id,
            input: { defaultTags: tags },
          });
          toast.success("Tags updated");
          setTagsOpen(false);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit Tags Dialog
// ---------------------------------------------------------------------------

function EditTagsDialog({
  open,
  onOpenChange,
  tags,
  saving,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tags: Record<string, string>;
  saving: boolean;
  onSave: (tags: Record<string, string>) => Promise<void>;
}) {
  const [localTags, setLocalTags] = useState<Record<string, string>>(tags);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");

  const entries = Object.entries(localTags);

  const addTag = () => {
    const k = newKey.trim();
    if (!k) return;
    const error = validateTagAdd(k, localTags, newValue.trim());
    if (error) {
      toast.error(error);
      return;
    }
    setLocalTags((prev) => ({ ...prev, [k]: newValue.trim() }));
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

  const handleClose = (value: boolean) => {
    if (!value) {
      setLocalTags(tags);
      setNewKey("");
      setNewValue("");
    }
    onOpenChange(value);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <DialogTitle>Edit Default Tags</DialogTitle>
        <DialogDescription>
          Tags are merged into every request from this key.
        </DialogDescription>

        <div className="space-y-3 py-2">
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

          <p className="text-[10px] text-muted-foreground">
            Max 10 tags. Keys must be alphanumeric/underscore/hyphen. Tags starting with _ns_ are reserved.
          </p>
        </div>

        <DialogFooter>
          <DialogClose
            className="inline-flex h-8 items-center justify-center rounded-md border border-border/50 bg-secondary px-3 text-xs font-medium text-foreground hover:bg-accent"
          >
            Cancel
          </DialogClose>
          <Button
            size="sm"
            onClick={async () => {
              try {
                await onSave(localTags);
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Failed to update tags");
              }
            }}
            disabled={saving}
            className="gap-1.5"
          >
            {saving && <Loader2 className="h-3 w-3 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
