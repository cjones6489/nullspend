"use client";

import { Copy, Key, Loader2, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useApiKeys,
  useCreateApiKey,
  useRevokeApiKey,
} from "@/lib/queries/api-keys";
import { useSession } from "@/lib/queries/session";
import { CopyButton } from "@/components/ui/copy-button";
import { formatRelativeTime } from "@/lib/utils/format";

export function ApiKeysSection() {
  const { data, isLoading, error } = useApiKeys();
  const [createOpen, setCreateOpen] = useState(false);
  const { data: session } = useSession();
  const canCreate = session?.role === "owner" || session?.role === "admin" || session?.role === "member";
  const canRevoke = session?.role === "owner" || session?.role === "admin";

  return (
    <Card className="border-border/50 bg-card">
      <CardHeader className="flex flex-row items-center justify-between pb-4">
        <div>
          <CardTitle className="text-sm font-medium text-foreground">
            API Keys
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Keys are used to authenticate SDK requests. The raw key is only shown once.
          </p>
        </div>
        {canCreate && <CreateKeyDialog open={createOpen} onOpenChange={setCreateOpen} />}
      </CardHeader>
      <CardContent className="p-0">
        {isLoading && <KeysSkeleton />}

        {error && (
          <div className="m-4 rounded-lg border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-400">
            Failed to load API keys.
          </div>
        )}

        {data && data.data.length === 0 && <EmptyKeys />}

        {data && data.data.length > 0 && (
          <div className="border-t border-border/30">
            <Table>
              <TableHeader>
                <TableRow className="border-border/30 hover:bg-transparent">
                  <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Name
                  </TableHead>
                  <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Key
                  </TableHead>
                  <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Last Used
                  </TableHead>
                  <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Created
                  </TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map((key) => (
                  <KeyRow key={key.id} apiKey={key} canRevoke={canRevoke} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function KeyRow({
  apiKey,
  canRevoke,
}: {
  apiKey: {
    id: string;
    name: string;
    keyPrefix: string;
    lastUsedAt: string | null;
    createdAt: string;
  };
  canRevoke: boolean;
}) {
  const revokeKey = useRevokeApiKey();
  const [revokeOpen, setRevokeOpen] = useState(false);

  function handleRevoke() {
    revokeKey.mutate(apiKey.id, {
      onSuccess: () => {
        setRevokeOpen(false);
        toast.success("API key revoked");
      },
      onError: (err) => {
        toast.error(err.message || "Failed to revoke key");
      },
    });
  }

  return (
    <TableRow className="border-border/30 transition-colors hover:bg-accent/40">
      <TableCell className="text-[13px] font-medium text-foreground">
        {apiKey.name}
      </TableCell>
      <TableCell>
        <span className="inline-flex items-center gap-1">
          <code className="rounded bg-secondary/50 px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
            {apiKey.keyPrefix}••••••••
          </code>
          <CopyButton value={apiKey.keyPrefix} />
        </span>
      </TableCell>
      <TableCell
        className="text-xs text-muted-foreground cursor-default"
        title={apiKey.lastUsedAt ? new Date(apiKey.lastUsedAt).toLocaleString() : undefined}
      >
        {apiKey.lastUsedAt ? formatRelativeTime(apiKey.lastUsedAt) : "Never"}
      </TableCell>
      <TableCell
        className="text-xs text-muted-foreground cursor-default"
        title={new Date(apiKey.createdAt).toLocaleString()}
      >
        {formatRelativeTime(apiKey.createdAt)}
      </TableCell>
      <TableCell>
        {canRevoke && (
          <Dialog open={revokeOpen} onOpenChange={setRevokeOpen}>
            <DialogTrigger
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-400"
              aria-label={`Revoke API key "${apiKey.name}"`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </DialogTrigger>
            <DialogContent>
              <DialogTitle>Revoke API key?</DialogTitle>
              <DialogDescription>
                This will immediately invalidate the key &ldquo;{apiKey.name}&rdquo;.
                Any SDK clients using this key will stop working. This cannot be undone.
              </DialogDescription>
              <DialogFooter>
                <DialogClose
                  className="inline-flex h-8 items-center justify-center rounded-md border border-border/50 bg-secondary px-3 text-xs font-medium text-foreground hover:bg-accent"
                  disabled={revokeKey.isPending}
                >
                  Cancel
                </DialogClose>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleRevoke}
                  disabled={revokeKey.isPending}
                >
                  {revokeKey.isPending ? <><Loader2 className="mr-1.5 h-3 w-3 animate-spin" />Revoking...</> : "Revoke Key"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </TableCell>
    </TableRow>
  );
}

function CreateKeyDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createKey = useCreateApiKey();
  const [name, setName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  function handleCreate() {
    createKey.mutate(
      { name },
      {
        onSuccess: (data) => {
          setCreatedKey(data.rawKey);
          setName("");
          toast.success("API key created");
        },
        onError: (err) => {
          toast.error(err.message || "Failed to create key");
        },
      },
    );
  }

  function handleClose(nextOpen: boolean) {
    if (createdKey && !nextOpen) {
      return;
    }

    if (!nextOpen) {
      setCreatedKey(null);
      setName("");
    }
    onOpenChange(nextOpen);
  }

  async function handleCopy() {
    if (createdKey) {
      try {
        await navigator.clipboard.writeText(createdKey);
        toast.success("Copied to clipboard");
      } catch {
        toast.error("Could not copy key. Please copy it manually.");
      }
    }
  }

  function handleDone() {
    setCreatedKey(null);
    setName("");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogTrigger
        className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        <Plus className="h-3.5 w-3.5" />
        Create Key
      </DialogTrigger>
      <DialogContent showCloseButton={!createdKey}>
        {createdKey ? (
          <>
            <DialogTitle>Your new API key</DialogTitle>
            <DialogDescription>
              Copy this key now. You won&apos;t be able to see it again.
            </DialogDescription>
            <div className="space-y-3">
              <div className="flex items-center gap-2 rounded-lg border border-border/50 bg-background p-3">
                <code className="flex-1 break-all font-mono text-xs text-foreground">
                  {createdKey}
                </code>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  aria-label="Copy API key to clipboard"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="text-[11px] text-amber-400/80">
                Store this key securely. It will not be shown again.
              </p>
            </div>
            <DialogFooter>
              <button
                type="button"
                onClick={handleDone}
                className="inline-flex h-8 items-center justify-center rounded-md bg-primary px-4 text-xs font-medium text-primary-foreground hover:bg-primary/90"
              >
                Done
              </button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogTitle>Create API key</DialogTitle>
            <DialogDescription>
              Give your key a name so you can identify it later.
            </DialogDescription>
            <div className="space-y-1.5">
              <Label htmlFor="key-name" className="text-xs text-muted-foreground">
                Key name
              </Label>
              <Input
                id="key-name"
                placeholder='e.g. "Production" or "Dev"'
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-9 border-border/50 bg-background text-[13px] placeholder:text-muted-foreground/50"
                maxLength={50}
              />
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
              >
                {createKey.isPending ? <><Loader2 className="mr-1.5 h-3 w-3 animate-spin" />Creating...</> : "Create Key"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function EmptyKeys() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 border-t border-border/30 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary/50">
        <Key className="h-5 w-5 text-muted-foreground" />
      </div>
      <div>
        <p className="text-sm font-medium text-foreground">No API keys</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Create a key to start using the NullSpend SDK.
        </p>
      </div>
    </div>
  );
}

export function KeysSkeleton() {
  return (
    <div className="space-y-2 border-t border-border/30 p-4">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full rounded-lg bg-secondary/50" />
      ))}
    </div>
  );
}
