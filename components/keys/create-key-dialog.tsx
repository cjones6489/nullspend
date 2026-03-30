"use client";

import { useState } from "react";
import { Copy, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

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
import { useCreateApiKey } from "@/lib/queries/api-keys";

interface CreateKeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateKeyDialog({ open, onOpenChange }: CreateKeyDialogProps) {
  const createKey = useCreateApiKey();
  const [name, setName] = useState("");
  const [rawKey, setRawKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) return;
    try {
      const result = await createKey.mutateAsync({ name: name.trim() });
      setRawKey(result.rawKey);
      toast.success("API key created");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create key");
    }
  };

  const handleCopy = async () => {
    if (!rawKey) return;
    await navigator.clipboard.writeText(rawKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClose = (value: boolean) => {
    if (!value) {
      setName("");
      setRawKey(null);
      setCopied(false);
    }
    onOpenChange(value);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogTrigger
        className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        <Plus className="h-3.5 w-3.5" />
        Create Key
      </DialogTrigger>
      <DialogContent>
        {rawKey ? (
          <>
            <DialogTitle>Key Created</DialogTitle>
            <DialogDescription>
              Copy this key now. You will not be able to see it again.
            </DialogDescription>
            <div className="flex items-center gap-2 rounded-md border border-border/50 bg-muted p-3">
              <code className="flex-1 break-all font-mono text-xs text-foreground">
                {rawKey}
              </code>
              <Button variant="ghost" size="sm" onClick={handleCopy} className="shrink-0">
                <Copy className="h-3.5 w-3.5" />
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <DialogFooter>
              <DialogClose
                className="inline-flex h-8 items-center justify-center rounded-md border border-border/50 bg-secondary px-3 text-xs font-medium text-foreground hover:bg-accent"
              >
                Done
              </DialogClose>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogTitle>Create API Key</DialogTitle>
            <DialogDescription>
              Give this key a name. You can set policy restrictions after creation.
            </DialogDescription>
            <div className="space-y-3 py-2">
              <div>
                <Label htmlFor="key-name" className="text-[13px]">Name</Label>
                <Input
                  id="key-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleCreate();
                    }
                  }}
                  placeholder="e.g. Production Agent"
                  className="mt-1"
                  autoFocus
                />
              </div>
            </div>
            <DialogFooter>
              <DialogClose
                className="inline-flex h-8 items-center justify-center rounded-md border border-border/50 bg-secondary px-3 text-xs font-medium text-foreground hover:bg-accent"
              >
                Cancel
              </DialogClose>
              <Button
                size="sm"
                onClick={handleCreate}
                disabled={!name.trim() || createKey.isPending}
                className="gap-1.5"
              >
                {createKey.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                Create
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
